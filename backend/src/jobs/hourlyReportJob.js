const cron              = require('node-cron');
const axios             = require('axios');
const AIReport          = require('../models/AIReport');
const Signal            = require('../models/Signal');
const VirtualPortfolio  = require('../models/VirtualPortfolio');
const VirtualTrade      = require('../models/VirtualTrade');
const User              = require('../models/User');
const { sendPushToUser, sendTelegramMessage } = require('../services/notificationService');
const { getCache: getGlobalCache }            = require('./globalScanJob');
const logger            = require('../config/logger');

const OPENAI_KEY = process.env.OPENAI_API_KEY || null;

// T-059 (2026-08-26, product-to-code audit follow-up): this job used to push
// a "BRAIN_REPORT" notification to every eligible user every single hour
// whenever any signal existed in the trailing hour, with no comparison to
// what was reported the previous hour -- so a user got a fresh push every
// hour even if the AI's actual recommendation hadn't changed at all. The
// AIReport document is still created every hour (it's a real historical
// record), but the notification now only fires when the reported
// asset/action/mood actually changed meaningfully since the last time a
// notification was sent, mirroring globalScanJob's existing _lastBest gate.
const NOTIFY_CONFIDENCE_DELTA_THRESHOLD = 5; // percentage points
let _lastNotified = null; // { asset, action, mood, confidence }

function _hourlyReportChanged(current) {
  if (!_lastNotified) return true;
  if (current.asset  !== _lastNotified.asset)  return true;
  if (current.action !== _lastNotified.action) return true;
  if (current.mood   !== _lastNotified.mood)   return true;
  if (Math.abs((current.confidence ?? 0) - (_lastNotified.confidence ?? 0)) >= NOTIFY_CONFIDENCE_DELTA_THRESHOLD) return true;
  return false;
}

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

    // T-031 (2026-08-18, PM continuous-improvement pass): queried the
    // wrong field name -- VirtualPortfolio's schema field is `portfolioKey`
    // (confirmed in VirtualPortfolio.js: `portfolioKey: { type: String,
    // default: 'global', unique: true }`), not `key`. Every other caller
    // in the codebase (budgetController.js, aiWorkerService.js,
    // virtualTrackingService.js) correctly queries `portfolioKey`; this
    // was the one outlier. A query on a field that doesn't exist on any
    // document always matches nothing, so `p` was always null here --
    // meaning every Hourly AI Report, every hour, silently fell back to
    // the hardcoded placeholder portfolio ($500 balance, $0 change, 0
    // open trades) instead of the real numbers, and that fake data was
    // baked into the stored report, the Telegram/push notification text,
    // and (if OPENAI_KEY is set) the GPT prompt used to write the report's
    // narrative insight.
    let portfolioSummary = { balance: 500, change: 0, changePct: 0, openTrades: 0 };
    try {
      const p = await VirtualPortfolio.findOne({ portfolioKey: 'global' }).lean();
      if (p) {
        const prev = p.balanceHistory?.slice(-2)[0]?.balance || p.currentBalance;
        // Bug fix (2026-09-04, overnight continuous-improvement pass, 3rd
        // audit pass): `p.openTrades` is not a real field on the
        // VirtualPortfolio schema at all (see VirtualPortfolio.js) -- it is
        // always `undefined`, so `p.openTrades || 0` silently reported ZERO
        // open trades in every single hourly report, Telegram message, and
        // GPT narrative prompt, no matter how many positions were actually
        // open. Count the real open VirtualTrade documents instead -- same
        // query virtualTrackingService.getSummary() already uses for this
        // exact number.
        const openTradesCount = await VirtualTrade.countDocuments({ status: 'open' });
        portfolioSummary = {
          balance:    p.currentBalance,
          change:     round2(p.currentBalance - prev),
          changePct:  round2((p.currentBalance - prev) / prev * 100),
          openTrades: openTradesCount,
        };
      }
    } catch (_) {}

    let bestOpportunity = null;
    try {
      const cached = getGlobalCache();
      const sd = cached?.result?.best;
      // AUDIT-02 (2026-09-01, production audit): RENO-001 (ai-service)
      // means `sd` is now non-null almost every scan regardless of
      // whether it clears the real confidence/fused-score bar. Without
      // this check, a below-bar candidate would drive the "🟢 AI Brain —
      // BUY <asset>" PUSH NOTIFICATION below (and the stored AIReport) as
      // if it were a confirmed pick -- the single highest-stakes instance
      // of exactly what this audit's Priority 3 forbids, since a push
      // notification is the most prominent surface in the app. Leaving
      // bestOpportunity null here correctly falls through to the
      // existing `|| best.action` etc. fallback below (the top active
      // Signal), the same established pattern guideController.js and
      // brainController.js use.
      if (sd && sd.meets_bar !== false) bestOpportunity = {
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

    const notifState  = { asset: primaryAsset, action: primaryAction, confidence: primaryConf, mood: marketMood };
    const shouldNotify = _hourlyReportChanged(notifState);

    let notifiedCount = 0;
    if (shouldNotify) {
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
          notifiedCount++;
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

      _lastNotified = notifState;
      logger.info(`[HourlyReport] ✓ ${marketMood} | ${best.asset} ${best.direction} ${best.confidence}% | notified ${notifiedCount} users`);
    } else {
      await AIReport.updateOne({ _id: report._id }, {
        $set: { 'notificationSent.fcm': false, 'notificationSent.telegram': false },
      });
      logger.info(`[HourlyReport] ✓ ${marketMood} | ${best.asset} ${best.direction} ${best.confidence}% | no meaningful change — notification skipped`);
    }

    return report;
  } catch (err) {
    logger.error(`[HourlyReport] failed: ${err.stack}`);
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

// Test-only: reset the in-memory "last notified" state between test cases
// (mirrors the module-level _lastBest pattern in globalScanJob.js).
function _resetNotifyStateForTests() { _lastNotified = null; }

module.exports = { startHourlyReportJob, generateHourlyReport, _resetNotifyStateForTests };
