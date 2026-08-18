const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/guideController');
const { protect } = require('../middleware/auth');

router.use(protect);
router.get('/suggestion',         ctrl.getSuggestion);
router.post('/suggestion/approve', ctrl.approve);
router.get('/positions',          ctrl.getPositions);
router.post('/positions/:tradeId/sell', ctrl.sellNow);

module.exports = router;
