const cron = require('node-cron');
const { runDueBuys } = require('../services/dcaService');
const logger = require('../config/logger');

async function runDcaCycle() {
  try {
    await runDueBuys();
  } catch (err) {
    logger.error(`[DCAJob] Cycle error: ${err.stack}`);
  }
}

function startDcaJob() {
  // Checked daily — frequencyDays is measured in whole days, no need for
  // finer granularity than that.
  cron.schedule('0 1 * * *', runDcaCycle);
  logger.info('[DCAJob] Started — checking due DCA buys daily at 01:00 UTC.');
}

module.exports = { startDcaJob, runDcaCycle };
