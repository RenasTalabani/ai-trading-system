const express = require('express');
const { protect, authorize } = require('../middleware/auth');
const {
  getMarketData,
  getAssetPrice,
  getSupportedAssets,
  getLivePrices,
  trainModel,
} = require('../controllers/marketController');

const router = express.Router();

router.use(protect);

router.get('/assets', getSupportedAssets);
router.get('/prices/live', getLivePrices);
router.get('/price/:asset', getAssetPrice);
router.get('/history/:asset', getMarketData);

// Trigger model training (admin only)
router.post('/train', authorize('admin'), trainModel);

module.exports = router;
