const cron = require('node-cron');
const Notification = require('../models/Notification');
const User = require('../models/User');
const { sendToDevice, isInvalidTokenError } = require('../services/firebaseService');
const { sendTelegramMessage } = require('../services/notificationService');
const logger = require('../config/logger');

const MAX_ATTEMPTS = 3;

// Exponential backoff delays in ms: attempt 1→10min, 2→20min, 3→40min
function backoffMs(attempt) {
  return 10 * 60 * 1000 * Math.pow(2, attempt - 1);
}

function isRetryDue(delivery) {
  if (delivery.status !== 'failed') return false;
  if (delivery.attempts >= MAX_ATTEMPTS) return false;
  if (!delivery.lastAttemptAt) return true;
  const elapsed = Date.now() - new Date(delivery.lastAttemptAt).getTime();
  return elapsed >= backoffMs(delivery.attempts);
}

async function retryFailedNotifications() {
  try {
    const candidates = await Notification.find({
      'delivery.status': 'failed',
      'delivery.attempts': { $lt: MAX_ATTEMPTS },
      createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    }).populate('userId', 'fcmToken telegramChatId preferences').lean();

    if (!candidates.length) return;

    let retried  = 0;
    let recovered = 0;

    for (const notif of candidates) {
      const user = notif.userId;
      if (!user) continue;

      const updatedDelivery = notif.delivery.map(d => ({ ...d }));
      let changed = false;

      for (const d of updatedDelivery) {
        if (!isRetryDue(d)) continue;

        retried++;
        const now = new Date();
        let success = false;

        if (d.channel === 'fcm' && user.fcmToken) {
          const result = await sendToDevice(user.fcmToken, notif.title, notif.body, {
            signalId:  notif.data?.signalId  || '',
            asset:     notif.data?.asset     || '',
            direction: notif.data?.action    || '',
          });
          success = result.success;
          if (!success) {
            d.lastError = result.error;
            if (isInvalidTokenError(result.code)) {
              await User.updateOne({ _id: user._id }, { $unset: { fcmToken: '' } }).catch(() => {});
              d.attempts = MAX_ATTEMPTS; // no more retries for invalid token
            }
          }
        }

        if (d.channel === 'telegram' && user.telegramChatId && user.preferences?.telegramEnabled) {
          success = await sendTelegramMessage(
            user.telegramChatId,
            `*${notif.title}*\n\n${notif.body}`
          );
          if (!success) d.lastError = 'Telegram send failed';
        }

        d.attempts       += 1;
        d.lastAttemptAt   = now;

        if (success) {
          d.status = 'sent';
          d.sentAt = now;
          recovered++;
        } else {
          // T-082 (2026-08-31): both branches of this used to evaluate to
          // 'failed' -- a dead ternary that looked like it should
          // distinguish "still eligible for another retry" from
          // "permanently exhausted", but the Notification schema's
          // delivery.status enum (['sent','failed','pending']) has no
          // third value for that. Simplified to what it actually always
          // did -- zero behavior change, no schema change. Future
          // retry-eligibility is (and was) already correctly gated
          // separately, by `attempts` against MAX_ATTEMPTS, both in
          // isRetryDue() above and in the query in
          // retryFailedNotifications() -- this field was never actually
          // used to decide that. Distinguishing "retrying" from
          // "exhausted" in delivery.status itself would need a real
          // schema change (a new enum value), not just this line -- a
          // separate, deliberate decision, not bundled into this cleanup.
          d.status = 'failed';
        }

        changed = true;
      }

      if (changed) {
        await Notification.updateOne(
          { _id: notif._id },
          {
            $set: {
              delivery:     updatedDelivery,
              successCount: updatedDelivery.filter(d => d.status === 'sent').length,
              failureCount: updatedDelivery.filter(d => d.status === 'failed').length,
            },
          }
        ).catch(err => logger.warn(`[RetryJob] Update failed: ${err.message}`));
      }
    }

    if (retried > 0) {
      logger.info(`[RetryJob] Processed ${retried} retries — ${recovered} recovered`);
    }
  } catch (err) {
    logger.error(`[RetryJob] retryFailedNotifications error: ${err.stack}`);
  }
}

function startNotificationRetryJob() {
  cron.schedule('*/10 * * * *', retryFailedNotifications);
  logger.info('  Notification retry job: every 10 min (exponential backoff: 10/20/40 min)');
}

module.exports = { startNotificationRetryJob };
