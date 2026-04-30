const { getLatestDecisions, getStats } = require('../services/aiWorkerService');
const AIDecision   = require('../models/AIDecision');
const VirtualTrade = require('../models/VirtualTrade');
const BudgetSession = require('../models/BudgetSession');
const logger = require('../config/logger');

// GET /api/v1/ai-brain/latest?limit=20
exports.latest = async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 20, 50);
    const decisions = await getLatestDecisions(limit);
    return res.json({ success: true, decisions });
  } catch (err) {
    logger.error('[AiBrain] latest error:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/v1/ai-brain/stats
exports.stats = async (req, res) => {
  try {
    const [stats, session, openTrades] = await Promise.all([
      getStats(),
      BudgetSession.findOne({ sessionKey: 'global' }).lean(),
      VirtualTrade.countDocuments({ status: 'open', source: 'ai' }),
    ]);

    return res.json({
      success: true,
      session: session ? { status: session.status, budget: session.budget } : null,
      openAITrades: openTrades,
      decisions: stats,
    });
  } catch (err) {
    logger.error('[AiBrain] stats error:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/v1/ai-brain/decisions/:asset
exports.assetHistory = async (req, res) => {
  try {
    const { asset } = req.params;
    const decisions = await AIDecision.find({ asset: asset.toUpperCase() })
      .sort({ createdAt: -1 })
      .limit(10)
      .lean();
    return res.json({ success: true, asset: asset.toUpperCase(), decisions });
  } catch (err) {
    logger.error('[AiBrain] assetHistory error:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
};
