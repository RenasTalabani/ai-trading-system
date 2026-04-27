const cron = require('node-cron');
const { pickupNewSignals, checkOpenTrades } = require('../services/virtualTrackingService');
const { getAllCachedPrices }                = require('../services/binanceService');
const logger                               = require('../config/logger');

async function runVirtualTrackingCycle() {
  try {
    // 1. Absorb any signals not yet tracked
    const picked = await pickupNewSignals();

    // 2. Evaluate open trades against latest prices
    const prices = getAllCachedPrices();
    if (Object.keys(prices).length > 0) {
      await checkOpenTrades(prices);
    }

    if (picked > 0) {
      logger.info(`[VirtualTrackingJob] Cycle complete — ${picked} new trade(s) opened.`);
    }
  } catch (err) {
    logger.error('[VirtualTrackingJob] Cycle error:', err.message);
  }
}

function startVirtualTrackingJob() {
  // Run immediately on startup
  runVirtualTrackingCycle();

  // Then every 5 minutes
  cron.schedule('*/5 * * * *', runVirtualTrackingCycle);
  logger.info('[VirtualTrackingJob] Started — running every 5 minutes.');
}

module.exports = { startVirtualTrackingJob };
