const express    = require('express');
const router     = express.Router();
const { protect } = require('../middleware/auth');
const ctrl       = require('../controllers/orderBlockController');

// GET /api/v1/order-blocks/analyze?asset=BTCUSDT&timeframe=1h
router.get('/analyze', protect, ctrl.analyze);

module.exports = router;
