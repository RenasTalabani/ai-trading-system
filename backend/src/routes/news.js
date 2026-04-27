const express = require('express');
const { protect, authorize } = require('../middleware/auth');
const {
  getLatestNews,
  getNewsForAsset,
  getHighImpactNews,
  getNewsStats,
  triggerCollection,
} = require('../controllers/newsController');

const router = express.Router();

router.use(protect);

router.get('/', getLatestNews);
router.get('/high-impact', getHighImpactNews);
router.get('/stats', getNewsStats);
router.get('/asset/:asset', getNewsForAsset);
router.post('/collect', authorize('admin'), triggerCollection);

module.exports = router;
