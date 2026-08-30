/**
 * AI Worker Service
 * Calls the Python AI service every cycle, stores decisions, opens virtual trades.
 * This is the core of the 24/7 autonomous AI brain.
 */
const axios          = require('axios');
const AIDecision     = require('../models/AIDecision');
const VirtualTrade   = require('../models/VirtualTrade');
const VirtualPortfolio = require('../models/VirtualPortfolio');
const BudgetSession  = require('../models/BudgetSession');
const MarketRegimeHistory = require('../models/MarketRegimeHistory');
const logger         = require('../config/logger');
const { capToMaxRisk } = require('./virtualTrackingService');
const { getCache: getGlobalScanCache } = require('../jobs/globalScanJob');

// T-060 (2026-08-26, product-to-code audit follow-up): this worker used to
// make its own independent /api/global/scan call every 5 minutes, separate
// from globalScanJob's own 30-minute cycle -- since that endpoint isn't
// deterministic/cached server-side (live prices, live RL weights, live
// macro), the two pipelines could and did return different results for the
// same asset within minutes of each other, each persisting its own
// AIDecision. Reusing globalScanJob's cached scan when it's fresh enough
// removes that duplicate-decision-generation root cause; falling back to a
// direct call when the cache is empty/stale keeps this worker functional on
// its own (e.g. at boot, or if globalScanJob's own cycle failed).
const MAX_CACHE_AGE_MS = 35 * 60 * 1000; // globalScanJob refreshes every 30 min; small slack

const CONFIDENCE_THRESHOLD  = parseInt(process.env.AI_CONFIDENCE_THRESHOLD)  || 70;  // Phase 18: raised to 70
const MIN_FUSED_SCORE       = parseInt(process.env.AI_MIN_FUSED_SCORE)       || 65;  // Phase 18
const MIN_QUALITY_SCORE     = parseInt(process.env.AI_MIN_QUALITY_SCORE)     || 75;  // Phase 18
const MAX_OPEN_TRADES       = parseInt(process.env.AI_MAX_OPEN_TRADES)       || 5;   // Phase 18: reduced to 5
const MAX_NEW_PER_CYCLE     = parseInt(process.env.AI_MAX_NEW_PER_CYCLE)     || 3;
const MAX_DAILY_LOSS_PCT    = parseFloat(process.env.AI_MAX_DAILY_LOSS_PCT)  || 0.05; // 5 %

// ── Helpers ───────────────────────────────────────────────────────────────────

function _pick(obj, ...keys) {
  for (const k of keys) if (obj[k] != null) return obj[k];
  return null;
}

// ── Core cycle ────────────────────────────────────────────────────────────────

async function runAIWorkerCycle() {
  // 1. Budget session must be active
  const session = await BudgetSession.findOne({ sessionKey: 'global' });
  if (!session || session.status !== 'active') {
    return { skipped: 'session_inactive' };
  }

  // 2. Portfolio protection — max open trades
  const openCount = await VirtualTrade.countDocuments({ status: 'open' });
  if (openCount >= MAX_OPEN_TRADES) {
    return { skipped: 'max_trades_reached', openCount };
  }

  // 3. Load portfolio for position sizing
  const portfolio = await VirtualPortfolio.findOne({ portfolioKey: 'global' });
  if (!portfolio) return { skipped: 'no_portfolio' };

  // 2b. Portfolio protection — max daily loss (5 %)
  const dayStart  = new Date(Date.now() - 86400_000);
  const todayLosses = await VirtualTrade.aggregate([
    { $match: { status: { $in: ['closed_profit', 'closed_loss'] }, closedAt: { $gte: dayStart }, pnl: { $lt: 0 } } },
    { $group: { _id: null, totalLoss: { $sum: '$pnl' } } },
  ]);
  const dailyLoss = Math.abs((todayLosses[0]?.totalLoss) || 0);
  if (dailyLoss >= portfolio.currentBalance * MAX_DAILY_LOSS_PCT) {
    logger.warn(`[AIWorker] Daily loss limit hit ($${dailyLoss.toFixed(2)}) — pausing trading.`);
    return { skipped: 'daily_loss_limit', dailyLoss };
  }

  // 4. Reuse globalScanJob's cached scan when fresh enough (T-060); only
  // fall back to an independent call when there's no usable cache.
  let scanResult;
  const cached   = getGlobalScanCache();
  const cacheAge = cached?.scannedAt ? Date.now() - new Date(cached.scannedAt).getTime() : Infinity;

  if (cached?.result?.success && cacheAge <= MAX_CACHE_AGE_MS) {
    scanResult = cached.result;
  } else {
    const aiUrl = (process.env.AI_SERVICE_URL || 'http://localhost:8000').replace(/\/$/, '');
    try {
      const { data } = await axios.post(`${aiUrl}/api/global/scan`, {
        capital:   portfolio.currentBalance,
        timeframe: '1h',
        top_n:     5,
      }, { timeout: 90_000 });
      scanResult = data;
    } catch (err) {
      logger.warn('[AIWorker] AI service unreachable:', err.message);
      return { skipped: 'ai_service_error', error: err.message };
    }
  }

  if (!scanResult?.success || !scanResult.top_opportunities?.length) {
    return { skipped: 'no_opportunities' };
  }

  // 5. Assets already in open trades — avoid doubling up
  const openAssets  = await VirtualTrade.distinct('asset', { status: 'open' });
  const openSet     = new Set(openAssets);
  const rawSizeUsd  = (portfolio.currentBalance * portfolio.riskPerTradePct) / 100;
  const sizeUsd     = parseFloat(
    capToMaxRisk(rawSizeUsd, portfolio.currentBalance, 'AI worker cycle').toFixed(2)
  );

  let tradesCreated = 0;

  // 6. Process each top opportunity
  for (const opp of scanResult.top_opportunities) {
    if (tradesCreated >= MAX_NEW_PER_CYCLE) break;
    // Bug found 2026-08-18 (PM continuous-improvement pass): the check at
    // the top of this function only gates whether the cycle runs *at all*
    // (openCount >= MAX_OPEN_TRADES -> skip the whole cycle) -- it never
    // limited how many NEW trades this loop could add on top of that
    // starting count. With enough qualifying opportunities in one scan,
    // a cycle could open up to MAX_NEW_PER_CYCLE trades regardless of how
    // close openCount already was to MAX_OPEN_TRADES, silently exceeding
    // the portfolio's own declared risk cap (e.g. openCount=4,
    // MAX_OPEN_TRADES=5, MAX_NEW_PER_CYCLE=3 -> could reach 7 open trades).
    if (openCount + tradesCreated >= MAX_OPEN_TRADES) break;
    if (opp.action === 'HOLD') continue;
    if ((opp.confidence   || 0) < CONFIDENCE_THRESHOLD) continue;
    if ((opp.fused_score  || 0) < MIN_FUSED_SCORE)      continue;
    if ((opp.quality_score || 0) < MIN_QUALITY_SCORE)   continue;
    if (openSet.has(opp.asset)) continue;

    const entryPrice = _pick(opp, 'current_price', 'currentPrice');
    if (!entryPrice) continue;

    const stopLoss   = _pick(opp, 'stop_loss',   'stopLoss');
    const takeProfit = _pick(opp, 'take_profit',  'takeProfit');

    // Store the AI decision
    const decision = await AIDecision.create({
      asset:       opp.asset,
      displayName: _pick(opp, 'display_name', 'displayName') || opp.asset,
      assetClass:  _pick(opp, 'asset_class',  'assetClass')  || 'crypto',
      action:      opp.action,
      confidence:  opp.confidence,
      entryPrice,
      stopLoss:    stopLoss   ?? null,
      takeProfit:  takeProfit ?? null,
      riskReward:  _pick(opp, 'risk_reward',  'riskReward')  ?? null,
      reason:      opp.reason ?? null,
      rsi:         opp.rsi    ?? null,
      trend:       opp.trend  ?? null,
      newsScore:   _pick(opp, 'news_score',  'newsScore')    ?? null,
      fusedScore:  _pick(opp, 'fused_score', 'fusedScore')   ?? null,
    });

    // Open virtual trade
    const trade = await VirtualTrade.create({
      source:       'ai',
      origin:       'ai_worker', // T-074a: 100%-certain, no HTTP request/human involved
      aiDecisionId: decision._id,
      asset:        opp.asset,
      direction:    opp.action,
      entryPrice:   parseFloat(Number(entryPrice).toFixed(8)),
      stopLoss:     stopLoss   != null ? parseFloat(Number(stopLoss).toFixed(8))   : null,
      takeProfit:   takeProfit != null ? parseFloat(Number(takeProfit).toFixed(8)) : null,
      // T-073: same ATR value ai-service's GlobalAnalyzer already computed
      // and used to size this exact opportunity's stopLoss/takeProfit
      // (see global_analyzer.py's _score_crypto/_score_multi_asset) --
      // reused as-is, not recalculated.
      atrAtEntry:   _pick(opp, 'atr'),
      sizeUsd,
      openedAt:     new Date(),
    });

    // Back-link trade onto the decision
    await AIDecision.updateOne({ _id: decision._id },
      { tradeCreated: true, tradeId: trade._id });

    // Store regime history (Phase 18)
    if (opp.regime) {
      MarketRegimeHistory.create({
        asset:      opp.asset,
        regime:     opp.regime,
        action:     opp.action,
        confidence: opp.confidence,
        fusedScore: opp.fused_score,
      }).catch(() => {});
    }

    openSet.add(opp.asset);
    tradesCreated++;

    logger.info(
      `[AIWorker] Trade OPENED — ${opp.asset} ${opp.action} @ ${entryPrice} ` +
      `| conf:${opp.confidence}% | SL:${stopLoss} | TP:${takeProfit} | size:$${sizeUsd}`
    );
  }

  return {
    tradesCreated,
    openCount,
    balance: parseFloat(portfolio.currentBalance.toFixed(2)),
    scanned: scanResult.scanned,
  };
}

// ── Queries used by the controller ────────────────────────────────────────────

async function getLatestDecisions(limit = 20) {
  return AIDecision.find()
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();
}

async function getStats() {
  const [total, withTrade, buyCount, sellCount, holdCount] = await Promise.all([
    AIDecision.countDocuments(),
    AIDecision.countDocuments({ tradeCreated: true }),
    AIDecision.countDocuments({ action: 'BUY' }),
    AIDecision.countDocuments({ action: 'SELL' }),
    AIDecision.countDocuments({ action: 'HOLD' }),
  ]);

  const latest = await AIDecision.findOne().sort({ createdAt: -1 }).lean();

  return {
    total, withTrade, buyCount, sellCount, holdCount,
    latestAt: latest?.createdAt ?? null,
  };
}

module.exports = { runAIWorkerCycle, getLatestDecisions, getStats };
