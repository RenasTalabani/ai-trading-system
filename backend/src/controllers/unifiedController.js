const axios  = require('axios');
const { body, validationResult } = require('express-validator');
const logger = require('../config/logger');

const AI_URL = process.env.AI_SERVICE_URL || 'http://localhost:8000';

const VALID_TIMEFRAMES = ['15m', '1h', '4h', '1d'];

exports.analyze = [
  body('asset').isString().isLength({ min: 2, max: 12 }),
  body('timeframe').isIn(VALID_TIMEFRAMES),
  body('capital').optional().isFloat({ min: 1, max: 1_000_000 }),

  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty())
      return res.status(400).json({ success: false, errors: errors.array() });

    const { asset, timeframe, capital = 500 } = req.body;

    try {
      const aiResp = await axios.post(
        `${AI_URL}/api/unified/analyze`,
        { asset: asset.toUpperCase(), timeframe, capital },
        { timeout: 90_000 },
      );
      return res.json(aiResp.data);
    } catch (err) {
      const msg = err.response?.data?.detail || err.message;
      logger.error(`[Unified] analysis failed for ${asset}/${timeframe}: ${msg}`);
      return res.status(502).json({ success: false, message: msg });
    }
  },
];
