const cron = require('node-cron');
const { checkOpenTrades, applyFundingPayments } = require('../services/virtualTrackingService');
const { getAllCachedPrices } = require('../services/binanceService');
const aiService = require('../services/aiService');
const logger = require('../config/logger');

// Non-Binance assets that can have open virtual trades — binanceService's
// price cache only ever covers TRACKED_ASSETS (crypto), so without this a
// gold position could never hit TP/SL/liquidation and would stay open forever.
const EXTENDED_PRICE_ASSETS = ['XAUUSD'];

async function runVirtualTrackingCycle() {
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
    logger.error('[VirtualTrackingJob] Cycle error:', err.message);
  }
}

async function runFundingCycle() {
  try {
    await applyFundingPayments();
  } catch (err) {
    logger.error('[VirtualTrackingJob] Funding cycle error:', err.message);
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
