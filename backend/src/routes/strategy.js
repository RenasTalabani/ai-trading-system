const express  = require('express');
const { protect } = require('../middleware/auth');
const ctrl = require('../controllers/strategyController');

const router = express.Router();

router.use(protect);

// POST /api/v1/strategy/holding   — get HOLD/BUY/SELL recs for assets
router.post('/holding',  ...ctrl.holding);

// POST /api/v1/strategy/simulate  — back-simulate strategy performance
router.post('/simulate', ...ctrl.simulate);

// GET  /api/v1/strategy/history   — user's past reports
router.get('/history',   ...ctrl.history);

module.exports = router;
