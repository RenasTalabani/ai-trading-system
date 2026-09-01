const axios = require('axios');
const User = require('../models/User');
const Notification = require('../models/Notification');
const { sendMulticast, sendToDevice, isInvalidTokenError } = require('./firebaseService');
const logger = require('../config/logger');

// ─── Risk Control ─────────────────────────────────────────────────────────────

function getRiskFlags(signal) {
  const flags = [];
  const conf = signal.confidence ?? 0;

  if (conf < 75) flags.push('⚠️ Borderline confidence');

  const { market = {}, news = {}, social = {} } = signal.sources || {};

  // Social-dominant signal with weak market backing
  if ((social.score ?? 0) > 70 && (market.score ?? 0) < 40) {
    flags.push('⚠️ Social-driven — limited market confirmation');
  }

  // Wide SL/TP spread indicates high volatility
  if (signal.price?.entry && signal.price?.stopLoss) {
    const spread = Math.abs(signal.price.entry - signal.price.stopLoss) / signal.price.entry;
    if (spread > 0.04) flags.push('⚠️ High volatility — wide stop');
  }

  // Weak news backing
  if ((news.score ?? 0) < 20 && (market.score ?? 0) < 50) {
    flags.push('⚠️ Low multi-source confirmation');
  }

  return flags;
}

// ─── Smart Filter ─────────────────────────────────────────────────────────────

async function shouldNotifyUser(user, signal) {
  if (!user.preferences?.notificationsEnabled) return false;

  // Asset filter
  const watchedAssets = user.preferences?.assets || [];
  if (watchedAssets.length && !watchedAssets.includes(signal.asset)) return false;

  // Confidence threshold
  const threshold = user.preferences?.confidenceThreshold ?? 70;
  if ((signal.confidence ?? 0) < threshold) return false;

  // Duplicate: same asset + direction within 2h
  const duplicate = await Notification.findOne({
    userId: user._id,
    'data.asset': signal.asset,
    'data.action': signal.direction,
    createdAt: { $gte: new Date(Date.now() - 2 * 60 * 60 * 1000) },
  }).lean();
  if (duplicate) return false;

  // Hourly rate limit
  const maxPerHour = user.preferences?.maxNotificationsPerHour ?? 5;
  const recentCount = await Notification.countDocuments({
    userId: user._id,
    createdAt: { $gte: new Date(Date.now() - 60 * 60 * 1000) },
  });
  if (recentCount >= maxPerHour) return false;

  return true;
}

// ─── Telegram ────────────────────────────────────────────────────────────────

async function sendTelegramMessage(chatId, text, options = {}) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || !chatId) return false;
  try {
    // Bug fix (2026-09-01, deep audit pass): this call had no timeout --
    // axios does not apply one by default, so a hung/slow Telegram API
    // response could block whatever caller awaited this indefinitely
    // (notification jobs run in a loop over many users -- one slow
    // Telegram response could stall the whole batch). Same class of bug
    // already fixed elsewhere in this codebase (T-088, T-089), just missed
    // here. Still wrapped in try/catch either way, so this only bounds how
    // long a failure takes to surface, not whether it's handled.
    await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
      chat_id:                  chatId,
      text,
      parse_mode:               'MarkdownV2',
      disable_web_page_preview: true,
      ...options,
    }, { timeout: 8000 });
    return true;
  } catch (err) {
    logger.error(`Telegram failed for chatId ${chatId}:`, err.message);
    return false;
  }
}

function esc(text) {
  return String(text).replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, c => '\\' + c);
}

function buildSignalMessage(signal, riskFlags = []) {
  const dir      = signal.direction;
  const emoji    = dir === 'BUY' ? '🟢' : dir === 'SELL' ? '🔴' : '🟡';
  const conf     = signal.confidence ?? 0;
  const filled   = Math.round(conf / 10);
  const confBar  = '█'.repeat(filled) + '░'.repeat(10 - filled);

  const lines = [
    `${emoji} *AI Trading Signal*`,
    '',
    `📊 *Asset:*      \`${esc(signal.asset)}\``,
    `📈 *Direction:*  *${esc(dir)}*`,
    `🎯 *Confidence:* ${esc(conf)}% ${esc(confBar)}`,
    `💰 *Entry Price:* \`$${esc(signal.price?.entry ?? 0)}\``,
  ];

  if (signal.price?.stopLoss)   lines.push(`🛑 *Stop Loss:*   \`$${esc(signal.price.stopLoss)}\``);
  if (signal.price?.takeProfit) lines.push(`✅ *Take Profit:* \`$${esc(signal.price.takeProfit)}\``);

  const { market = {}, news = {}, social = {} } = signal.sources || {};
  lines.push('');
  lines.push(`📡 *Sources:* Market ${esc(market.score ?? 0)}% · News ${esc(news.score ?? 0)}% · Social ${esc(social.score ?? 0)}%`);

  if (signal.reason) {
    lines.push('');
    lines.push(`💬 _${esc(signal.reason)}_`);
  }

  if (riskFlags.length) {
    lines.push('');
    riskFlags.forEach(f => lines.push(esc(f)));
  }

  lines.push('');
  lines.push(`🕐 _${esc(new Date().toUTCString())}_`);

  return lines.join('\n');
}

function buildSignalTitle(signal) {
  const emoji = signal.direction === 'BUY' ? '🟢' : signal.direction === 'SELL' ? '🔴' : '🟡';
  return `${emoji} ${signal.direction} ${signal.asset} — ${signal.confidence}% confidence`;
}

function buildFcmBody(signal, riskFlags) {
  let body = signal.reason || `${signal.direction} signal for ${signal.asset}`;
  if (riskFlags.length) body += ` ${riskFlags[0]}`;
  return body;
}

// ─── FCM helpers ─────────────────────────────────────────────────────────────

async function purgeInvalidTokens(results) {
  for (const r of results) {
    if (!r.success && isInvalidTokenError(r.code)) {
      await User.updateMany({ fcmToken: r.token }, { $unset: { fcmToken: '' } }).catch(() => {});
    }
  }
}

// ─── Notification persistence ─────────────────────────────────────────────────

async function persistNotification(userId, signal, delivery) {
  try {
    return await Notification.create({
      userId,
      type:  'signal',
      title: buildSignalTitle(signal),
      body:  signal.reason || `${signal.direction} signal for ${signal.asset}`,
      data: {
        signalId:   signal._id?.toString(),
        asset:      signal.asset,
        action:     signal.direction,
        confidence: signal.confidence,
        price:      signal.price?.entry,
        stopLoss:   signal.price?.stopLoss,
        takeProfit: signal.price?.takeProfit,
      },
      delivery,
      successCount: delivery.filter(d => d.status === 'sent').length,
      failureCount:  delivery.filter(d => d.status === 'failed').length,
    });
  } catch (err) {
    logger.warn('Notification persist failed:', err.message);
    return null;
  }
}

// ─── Main signal notification ─────────────────────────────────────────────────

async function sendSignalNotification(signal) {
  const riskFlags = getRiskFlags(signal);
  const allUsers  = await User.find({ isActive: true }).lean();

  // Apply smart filter per user
  const eligible = [];
  for (const user of allUsers) {
    if (await shouldNotifyUser(user, signal)) eligible.push(user);
  }

  if (!eligible.length) {
    logger.info(`[Notify] Signal ${signal._id} — no eligible recipients after filtering`);
    signal.notificationSent = { fcm: false, telegram: false };
    await signal.save().catch(() => {});
    return { fcmSent: 0, fcmFailed: 0, telegramSent: 0 };
  }

  const title    = buildSignalTitle(signal);
  const fcmBody  = buildFcmBody(signal, riskFlags);
  const tgMsg    = buildSignalMessage(signal, riskFlags);

  const fcmData = {
    signalId:   String(signal._id || ''),
    asset:      signal.asset,
    direction:  signal.direction,
    confidence: String(signal.confidence ?? 0),
    price:      String(signal.price?.entry ?? 0),
    hasRisk:    String(riskFlags.length > 0),
  };

  // Sort by confidence proximity to ideal (highest wins)
  eligible.sort((a, b) =>
    (b.preferences?.confidenceThreshold ?? 70) - (a.preferences?.confidenceThreshold ?? 70)
  );

  // ── FCM multicast ──
  const fcmTokens = eligible
    .filter(u => u.preferences?.fcmEnabled !== false && u.fcmToken)
    .map(u => u.fcmToken);

  let fcmSuccess = 0;
  let fcmFail    = 0;
  let fcmResults = [];

  if (fcmTokens.length) {
    const result = await sendMulticast(fcmTokens, title, fcmBody, fcmData);
    fcmSuccess = result.successCount;
    fcmFail    = result.failureCount;
    fcmResults = result.results;
    await purgeInvalidTokens(fcmResults);
  }

  // ── Telegram per-user ──
  let telegramSent = 0;
  const inlineKeyboard = {
    inline_keyboard: [[
      { text: '📈 TradingView', url: `https://www.tradingview.com/chart/?symbol=BINANCE:${signal.asset}` },
    ]],
  };

  for (const user of eligible) {
    if (user.preferences?.telegramEnabled && user.telegramChatId) {
      const ok = await sendTelegramMessage(user.telegramChatId, tgMsg, {
        reply_markup: JSON.stringify(inlineKeyboard),
      });
      if (ok) telegramSent++;
    }
  }

  // ── Admin channel broadcast ──
  const adminChannel = process.env.TELEGRAM_CHANNEL_ID;
  if (adminChannel) {
    await sendTelegramMessage(adminChannel, tgMsg, {
      reply_markup: JSON.stringify(inlineKeyboard),
    });
  }

  // ── Persist per-user records ──
  const fcmResultMap = new Map(fcmResults.map(r => [r.token, r]));
  for (const user of eligible) {
    const delivery = [];
    const now = new Date();

    if (user.preferences?.fcmEnabled !== false && user.fcmToken) {
      const r = fcmResultMap.get(user.fcmToken);
      delivery.push({
        channel:       'fcm',
        status:        r?.success ? 'sent' : 'failed',
        attempts:      1,
        lastAttemptAt: now,
        sentAt:        r?.success ? now : undefined,
        lastError:     r?.error,
      });
    }

    if (user.preferences?.telegramEnabled && user.telegramChatId) {
      delivery.push({
        channel:       'telegram',
        status:        'sent',
        attempts:      1,
        lastAttemptAt: now,
        sentAt:        now,
      });
    }

    if (delivery.length) {
      await persistNotification(user._id, signal, delivery);
    }
  }

  signal.notificationSent = { fcm: fcmSuccess > 0, telegram: telegramSent > 0 };
  await signal.save().catch(() => {});

  logger.info(
    `[Notify] Signal ${signal._id} → FCM: ${fcmSuccess}/${fcmTokens.length}, ` +
    `Telegram: ${telegramSent}, RiskFlags: ${riskFlags.length}, ` +
    `Eligible: ${eligible.length}/${allUsers.length}`
  );

  return { fcmSent: fcmSuccess, fcmFailed: fcmFail, telegramSent, riskFlags };
}

// ─── Trade-event in-app persistence (BUG-004) ──────────────────────────────────
// Fans a trade-open/trade-close event out to every active user's in-app
// notification list. Deliberately NOT gated on preferences.fcmEnabled --
// that preference controls whether a *push* goes to the device, but a
// user who disabled push should still be able to open the app and see
// what the AI actually did with their (paper) money, which is the whole
// point of this fix. This app has a single shared paper-trading portfolio
// (VirtualTrade carries no per-user field), so "every active user" is the
// correct audience, matching sendTradeClosedNotification's existing push
// fan-out (User.find({isActive:true, ...})) above/below.
async function persistTradeEventNotification(type, title, body, data) {
  try {
    const users = await User.find({ isActive: true }).select('_id').lean();
    await Promise.all(users.map(u =>
      Notification.create({ userId: u._id, type, title, body, data }).catch(() => null)
    ));
  } catch (err) {
    logger.warn(`[Notify] persistTradeEventNotification(${type}) failed:`, err.message);
  }
}

// ─── Trade opened notification (BUG-004) ───────────────────────────────────────
// Previously: no notification-creation code of any kind existed for
// trade-open events (confirmed by tracing virtualTrackingService.js) -- a
// user relying on notifications to know when the AI took a position for
// them would only find out by manually checking the app. In-app only for
// now (matches the reported gap exactly); push/Telegram on open was not
// requested and isn't added here to keep this change scoped to what was
// actually found missing.
async function sendTradeOpenedNotification(trade) {
  const { asset, direction, entryPrice, sizeUsd } = trade;
  const title = `🟢 ${asset} ${direction} opened`;
  const body  = `Entry: $${entryPrice} · Size: $${sizeUsd?.toFixed ? sizeUsd.toFixed(2) : sizeUsd}`;
  await persistTradeEventNotification('trade_open', title, body, {
    tradeId: trade._id?.toString(),
    asset,
    action: direction,
    price:  entryPrice,
  });
}

// ─── Trade closed notification ────────────────────────────────────────────────

async function sendTradeClosedNotification(trade, portfolio) {
  try {
    const { asset, direction, pnl, pnlPct, exitReason, result } = trade;
    const isWin    = result === 'win';
    const emoji    = isWin ? '✅' : '❌';
    const sign     = pnl >= 0 ? '+' : '';
    const balance  = parseFloat(portfolio.currentBalance.toFixed(2));

    const title = `${emoji} ${asset} ${direction} — ${exitReason}`;
    const body  = `P&L: ${sign}$${Math.abs(pnl).toFixed(2)} (${sign}${pnlPct?.toFixed(2) ?? '0.00'}%) · Balance: $${balance}`;

    const tgMsg = [
      `${emoji} *Virtual Trade Closed*`,
      '',
      `📊 *Asset:* \`${esc(asset)}\` ${esc(direction)}`,
      `🏁 *Exit:* ${esc(exitReason)}`,
      `💰 *P&L:* ${esc(sign + '$' + Math.abs(pnl).toFixed(2))} \\(${esc(sign + (pnlPct?.toFixed(2) ?? '0.00') + '%')}\\)`,
      `💼 *Balance:* \`$${esc(balance)}\``,
      `📈 *Win Rate:* ${esc(portfolio.winCount + portfolio.lossCount > 0
        ? ((portfolio.winCount / (portfolio.winCount + portfolio.lossCount)) * 100).toFixed(1)
        : '0.0')}%`,
    ].join('\n');

    const fcmData = {
      type:       'trade_closed',
      asset,
      direction,
      exitReason,
      pnl:        String(pnl),
      balance:    String(balance),
    };

    // Push to all active users with FCM who haven't opted out of push
    // (T-055: this used to push regardless of preferences.fcmEnabled, unlike
    // every other broadcast-push path — sendSignalNotification, dailyReportJob,
    // weeklyReportJob, globalScanJob — which all honor that preference.)
    const allUsers = await User.find({ isActive: true, fcmToken: { $exists: true, $ne: '' } }).lean();
    const tokens   = allUsers
      .filter(u => u.preferences?.fcmEnabled !== false)
      .map(u => u.fcmToken)
      .filter(Boolean);

    if (tokens.length) {
      const { sendMulticast } = require('./firebaseService');
      await sendMulticast(tokens, title, body, fcmData).catch(() => {});
    }

    // Telegram admin channel
    const adminChannel = process.env.TELEGRAM_CHANNEL_ID;
    if (adminChannel) {
      await sendTelegramMessage(adminChannel, tgMsg).catch(() => {});
    }

    // BUG-004: this used to be push/Telegram-only and never appeared in the
    // in-app notification list at all -- unlike sendSignalNotification,
    // which always persists one. Added so trade-close events work the same
    // way even when push isn't configured (e.g. this local dev environment
    // has no Firebase credentials, so before this fix a closed trade
    // produced literally no visible notification anywhere).
    await persistTradeEventNotification('trade_closed', title, body, {
      tradeId: trade._id?.toString(),
      asset, action: direction,
      pnl: parseFloat(pnl.toFixed(2)),
      pnlPct: pnlPct != null ? parseFloat(pnlPct.toFixed(2)) : null,
      exitReason,
    });
  } catch (err) {
    logger.warn('[Notify] sendTradeClosedNotification error:', err.message);
  }
}

// ─── Generic push ────────────────────────────────────────────────────────────

async function sendPushToUser(userId, title, body, data = {}) {
  const user = await User.findById(userId).select('fcmToken').lean();
  if (!user?.fcmToken) return { success: false, reason: 'no_token' };
  const result = await sendToDevice(user.fcmToken, title, body, data);
  if (!result.success && isInvalidTokenError(result.code)) {
    await User.updateOne({ _id: userId }, { $unset: { fcmToken: '' } }).catch(() => {});
  }
  return result;
}

module.exports = {
  sendSignalNotification,
  sendTelegramMessage,
  sendPushToUser,
  sendTradeOpenedNotification,
  sendTradeClosedNotification,
  buildSignalMessage,
  getRiskFlags,
};
