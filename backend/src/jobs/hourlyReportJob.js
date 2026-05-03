const cron              = require('node-cron');
const axios             = require('axios');
const AIReport          = require('../models/AIReport');
const Signal            = require('../models/Signal');
const VirtualPortfolio  = require('../models/VirtualPortfolio');
const logger            = require('../config/logger');

const AI_URL = process.env.AI_SERVICE_URL || 'http://localhost:8000';

const MOODS = { bullish: 0, bearish: 0, neutral: 0 };

async function generateHourlyReport() {
  try {
    const now   = new Date();
    const start = new Date(now.getTime() - 60 * 60 * 1000);

    // Fetch active signals from the last hour
    const signals = await Signal.find({
      status:    'active',
      createdAt: { $gte: start },
    }).sort({ confidence: -1 }).limit(20).lean();

    if (signals.length === 0) {
      logger.info('[HourlyReport] No active signals — skipping report generation');
      return null;
    }

    // Market mood
    const buys  = signals.filter(s => s.direction === 'BUY').length;
    const sells = signals.filter(s => s.direction === 'SELL').length;
    const total = signals.length;
    let marketMood = 'neutral';
    let moodPct    = 50;
    if (buys > sells) { marketMood = 'bullish'; moodPct = Math.round(buys / total * 100); }
    else if (sells > buys) { marketMood = 'bearish'; moodPct = Math.round(sells / total * 100); }

    const best = signals[0];

    // Top 5 picks
    const topPicks = signals.slice(0, 5).map(s => ({
      asset:      s.asset,
      action:     s.direction,
      confidence: s.confidence,
      price:      s.price?.entry || 0,
    }));

    // Portfolio snapshot
    let portfolioSummary = { balance: 500, change: 0, changePct: 0, openTrades: 0 };
    try {
      const portfolio = await VirtualPortfolio.findOne({ key: 'global' }).lean();
      if (portfolio) {
        const prevBalance = portfolio.balanceHistory?.slice(-2)[0]?.balance || portfolio.currentBalance;
        portfolioSummary = {
          balance:    portfolio.currentBalance,
          change:     round2(portfolio.currentBalance - prevBalance),
          changePct:  round2((portfolio.currentBalance - prevBalance) / prevBalance * 100),
          openTrades: portfolio.openTrades || 0,
        };
      }
    } catch (e) { /* non-critical */ }

    // Global scan for best opportunity
    let bestOpportunity = null;
    try {
      const scanResp = await axios.get(`${AI_URL}/api/global/latest`, { timeout: 5_000 });
      const scanData = scanResp.data?.best;
      if (scanData) {
        bestOpportunity = {
          asset:          scanData.asset,
          action:         scanData.action,
          confidence:     scanData.confidence,
          expectedReturn: scanData.expected_return || 'N/A',
          reason:         scanData.reason || '',
        };
      }
    } catch (e) { /* non-critical */ }

    // AI insight string
    const insight = buildInsight(marketMood, best, signals.length, portfolioSummary);

    const report = await AIReport.create({
      type:   'hourly',
      period: { start, end: now },
      marketSummary: {
        topAsset:      best.asset,
        topAction:     best.direction,
        topConfidence: best.confidence,
        marketMood,
        moodPct,
        activeSignals: signals.length,
      },
      bestOpportunity,
      topPicks,
      portfolioSummary,
      aiInsight: insight,
    });

    logger.info(`[HourlyReport] Generated: ${marketMood} | Top: ${best.asset} ${best.direction} ${best.confidence}%`);
    return report;
  } catch (err) {
    logger.error('[HourlyReport] generation failed:', err.message);
    return null;
  }
}

function buildInsight(mood, topSignal, signalCount, portfolio) {
  const moodWord  = mood === 'bullish' ? 'bullish 📈' : mood === 'bearish' ? 'bearish 📉' : 'neutral ➡️';
  const portState = portfolio.change >= 0
    ? `Portfolio is up $${Math.abs(portfolio.change)}`
    : `Portfolio is down $${Math.abs(portfolio.change)}`;
  return (
    `Market is ${moodWord} — ${signalCount} active signals. ` +
    `Top pick: ${topSignal.asset} ${topSignal.direction} (${topSignal.confidence}% confidence). ` +
    `${portState} this hour. ${portfolio.openTrades} open trades.`
  );
}

function round2(n) { return Math.round(n * 100) / 100; }

function startHourlyReportJob() {
  // Run at minute 0 of every hour
  cron.schedule('0 * * * *', async () => {
    logger.info('[HourlyReport] Job triggered');
    await generateHourlyReport();
  });
  logger.info('[HourlyReport] Job scheduled — every hour at :00');
}

module.exports = { startHourlyReportJob, generateHourlyReport };
