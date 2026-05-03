const router = require('express').Router();
const { protect, authorize } = require('../middleware/auth');
const ctrl   = require('../controllers/trackerController');

router.use(protect);
router.post('/store',    ...ctrl.store);
router.get('/history',   ...ctrl.history);
router.get('/accuracy',  ctrl.accuracy);
router.post('/evaluate', authorize('admin'), ctrl.evaluate);

module.exports = router;
