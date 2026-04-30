const express = require('express');
const { protect } = require('../middleware/auth');
const ctrl = require('../controllers/aiBrainController');

const router = express.Router();

router.get('/latest',           protect, ctrl.latest);
router.get('/stats',            protect, ctrl.stats);
router.get('/decisions/:asset', protect, ctrl.assetHistory);

module.exports = router;
