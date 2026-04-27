const cron = require('node-cron');
const { fetchSocialAnalysis, fetchSocialAlerts } = require('../services/socialService');
const { broadcastSignal } = require('../websocket/wsServer');
const logger = require('../config/logger');

async function runSocialCheck() {
  logger.info('[SocialJob] Fetching social intelligence update...');
  try {
    const [analysis, alerts] = await Promise.all([
      fetchSocialAnalysis(),
      fetchSocialAlerts(),
    ]);

    if (alerts?.alerts?.length) {
      logger.warn(`[SocialJob] ${alerts.alert_count} active manipulation/pump alerts`);
      alerts.alerts.forEach((a) => {
        logger.warn(`  ⚠ ${a.asset}: pump=${a.pump_detected}, manip=${a.manipulation_detected}, hype=${a.hype_level}`);
      });
    }

    if (analysis) {
      logger.info(
        `[SocialJob] Global social: ${analysis.global?.sentiment} | ` +
        `posts: ${analysis.global?.total_posts} | ` +
        `pump_detected: ${analysis.global?.pump_detected}`
      );
    }
  } catch (err) {
    logger.error('[SocialJob] Error:', err.message);
  }
}

function startSocialJob() {
  logger.info('Starting social intelligence job...');

  // Run every 15 minutes — social moves fast
  cron.schedule('*/15 * * * *', runSocialCheck);
  logger.info('  Social intelligence check: every 15 minutes');

  // Initial run after 8 seconds
  setTimeout(runSocialCheck, 8000);
}

module.exports = { startSocialJob, runSocialCheck };
