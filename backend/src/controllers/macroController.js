const axios  = require('axios');
const logger = require('../config/logger');

const AI_URL = process.env.AI_SERVICE_URL || 'http://localhost:8000';

exports.snapshot = async (req, res) => {
  try {
    const r = await axios.get(`${AI_URL}/api/macro/snapshot`, { timeout: 12_000 });
    res.json(r.data);
  } catch (err) {
    logger.error('[Macro] snapshot proxy failed:', err.message);
    res.status(502).json({ success: false, message: 'Macro data unavailable', detail: err.message });
  }
};

exports.fearGreed = async (req, res) => {
  try {
    const r = await axios.get(`${AI_URL}/api/macro/fear-greed`, { timeout: 8_000 });
    res.json(r.data);
  } catch (err) {
    res.status(502).json({ success: false, message: 'Fear & Greed unavailable' });
  }
};

exports.fundingRates = async (req, res) => {
  try {
    const r = await axios.get(`${AI_URL}/api/macro/funding-rates`, { timeout: 8_000 });
    res.json(r.data);
  } catch (err) {
    res.status(502).json({ success: false, message: 'Funding rates unavailable' });
  }
};
