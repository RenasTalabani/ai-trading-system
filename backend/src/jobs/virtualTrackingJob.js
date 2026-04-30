const cron = require('node-cron');
const { checkOpenTrades } = require('../services/virtualTrackingService');
const { getAllCachedPrices } = require('../services/binanceService');
const logger = require('../config/logger');

async function runVirtualTrackingCycle() {
  try {
    const prices = getAllCachedPrices();
    if (Object.keys(prices).length > 0) {
      await checkOpenTrades(prices);
    }
  } catch (err) {
    logger.error('[VirtualTrackingJob] Cycle error:', err.message);
  }
}

function startVirtualTrackingJob() {
  runVirtualTrackingCycle();
  cron.schedule('*/5 * * * *', runVirtualTrackingCycle);
  logger.info('[VirtualTrackingJob] Started — checking open trades every 5 minutes.');
}

module.exports = { startVirtualTrackingJob };
