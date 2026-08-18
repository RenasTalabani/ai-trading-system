const express = require('express');
const { body, param } = require('express-validator');
const router  = express.Router();
const ctrl    = require('../controllers/brainController');
const follow  = require('../controllers/userFollowController');
const { protect } = require('../middleware/auth');
const { validate } = require('../middleware/validate');

router.use(protect);
router.get('/report/action',      ctrl.actionReport);
router.get('/report/performance', ctrl.performanceReport);
router.get('/stats',              ctrl.brainStats);
router.get('/analytics',          ctrl.brainAnalytics);
router.post('/ask',               ctrl.askBrain);

router.get('/follows/stats',      follow.stats);
router.get('/follows',            follow.list);

router.post(
  '/follows',
  [
    body('asset').trim().notEmpty().isLength({ max: 20 }).withMessage('asset is required (max 20 chars)'),
    body('displayName').optional({ checkFalsy: true }).trim().isLength({ max: 50 }),
    body('action').isIn(['BUY', 'SELL', 'HOLD']).withMessage('action must be BUY, SELL or HOLD'),
    body('confidence').isFloat({ min: 0, max: 100 }).withMessage('confidence must be 0-100'),
    body('entryPrice').optional({ checkFalsy: true }).isFloat({ gt: 0 }).withMessage('entryPrice must be positive'),
    body('stopLoss').optional({ checkFalsy: true }).isFloat({ gt: 0 }).withMessage('stopLoss must be positive'),
    body('takeProfit').optional({ checkFalsy: true }).isFloat({ gt: 0 }).withMessage('takeProfit must be positive'),
    body('timeframe').optional({ checkFalsy: true }).trim().isLength({ max: 10 }),
    body('note').optional({ checkFalsy: true }).trim().isLength({ max: 280 }),
  ],
  validate,
  follow.follow
);

router.patch(
  '/follows/:id/close',
  [
    param('id').isMongoId().withMessage('invalid follow id'),
    body('outcome').optional({ checkFalsy: true }).isIn(['OPEN', 'WIN', 'LOSS', 'CANCELLED']).withMessage('invalid outcome'),
    body('exitPrice').optional({ checkFalsy: true }).isFloat({ gt: 0 }).withMessage('exitPrice must be positive'),
    body('profitPct').optional({ checkFalsy: true }).isFloat().withMessage('profitPct must be a number'),
    body('note').optional({ checkFalsy: true }).trim().isLength({ max: 280 }),
  ],
  validate,
  follow.close
);

router.delete(
  '/follows/:id',
  [param('id').isMongoId().withMessage('invalid follow id')],
  validate,
  follow.remove
);

module.exports = router;
