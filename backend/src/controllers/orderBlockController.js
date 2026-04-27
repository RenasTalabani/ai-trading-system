const axios  = require('axios');
const { param, query, validationResult } = require('express-validator');
const logger = require('../config/logger');

const AI_URL = process.env.AI_SERVICE_URL || 'http://localhost:8000';

const VALID_TIMEFRAMES = ['15m', '1h', '4h', '1d'];

exports.analyze = [
  query('asset').optional().isString().isLength({ min: 3, max: 12 }),
  query('timeframe').optional().isIn(VALID_TIMEFRAMES),

  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

    const asset     = (req.query.asset     || 'BTCUSDT').toUpperCase();
    const timeframe = (req.query.timeframe || '1h').toLowerCase();

    try {
      const aiResp = await axios.post(
        `${AI_URL}/api/order-blocks/analyze`,
        { asset, timeframe },
        { timeout: 45_000 },
      );
      return res.json(aiResp.data);
    } catch (err) {
      const msg = err.response?.data?.detail || err.message;
      logger.error(`Order block analysis failed for ${asset}/${timeframe}: ${msg}`);
      return res.status(502).json({ success: false, message: msg });
    }
  },
];
