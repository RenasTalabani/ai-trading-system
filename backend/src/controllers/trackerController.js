const axios             = require('axios');
const { body, query, validationResult } = require('express-validator');
const AIRecommendation  = require('../models/AIRecommendation');
const logger            = require('../config/logger');

const AI_URL = process.env.AI_SERVICE_URL || 'http://localhost:8000';

// ─── Store a new AI recommendation ────────────────────────────────────────────

exports.store = [
  body('asset').isString().toUpperCase(),
  body('action').isIn(['BUY', 'SELL', 'HOLD']),
  body('confidence').isFloat({ min: 0, max: 100 }),
  body('timeframe').isString(),
  body('priceAtRecommendation').isFloat({ min: 0 }),
  body('expectedReturnPct').optional().isString(),
  body('reason').optional().isString(),
  body('source').optional().isIn(['advisor', 'signal', 'brain']),

  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

    const {
      asset, action, confidence, timeframe,
      priceAtRecommendation, expectedReturnPct, reason,
      source = 'advisor',
    } = req.body;

    // Set expiry based on timeframe
    const expiryMap = { '1h': 1, '4h': 4, '1d': 24, '7d': 168, '30d': 720 };
    const hours     = expiryMap[timeframe] || 24;
    const expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000);

    try {
      const rec = await AIRecommendation.create({
        asset, action, confidence, timeframe,
        priceAtRecommendation, expectedReturnPct, reason,
        source, expiresAt,
      });
      res.status(201).json({ success: true, data: rec });
    } catch (err) {
      logger.error('[Tracker] store error:', err.message);
      res.status(500).json({ success: false, message: err.message });
    }
  },
];

// ─── Get recommendation history ───────────────────────────────────────────────

exports.history = [
  query('asset').optional().isString().toUpperCase(),
  query('status').optional().isIn(['pending', 'evaluated']),
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),

  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

    const filter = {};
    if (req.query.asset)  filter.asset  = req.query.asset.toUpperCase();
    if (req.query.status) filter.status = req.query.status;

    const page  = req.query.page  || 1;
    const limit = req.query.limit || 20;
    const skip  = (page - 1) * limit;

    try {
      const [recs, total] = await Promise.all([
        AIRecommendation.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
        AIRecommendation.countDocuments(filter),
      ]);
      res.json({ success: true, total, page, pages: Math.ceil(total / limit), recommendations: recs });
    } catch (err) {
      logger.error('[Tracker] history error:', err.message);
      res.status(500).json({ success: false, message: err.message });
    }
  },
];

// ─── Accuracy stats ───────────────────────────────────────────────────────────

exports.accuracy = async (req, res) => {
  try {
    const evaluated = await AIRecommendation.find({ status: 'evaluated' }).lean();

    const total   = evaluated.length;
    const correct = evaluated.filter(r => r.wasCorrect).length;
    const accuracy = total > 0 ? Math.round(correct / total * 100) : 0;

    const avgProfit = total > 0
      ? Math.round(evaluated.reduce((s, r) => s + (r.profitIfFollowed || 0), 0) / total * 100) / 100
      : 0;

    const byAsset = {};
    for (const r of evaluated) {
      if (!byAsset[r.asset]) byAsset[r.asset] = { total: 0, correct: 0 };
      byAsset[r.asset].total++;
      if (r.wasCorrect) byAsset[r.asset].correct++;
    }

    const byAssetStats = Object.entries(byAsset).map(([asset, d]) => ({
      asset,
      total:    d.total,
      correct:  d.correct,
      accuracy: Math.round(d.correct / d.total * 100),
    })).sort((a, b) => b.accuracy - a.accuracy);

    res.json({
      success:    true,
      total,
      correct,
      accuracy,
      avgProfitPerTrade: avgProfit,
      byAsset:    byAssetStats,
      pending:    await AIRecommendation.countDocuments({ status: 'pending' }),
    });
  } catch (err) {
    logger.error('[Tracker] accuracy error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── Evaluate pending recommendations ─────────────────────────────────────────
// Called by a cron job — checks each expired pending rec and compares with current price

exports.evaluate = async (req, res) => {
  try {
    const now     = new Date();
    const pending = await AIRecommendation.find({
      status:    'pending',
      expiresAt: { $lte: now },
    }).limit(50).lean();

    if (pending.length === 0) return res.json({ success: true, evaluated: 0 });

    let evaluated = 0;
    for (const rec of pending) {
      try {
        const priceResp = await axios.get(`${AI_URL}/api/prices/${rec.asset}`, { timeout: 5_000 });
        const currentPrice = priceResp.data?.price;
        if (!currentPrice) continue;

        const priceDiff    = currentPrice - rec.priceAtRecommendation;
        const actualReturn = priceDiff / rec.priceAtRecommendation * 100;

        let wasCorrect = false;
        if (rec.action === 'BUY'  && actualReturn > 0) wasCorrect = true;
        if (rec.action === 'SELL' && actualReturn < 0) wasCorrect = true;
        if (rec.action === 'HOLD' && Math.abs(actualReturn) < 2) wasCorrect = true;

        const signedReturn  = rec.action === 'SELL' ? -actualReturn : actualReturn;
        const profitOn100   = Math.round(100 * signedReturn / 100 * 100) / 100;

        await AIRecommendation.updateOne({ _id: rec._id }, {
          status:           'evaluated',
          priceAtExpiry:    currentPrice,
          actualReturnPct:  Math.round(actualReturn * 100) / 100,
          wasCorrect,
          profitIfFollowed: profitOn100,
          evaluatedAt:      now,
        });
        evaluated++;
      } catch (e) {
        logger.warn(`[Tracker] evaluate ${rec.asset} failed: ${e.message}`);
      }
    }

    res.json({ success: true, evaluated, found: pending.length });
  } catch (err) {
    logger.error('[Tracker] evaluate error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
};
