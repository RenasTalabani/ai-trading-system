/**
 * globalScanJob — runs the full multi-asset global scan every 30 minutes.
 * Keeps the latest result cached in memory so the dashboard can serve it
 * instantly without waiting for a 60-second AI scan.
 */
const cron   = require('node-cron');
const axios  = require('axios');
const logger = require('../config/logger');

// Lazy-require to avoid circular dep at module load time
let _storeDecision = null;
function _getStore() {
  if (!_storeDecision) {
    _storeDecision = require('./decisionTrackingJob').storeGlobalDecision;
  }
  return _storeDecision;
}

const AI_URL = process.env.AI_SERVICE_URL || 'http://localhost:8000';

// In-memory cache: { result, scannedAt }
let _cache    = null;
let _lastBest = null; // tracks {asset, action} to detect changes

async function runGlobalScan() {
  try {
    logger.info('[GlobalScanJob] Starting global multi-asset scan…');
    const resp = await axios.post(
      `${AI_URL}/api/global/scan`,
      { capital: 500, timeframe: '1h', top_n: 5 },
      { timeout: 120_000 },
    );
    if (resp.data?.success) {
      const scannedAt = new Date();
      _cache = { result: resp.data, scannedAt };
      const best = resp.data.best;
      if (best) {
        logger.info(
          `[GlobalScanJob] Best: ${best.display_name} → ${best.action} ` +
          `(${best.confidence}% conf, score ${best.fused_score})`,
        );
        _getStore()(best, scannedAt).catch(() => {});

        // Push notification when best pick changes
        const changed = !_lastBest
            || _lastBest.asset  !== best.asset
            || _lastBest.action !== best.action;
        _lastBest = { asset: best.asset, action: best.action };

        if (changed) {
          _notifyBrainUpdate(best).catch(() => {});
        }
      }
    }
  } catch (err) {
    logger.warn(`[GlobalScanJob] scan failed: ${err.message}`);
  }
}

async function _notifyBrainUpdate(best) {
  try {
    const User = require('../models/User');
    const { sendPushToUser } = require('../services/notificationService');
    const actionEmoji = best.action === 'BUY' ? '🟢' : best.action === 'SELL' ? '🔴' : '⚪️';
    const title       = `${actionEmoji} AI Brain — ${best.action} ${best.display_name || best.asset}`;
    const retPart     = best.expected_return ? ` · +${best.expected_return}% est.` : '';
    const body        = `${best.confidence}% confidence${retPart}`;
    const users = await User.find({ isActive: true, fcmToken: { $exists: true } }).lean();
    for (const user of users) {
      if (user.preferences?.fcmEnabled !== false) {
        await sendPushToUser(user._id, title, body, {
          type:       'BRAIN_UPDATE',
          asset:      best.asset,
          action:     best.action,
          confidence: String(best.confidence),
        }).catch(() => {});
      }
    }
    logger.info(`[GlobalScanJob] Brain update push sent — ${best.action} ${best.asset} to ${users.length} users`);
  } catch (err) {
    logger.warn('[GlobalScanJob] Brain update push failed:', err.message);
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
