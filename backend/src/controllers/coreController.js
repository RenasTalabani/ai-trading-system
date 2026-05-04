const { getCache: getGlobalCache } = require('../jobs/globalScanJob');
const AIDecision                   = require('../models/AIDecision');
const logger                       = require('../config/logger');

// GET /api/v1/core/advice
// Returns the single best AI decision right now from the global scan cache.
exports.advice = async (req, res) => {
  try {
    const cached = getGlobalCache();
    if (!cached?.result?.best) {
      return res.status(503).json({
        success: false,
        message: 'AI brain is warming up — retry in 30 seconds',
      });
    }

    const best  = cached.result.best;
    const scans = cached.result.top_opportunities || [];

    // Pull the last stored decision to show streak / history count
    const lastDecision = await AIDecision.findOne({ asset: best.asset })
      .sort({ createdAt: -1 })
      .lean();

    res.json({
      success: true,
      advice: {
        asset:           best.asset,
        display_name:    best.display_name || best.asset,
        decision:        best.action,
        timeframe:       best.timeframe   || '1h',
        confidence:      best.confidence,
        expected_profit: best.expected_return || 'N/A',
        reason:          best.reason || '',
        current_price:   best.current_price  || null,
        stop_loss:       best.stop_loss       || null,
        take_profit:     best.take_profit     || null,
        risk_reward:     best.risk_reward     || null,
        asset_class:     best.asset_class     || 'crypto',
        scanned_at:      cached.scannedAt,
      },
      top_picks: scans.slice(0, 5).map(o => ({
        asset:      o.asset,
        decision:   o.action,
        confidence: o.confidence,
      })),
      last_decision_id: lastDecision?._id || null,
    });
  } catch (err) {
    logger.error('[Core] advice error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/v1/core/status
exports.status = (req, res) => {
  const cached = getGlobalCache();
  res.json({
    success:    true,
    brain_ready: !!cached,
    last_scan:   cached?.scannedAt || null,
    asset_count: cached?.result?.scanned || 0,
  });
};
