const axios        = require('axios');
const { body, query, validationResult } = require('express-validator');
const StrategyReport = require('../models/StrategyReport');
const logger         = require('../config/logger');

const AI_URL = process.env.AI_SERVICE_URL || 'http://localhost:8000';

// ─── Holding analysis ─────────────────────────────────────────────────────────

exports.holding = [
  body('assets').isArray({ min: 1, max: 10 }),
  body('timeframe').isIn(['1d', '7d', '30d']),
  body('capital').optional().isFloat({ min: 1 }),

  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

    try {
      const { assets, timeframe, capital = 500 } = req.body;

      const aiResp = await axios.post(`${AI_URL}/api/strategy/holding`, {
        assets, timeframe, capital,
      }, { timeout: 30_000 });

      const data = aiResp.data.data;

      // Persist report
      const report = await StrategyReport.create({
        userId:         req.user._id,
        assets,
        timeframe,
        capital,
        type:           'holding',
        bestAsset:      data.best_asset,
        expectedProfit: data.expected_profit,
        expectedLoss:   data.expected_loss,
        winRate:        data.win_rate,
        perAsset:       (data.recommendations || []).map(r => ({
          asset:          r.asset,
          recommendation: r.recommendation,
          confidence:     r.confidence,
          trend:          r.trend,
          expectedMove:   r.expected_move_percent,
          currentPrice:   r.current_price,
          reason:         r.reason,
        })),
      });

      res.json({ success: true, data, reportId: report._id });
    } catch (err) {
      logger.error('[Strategy] holding error:', err.message);
      res.status(502).json({ success: false, message: 'Strategy analysis unavailable', detail: err.message });
    }
  },
];

// ─── Simulation ───────────────────────────────────────────────────────────────

exports.simulate = [
  body('assets').isArray({ min: 1, max: 10 }),
  body('timeframe').isIn(['1d', '7d', '30d']),
  body('capital').optional().isFloat({ min: 1 }),

  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

    try {
      const { assets, timeframe, capital = 500 } = req.body;

      const aiResp = await axios.post(`${AI_URL}/api/strategy/simulate`, {
        assets, timeframe, capital,
      }, { timeout: 60_000 });

      const data = aiResp.data.data;

      const report = await StrategyReport.create({
        userId:         req.user._id,
        assets,
        timeframe,
        capital,
        type:           'simulate',
        initialBalance: data.initial_balance,
        finalBalance:   data.final_balance,
        netPnl:         data.net_pnl,
        returnPct:      data.return_pct,
        winRate:        data.win_rate,
        totalTrades:    data.total_trades,
        perAsset:       (data.per_asset || []).map(r => ({
          asset:          r.asset,
          recommendation: 'HOLD',  // simulation doesn't produce a rec field
          initialCapital: r.initial_capital,
          finalBalance:   r.final_balance,
          profit:         r.profit,
          loss:           r.loss,
          trades:         r.trades,
          returnPct:      r.return_pct,
        })),
      });

      res.json({ success: true, data, reportId: report._id });
    } catch (err) {
      logger.error('[Strategy] simulate error:', err.message);
      res.status(502).json({ success: false, message: 'Strategy simulation unavailable', detail: err.message });
    }
  },
];

// ─── History ──────────────────────────────────────────────────────────────────

exports.history = [
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('limit').optional().isInt({ min: 1, max: 50 }).toInt(),
  query('type').optional().isIn(['holding', 'simulate']),

  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

    const page  = req.query.page  || 1;
    const limit = req.query.limit || 10;
    const skip  = (page - 1) * limit;

    const filter = { userId: req.user._id };
    if (req.query.type) filter.type = req.query.type;

    const [reports, total] = await Promise.all([
      StrategyReport.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      StrategyReport.countDocuments(filter),
    ]);

    res.json({
      success: true,
      total,
      page,
      pages: Math.ceil(total / limit),
      reports,
    });
  },
];
