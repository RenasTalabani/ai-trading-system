const axios  = require('axios');
const { body, validationResult } = require('express-validator');
const logger = require('../config/logger');
const { getCache, runGlobalScan } = require('../jobs/globalScanJob');

const AI_URL = process.env.AI_SERVICE_URL || 'http://localhost:8000';

const VALID_TIMEFRAMES = ['15m', '1h', '4h', '1d'];

// GET /api/v1/global/latest — returns cached result instantly
exports.latest = async (req, res) => {
  const cached = getCache();
  if (cached) {
    return res.json({ ...cached.result, cached_at: cached.scannedAt });
  }
  // Cache cold — trigger a scan and wait
  try {
    await runGlobalScan();
    const fresh = getCache();
    return fresh
      ? res.json({ ...fresh.result, cached_at: fresh.scannedAt })
      : res.status(503).json({ success: false, message: 'Scan in progress, retry in 30s' });
  } catch (err) {
    return res.status(503).json({ success: false, message: err.message });
  }
};

exports.scan = [
  body('capital').optional().isFloat({ min: 1, max: 1_000_000 }),
  body('timeframe').optional().isIn(VALID_TIMEFRAMES),
  body('top_n').optional().isInt({ min: 1, max: 10 }),

  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty())
      return res.status(400).json({ success: false, errors: errors.array() });

    const { capital = 500, timeframe = '1h', top_n = 5 } = req.body;

    try {
      const aiResp = await axios.post(
        `${AI_URL}/api/global/scan`,
        { capital, timeframe, top_n },
        { timeout: 120_000 },
      );
      return res.json(aiResp.data);
    } catch (err) {
      const msg = err.response?.data?.detail || err.message;
      logger.error(`[Global] scan failed: ${msg}`);
      return res.status(502).json({ success: false, message: msg });
    }
  },
];
