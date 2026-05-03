const cron             = require('node-cron');
const axios            = require('axios');
const AIRecommendation = require('../models/AIRecommendation');
const logger           = require('../config/logger');

const AI_URL = process.env.AI_SERVICE_URL || 'http://localhost:8000';

async function evaluatePending() {
  const now     = new Date();
  const pending = await AIRecommendation.find({
    status:    'pending',
    expiresAt: { $lte: now },
  }).limit(100).lean();

  if (pending.length === 0) return;

  // Batch: fetch unique assets' prices in parallel
  const assets  = [...new Set(pending.map(r => r.asset))];
  const prices  = {};
  await Promise.all(assets.map(async asset => {
    try {
      const resp   = await axios.get(`${AI_URL}/api/prices/${asset}`, { timeout: 5_000 });
      prices[asset] = resp.data?.price ?? null;
    } catch { prices[asset] = null; }
  }));

  let evaluated = 0;
  const bulk = AIRecommendation.collection.initializeUnorderedBulkOp();

  for (const rec of pending) {
    const currentPrice = prices[rec.asset];
    if (!currentPrice || !rec.priceAtRecommendation) continue;

    const actualReturn = (currentPrice - rec.priceAtRecommendation) / rec.priceAtRecommendation * 100;
    const signedReturn = rec.action === 'SELL' ? -actualReturn : actualReturn;

    let wasCorrect = false;
    if (rec.action === 'BUY'  && actualReturn > 0.5)       wasCorrect = true;
    if (rec.action === 'SELL' && actualReturn < -0.5)       wasCorrect = true;
    if (rec.action === 'HOLD' && Math.abs(actualReturn) < 2) wasCorrect = true;

    bulk.find({ _id: rec._id }).updateOne({ $set: {
      status:           'evaluated',
      priceAtExpiry:    currentPrice,
      actualReturnPct:  Math.round(actualReturn * 100) / 100,
      wasCorrect,
      profitIfFollowed: Math.round(100 * signedReturn / 100 * 100) / 100,
      evaluatedAt:      now,
    }});
    evaluated++;
  }

  if (evaluated > 0) {
    await bulk.execute();
    logger.info(`[TrackerEval] Evaluated ${evaluated}/${pending.length} recommendations`);
  }
}

function startTrackerEvalJob() {
  // Run at minute 30 of every 2nd hour (00:30, 02:30, 04:30 ...)
  cron.schedule('30 */2 * * *', async () => {
    try {
      await evaluatePending();
    } catch (err) {
      logger.error('[TrackerEval] Job error:', err.message);
    }
  });
  logger.info('[TrackerEval] Job scheduled — every 2 hours at :30');
}

module.exports = { startTrackerEvalJob, evaluatePending };
