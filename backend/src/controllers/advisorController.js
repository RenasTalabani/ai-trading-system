const axios  = require('axios');
const { body, validationResult } = require('express-validator');
const logger = require('../config/logger');

const AI_URL = process.env.AI_SERVICE_URL || 'http://localhost:8000';

const VALID_TFS  = ['1h', '4h', '1d', '7d', '30d'];
const VALID_ASSETS = [
  'BTCUSDT','ETHUSDT','BNBUSDT','SOLUSDT','XRPUSDT',
  'ADAUSDT','DOGEUSDT','AVAXUSDT','DOTUSDT','MATICUSDT',
];

exports.analyze = [
  body('asset').isString().toUpperCase(),
  body('timeframes').optional().isArray({ min: 1, max: 5 }),

  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

    const asset      = (req.body.asset || 'BTCUSDT').toUpperCase();
    const timeframes = (req.body.timeframes || VALID_TFS).filter(tf => VALID_TFS.includes(tf));

    try {
      const aiResp = await axios.post(`${AI_URL}/api/advisor/analyze`, {
        asset, timeframes,
      }, { timeout: 45_000 });

      res.json({ success: true, ...aiResp.data });
    } catch (err) {
      logger.error('[Advisor] analyze error:', err.message);
      res.status(502).json({ success: false, message: 'Advisor unavailable', detail: err.message });
    }
  },
];

exports.supported = (req, res) => {
  res.json({
    success:    true,
    assets:     VALID_ASSETS,
    timeframes: VALID_TFS,
  });
};
