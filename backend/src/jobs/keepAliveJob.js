const cron   = require('node-cron');
const axios  = require('axios');
const logger = require('../config/logger');

const BACKEND_URL = process.env.RAILWAY_PUBLIC_DOMAIN
  ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}/api/v1/health`
  : null;

const AI_URL = (process.env.AI_SERVICE_URL || '').replace(/\/$/, '');

async function ping() {
  const results = [];

  if (BACKEND_URL) {
    try {
      await axios.get(BACKEND_URL, { timeout: 8_000 });
      results.push('backend OK');
    } catch (e) {
      results.push(`backend FAIL: ${e.message}`);
    }
  }

  if (AI_URL) {
    try {
      await axios.get(`${AI_URL}/api/health`, { timeout: 8_000 });
      results.push('ai-service OK');
    } catch (e) {
      results.push(`ai-service FAIL: ${e.message}`);
    }
  }

  if (results.length) logger.info(`[KeepAlive] ${results.join(' | ')}`);
}

function startKeepAliveJob() {
  cron.schedule('*/5 * * * *', ping);
  logger.info('[KeepAlive] Pinging services every 5 minutes to prevent sleep');
}

module.exports = { startKeepAliveJob };
