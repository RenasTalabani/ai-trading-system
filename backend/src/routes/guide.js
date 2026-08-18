const express = require('express');
const { param } = require('express-validator');
const router  = express.Router();
const ctrl    = require('../controllers/guideController');
const { protect } = require('../middleware/auth');
const { validate } = require('../middleware/validate');

router.use(protect);
router.get('/suggestion',         ctrl.getSuggestion);
router.post('/suggestion/approve', ctrl.approve);
router.get('/positions',          ctrl.getPositions);

router.post(
  '/positions/:tradeId/sell',
  [param('tradeId').isMongoId().withMessage('invalid trade id')],
  validate,
  ctrl.sellNow
);

module.exports = router;
