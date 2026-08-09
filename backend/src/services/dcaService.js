/**
 * DCA (Dollar-Cost Averaging) — simulated recurring-buy strategy.
 * Paper trading only, same as the rest of the virtual portfolio system.
 */
const DCAPlan = require('../models/DCAPlan');
const binanceService = require('./binanceService');
const logger = require('../config/logger');

function aiSvc() { return require('./aiService'); } // lazy — avoid load-order issues

// Crypto uses the live WS/REST price cache (no extra network call); anything
// else (e.g. gold) falls back to the AI service's price lookup, which itself
// dispatches to the right source (Binance vs Yahoo Finance) per asset.
async function getLivePrice(asset) {
  const cached = binanceService.getCachedPrice(asset);
  if (cached) return typeof cached === 'object' ? cached.price : cached;
  return await aiSvc().getPrice(asset);
}

async function startPlan(asset, amountPerBuy, frequencyDays) {
  asset = asset.toUpperCase();
  const price = await getLivePrice(asset);
  if (!price) throw new Error(`Price unavailable for ${asset} — can't start a DCA plan.`);

  const units = amountPerBuy / price;
  const plan = await DCAPlan.create({
    asset, amountPerBuy, frequencyDays,
    purchases: [{ price, amountUsd: amountPerBuy, units, date: new Date() }],
    totalInvested: amountPerBuy,
    totalUnits: units,
    lastBuyAt: new Date(),
  });

  logger.info(`[DCA] Started plan for ${asset}: $${amountPerBuy} every ${frequencyDays}d (first buy @ $${price})`);
  return plan;
}

async function stopPlan(planId) {
  const plan = await DCAPlan.findById(planId);
  if (!plan) throw new Error('DCA plan not found.');
  plan.status = 'stopped';
  await plan.save();
  return plan;
}

// Executes any buys that have come due — called on a daily cron.
async function runDueBuys() {
  const activePlans = await DCAPlan.find({ status: 'active' });
  if (activePlans.length === 0) return;

  for (const plan of activePlans) {
    try {
      const dueAt = new Date(plan.lastBuyAt.getTime() + plan.frequencyDays * 24 * 3_600_000);
      if (Date.now() < dueAt.getTime()) continue;

      const price = await getLivePrice(plan.asset);
      if (!price) {
        logger.warn(`[DCA] Skipped buy for ${plan.asset} — price unavailable.`);
        continue;
      }

      const units = plan.amountPerBuy / price;
      plan.purchases.push({ price, amountUsd: plan.amountPerBuy, units, date: new Date() });
      plan.totalInvested += plan.amountPerBuy;
      plan.totalUnits += units;
      plan.lastBuyAt = new Date();
      await plan.save();

      logger.info(`[DCA] Executed buy for ${plan.asset}: $${plan.amountPerBuy} @ $${price} (${plan.purchases.length} total buys)`);
    } catch (err) {
      logger.error(`[DCA] Buy failed for plan ${plan._id} (${plan.asset}):`, err.message);
    }
  }
}

async function getPlansWithSummary() {
  const plans = await DCAPlan.find().sort({ createdAt: -1 }).lean();
  const summaries = [];

  for (const plan of plans) {
    const currentPrice = await getLivePrice(plan.asset);
    const currentValue = currentPrice ? plan.totalUnits * currentPrice : null;
    const unrealizedPnl = currentValue !== null ? currentValue - plan.totalInvested : null;
    const unrealizedPnlPct = currentValue !== null && plan.totalInvested > 0
      ? (unrealizedPnl / plan.totalInvested) * 100 : null;
    const avgCostBasis = plan.totalUnits > 0 ? plan.totalInvested / plan.totalUnits : 0;

    summaries.push({
      ...plan,
      currentPrice, currentValue, unrealizedPnl, unrealizedPnlPct, avgCostBasis,
    });
  }
  return summaries;
}

module.exports = { startPlan, stopPlan, runDueBuys, getPlansWithSummary };
