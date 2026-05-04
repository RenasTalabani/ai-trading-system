const cron              = require('node-cron');
const axios             = require('axios');
const AIReport          = require('../models/AIReport');
const Signal            = require('../models/Signal');
const VirtualPortfolio  = require('../models/VirtualPortfolio');
const User              = require('../models/User');
const { sendPushToUser, sendTelegramMessage } = require('../services/notificationService');
const { getCache: getGlobalCache }            = require('./globalScanJob');
const logger            = require('../config/logger');

const OPENAI_KEY = process.env.OPENAI_API_KEY || null;

async function generateHourlyReport() {
  try {
    const now   = new Date();
    const start = new Date(now.getTime() - 60 * 60 * 1000);

    const signals = await Signal.find({
      status:    'active',
      createdAt: { $gte: start },
    }).sort({ confidence: -1 }).limit(20).lean();

    if (signals.length === 0) {
      logger.info('[HourlyReport] No active signals — skipping');
      return null;
    }

    const buys  = signals.filter(s => s.direction === 'BUY').length;
    const sells = signals.filter(s => s.direction === 'SELL').length;
    const total = signals.length;
    let marketMood = 'neutral', moodPct = 50;
    if (buys > sells)  { marketMood = 'bullish'; moodPct = Math.round(buys  / total * 100); }
    if (sells > buys)  { marketMood = 'bearish'; moodPct = Math.round(sells / total * 100); }

    const best = signals[0];
    const topPicks = signals.slice(0, 5).map(s => ({
      asset:      s.asset,
      action:     s.direction,
      confidence: s.confidence,
      price:      s.price?.entry || 0,
    }));

    let portfolioSummary = { balance: 500, change: 0, changePct: 0, openTrades: 0 };
    try {
      const p = await VirtualPortfolio.findOne({ key: 'global' }).lean();
      if (p) {
        const prev = p.balanceHistory?.slice(-2)[0]?.balance || p.currentBalance;
        portfolioSummary = {
          balance:    p.currentBalance,
          change:     round2(p.currentBalance - prev),
          changePct:  round2((p.currentBalance - prev) / prev * 100),
          openTrades: p.openTrades || 0,
        };
      }
    } catch (_) {}

    let bestOpportunity = null;
    try {
      const cached = getGlobalCache();
      const sd = cached?.result?.best;
      if (sd) bestOpportunity = {
        asset:          sd.asset,
        action:         sd.action,
        confidence:     sd.confidence,
        expectedReturn: sd.expected_return || 'N/A',
        reason:         sd.reason || '',
      };
    } catch (_) {}

    const baseInsight = _buildInsight(marketMood, best, signals.length, portfolioSummary);
    const insight     = await _enhanceWithGPT(baseInsight, marketMood, best, signals.length, portfolioSummary);

    const report = await AIReport.create({
      type:   'hourly',
      period: { start, end: now },
      marketSummary: {
        topAsset: best.asset, topAction: best.direction,
        topConfidence: best.confidence, marketMood, moodPct,
        activeSignals: signals.length,
      },
      bestOpportunity,
      topPicks,
      portfolioSummary,
      aiInsight: insight,
    });

    // ── Push notifications (brain report format) ────────────────────────────
    const actionEmoji = bestOpportunity?.action === 'BUY'  ? '🟢'
                      : bestOpportunity?.action === 'SELL' ? '🔴' : '⚪️';
    const primaryAsset  = bestOpportunity?.asset      || best.asset;
    const primaryAction = bestOpportunity?.action     || best.direction;
    const primaryConf   = bestOpportunity?.confidence || best.confidence;
    const expectedRet   = bestOpportunity?.expectedReturn;
    const notifTitle = `${actionEmoji} AI Brain — ${primaryAction} ${primaryAsset}`;
    const retPart    = expectedRet && expectedRet !== 'N/A' ? ` · +${expectedRet}% est.` : '';
    const notifBody  = `${primaryConf}% confidence${retPart} · Market: ${marketMood}`;

    const users = await User.find({ isActive: true }).lean();
    for (const user of users) {
      try {
        if (user.preferences?.fcmEnabled !== false && user.fcmToken) {
          await sendPushToUser(user._id, notifTitle, notifBody, {
            type:       'BRAIN_REPORT',
            reportId:   report._id.toString(),
            mood:       marketMood,
            topAsset:   primaryAsset,
            topAction:  primaryAction,
            confidence: String(primaryConf),
          }).catch(() => {});
        }
        if (user.preferences?.telegramEnabled && user.telegramChatId) {
          await sendTelegramMessage(user.telegramChatId, _buildTgMessage(report)).catch(() => {});
        }
      } catch (_) {}
    }

    // Admin channel
    const adminChannel = process.env.TELEGRAM_CHANNEL_ID;
    if (adminChannel) {
      await sendTelegramMessage(adminChannel, _buildTgMessage(report)).catch(() => {});
    }

    await AIReport.updateOne({ _id: report._id }, {
      $set: { 'notificationSent.fcm': true, 'notificationSent.telegram': !!adminChannel },
    });

    logger.info(`[HourlyReport] ✓ ${marketMood} | ${best.asset} ${best.direction} ${best.confidence}% | notified ${users.length} users`);
    return report;
  } catch (err) {
    logger.error('[HourlyReport] failed:', err.message);
    return null;
  }
}

async function _enhanceWithGPT(baseInsight, mood, top, count, port) {
  if (!OPENAI_KEY) return baseInsight;
  try {
    const prompt = `You are a concise crypto market analyst. Summarize in 2 sentences (max 200 chars):
Market: ${mood}, ${count} signals. Top: ${top.asset} ${top.direction} ${top.confidence}% conf. Portfolio: $${port.balance.toFixed(2)} (${port.change >= 0 ? '+' : ''}$${port.change.toFixed(2)}). ${port.openTrades} open trades.
Be direct, professional, no emojis.`;

    const resp = await axios.post('https://api.openai.com/v1/chat/completions', {
      model:      'gpt-4o-mini',
      max_tokens: 100,
      messages:   [{ role: 'user', content: prompt }],
    }, {
      headers:  { Authorization: `Bearer ${OPENAI_KEY}`, 'Content-Type': 'application/json' },
      timeout:  8_000,
    });

    const text = resp.data?.choices?.[0]?.message?.content?.trim();
    return text || baseInsight;
  } catch (_) {
    return baseInsight;
  }
}

function _buildInsight(mood, top, count, port) {
  const moodWord = mood === 'bullish' ? 'bullish 📈' : mood === 'bearish' ? 'bearish 📉' : 'neutral ➡️';
  const portWord = port.change >= 0
    ? `Portfolio up $${Math.abs(port.change)}`
    : `Portfolio down $${Math.abs(port.change)}`;
  return `Market is ${moodWord} — ${count} signals. Top: ${top.asset} ${top.direction} ${top.confidence}% confidence. ${portWord}. ${port.openTrades} open trades.`;
}

function _buildTgMessage(r) {
  const ms   = r.marketSummary;
  const port = r.portfolioSummary;
  const emoji = ms.marketMood === 'bullish' ? '📈' : ms.marketMood === 'bearish' ? '📉' : '➡️';
  const lines = [
    `${emoji} *Hourly AI Report*`,
    `Market: *${ms.marketMood.toUpperCase()}* (${ms.moodPct}%)`,
    `Top: *${ms.topAsset}* ${ms.topAction} ${ms.topConfidence}%`,
    ms.activeSignals ? `Signals: ${ms.activeSignals} active` : '',
    r.bestOpportunity ? `Best: *${r.bestOpportunity.asset}* ${r.bestOpportunity.action} ${r.bestOpportunity.confidence}%` : '',
    `Portfolio: $${port.balance.toFixed(2)} (${port.change >= 0 ? '+' : ''}$${port.change.toFixed(2)})`,
  ].filter(Boolean);
  return lines.join('\n');
}

function round2(n) { return Math.round(n * 100) / 100; }

function startHourlyReportJob() {
  cron.schedule('0 * * * *', async () => {
    logger.info('[HourlyReport] Job triggered');
    await generateHourlyReport();
  });
  logger.info('[HourlyReport] Job scheduled — every hour at :00');
}

module.exports = { startHourlyReportJob, generateHourlyReport };
