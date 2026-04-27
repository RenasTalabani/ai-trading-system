const cron = require('node-cron');
const { collectAllAssets } = require('../services/binanceService');
const logger = require('../config/logger');

let task = null;

// Collect 1h candles every hour at :01
// Collect 15m candles every 15 minutes
const SCHEDULES = [
  { interval: '1h',  cron: '1 * * * *'    },
  { interval: '15m', cron: '*/15 * * * *' },
  { interval: '4h',  cron: '2 */4 * * *'  },
  { interval: '1d',  cron: '3 0 * * *'    },
];

function startMarketDataJob() {
  logger.info('Starting market data collection jobs...');

  SCHEDULES.forEach(({ interval, cron: schedule }) => {
    cron.schedule(schedule, async () => {
      logger.info(`[MarketDataJob] Running collection for interval: ${interval}`);
      try {
        await collectAllAssets(interval);
      } catch (err) {
        logger.error(`[MarketDataJob] Failed for ${interval}:`, err.message);
      }
    });
    logger.info(`  Scheduled ${interval} collection: "${schedule}"`);
  });

  // Run immediately on startup to seed database
  setTimeout(async () => {
    logger.info('[MarketDataJob] Initial data seed running...');
    await collectAllAssets('1h');
    await collectAllAssets('4h');
  }, 3000);
}

module.exports = { startMarketDataJob };
