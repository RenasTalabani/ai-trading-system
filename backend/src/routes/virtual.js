const express  = require('express');
const { body, query, param, validationResult } = require('express-validator');
const { protect, authorize } = require('../middleware/auth');
const VirtualTrade = require('../models/VirtualTrade');
const {
  getPerformance, getSummary, resetPortfolio, setCapital, openFuturesTrade,
  enableTrailingStop, getExposureSummary,
} = require('../services/virtualTrackingService');
const { startPlan, stopPlan, getPlansWithSummary } = require('../services/dcaService');
const riskStateService = require('../services/riskStateService');

const router = express.Router();

router.use(protect);

// ─── GET /api/v1/virtual/risk-state ───────────────────────────────────────────
// Surfaces the daily-loss circuit breaker's live status (master_plan_v1.md
// decision #16) so the mobile app can show "trading halted for today" instead
// of a silent lack of new trades.
router.get('/risk-state', async (req, res) => {
  try {
    const state = await riskStateService.getState();
    res.json({ success: true, data: state });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── POST /api/v1/virtual/risk-state/reset ────────────────────────────────────
// The ONLY way to clear a tripped daily-loss circuit breaker (decision #16:
// "stops until manual reactivation" -- deliberately not automatic/scheduled).
router.post('/risk-state/reset', async (req, res) => {
  try {
    const state = await riskStateService.manualReset(req.user?.id || req.user?._id || 'user');
    res.json({ success: true, data: state });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── GET /api/v1/virtual/exposure ─────────────────────────────────────────────
// Aggregate risk across all open positions: total notional/margin, per-asset
// concentration, and simple correlation/liquidation-proximity warnings.
router.get('/exposure', async (req, res) => {
  try {
    const data = await getExposureSummary();
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── GET /api/v1/virtual/performance?range=7d|30d|all ────────────────────────
router.get('/performance', [
  query('range').optional().isIn(['7d', '30d', 'all']),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

  try {
    const data = await getSummary(req.query.range || 'all');
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── GET /api/v1/virtual/summary?range=7d|30d|all ────────────────────────────
router.get('/summary', [
  query('range').optional().isIn(['7d', '30d', 'all']),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

  try {
    const data = await getSummary(req.query.range || 'all');
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── GET /api/v1/virtual/trades ───────────────────────────────────────────────
router.get('/trades', [
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
  query('status').optional().isIn(['open', 'closed_profit', 'closed_loss', 'cancelled', 'closed']),
  query('range').optional().isIn(['7d', '30d', 'all']),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

  const page  = req.query.page  || 1;
  const limit = req.query.limit || 20;
  const skip  = (page - 1) * limit;

  try {
    let filter = {};

    if (req.query.status === 'closed') {
      filter.status = { $in: ['closed_profit', 'closed_loss'] };
    } else if (req.query.status) {
      filter.status = req.query.status;
    }

    if (req.query.range && req.query.range !== 'all') {
      const days  = req.query.range === '7d' ? 7 : 30;
      const since = new Date(Date.now() - days * 24 * 3_600_000);
      filter.openedAt = { $gte: since };
    }

    const [trades, total] = await Promise.all([
      VirtualTrade.find(filter).sort({ openedAt: -1 }).skip(skip).limit(limit).lean(),
      VirtualTrade.countDocuments(filter),
    ]);

    res.json({
      success: true,
      total,
      page,
      pages: Math.ceil(total / limit),
      trades,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── GET /api/v1/virtual/trades/history?range=7d|30d|all ─────────────────────
router.get('/trades/history', [
  query('range').optional().isIn(['7d', '30d', 'all']),
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

  const page  = req.query.page  || 1;
  const limit = req.query.limit || 20;
  const skip  = (page - 1) * limit;

  try {
    const filter = { status: { $in: ['closed_profit', 'closed_loss', 'cancelled'] } };

    if (req.query.range && req.query.range !== 'all') {
      const days  = req.query.range === '7d' ? 7 : 30;
      const since = new Date(Date.now() - days * 24 * 3_600_000);
      filter.closedAt = { $gte: since };
    }

    const [trades, total] = await Promise.all([
      VirtualTrade.find(filter).sort({ closedAt: -1 }).skip(skip).limit(limit).lean(),
      VirtualTrade.countDocuments(filter),
    ]);

    res.json({
      success: true,
      total,
      page,
      pages: Math.ceil(total / limit),
      trades,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── POST /api/v1/virtual/reset ───────────────────────────────────────────────
router.post('/reset', authorize('admin'), [
  body('startingBalance').optional().isFloat({ min: 10, max: 1_000_000 }),
  body('riskPerTradePct').optional().isFloat({ min: 1, max: 50 }),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

  try {
    const balance = req.body.startingBalance || 500;
    const risk    = req.body.riskPerTradePct || 5;
    await resetPortfolio(balance, risk);
    res.json({ success: true, message: `Portfolio reset. Starting balance: $${balance}, risk: ${risk}% per trade.` });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── POST /api/v1/virtual/set-capital ────────────────────────────────────────
router.post('/set-capital', authorize('admin'), [
  body('startingBalance').optional().isFloat({ min: 10, max: 1_000_000 }),
  body('riskPerTradePct').optional().isFloat({ min: 1, max: 50 }),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

  try {
    await setCapital(req.body.startingBalance, req.body.riskPerTradePct);
    res.json({ success: true, message: 'Capital settings updated.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── POST /api/v1/virtual/trades/:signalId/open-futures ──────────────────────
// Master-plan decision #13 (locked, 2026-09-03): leverage is banned. This
// endpoint's `leverage` body param is now IGNORED by the service layer
// (virtualTrackingService.openFuturesTrade forces 1x regardless of what's
// sent) — the validator below is left permissive only so an old client
// sending 1-20 doesn't get a 400 instead of the clearer service-level log.
router.post('/trades/:signalId/open-futures', [
  param('signalId').isMongoId(),
  body('leverage').optional().isInt({ min: 1, max: 20 }),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

  try {
    const trade = await openFuturesTrade(req.params.signalId, req.body.leverage || 1);
    res.json({ success: true, trade });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// ─── POST /api/v1/virtual/trades/:tradeId/trailing-stop ──────────────────────
// Opts an open trade into a trailing stop-loss — it only ever tightens
// toward the current price as it moves favorably, locking in gains.
router.post('/trades/:tradeId/trailing-stop', [
  param('tradeId').isMongoId(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

  try {
    const trade = await enableTrailingStop(req.params.tradeId);
    res.json({ success: true, trade });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// ─── DCA (Dollar-Cost Averaging) — simulated recurring buys ──────────────────

// GET /api/v1/virtual/dca
router.get('/dca', async (req, res) => {
  try {
    const plans = await getPlansWithSummary();
    res.json({ success: true, plans });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/v1/virtual/dca/start
router.post('/dca/start', [
  body('asset').isString().trim().notEmpty(),
  body('amountPerBuy').isFloat({ min: 1 }),
  body('frequencyDays').isInt({ min: 1, max: 30 }),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

  try {
    const plan = await startPlan(req.body.asset, req.body.amountPerBuy, req.body.frequencyDays);
    res.json({ success: true, plan });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// POST /api/v1/virtual/dca/:planId/stop
router.post('/dca/:planId/stop', [
  param('planId').isMongoId(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

  try {
    const plan = await stopPlan(req.params.planId);
    res.json({ success: true, plan });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

module.exports = router;
