const express = require('express');
const { protect, authorize } = require('../middleware/auth');
const {
  getSocialFeed,
  getSocialForAsset,
  getSocialStats,
  getSocialAlerts,
} = require('../controllers/socialController');

const router = express.Router();

router.use(protect);

router.get('/', getSocialFeed);
router.get('/alerts', getSocialAlerts);
router.get('/stats', getSocialStats);
router.get('/asset/:asset', getSocialForAsset);

module.exports = router;
