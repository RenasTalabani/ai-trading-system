const { getCache: getGlobalCache } = require('../jobs/globalScanJob');
const AIDecision                   = require('../models/AIDecision');
const logger                       = require('../config/logger');

// AUDIT-02 (2026-09-01, production audit): see the identical helper +
// comment in brainController.js -- RENO-001 (ai-service) means
// `cached.result.best` is now non-null almost every scan regardless of
// whether it clears the real quality bar; only an explicit
// `meets_bar === false` disqualifies it (a best from an older ai-service
// deploy, with no such field, stays trusted).
function bestMeetsBar(best) {
  return !!best && best.meets_bar !== false;
}

// GET /api/v1/core/advice
// Returns the single best AI decision right now from the global scan cache.
exports.advice = async (req, res) => {
  try {
    const cached = getGlobalCache();
    // T-083 (2026-08-31): "never scanned yet" vs "scanned, nothing
    // qualifies" -- see the identical fix + comment in
    // brainController.js's actionReport() for the full rationale.
    if (!cached) {
      return res.status(503).json({
        success: false,
        message: 'AI brain is warming up — retry in 30 seconds',
      });
    }
    if (!bestMeetsBar(cached.result?.best)) {
      // AUDIT-02: below-bar candidates (RENO-001) surfaced honestly, same
      // watch-list shape as brainController.js's actionReport() -- never
      // presented as `advice` (that stays null), never a fabricated
      // Entry/SL/TP.
      const watch_list = (cached.result?.top_opportunities || [])
        .filter((o) => o && o.asset)
        .slice(0, 5)
        .map((o) => ({
          asset: o.asset, display_name: o.display_name || o.asset,
          decision: o.action, confidence: o.confidence,
          meets_bar: o.meets_bar !== false, reason: o.reason || null,
        }));
      return res.json({
        success: true,
        advice: null,
        top_picks: [],
        watch_list,
        last_decision_id: null,
        message: 'No strong recommendation right now — no asset currently '
                 + 'clears the AI Brain\'s confidence/quality filter.',
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

// GET /api/v1/core/decisions?limit=20
exports.decisions = async (req, res) => {
  try {
    const limit = Math.min(50, parseInt(req.query.limit) || 20);

    const [decisions, total, wins, losses, open] = await Promise.all([
      AIDecision.find().sort({ createdAt: -1 }).limit(limit).lean(),
      AIDecision.countDocuments(),
      AIDecision.countDocuments({ result: 'WIN' }),
      AIDecision.countDocuments({ result: 'LOSS' }),
      AIDecision.countDocuments({ result: 'OPEN' }),
    ]);

    const evaluated = wins + losses;
    const winRate   = evaluated > 0 ? Math.round(wins / evaluated * 100) : 0;

    res.json({
      success: true,
      summary: { total, wins, losses, open, win_rate: winRate },
      decisions: decisions.map(d => ({
        id:           d._id,
        asset:        d.asset,
        display_name: d.displayName || d.asset,
        decision:     d.action,
        confidence:   d.confidence,
        timeframe:    d.timeframe,
        entry_price:  d.entryPrice,
        exit_price:   d.exitPrice,
        profit_pct:   d.profitPct,
        profit:       d.profit,
        result:       d.result,
        reason:       d.reason,
        created_at:   d.createdAt,
        closed_at:    d.closedAt,
      })),
    });
  } catch (err) {
    logger.error('[Core] decisions error:', err.message);
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
