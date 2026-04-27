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
    await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
      chat_id:                  chatId,
      text,
      parse_mode:               'MarkdownV2',
      disable_web_page_preview: true,
      ...options,
    });
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

    // Push to all active users with FCM
    const allUsers = await User.find({ isActive: true, fcmToken: { $exists: true, $ne: '' } }).lean();
    const tokens   = allUsers.map(u => u.fcmToken).filter(Boolean);

    if (tokens.length) {
      const { sendMulticast } = require('./firebaseService');
      await sendMulticast(tokens, title, body, fcmData).catch(() => {});
    }

    // Telegram admin channel
    const adminChannel = process.env.TELEGRAM_CHANNEL_ID;
    if (adminChannel) {
      await sendTelegramMessage(adminChannel, tgMsg).catch(() => {});
    }
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
  sendTradeClosedNotification,
  buildSignalMessage,
  getRiskFlags,
};
