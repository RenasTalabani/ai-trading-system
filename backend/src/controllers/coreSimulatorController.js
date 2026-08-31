const AIDecision = require('../models/AIDecision');
const logger     = require('../config/logger');

// GET /api/v1/core/simulator?capital=500
// Answers: "if you followed every AI decision, how much would you have?"
exports.simulate = async (req, res) => {
  try {
    const capital = Math.max(10, Math.min(1_000_000, parseFloat(req.query.capital) || 500));

    const closed = await AIDecision.find({
      result:    { $in: ['WIN', 'LOSS'] },
      profitPct: { $ne: null },
    }).sort({ createdAt: 1 }).lean();

    // T-085 (2026-08-31): same staleness distinction as
    // brainController.js's performanceReport() -- this is a full replay of
    // every closed AIDecision, so it's frozen for as long as nothing new
    // closes. See that function's comment for the full root-cause
    // evidence trail (nothing had closed in ~4 months in production).
    const mostRecent = await AIDecision.findOne({}).sort({ createdAt: -1 }).select('createdAt').lean();
    const lastDecisionAt = mostRecent?.createdAt || null;
    const STALE_MS = 24 * 60 * 60 * 1000;
    const stale = !lastDecisionAt || (Date.now() - new Date(lastDecisionAt).getTime()) > STALE_MS;

    if (closed.length === 0) {
      return res.json({
        success: true,
        capital,
        balance:       capital,
        profit:        0,
        profit_percent: 0,
        win_rate:      0,
        total_trades:  0,
        wins:          0,
        losses:        0,
        stale,
        last_decision_at: lastDecisionAt,
        message:       'No evaluated decisions yet — results appear after 1 hour',
      });
    }

    // Simulate: risk 5% of current balance per trade
    let balance = capital;
    let wins = 0, losses = 0;
    const equityCurve = [{ date: closed[0].createdAt, balance: capital }];

    for (const dec of closed) {
      const risk   = balance * 0.05;
      const change = risk * (dec.profitPct / 100);
      balance      += change;
      equityCurve.push({
        date:    dec.createdAt,
        balance: Math.round(balance * 100) / 100,
      });
      if (dec.result === 'WIN') wins++; else losses++;
    }

    const total      = wins + losses;
    const profit     = Math.round((balance - capital) * 100) / 100;
    const profitPct  = Math.round((profit / capital) * 10000) / 100;
    const winRate    = Math.round((wins / total) * 100);

    res.json({
      success:        true,
      capital,
      balance:        Math.round(balance * 100) / 100,
      profit,
      profit_percent: profitPct,
      win_rate:       winRate,
      total_trades:   total,
      wins,
      losses,
      equity_curve:   equityCurve,
      stale,
      last_decision_at: lastDecisionAt,
      message: stale
        ? `No new AI decisions since ${new Date(lastDecisionAt).toISOString().slice(0, 10)} — showing the last available snapshot, not live performance.`
        : undefined,
    });
  } catch (err) {
    logger.error('[CoreSimulator] error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
};
