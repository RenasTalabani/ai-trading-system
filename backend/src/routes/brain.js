const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/brainController');
const follow  = require('../controllers/userFollowController');
const { protect } = require('../middleware/auth');

router.use(protect);
router.get('/report/action',      ctrl.actionReport);
router.get('/report/performance', ctrl.performanceReport);
router.get('/stats',              ctrl.brainStats);
router.get('/analytics',          ctrl.brainAnalytics);

router.get('/follows/stats',      follow.stats);
router.get('/follows',            follow.list);
router.post('/follows',           follow.follow);
router.patch('/follows/:id/close', follow.close);
router.delete('/follows/:id',     follow.remove);

module.exports = router;
