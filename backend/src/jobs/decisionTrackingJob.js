const cron       = require('node-cron');
const axios      = require('axios');
const AIDecision = require('../models/AIDecision');
const logger     = require('../config/logger');

const AI_URL = process.env.AI_SERVICE_URL || 'http://localhost:8000';

const TIMEFRAME_HOURS = { '1h': 1, '4h': 4, '1d': 24, '7d': 168, '30d': 720 };

async function evaluateOpenDecisions() {
  const now     = new Date();
  const expired = await AIDecision.find({
    result:    'OPEN',
    expiresAt: { $lte: now },
    entryPrice: { $gt: 0 },
  }).limit(100).lean();

  if (expired.length === 0) return;

  // Fetch unique asset prices in parallel
  const assets = [...new Set(expired.map(d => d.asset))];
  const prices = {};
  await Promise.all(assets.map(async asset => {
    try {
      const r = await axios.get(`${AI_URL}/api/prices/${asset}`, { timeout: 5_000 });
      prices[asset] = r.data?.price ?? null;
    } catch { prices[asset] = null; }
  }));

  const bulk = AIDecision.collection.initializeUnorderedBulkOp();
  let evaluated = 0;

  for (const dec of expired) {
    const currentPrice = prices[dec.asset];
    if (!currentPrice || !dec.entryPrice) continue;

    const returnPct    = (currentPrice - dec.entryPrice) / dec.entryPrice * 100;
    const signedReturn = dec.action === 'SELL' ? -returnPct : returnPct;
    const profitOn100  = Math.round(signedReturn * 100) / 100;

    let result = 'LOSS';
    if (dec.action === 'BUY'  && returnPct  >  0.5) result = 'WIN';
    if (dec.action === 'SELL' && returnPct  < -0.5) result = 'WIN';
    if (dec.action === 'HOLD' && Math.abs(returnPct) < 2) result = 'WIN';

    bulk.find({ _id: dec._id }).updateOne({ $set: {
      exitPrice:  currentPrice,
      profitPct:  Math.round(returnPct * 100) / 100,
      profit:     profitOn100,
      result,
      closedAt:   now,
    }});
    evaluated++;
  }

  if (evaluated > 0) {
    await bulk.execute();
    logger.info(`[DecisionTracking] Evaluated ${evaluated} decisions`);
  }
}

async function storeGlobalDecision(best, scannedAt) {
  if (!best?.asset || !best?.action || !best?.current_price) return;

  const hours     = TIMEFRAME_HOURS[best.timeframe || '1h'] || 1;
  const expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000);

  // Avoid duplicate: skip if same asset+action within last 15 min
  const recent = await AIDecision.findOne({
    asset:     best.asset,
    action:    best.action,
    createdAt: { $gte: new Date(Date.now() - 15 * 60 * 1000) },
  }).lean();

  if (recent) return;

  await AIDecision.create({
    asset:             best.asset,
    displayName:       best.display_name || best.asset,
    assetClass:        best.asset_class  || 'crypto',
    action:            best.action,
    confidence:        best.confidence,
    entryPrice:        best.current_price,
    stopLoss:          best.stop_loss    || null,
    takeProfit:        best.take_profit  || null,
    riskReward:        best.risk_reward  || null,
    reason:            best.reason       || '',
    timeframe:         best.timeframe    || '1h',
    expectedProfitPct: best.expected_return || 'N/A',
    expiresAt,
    source:            'global_scan',
    result:            'OPEN',
  });

  logger.info(`[DecisionTracking] Stored: ${best.asset} ${best.action} @ $${best.current_price}`);
}

function startDecisionTrackingJob() {
  // Evaluate open decisions every 15 min
  cron.schedule('*/15 * * * *', async () => {
    try { await evaluateOpenDecisions(); }
    catch (e) { logger.error('[DecisionTracking] eval error:', e.message); }
  });
  logger.info('[DecisionTracking] Job scheduled — evaluates every 15 minutes');
}

module.exports = { startDecisionTrackingJob, storeGlobalDecision, evaluateOpenDecisions };
