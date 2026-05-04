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
    });
  } catch (err) {
    logger.error('[CoreSimulator] error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
};
