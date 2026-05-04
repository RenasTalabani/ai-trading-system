const UserFollow = require('../models/UserFollow');
const logger     = require('../config/logger');

// GET /api/v1/brain/follows
exports.list = async (req, res) => {
  try {
    const follows = await UserFollow.find({ userId: req.user.id })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();
    res.json({ success: true, follows });
  } catch (err) {
    logger.error('[UserFollow] list error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/v1/brain/follows
exports.follow = async (req, res) => {
  try {
    const { asset, displayName, action, entryPrice, stopLoss,
            takeProfit, confidence, timeframe, note } = req.body;

    if (!asset || !action || !confidence) {
      return res.status(400).json({ success: false, message: 'asset, action, confidence required' });
    }

    // One open follow per asset at a time
    const existing = await UserFollow.findOne({
      userId: req.user.id, asset, outcome: 'OPEN',
    });
    if (existing) {
      return res.json({ success: true, follow: existing, alreadyFollowing: true });
    }

    const follow = await UserFollow.create({
      userId: req.user.id,
      asset, displayName: displayName || asset,
      action, entryPrice, stopLoss, takeProfit,
      confidence, timeframe: timeframe || '4H', note: note || '',
    });

    res.json({ success: true, follow });
  } catch (err) {
    logger.error('[UserFollow] follow error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
};

// PATCH /api/v1/brain/follows/:id/close
exports.close = async (req, res) => {
  try {
    const { outcome, exitPrice, profitPct, note } = req.body;

    const follow = await UserFollow.findOne({
      _id: req.params.id, userId: req.user.id,
    });
    if (!follow) {
      return res.status(404).json({ success: false, message: 'Follow not found' });
    }

    follow.outcome   = outcome   || 'CANCELLED';
    follow.exitPrice = exitPrice || null;
    follow.profitPct = profitPct != null ? profitPct : null;
    follow.closedAt  = new Date();
    if (note) follow.note = note;
    await follow.save();

    res.json({ success: true, follow });
  } catch (err) {
    logger.error('[UserFollow] close error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
};

// DELETE /api/v1/brain/follows/:id
exports.remove = async (req, res) => {
  try {
    await UserFollow.deleteOne({ _id: req.params.id, userId: req.user.id });
    res.json({ success: true });
  } catch (err) {
    logger.error('[UserFollow] remove error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/v1/brain/follows/stats
exports.stats = async (req, res) => {
  try {
    const all = await UserFollow.find({ userId: req.user.id }).lean();
    const closed = all.filter(f => f.outcome === 'WIN' || f.outcome === 'LOSS');
    const wins   = closed.filter(f => f.outcome === 'WIN').length;

    res.json({
      success:   true,
      total:     all.length,
      open:      all.filter(f => f.outcome === 'OPEN').length,
      wins,
      losses:    closed.filter(f => f.outcome === 'LOSS').length,
      winRate:   closed.length > 0 ? Math.round((wins / closed.length) * 100) : 0,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
