const cron = require('node-cron');
const { checkOpenTrades, applyFundingPayments } = require('../services/virtualTrackingService');
const { getAllCachedPrices } = require('../services/binanceService');
const aiService = require('../services/aiService');
const logger = require('../config/logger');

// Non-Binance assets that can have open virtual trades — binanceService's
// price cache only ever covers TRACKED_ASSETS (crypto), so without this an
// asset priced outside Binance could never hit TP/SL/liquidation and would
// stay open forever. Empty since decision #18 (locked, 2026-09-03): gold
// moved from XAUUSD to PAXGUSDT, which IS in TRACKED_ASSETS now, so it's
// already covered by the normal cached-price path below with no extra step.
const EXTENDED_PRICE_ASSETS = [];

// Self-overlap guards (T-023 follow-up, 2026-08-18). The shared portfolio
// lock added in T-023 already makes concurrent cycles *correct* (no lost
// updates), but without these flags a cycle that runs long -- e.g. a slow
// aiService.getPrice() round trip while ai-service is degraded -- would
// still let cron queue up an unbounded backlog of pending cycles behind
// the lock, each waiting its turn. Mirrors the existing pattern already
// used in aiWorkerJob.js's `_running` guard, applied to both schedules
// registered in this file.
let _trackingRunning = false;
let _fundingRunning  = false;

async function runVirtualTrackingCycle() {
  if (_trackingRunning) {
    logger.debug('[VirtualTrackingJob] Previous tracking cycle still running — skipping.');
    return;
  }
  _trackingRunning = true;
  try {
    const prices = getAllCachedPrices();

    for (const asset of EXTENDED_PRICE_ASSETS) {
      const price = await aiService.getPrice(asset);
      if (price !== null) prices[asset] = { price, ts: Date.now() };
    }

    if (Object.keys(prices).length > 0) {
      await checkOpenTrades(prices);
    }
  } catch (err) {
    logger.error(`[VirtualTrackingJob] Cycle error: ${err.stack}`);
  } finally {
    _trackingRunning = false;
  }
}

async function runFundingCycle() {
  if (_fundingRunning) {
    logger.debug('[VirtualTrackingJob] Previous funding cycle still running — skipping.');
    return;
  }
  _fundingRunning = true;
  try {
    await applyFundingPayments();
  } catch (err) {
    logger.error(`[VirtualTrackingJob] Funding cycle error: ${err.stack}`);
  } finally {
    _fundingRunning = false;
  }
}

function startVirtualTrackingJob() {
  runVirtualTrackingCycle();
  cron.schedule('*/5 * * * *', runVirtualTrackingCycle);
  // Real Binance perpetual funding intervals: 00:00, 08:00, 16:00 UTC
  cron.schedule('0 0,8,16 * * *', runFundingCycle);
  logger.info('[VirtualTrackingJob] Started — checking open trades every 5 minutes, funding every 8 hours.');
}

module.exports = { startVirtualTrackingJob };
