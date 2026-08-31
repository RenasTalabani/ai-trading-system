const cron       = require('node-cron');
const axios      = require('axios');
const AIDecision = require('../models/AIDecision');
const logger     = require('../config/logger');

const AI_URL = process.env.AI_SERVICE_URL || 'http://localhost:8000';

const TIMEFRAME_HOURS = { '1h': 1, '4h': 4, '1d': 24, '7d': 168, '30d': 720 };

// T-058 (2026-08-26, product-to-code audit follow-up): storeGlobalDecision()
// used to skip only if the *identical* asset+action pair had already been
// written in the last 15 minutes. globalScanJob (every 30 min) plus
// aiDecisionJob (which just re-triggers the same scan, offset at :15/:45)
// together produce an effective scan roughly every 15 minutes -- so that
// window barely outlasted the job's own cadence, and a near-duplicate
// AIDecision row got written on almost every cycle even when nothing about
// the market actually changed. Replaced with real state-change detection:
// skip only when the action, confidence, and price all match the most
// recent decision for this asset within these tolerances, AND that decision
// isn't stale enough to warrant a fresh read anyway.
const CONFIDENCE_DELTA_THRESHOLD = 5;              // percentage points
const PRICE_DELTA_PCT_THRESHOLD  = 1.5;            // percent
const MAX_STALENESS_MS           = 6 * 60 * 60 * 1000; // re-affirm at least every 6h

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
  let skipped   = 0;

  for (const dec of expired) {
    const currentPrice = prices[dec.asset];
    // T-085 (2026-08-31): this used to `continue` here with zero logging --
    // found live in production that two decisions (XAUUSD/XAGUSD, both
    // multi-asset symbols priced via ai-service's yfinance-backed
    // collector, which is meaningfully less reliable than the crypto/
    // Binance path) sat OPEN, silently re-skipped every 15 minutes, for
    // three weeks straight with zero trace in the logs -- the only reason
    // this was ever noticed was a user staring at a frozen portfolio
    // number. A single skip is normal (the price API can have a bad
    // moment); skips that never resolve are the actual problem, and there
    // was no way to tell the two apart from the logs before this. Not
    // retried harder here on purpose -- the 15-minute cron already
    // provides the retry; this only makes a stuck one visible instead of
    // silent.
    if (!currentPrice || !dec.entryPrice) {
      skipped++;
      logger.warn(`[DecisionTracking] Skipping ${dec.asset} (id ${dec._id}): ` +
        `${!currentPrice ? 'no live price available' : 'entryPrice missing'} ` +
        `-- created ${dec.createdAt?.toISOString?.() || dec.createdAt}, will retry next cycle`);
      continue;
    }

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

  // State-change detection (T-058) — see comment above for why this
  // replaced the old fixed 15-minute same-label window.
  const last = await AIDecision.findOne({ asset: best.asset })
    .sort({ createdAt: -1 })
    .lean();

  if (last) {
    const age                = Date.now() - new Date(last.createdAt).getTime();
    const actionChanged      = last.action !== best.action;
    const confidenceChanged  = Math.abs((last.confidence ?? 0) - (best.confidence ?? 0)) >= CONFIDENCE_DELTA_THRESHOLD;
    const priceChangedPct    = last.entryPrice
      ? Math.abs(best.current_price - last.entryPrice) / last.entryPrice * 100
      : Infinity;
    const priceChanged       = priceChangedPct >= PRICE_DELTA_PCT_THRESHOLD;
    const stale               = age >= MAX_STALENESS_MS;

    if (!actionChanged && !confidenceChanged && !priceChanged && !stale) {
      return; // nothing meaningful changed since the last decision for this asset
    }
  }

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
