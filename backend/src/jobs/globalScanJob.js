/**
 * globalScanJob — runs the full multi-asset global scan every 30 minutes.
 * Keeps the latest result cached in memory so the dashboard can serve it
 * instantly without waiting for a 60-second AI scan.
 */
const cron   = require('node-cron');
const axios  = require('axios');
const logger = require('../config/logger');

const AI_URL = process.env.AI_SERVICE_URL || 'http://localhost:8000';

// In-memory cache: { result, scannedAt }
let _cache = null;

async function runGlobalScan() {
  try {
    logger.info('[GlobalScanJob] Starting global multi-asset scan…');
    const resp = await axios.post(
      `${AI_URL}/api/global/scan`,
      { capital: 500, timeframe: '1h', top_n: 5 },
      { timeout: 120_000 },
    );
    if (resp.data?.success) {
      _cache = { result: resp.data, scannedAt: new Date() };
      const best = resp.data.best;
      if (best) {
        logger.info(
          `[GlobalScanJob] Best: ${best.display_name} → ${best.action} ` +
          `(${best.confidence}% conf, score ${best.fused_score})`,
        );
      }
    }
  } catch (err) {
    logger.warn(`[GlobalScanJob] scan failed: ${err.message}`);
  }
}

function getCache() {
  return _cache;
}

function start() {
  // Run immediately on startup, then every 30 minutes
  runGlobalScan();
  cron.schedule('*/30 * * * *', runGlobalScan);
  logger.info('[GlobalScanJob] Scheduled — runs every 30 minutes');
}

module.exports = { start, getCache, runGlobalScan };
