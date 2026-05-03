const router = require('express').Router();
const { protect, authorize } = require('../middleware/auth');
const ctrl   = require('../controllers/reportsController');

router.use(protect);
router.get('/latest',  ctrl.latest);
router.get('/history', ...ctrl.history);
router.get('/stats',   ctrl.stats);
router.post('/trigger', authorize('admin'), ctrl.trigger);

module.exports = router;
