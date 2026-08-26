const axios               = require('axios');
const { body, validationResult } = require('express-validator');
const AIRecommendation    = require('../models/AIRecommendation');
const logger              = require('../config/logger');

const AI_URL = process.env.AI_SERVICE_URL || 'http://localhost:8000';

const VALID_TFS = ['1h', '4h', '1d', '7d', '30d'];
const VALID_ASSETS = [
  'BTCUSDT','ETHUSDT','BNBUSDT','SOLUSDT','XRPUSDT',
  'ADAUSDT','DOGEUSDT','AVAXUSDT','DOTUSDT','MATICUSDT',
  'XAUUSD',
];

const EXPIRY_HOURS = { '1h': 1, '4h': 4, '1d': 24, '7d': 168, '30d': 720 };

async function _autoTrack(asset, timeframeRecs) {
  try {
    // T-054 (2026-08-26): this insertMany() bypasses store()'s
    // express-validator entirely (that validator only runs on the
    // POST /tracker/store HTTP path, not on a direct model write here) --
    // so `tf.current_price || 0` used to silently create a permanently
    // untrackable record whenever ai-service omitted/zeroed a timeframe's
    // current_price. Such a record can never be meaningfully evaluated
    // (there's no real reference price to compute a return against), and
    // once created it stays status:'pending' forever -- both evaluate()
    // implementations (trackerController.js and trackerEvalJob.js) just
    // skip it on every cron cycle indefinitely, permanently occupying a
    // slot in their pending-query limit. Skip auto-tracking a timeframe
    // rec outright when it has no valid positive price, instead of
    // inserting a doc that can never leave 'pending'. See
    // PROJECT_STATUS.md T-054.
    const trackable = timeframeRecs.filter(tf => tf.current_price > 0);
    const skipped    = timeframeRecs.length - trackable.length;
    if (skipped > 0) {
      logger.warn(`[Advisor] Skipped auto-tracking ${skipped}/${timeframeRecs.length} recommendation(s) for ${asset} -- no valid current_price.`);
    }
    if (trackable.length === 0) return;

    const docs = trackable.map(tf => {
      const hours     = EXPIRY_HOURS[tf.timeframe] || 24;
      const expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000);
      return {
        asset,
        action:                tf.action,
        confidence:            tf.confidence,
        timeframe:             tf.timeframe,
        priceAtRecommendation: tf.current_price,
        expectedReturnPct:     tf.expected_return_pct || '0%',
        reason:                tf.reason || '',
        source:                'advisor',
        expiresAt,
      };
    });
    await AIRecommendation.insertMany(docs, { ordered: false });
    logger.info(`[Advisor] Auto-tracked ${docs.length} recommendations for ${asset}`);
  } catch (e) {
    logger.warn('[Advisor] auto-track failed (non-critical):', e.message);
  }
}

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

      const data = aiResp.data;

      // Auto-track every timeframe recommendation — fire-and-forget
      if (data.timeframes?.length) {
        _autoTrack(asset, data.timeframes);
      }

      res.json({ success: true, ...data });
    } catch (err) {
      logger.error('[Advisor] analyze error:', err.message);
      res.status(502).json({ success: false, message: 'Advisor unavailable', detail: err.message });
    }
  },
];

exports.supported = (req, res) => {
  res.json({ success: true, assets: VALID_ASSETS, timeframes: VALID_TFS });
};
