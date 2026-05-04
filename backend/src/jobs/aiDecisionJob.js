/**
 * aiDecisionJob — runs every 15 minutes.
 * Triggers a fresh AI global scan, caches the result, and stores the best
 * decision so decision_tracking_job can evaluate it when it expires.
 * This gives the AI Brain a 15-min refresh cycle instead of waiting 30 min.
 */
const cron   = require('node-cron');
const logger = require('../config/logger');
const { runGlobalScan } = require('./globalScanJob');

async function runAIDecisionCycle() {
  try {
    logger.info('[AIDecisionJob] Running decision cycle…');
    await runGlobalScan();   // re-scans + auto-stores via storeGlobalDecision hook
  } catch (err) {
    logger.error('[AIDecisionJob] cycle error:', err.message);
  }
}

function startAIDecisionJob() {
  // Offset from globalScanJob (which runs at :00 and :30) — run at :15 and :45
  cron.schedule('15,45 * * * *', runAIDecisionCycle);
  logger.info('[AIDecisionJob] Scheduled — every 15 minutes at :15 and :45');
}

module.exports = { startAIDecisionJob, runAIDecisionCycle };
