const {
  getLatestDecisions, getStats, approveDecision, rejectDecision, getPendingDecision,
  getPendingProposal, approveAllocationProposal, rejectAllocationProposal,
} = require('../services/aiWorkerService');
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

// GET /api/v1/ai-brain/pending — the ONE thing the single main screen needs:
// "is there a decision waiting on me right now, and what is it".
exports.pending = async (req, res) => {
  try {
    const decision = await getPendingDecision();
    return res.json({ success: true, decision: decision || null });
  } catch (err) {
    logger.error('[AiBrain] pending error:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/v1/ai-brain/decisions/:id/approve — master-plan decision #11:
// this is the ONLY way a proposal becomes a real (paper) trade.
exports.approve = async (req, res) => {
  try {
    const trade = await approveDecision(req.params.id);
    return res.json({ success: true, trade });
  } catch (err) {
    logger.warn('[AiBrain] approve rejected:', err.message);
    return res.status(err.isSafetyGateRejection ? 422 : 400).json({ success: false, message: err.message });
  }
};

// POST /api/v1/ai-brain/decisions/:id/reject
exports.reject = async (req, res) => {
  try {
    const decision = await rejectDecision(req.params.id);
    return res.json({ success: true, decision });
  } catch (err) {
    logger.warn('[AiBrain] reject failed:', err.message);
    return res.status(400).json({ success: false, message: err.message });
  }
};

// ── Allocation proposal endpoints (decisions #11 + #14) ─────────────────────
// This is what the single main screen actually polls: one pending card with
// 2-4 choices and exactly one AI-recommended pick.

// GET /api/v1/ai-brain/pending-proposal
exports.pendingProposal = async (req, res) => {
  try {
    const proposal = await getPendingProposal();
    return res.json({ success: true, proposal: proposal || null });
  } catch (err) {
    logger.error('[AiBrain] pendingProposal error:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/v1/ai-brain/proposals/:id/approve  body: { optionKey }
exports.approveProposal = async (req, res) => {
  try {
    const { optionKey } = req.body;
    if (!optionKey) return res.status(400).json({ success: false, message: '"optionKey" is required.' });
    const result = await approveAllocationProposal(req.params.id, optionKey);
    return res.json({ success: true, ...result });
  } catch (err) {
    logger.warn('[AiBrain] approveProposal rejected:', err.message);
    return res.status(err.isSafetyGateRejection ? 422 : 400).json({ success: false, message: err.message, failures: err.failures });
  }
};

// POST /api/v1/ai-brain/proposals/:id/reject
exports.rejectProposal = async (req, res) => {
  try {
    const proposal = await rejectAllocationProposal(req.params.id);
    return res.json({ success: true, proposal });
  } catch (err) {
    logger.warn('[AiBrain] rejectProposal failed:', err.message);
    return res.status(400).json({ success: false, message: err.message });
  }
};
