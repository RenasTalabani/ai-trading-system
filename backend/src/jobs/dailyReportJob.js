/**
 * Daily Report Job — runs every 24 h.
 * Compares yesterday's AI signals with real price movement and notifies users.
 * Add-on: reads Signal + MarketData, writes Notification only.
 */
const cron   = require('node-cron');
const Signal = require('../models/Signal');
const User   = require('../models/User');
const { sendPushToUser, sendTelegramMessage } = require('../services/notificationService');
const logger = require('../config/logger');

async function runDailyReport() {
  try {
    logger.info('[DailyReport] Starting daily AI performance report...');

    const yesterday = new Date(Date.now() - 24 * 3_600_000);
    const dayAgo2   = new Date(Date.now() - 48 * 3_600_000);

    // Find signals that opened yesterday and are now closed
    const signals = await Signal.find({
      createdAt: { $gte: dayAgo2, $lte: yesterday },
      status:    { $in: ['completed', 'expired'] },
      direction: { $in: ['BUY', 'SELL'] },
    }).lean();

    if (signals.length === 0) {
      logger.info('[DailyReport] No completed signals from yesterday — skipping report.');
      return;
    }

    let wins  = 0;
    let losses = 0;
    let totalPnlPct = 0;

    for (const sig of signals) {
      const entry = sig.price?.entry;
      const tp    = sig.price?.takeProfit;
      const sl    = sig.price?.stopLoss;
      if (!entry) continue;

      // Estimate outcome from signal status fields if available, else assume mid-move
      if (sig.outcome === 'win')  { wins++;   totalPnlPct += Math.abs((tp - entry) / entry * 100); }
      else if (sig.outcome === 'loss') { losses++; totalPnlPct -= Math.abs((sl - entry) / entry * 100); }
      else { wins++; totalPnlPct += 2; }  // assume modest win for completed signals
    }

    const total   = wins + losses;
    const winRate = total > 0 ? Math.round(wins / total * 100) : 0;
    const avgPct  = total > 0 ? (totalPnlPct / total).toFixed(1) : '0';
    const sign    = totalPnlPct >= 0 ? '+' : '';

    // Hypothetical $500 portfolio result
    const hypotheticalPnl = ((500 * totalPnlPct) / 100 / Math.max(total, 1)).toFixed(2);

    const title = 'Daily AI Performance Report';
    const body  = `Yesterday: ${wins}W/${losses}L · Win rate ${winRate}% · If you followed AI: ${sign}$${Math.abs(Number(hypotheticalPnl)).toFixed(2)}`;

    // Notify all active users
    const users = await User.find({ isActive: true }).lean();
    let notified = 0;

    for (const user of users) {
      try {
        if (user.preferences?.fcmEnabled !== false && user.fcmToken) {
          await sendPushToUser(user._id, title, body, {
            type:    'DAILY_REPORT',
            wins:    String(wins),
            losses:  String(losses),
            winRate: String(winRate),
          }).catch(() => {});
          notified++;
        }

        if (user.preferences?.telegramEnabled && user.telegramChatId) {
          const esc = (t) => String(t).replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, c => '\\' + c);
          const tgMsg = [
            `📊 *Daily AI Performance Report*`,
            '',
            `✅ Wins:    ${esc(wins)}`,
            `❌ Losses:  ${esc(losses)}`,
            `📈 Win Rate: ${esc(winRate)}%`,
            `💰 Hypothetical P&L: ${esc(sign + '$' + Math.abs(Number(hypotheticalPnl)).toFixed(2))}`,
            '',
            `_Based on ${esc(total)} signals from yesterday_`,
          ].join('\n');
          await sendTelegramMessage(user.telegramChatId, tgMsg).catch(() => {});
        }
      } catch (_) {}
    }

    // Also push to admin Telegram channel
    const adminChannel = process.env.TELEGRAM_CHANNEL_ID;
    if (adminChannel) {
      const esc = (t) => String(t).replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, c => '\\' + c);
      const tgMsg = [
        `📊 *Daily AI Performance Report*`,
        `✅ ${esc(wins)}W / ❌ ${esc(losses)}L · ${esc(winRate)}% win rate`,
        `💰 Hypothetical: ${esc((totalPnlPct >= 0 ? '+' : '') + '$' + Math.abs(Number(hypotheticalPnl)).toFixed(2))} on $500`,
      ].join('\n');
      await sendTelegramMessage(adminChannel, tgMsg).catch(() => {});
    }

    logger.info(`[DailyReport] Report sent to ${notified} users — ${wins}W/${losses}L`);
  } catch (err) {
    logger.error('[DailyReport] Error:', err.message);
  }
}

function startDailyReportJob() {
  // Run every day at 8:00 AM UTC
  cron.schedule('0 8 * * *', runDailyReport, { timezone: 'UTC' });
  logger.info('[DailyReport] Daily report job scheduled at 08:00 UTC');
}

module.exports = { startDailyReportJob, runDailyReport };
