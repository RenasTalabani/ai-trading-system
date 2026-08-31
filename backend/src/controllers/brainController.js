const axios      = require('axios');
const { getCache: getGlobalCache } = require('../jobs/globalScanJob');
const AIDecision = require('../models/AIDecision');
const NewsData   = require('../models/NewsData');
const logger     = require('../config/logger');

const AI_URL = process.env.AI_SERVICE_URL || 'http://localhost:8000';

// ── GET /api/v1/brain/report/action ──────────────────────────────────────────
// Report 1: "What To Do" — best asset + full trade plan from all sources
exports.actionReport = async (req, res) => {
  try {
    const cached = getGlobalCache();
    // T-083 (2026-08-31): these were previously the same 503 "warming up"
    // branch, but they're two different states. `cached` being null/
    // undefined means no global scan has EVER completed since this
    // instance booted -- genuinely transient, resolves within one scan
    // cycle. `cached` existing but `cached.result.best` being null means a
    // scan DID complete and found zero assets clearing the confidence/
    // quality filter (globalAnalyzer.js's MIN_CONFIDENCE/MIN_FUSED_SCORE
    // thresholds, or the current RL-adaptive macro weight -- see T-041) --
    // a legitimate outcome of real market conditions that can persist for
    // hours, not a "retry in 30 seconds" situation. Telling the client to
    // retry in 30s forever, on every request, produced an unhandled
    // DioException on the mobile Radar screen (reported live 2026-08-31)
    // since brainActionProvider has no 503-specific handling -- collapsing
    // "never scanned" into a permanent-503 loop made that unavoidable.
    // Fixed by returning a normal 200 with a null-signal payload instead,
    // matching the "no strong recommendation" pattern guideController.js
    // already uses (T-079) for the same underlying situation.
    if (!cached) {
      return res.status(503).json({
        success: false,
        message: 'AI Brain is warming up — retry in 30 seconds',
      });
    }
    if (!cached.result?.best) {
      return res.json({
        success: true,
        generatedAt: cached.scannedAt,
        action: {
          bestAsset: '', displayName: '', assetClass: 'crypto',
          action: 'HOLD', timeframe: '4H', confidence: 0,
          reason: 'No strong recommendation right now — no asset currently '
                  + 'clears the AI Brain\'s confidence/quality filter. This '
                  + 'can happen during genuinely low-conviction market '
                  + 'conditions and may last a while; it is not an error.',
          topPicks: [],
        },
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
// T-085 (2026-08-31): the Portfolio screen's "If you followed every AI
// decision" balance is a full replay of every AIDecision ever closed --
// which means it's mathematically frozen for as long as no new decision
// closes, with nothing in the response to say so. Found live in
// production: the balance had been showing the exact same $304.58 for
// nearly four months, because AIDecision.find() turned up nothing created
// after 2026-05-06 -- storeGlobalDecision() (globalScanJob.js) only fires
// when a scan's `best` pick is non-null, and the confidence/fused-score
// filter in global_analyzer.py has been blocking effectively every asset
// (see the T-083/T-084 commits' evidence trail, and global_analyzer.py's
// own T-041 comment on the RL macro-weight drift behind it -- an explicit
// owner-reviewed decision, not touched here). Rather than silently
// replaying ancient data as if it were current, this now reports how
// stale it is so the UI can be honest about it instead of just looking
// broken.
const DECISION_STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24h

exports.performanceReport = async (req, res) => {
  try {
    const startingBalance = Math.max(10, Math.min(1_000_000,
      parseFloat(req.query.balance) || 500));

    const closed = await AIDecision.find({
      result:    { $in: ['WIN', 'LOSS'] },
      profitPct: { $ne: null },
    }).sort({ createdAt: 1 }).lean();

    const open = await AIDecision.countDocuments({ result: 'OPEN' });
    const mostRecent = await AIDecision.findOne({}).sort({ createdAt: -1 }).select('createdAt').lean();
    const lastDecisionAt = mostRecent?.createdAt || null;
    const stale = !lastDecisionAt || (Date.now() - new Date(lastDecisionAt).getTime()) > DECISION_STALE_THRESHOLD_MS;

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
        stale,
        lastDecisionAt,
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
      stale,
      lastDecisionAt,
      message: stale
        ? `No new AI decisions since ${new Date(lastDecisionAt).toISOString().slice(0, 10)} — `
          + 'showing the last available snapshot, not live performance.'
        : undefined,
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

// ── POST /api/v1/brain/ask ────────────────────────────────────────────────────
exports.askBrain = async (req, res) => {
  try {
    const raw = (req.body.question || '').trim();
    if (!raw) return res.status(400).json({ success: false, message: 'question required' });
    const q      = raw.toLowerCase();
    const intent = _detectIntent(q);
    const answer = await _buildAnswer(intent, q);
    res.json({ success: true, intent, question: raw, ...answer });
  } catch (err) {
    logger.error('[Brain] ask error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
};

function _detectIntent(q) {
  if (/\b(buy|sell|trade|invest|what should|best pick|top pick|recommend|signal|action|do now|what to do)\b/.test(q)) return 'action';
  const assetMap = {
    bitcoin:'BTCUSDT', btc:'BTCUSDT', ethereum:'ETHUSDT', eth:'ETHUSDT',
    bnb:'BNBUSDT', solana:'SOLUSDT', sol:'SOLUSDT', xrp:'XRPUSDT', ripple:'XRPUSDT',
    cardano:'ADAUSDT', ada:'ADAUSDT', doge:'DOGEUSDT', dogecoin:'DOGEUSDT',
    avax:'AVAXUSDT', avalanche:'AVAXUSDT', link:'LINKUSDT', chainlink:'LINKUSDT',
    matic:'MATICUSDT', polygon:'MATICUSDT',
  };
  for (const [name, sym] of Object.entries(assetMap)) {
    if (q.includes(name)) return 'asset:' + sym;
  }
  if (/\b(performance|accurate|accuracy|win rate|winning|profit|how good|track record|result)\b/.test(q)) return 'performance';
  if (/\b(streak|consecutive|row|on fire|winning streak)\b/.test(q)) return 'streak';
  if (/\b(market|sentiment|mood|fear|greed|bearish|bullish|macro|outlook)\b/.test(q)) return 'sentiment';
  if (/\b(news|headline|happening|latest|update|event)\b/.test(q)) return 'news';
  if (/\b(top|picks|opportunities|best assets|watch|all assets|which)\b/.test(q)) return 'picks';
  if (/\b(risk|safe|stop loss|stop|loss|dangerous|careful)\b/.test(q)) return 'risk';
  if (/\b(portfolio|followed|my trades|my follow|tracking)\b/.test(q)) return 'portfolio';
  return 'unknown';
}

async function _buildAnswer(intent, q) {
  const cached = getGlobalCache();

  if (intent === 'action' || intent === 'picks') {
    // T-083 (2026-08-31): same "never scanned" vs "scanned, nothing
    // qualifies" distinction as actionReport() above -- see its comment.
    if (!cached) return { type: 'text', text: 'The AI Brain is still warming up. Try again in 30 seconds.' };
    if (!cached.result?.best) return { type: 'text', text: 'No strong recommendation right now — no asset currently clears the AI Brain\'s confidence/quality filter. This can happen during low-conviction market conditions.' };
    const best = cached.result.best;
    const top  = (cached.result.top_opportunities || []).slice(0, 5);
    return {
      type: 'action',
      text: 'The AI Brain currently recommends **' + best.action + '** on **' + (best.display_name || best.asset) + '** with **' + best.confidence + '% confidence**.',
      data: {
        bestAsset: best.asset, displayName: best.display_name || best.asset,
        action: best.action, confidence: best.confidence,
        entryPrice: best.current_price || null, stopLoss: best.stop_loss || null,
        takeProfit: best.take_profit || null, riskReward: best.risk_reward || null,
        reason: best.reason || null,
        topPicks: top.map(o => ({ asset: o.asset, displayName: o.display_name || o.asset, action: o.action, confidence: o.confidence })),
      },
    };
  }

  if (intent.startsWith('asset:')) {
    const symbol  = intent.replace('asset:', '');
    const recent  = await AIDecision.find({ asset: symbol, result: { $in: ['WIN','LOSS','OPEN'] } }).sort({ createdAt: -1 }).limit(5).lean();
    const closed  = recent.filter(d => d.result !== 'OPEN');
    const wins    = closed.filter(d => d.result === 'WIN').length;
    const wr      = closed.length > 0 ? Math.round((wins / closed.length) * 100) : null;
    let brainSignal = null;
    if (cached?.result?.best?.asset === symbol) brainSignal = cached.result.best;
    if (!brainSignal) brainSignal = (cached?.result?.top_opportunities || []).find(o => o.asset === symbol);
    // T-057: was `relevantAssets` — not a field on the NewsData schema (the
    // real field, used everywhere else in the codebase, is `relatedAssets`)
    // — so this always matched zero documents.
    const news = await NewsData.find({ relatedAssets: symbol }).sort({ publishedAt: -1 }).limit(3).lean();
    const name = (brainSignal?.display_name || recent[0]?.displayName || symbol).replace('USDT','');
    const sigText = brainSignal ? 'Current signal: **' + brainSignal.action + '** at ' + brainSignal.confidence + '% confidence.' : 'No active brain signal for this asset.';
    const perfText = wr !== null ? ' Win rate: **' + wr + '%** over ' + closed.length + ' trades.' : '';
    return {
      type: 'asset',
      text: 'Here\'s what I know about **' + name + '**. ' + sigText + perfText,
      data: {
        asset: symbol, displayName: name,
        signal: brainSignal ? { action: brainSignal.action, confidence: brainSignal.confidence } : null,
        winRate: wr, totalTrades: closed.length,
        recentDecisions: recent.slice(0,3).map(d => ({ action: d.action, result: d.result, profitPct: d.profitPct, createdAt: d.createdAt })),
        news: news.map(n => ({ title: n.title, source: n.source, publishedAt: n.publishedAt })),
      },
    };
  }

  if (intent === 'performance') {
    const [wins, losses] = await Promise.all([
      AIDecision.countDocuments({ result: 'WIN' }),
      AIDecision.countDocuments({ result: 'LOSS' }),
    ]);
    const total = wins + losses;
    const wr    = total > 0 ? Math.round((wins / total) * 100) : 0;
    const avgR  = await AIDecision.aggregate([{ $match: { result: { $in: ['WIN','LOSS'] }, profitPct: { $ne: null } } }, { $group: { _id: null, avg: { $avg: '$profitPct' } } }]);
    const avg   = avgR[0]?.avg != null ? Math.round(avgR[0].avg * 10) / 10 : null;
    const grade = wr >= 80 ? 'S-tier 🏆' : wr >= 70 ? 'A-grade 🎖️' : wr >= 60 ? 'B-grade 📈' : 'Building track record';
    return {
      type: 'performance',
      text: 'The AI has a **' + wr + '% win rate** over **' + total + ' trades** — ' + grade + '.' + (avg != null ? ' Avg P&L: **' + (avg >= 0 ? '+' : '') + avg + '%**.' : ''),
      data: { wins, losses, total, winRate: wr, avgProfitPct: avg },
    };
  }

  if (intent === 'streak') {
    const evaluated = await AIDecision.find({ result: { $in: ['WIN','LOSS'] } }).sort({ closedAt: -1 }).limit(50).lean();
    let streak = 0;
    for (const d of evaluated) { if (d.result === 'WIN') streak++; else break; }
    const emoji = streak >= 10 ? '💎' : streak >= 5 ? '🔥' : streak >= 3 ? '⚡' : '';
    return { type: 'streak', text: streak === 0 ? 'No active win streak — last trade was a loss.' : 'The AI is on a **' + streak + '-win streak** ' + emoji + '!', data: { currentStreak: streak } };
  }

  if (intent === 'sentiment') {
    let macro = null;
    try { const r = await axios.get(AI_URL + '/api/macro/snapshot', { timeout: 5000 }); if (r.data?.success !== false) macro = r.data; } catch (_) {}
    const fg   = macro?.fear_greed?.value;
    const sent = macro?.macro_sentiment;
    const fgL  = fg == null ? '' : fg >= 75 ? 'Extreme Greed' : fg >= 55 ? 'Greed' : fg >= 45 ? 'Neutral' : fg >= 25 ? 'Fear' : 'Extreme Fear';
    return {
      type: 'sentiment',
      text: fg != null ? 'Fear & Greed: **' + fg + '/100** (' + fgL + ').' + (sent ? ' Macro: **' + sent.toUpperCase() + '**.' : '') + ' ' + (fg >= 65 ? 'Markets are greedy — manage risk carefully.' : fg <= 35 ? 'Fear is elevated — watch for opportunities.' : 'Markets are neutral.') : 'Macro data unavailable right now.',
      data: { fearGreed: fg, fearGreedLabel: fgL, macroSentiment: sent },
    };
  }

  if (intent === 'news') {
    const news = await NewsData.find({ impactScore: { $gte: 0.5 } }).sort({ publishedAt: -1 }).limit(5).lean();
    if (!news.length) return { type: 'text', text: 'No high-impact news available right now.' };
    const h = news[0];
    const s = (h.sentiment?.label || h.sentiment || 'neutral').toLowerCase();
    return { type: 'news', text: 'Latest: **"' + h.title + '"** (' + h.source + ') — ' + s + '.', data: { news: news.map(n => ({ title: n.title, source: n.source, sentiment: n.sentiment?.label || n.sentiment || 'neutral', publishedAt: n.publishedAt, url: n.url })) } };
  }

  if (intent === 'risk') {
    const best = cached?.result?.best;
    if (!best) return { type: 'text', text: 'Load the Brain report first to see risk levels.' };
    return { type: 'risk', text: 'For **' + best.action + ' ' + (best.display_name || best.asset) + '**: Entry **$' + best.current_price + '**, SL **$' + best.stop_loss + '**, TP **$' + best.take_profit + '**, R:R **' + (best.risk_reward || 'N/A') + '**. Never risk more than 1-3% of capital per trade.', data: { action: best.action, entryPrice: best.current_price, stopLoss: best.stop_loss, takeProfit: best.take_profit, riskReward: best.risk_reward } };
  }

  if (intent === 'portfolio') {
    const [open, closed] = await Promise.all([ AIDecision.countDocuments({ result: 'OPEN' }), AIDecision.countDocuments({ result: { $in: ['WIN','LOSS'] } }) ]);
    return { type: 'text', text: 'The AI has **' + open + ' open trade' + (open !== 1 ? 's' : '') + '** and **' + closed + ' closed trades** total. Check the Portfolio tab for the full breakdown.', data: { openTrades: open, closedTrades: closed } };
  }

  return { type: 'help', text: 'I didn\'t quite understand that. Try one of the suggestions below!', data: { suggestions: ['What should I buy?', 'Market sentiment?', 'AI win rate?', 'Tell me about Bitcoin', 'Current streak?', 'Latest news'] } };
}
