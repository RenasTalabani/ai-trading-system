const express = require('express');
const { body, param } = require('express-validator');
const router  = express.Router();
const ctrl    = require('../controllers/priceAlertController');
const { protect } = require('../middleware/auth');
const { validate } = require('../middleware/validate');

router.use(protect);

router.get('/', ctrl.list);

router.post(
  '/',
  [
    body('asset').trim().notEmpty().isLength({ max: 20 }).withMessage('asset is required (max 20 chars)'),
    body('displayName').optional({ checkFalsy: true }).trim().isLength({ max: 50 }).withMessage('displayName max 50 chars'),
    // gt: 0 rejects zero/negative/NaN/Infinity — the concrete gap this closes:
    // the old handler did `parseFloat(targetPrice)` with no bound, so a
    // non-numeric or out-of-range value could be silently stored and would
    // then never (or always) trigger in the price-alert-checking job.
    body('targetPrice').isFloat({ gt: 0 }).withMessage('targetPrice must be a positive number'),
    body('direction').isIn(['above', 'below']).withMessage('direction must be above or below'),
    body('note').optional({ checkFalsy: true }).trim().isLength({ max: 280 }).withMessage('note max 280 chars'),
  ],
  validate,
  ctrl.create
);

router.delete(
  '/:id',
  [param('id').isMongoId().withMessage('invalid alert id')],
  validate,
  ctrl.remove
);

router.patch(
  '/:id/toggle',
  [param('id').isMongoId().withMessage('invalid alert id')],
  validate,
  ctrl.toggle
);

module.exports = router;
