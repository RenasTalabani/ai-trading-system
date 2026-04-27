const cron = require('node-cron');
const { collectNews } = require('../services/newsService');
const logger = require('../config/logger');

function startNewsJob() {
  logger.info('Starting news collection job...');

  // Collect news every 30 minutes
  cron.schedule('*/30 * * * *', async () => {
    logger.info('[NewsJob] Running scheduled news collection...');
    try {
      const result = await collectNews();
      logger.info(`[NewsJob] Complete — collected: ${result.collected}, stored: ${result.stored}`);
    } catch (err) {
      logger.error('[NewsJob] Error:', err.message);
    }
  });

  logger.info('  News collection: every 30 minutes');

  // Initial run after 5 seconds
  setTimeout(async () => {
    logger.info('[NewsJob] Initial news collection running...');
    try {
      await collectNews();
    } catch (err) {
      logger.error('[NewsJob] Initial collection failed:', err.message);
    }
  }, 5000);
}

module.exports = { startNewsJob };
