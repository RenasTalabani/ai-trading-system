const { body, validationResult } = require('express-validator');
const BudgetSession    = require('../models/BudgetSession');
const VirtualPortfolio = require('../models/VirtualPortfolio');
const VirtualTrade     = require('../models/VirtualTrade');
const { getSummary }   = require('../services/virtualTrackingService');
const logger           = require('../config/logger');

// ── Helpers ───────────────────────────────────────────────────────────────────

async function getOrCreate() {
  let s = await BudgetSession.findOne({ sessionKey: 'global' });
  if (!s) s = await BudgetSession.create({ sessionKey: 'global' });
  return s;
}

async function getPortfolio() {
  let p = await VirtualPortfolio.findOne({ portfolioKey: 'global' });
  if (!p) p = await VirtualPortfolio.create({ portfolioKey: 'global' });
  return p;
}

function riskPct(level) {
  return level === 'low' ? 2 : level === 'high' ? 10 : 5;
}

// ── GET /status ───────────────────────────────────────────────────────────────

exports.status = async (req, res) => {
  try {
    const session   = await getOrCreate();
    const portfolio = await getPortfolio();

    const activeTrades = await VirtualTrade.countDocuments({ status: 'open' });

    const sessionPnL = session.snapshotBalance != null
      ? parseFloat((portfolio.currentBalance - session.snapshotBalance).toFixed(2))
      : 0;

    const totalTrades = portfolio.winCount + portfolio.lossCount;
    const winRate     = totalTrades > 0
      ? parseFloat(((portfolio.winCount / totalTrades) * 100).toFixed(1))
      : 0;

    return res.json({
      success: true,
      session: {
        status:         session.status,
        budget:         session.budget,
        riskLevel:      session.riskLevel,
        preferredAsset: session.preferredAsset,
        startedAt:      session.startedAt,
      },
      performance: {
        currentBalance: parseFloat(portfolio.currentBalance.toFixed(2)),
        startingBalance: parseFloat(portfolio.startingBalance.toFixed(2)),
        sessionPnL,
        // Bug fix (2026-09-04, overnight continuous-improvement pass,
        // follow-up audit): this summed totalProfit and totalLoss instead
        // of netting them. totalLoss is persisted as a positive magnitude
        // everywhere it's written (virtualTrackingService.js: `totalLoss +=
        // Math.abs(pnl)`), the same convention getSummary()'s own totalPnl
        // uses (`totalProfit - totalLoss`, since totalPnl there is just the
        // sum of real, correctly-signed per-trade pnl values, which is
        // algebraically identical to totalProfit minus totalLoss). Summing
        // instead of subtracting reported an inflated, almost-always-
        // positive headline P&L on the mobile Budget screen -- e.g. +$10 of
        // real profit against $500 of real losses showed as "+$510"
        // instead of the true "-$490".
        totalPnL:        parseFloat((portfolio.totalProfit - portfolio.totalLoss).toFixed(2)),
        winRate,
        activeTrades,
        totalTrades,
        maxDrawdown:     portfolio.maxDrawdown,
        bestTrade:       portfolio.bestTrade,
        worstTrade:      portfolio.worstTrade,
      },
    });
  } catch (err) {
    logger.error('[Budget] status error:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ── POST /start ───────────────────────────────────────────────────────────────

exports.start = [
  body('budget').isFloat({ min: 1, max: 1_000_000 }),
  body('riskLevel').optional().isIn(['low', 'medium', 'high']),
  body('preferredAsset').optional().isString(),

  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty())
      return res.status(400).json({ success: false, errors: errors.array() });

    const { budget, riskLevel = 'medium', preferredAsset = 'ALL' } = req.body;

    try {
      const session = await getOrCreate();

      // Reset portfolio to new budget
      await VirtualPortfolio.findOneAndUpdate(
        { portfolioKey: 'global' },
        {
          startingBalance: budget,
          currentBalance:  budget,
          riskPerTradePct: riskPct(riskLevel),
          totalProfit: 0, totalLoss: 0,
          winCount: 0, lossCount: 0,
          peakBalance: budget, maxDrawdown: 0,
          bestTrade: null, worstTrade: null,
          balanceHistory: [],
          startedAt: new Date(),
          // Bug fix (2026-09-04, overnight continuous-improvement pass,
          // follow-up audit): this reset startingBalance/currentBalance to
          // the new budget but left `benchmarkStartBalance` untouched --
          // the frozen baseline getBenchmarkComparison() uses so a later
          // setCapital() call can't quietly move it (see that fix's own
          // comment in virtualTrackingService.js). Left stale, a brand new
          // session (a different budget amount) would get benchmarked
          // against a leftover dollar baseline from the PREVIOUS session,
          // corrupting outperformingBenchmark/graduationCriteriaMet -- the
          // exact signal decision #22 gates moving to real money on.
          // Explicitly nulled here so getBenchmarkComparison() re-seeds it
          // from the new startingBalance on its next call, exactly like a
          // brand-new portfolio does (it already initializes benchmarkStart
          // Balance from startingBalance whenever the field is null).
          benchmarkStartBalance: null,
        },
        { upsert: true, new: true },
      );

      // Close any open virtual trades from old session
      await VirtualTrade.updateMany(
        { status: 'open' },
        { $set: { status: 'expired', exitReason: 'session_reset' } },
      );

      // Update session
      session.budget          = budget;
      session.riskLevel       = riskLevel;
      session.preferredAsset  = preferredAsset;
      session.status          = 'active';
      session.startedAt       = new Date();
      session.pausedAt        = null;
      session.snapshotBalance = budget;
      await session.save();

      logger.info(`[Budget] Session STARTED — $${budget} | risk:${riskLevel} | asset:${preferredAsset}`);

      return res.json({
        success: true,
        message: `AI budget manager started with $${budget}`,
        session: {
          status:         session.status,
          budget,
          riskLevel,
          preferredAsset,
          startedAt:      session.startedAt,
        },
      });
    } catch (err) {
      logger.error('[Budget] start error:', err.message);
      return res.status(500).json({ success: false, message: err.message });
    }
  },
];

// ── GET /report?range=daily|weekly ───────────────────────────────────────────

exports.report = async (req, res) => {
  try {
    const range = req.query.range === 'weekly' ? '7d' : '1d';
    const [summary, session] = await Promise.all([
      getSummary(range),
      BudgetSession.findOne({ sessionKey: 'global' }),
    ]);

    return res.json({
      success:    true,
      range:      req.query.range || 'daily',
      period:     range === '1d' ? 'Last 24 hours' : 'Last 7 days',
      session: session ? {
        status:    session.status,
        budget:    session.budget,
        riskLevel: session.riskLevel,
        startedAt: session.startedAt,
      } : null,
      trades: {
        total:              summary.totalTrades,
        open:               summary.openTrades,
        wins:               summary.winCount,
        losses:             summary.lossCount,
        winRate:            summary.winRate,
        avgDurationMinutes: summary.avgDurationMinutes,
      },
      pnl: {
        net:    summary.totalPnl,
        profit: summary.totalProfit,
        loss:   summary.totalLoss,
        netPct: summary.netProfitPct,
      },
      portfolio: {
        currentBalance:  summary.currentBalance,
        startingBalance: summary.startingBalance,
        maxDrawdown:     summary.maxDrawdown,
        peakBalance:     summary.peakBalance,
      },
      highlights: {
        bestTrade:  summary.bestTrade,
        worstTrade: summary.worstTrade,
      },
      balanceHistory: summary.balanceHistory.slice(-50),
    });
  } catch (err) {
    logger.error('[Budget] report error:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ── POST /stop ────────────────────────────────────────────────────────────────

exports.stop = async (req, res) => {
  try {
    const session = await getOrCreate();
    session.status   = 'paused';
    session.pausedAt = new Date();
    await session.save();

    logger.info('[Budget] Session PAUSED');
    return res.json({ success: true, message: 'AI budget manager paused' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};
