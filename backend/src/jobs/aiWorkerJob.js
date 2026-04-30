const cron = require('node-cron');
const { runAIWorkerCycle } = require('../services/aiWorkerService');
const logger = require('../config/logger');

let _running = false;

async function runSafe() {
  if (_running) {
    logger.debug('[AIWorkerJob] Previous cycle still running — skipping.');
    return;
  }
  _running = true;
  try {
    const result = await runAIWorkerCycle();
    if (result?.skipped) {
      logger.debug(`[AIWorkerJob] Cycle skipped: ${result.skipped}`);
    } else if (result?.tradesCreated > 0) {
      logger.info(
        `[AIWorkerJob] Cycle done — ${result.tradesCreated} trade(s) opened ` +
        `| open:${result.openCount} | balance:$${result.balance}`
      );
    }
  } catch (err) {
    logger.error('[AIWorkerJob] Unhandled error:', err.message);
  } finally {
    _running = false;
  }
}

function startAIWorkerJob() {
  // Give services 15 s to initialise before first run
  setTimeout(runSafe, 15_000);

  // Then run every 5 minutes
  cron.schedule('*/5 * * * *', runSafe);
  logger.info('[AIWorkerJob] AI Brain Worker started — running every 5 minutes');
}

module.exports = { startAIWorkerJob };
