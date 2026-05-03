const axios  = require('axios');
const { body, validationResult } = require('express-validator');
const logger = require('../config/logger');

const AI_URL = process.env.AI_SERVICE_URL || 'http://localhost:8000';

exports.run = [
  body('capital').optional().isFloat({ min: 10, max: 1_000_000 }),
  body('assets').isArray({ min: 1, max: 10 }),
  body('duration_days').optional().isInt({ min: 1, max: 90 }),
  body('risk_pct').optional().isFloat({ min: 1, max: 20 }),

  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

    const { capital = 500, assets, duration_days = 7, risk_pct = 5 } = req.body;

    try {
      const aiResp = await axios.post(`${AI_URL}/api/simulator/run`, {
        capital, assets, duration_days, risk_pct,
      }, { timeout: 90_000 });

      res.json({ success: true, ...aiResp.data });
    } catch (err) {
      logger.error('[Simulator] run error:', err.message);
      res.status(502).json({ success: false, message: 'Simulator unavailable', detail: err.message });
    }
  },
];
