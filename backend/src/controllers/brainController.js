const axios      = require('axios');
const { getCache: getGlobalCache } = require('../jobs/globalScanJob');
const AIDecision = require('../models/AIDecision');
const logger     = require('../config/logger');

const AI_URL = process.env.AI_SERVICE_URL || 'http://localhost:8000';

// ── GET /api/v1/brain/report/action ──────────────────────────────────────────
// Report 1: "What To Do" — best asset + full trade plan from all sources
exports.actionReport = async (req, res) => {
  try {
    const cached = getGlobalCache();
    if (!cached?.result?.best) {
      return res.status(503).json({
        success: false,
        message: 'AI Brain is warming up — retry in 30 seconds',
      });
    }

    const best = cached.result.best;
    const top  = cached.result.top_opportunities || [];

    // Fetch macro data from AI service (not in global scan cache)
    let macro = null;
    try {
      const macroResp = await axios.get(`${AI_URL}/api/macro/snapshot`, { timeout: 5_000 });
      if (macroResp.data?.success !== false) macro = macroResp.data;
    } catch (_) {}

    // Pull recent accuracy for confidence boost context
    const [totalWins, totalLosses] = await Promise.all([
      AIDecision.countDocuments({ result: 'WIN' }),
      AIDecision.countDocuments({ result: 'LOSS' }),
    ]);
    const evaluated  = totalWins + totalLosses;
    const aiAccuracy = evaluated > 0
      ? Math.round((totalWins / evaluated) * 100) : null;

    // Build rich reason combining all sources
    const reasonParts = [best.reason || ''];
    if (macro) {
      const fg = macro.fear_greed?.value;
      if (fg != null) {
        const mood = fg >= 65 ? 'Greed' : fg <= 35 ? 'Fear' : 'Neutral';
        reasonParts.push(`Market mood: ${mood} (Fear & Greed ${fg}/100).`);
      }
      if (macro.macro_sentiment) {
        reasonParts.push(`Macro bias: ${macro.macro_sentiment.toUpperCase()}.`);
      }
    }
    if (aiAccuracy != null) {
      reasonParts.push(`AI historical accuracy: ${aiAccuracy}% over ${evaluated} evaluated trades.`);
    }

    res.json({
      success:    true,
      generatedAt: cached.scannedAt,
      action: {
        bestAsset:             best.asset,
        displayName:           best.display_name || best.asset,
        assetClass:            best.asset_class  || 'crypto',
        action:                best.action,
        entryPrice:            best.current_price || null,
        stopLoss:              best.stop_loss     || null,
        takeProfit:            best.take_profit   || null,
        riskReward:            best.risk_reward   || null,
        timeframe:             best.timeframe     || '4H',
        confidence:            best.confidence,
        expectedProfitPercent: best.expected_return || null,
        reason:                reasonParts.filter(Boolean).join(' '),
        topPicks:              top.slice(0, 5).map(o => ({
          asset:      o.asset,
          displayName: o.display_name || o.asset,
          action:     o.action,
          confidence: o.confidence,
          assetClass: o.asset_class || 'crypto',
        })),
        macroSentiment: macro?.macro_sentiment || null,
        fearGreed:      macro?.fear_greed?.value || null,
        fearGreedClass: macro?.fear_greed?.classification || null,
        aiAccuracy,
        totalEvaluated: evaluated,
      },
    });
  } catch (err) {
    logger.error('[Brain] action report error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── GET /api/v1/brain/report/performance?balance=500 ─────────────────────────
// Report 2: "If You Followed AI" — full simulation with periods + history
exports.performanceReport = async (req, res) => {
  try {
    const startingBalance = Math.max(10, Math.min(1_000_000,
      parseFloat(req.query.balance) || 500));

    const closed = await AIDecision.find({
      result:    { $in: ['WIN', 'LOSS'] },
      profitPct: { $ne: null },
    }).sort({ createdAt: 1 }).lean();

    const open = await AIDecision.countDocuments({ result: 'OPEN' });

    if (closed.length === 0) {
      return res.json({
        success: true,
        startingBalance,
        currentBalance:    startingBalance,
        netProfit:         0,
        netProfitPercent:  0,
        last24hProfit:     0,
        last7dProfit:      0,
        totalTrades:       0,
        winTrades:         0,
        lossTrades:        0,
        openTrades:        open,
        winRate:           0,
        accuracy:          0,
        equityCurve:       [],
        recentDecisions:   [],
        message:           'No evaluated decisions yet — results appear after the first completed trade',
      });
    }

    // Full simulation
    let balance  = startingBalance;
    let wins     = 0;
    let losses   = 0;
    const equityCurve = [{ date: closed[0].createdAt, balance: startingBalance }];

    for (const dec of closed) {
      const risk   = balance * 0.05;
      const change = risk * (dec.profitPct / 100);
      balance     += change;
      equityCurve.push({
        date:    dec.createdAt,
        balance: Math.round(balance * 100) / 100,
      });
      if (dec.result === 'WIN') wins++; else losses++;
    }

    const now       = new Date();
    const t24h      = new Date(now - 24 * 3600_000);
    const t7d       = new Date(now - 7 * 86400_000);

    // Period profits (simulate sub-windows)
    function periodProfit(since) {
      let bal = startingBalance;
      let afterBal = startingBalance;
      let inPeriod = false;
      for (const dec of closed) {
        const risk   = bal * 0.05;
        const change = risk * (dec.profitPct / 100);
        bal         += change;
        if (dec.createdAt >= since) {
          if (!inPeriod) { afterBal = bal - change; inPeriod = true; }
        }
      }
      return inPeriod ? Math.round((bal - afterBal) * 100) / 100 : 0;
    }

    const total      = wins + losses;
    const netProfit  = Math.round((balance - startingBalance) * 100) / 100;
    const netPct     = Math.round((netProfit / startingBalance) * 10000) / 100;
    const winRate    = Math.round((wins / total) * 100);

    // Recent 20 decisions for display
    const recent = await AIDecision.find({ result: { $ne: 'SKIPPED' } })
      .sort({ createdAt: -1 }).limit(20).lean();

    const closedPnl = recent.filter(d => d.profitPct != null);
    const avgProfitPct = closedPnl.length > 0
      ? Math.round(closedPnl.reduce((s, d) => s + d.profitPct, 0) / closedPnl.length * 100) / 100
      : null;

    res.json({
      success:          true,
      startingBalance,
      currentBalance:   Math.round(balance * 100) / 100,
      netProfit,
      netProfitPercent: netPct,
      last24hProfit:    periodProfit(t24h),
      last7dProfit:     periodProfit(t7d),
      totalTrades:      total,
      winTrades:        wins,
      lossTrades:       losses,
      openTrades:       open,
      winRate,
      accuracy:         winRate,
      avgProfitPct,
      equityCurve,
      recentDecisions:  recent.map(d => ({
        id:          d._id,
        asset:       d.asset,
        displayName: d.displayName || d.asset,
        action:      d.action,
        confidence:  d.confidence,
        result:      d.result,
        profitPct:   d.profitPct || null,
        createdAt:   d.createdAt,
      })),
    });
  } catch (err) {
    logger.error('[Brain] performance report error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── GET /api/v1/brain/stats ───────────────────────────────────────────────────
// Streak, achievements, 30-day heatmap
exports.brainStats = async (req, res) => {
  try {
    const evaluated = await AIDecision.find({
      result: { $in: ['WIN', 'LOSS'] },
    }).sort({ closedAt: -1 }).lean();

    // Current streak (consecutive wins from most recent)
    let currentStreak = 0;
    for (const d of evaluated) {
      if (d.result === 'WIN') currentStreak++;
      else break;
    }

    // Best streak ever
    let bestStreak = 0;
    let runningStreak = 0;
    for (const d of [...evaluated].reverse()) {
      if (d.result === 'WIN') { runningStreak++; bestStreak = Math.max(bestStreak, runningStreak); }
      else runningStreak = 0;
    }

    const wins   = evaluated.filter(d => d.result === 'WIN').length;
    const losses = evaluated.filter(d => d.result === 'LOSS').length;
    const total  = wins + losses;
    const winRate = total > 0 ? Math.round((wins / total) * 100) : 0;

    // Best profit on a single trade
    const bestProfitTrade = evaluated
      .filter(d => d.profitPct != null)
      .sort((a, b) => b.profitPct - a.profitPct)[0];

    // Weekly accuracy (last 7 days)
    const t7d = new Date(Date.now() - 7 * 86400_000);
    const weekly = evaluated.filter(d => new Date(d.closedAt) >= t7d);
    const weeklyWins   = weekly.filter(d => d.result === 'WIN').length;
    const weeklyAccuracy = weekly.length > 0
      ? Math.round((weeklyWins / weekly.length) * 100) : null;

    // 30-day heatmap: group by date string 'YYYY-MM-DD'
    const t30d = new Date(Date.now() - 30 * 86400_000);
    const recent30 = evaluated.filter(d => new Date(d.closedAt) >= t30d);
    const heatmapMap = {};
    for (const d of recent30) {
      const day = new Date(d.closedAt).toISOString().slice(0, 10);
      if (!heatmapMap[day]) heatmapMap[day] = { wins: 0, losses: 0 };
      if (d.result === 'WIN') heatmapMap[day].wins++;
      else heatmapMap[day].losses++;
    }
    const heatmap = Object.entries(heatmapMap).map(([date, v]) => ({
      date,
      wins:   v.wins,
      losses: v.losses,
      result: v.wins > v.losses ? 'WIN' : v.losses > v.wins ? 'LOSS' : 'MIXED',
    }));

    // Achievements
    const achievements = _computeAchievements({
      total, wins, losses, winRate, currentStreak, bestStreak, bestProfitTrade,
    });

    res.json({
      success: true,
      currentStreak,
      bestStreak,
      totalWins:    wins,
      totalLosses:  losses,
      totalEvaluated: total,
      winRate,
      weeklyAccuracy,
      weeklyTotal: weekly.length,
      heatmap,
      achievements,
    });
  } catch (err) {
    logger.error('[Brain] stats error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── GET /api/v1/brain/analytics ──────────────────────────────────────────────
// Per-asset AI performance breakdown
exports.brainAnalytics = async (req, res) => {
  try {
    const byAsset = await AIDecision.aggregate([
      { $match: { result: { $in: ['WIN', 'LOSS'] }, profitPct: { $ne: null } } },
      { $group: {
        _id: '$asset',
        displayName:   { $last: '$displayName' },
        assetClass:    { $last: '$assetClass' },
        total:         { $sum: 1 },
        wins:          { $sum: { $cond: [{ $eq: ['$result', 'WIN'] }, 1, 0] } },
        avgProfitPct:  { $avg: '$profitPct' },
        bestProfitPct: { $max: '$profitPct' },
        worstProfitPct:{ $min: '$profitPct' },
        lastSignal:    { $last: '$action' },
        lastAt:        { $last: '$createdAt' },
      }},
      { $addFields: {
        winRate: { $multiply: [{ $divide: ['$wins', '$total'] }, 100] },
        losses:  { $subtract: ['$total', '$wins'] },
      }},
      { $sort: { winRate: -1, total: -1 } },
    ]);

    const overall = await AIDecision.aggregate([
      { $match: { result: { $in: ['WIN', 'LOSS'] } } },
      { $group: {
        _id: null,
        total: { $sum: 1 },
        wins:  { $sum: { $cond: [{ $eq: ['$result', 'WIN'] }, 1, 0] } },
        avgProfitPct: { $avg: '$profitPct' },
      }},
    ]);

    const ov = overall[0] || { total: 0, wins: 0, avgProfitPct: 0 };

    res.json({
      success: true,
      overall: {
        total:        ov.total,
        wins:         ov.wins,
        losses:       ov.total - ov.wins,
        winRate:      ov.total > 0 ? Math.round((ov.wins / ov.total) * 100) : 0,
        avgProfitPct: ov.avgProfitPct != null
          ? Math.round(ov.avgProfitPct * 100) / 100 : null,
      },
      assets: byAsset.map(a => ({
        asset:          a._id,
        displayName:    a.displayName || a._id,
        assetClass:     a.assetClass  || 'crypto',
        total:          a.total,
        wins:           a.wins,
        losses:         a.losses,
        winRate:        Math.round(a.winRate),
        avgProfitPct:   Math.round(a.avgProfitPct * 100) / 100,
        bestProfitPct:  Math.round(a.bestProfitPct * 100) / 100,
        worstProfitPct: Math.round(a.worstProfitPct * 100) / 100,
        lastSignal:     a.lastSignal,
        lastAt:         a.lastAt,
      })),
    });
  } catch (err) {
    logger.error('[Brain] analytics error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
};

function _computeAchievements({ total, wins, losses, winRate, currentStreak, bestStreak, bestProfitTrade }) {
  return [
    {
      id: 'first_signal',
      name: 'First Signal',
      description: 'AI completed its first evaluated trade',
      icon: '🎯',
      earned: total >= 1,
      progress: Math.min(total, 1),
      goal: 1,
    },
    {
      id: 'hot_streak',
      name: 'Hot Streak',
      description: '5 consecutive wins',
      icon: '🔥',
      earned: bestStreak >= 5,
      progress: Math.min(bestStreak, 5),
      goal: 5,
    },
    {
      id: 'diamond_streak',
      name: 'Diamond Streak',
      description: '10 consecutive wins',
      icon: '💎',
      earned: bestStreak >= 10,
      progress: Math.min(bestStreak, 10),
      goal: 10,
    },
    {
      id: 'twenty_wins',
      name: '20 Wins',
      description: 'AI accumulated 20 total wins',
      icon: '🚀',
      earned: wins >= 20,
      progress: Math.min(wins, 20),
      goal: 20,
    },
    {
      id: 'century',
      name: 'Century Club',
      description: '100 total evaluated trades',
      icon: '🎪',
      earned: total >= 100,
      progress: Math.min(total, 100),
      goal: 100,
    },
    {
      id: 'sharp_shooter',
      name: 'Sharp Shooter',
      description: 'Win rate above 70% over 10+ trades',
      icon: '🎖️',
      earned: total >= 10 && winRate >= 70,
      progress: total >= 10 ? Math.min(winRate, 70) : Math.min(total, 10),
      goal: total >= 10 ? 70 : 10,
      unit: total >= 10 ? '%' : ' trades',
    },
    {
      id: 'fast_gainer',
      name: 'Fast Gainer',
      description: 'Any trade closed with +5% or more',
      icon: '⚡',
      earned: bestProfitTrade != null && bestProfitTrade.profitPct >= 5,
      progress: bestProfitTrade != null ? Math.min(bestProfitTrade.profitPct, 5) : 0,
      goal: 5,
      unit: '%',
    },
    {
      id: 'top_performer',
      name: 'Top Performer',
      description: 'Win rate above 80% over 20+ trades',
      icon: '🏆',
      earned: total >= 20 && winRate >= 80,
      progress: total >= 20 ? Math.min(winRate, 80) : Math.min(total, 20),
      goal: total >= 20 ? 80 : 20,
      unit: total >= 20 ? '%' : ' trades',
    },
  ];
}
