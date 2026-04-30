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
const logger         = require('../config/logger');

const CONFIDENCE_THRESHOLD = parseInt(process.env.AI_CONFIDENCE_THRESHOLD) || 60;
const MAX_OPEN_TRADES      = parseInt(process.env.AI_MAX_OPEN_TRADES)      || 10;
const MAX_NEW_PER_CYCLE    = parseInt(process.env.AI_MAX_NEW_PER_CYCLE)    || 3;

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

  // 2. Respect max-open-trades limit
  const openCount = await VirtualTrade.countDocuments({ status: 'open' });
  if (openCount >= MAX_OPEN_TRADES) {
    return { skipped: 'max_trades_reached', openCount };
  }

  // 3. Load portfolio for position sizing
  const portfolio = await VirtualPortfolio.findOne({ portfolioKey: 'global' });
  if (!portfolio) return { skipped: 'no_portfolio' };

  // 4. Call Python global scan
  const aiUrl = (process.env.AI_SERVICE_URL || 'http://localhost:8000').replace(/\/$/, '');
  let scanResult;
  try {
    const { data } = await axios.post(`${aiUrl}/global/scan`, {
      capital:   portfolio.currentBalance,
      timeframe: '1h',
      top_n:     5,
    }, { timeout: 90_000 });
    scanResult = data;
  } catch (err) {
    logger.warn('[AIWorker] AI service unreachable:', err.message);
    return { skipped: 'ai_service_error', error: err.message };
  }

  if (!scanResult?.success || !scanResult.top_opportunities?.length) {
    return { skipped: 'no_opportunities' };
  }

  // 5. Assets already in open trades — avoid doubling up
  const openAssets  = await VirtualTrade.distinct('asset', { status: 'open' });
  const openSet     = new Set(openAssets);
  const sizeUsd     = parseFloat(
    ((portfolio.currentBalance * portfolio.riskPerTradePct) / 100).toFixed(2)
  );

  let tradesCreated = 0;

  // 6. Process each top opportunity
  for (const opp of scanResult.top_opportunities) {
    if (tradesCreated >= MAX_NEW_PER_CYCLE) break;
    if (opp.action === 'HOLD') continue;
    if ((opp.confidence || 0) < CONFIDENCE_THRESHOLD) continue;
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
      aiDecisionId: decision._id,
      asset:        opp.asset,
      direction:    opp.action,
      entryPrice:   parseFloat(Number(entryPrice).toFixed(8)),
      stopLoss:     stopLoss   != null ? parseFloat(Number(stopLoss).toFixed(8))   : null,
      takeProfit:   takeProfit != null ? parseFloat(Number(takeProfit).toFixed(8)) : null,
      sizeUsd,
      openedAt:     new Date(),
    });

    // Back-link trade onto the decision
    await AIDecision.updateOne({ _id: decision._id },
      { tradeCreated: true, tradeId: trade._id });

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
