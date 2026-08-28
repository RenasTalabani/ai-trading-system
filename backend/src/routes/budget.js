const express = require('express');
const { protect, authorize } = require('../middleware/auth');
const ctrl = require('../controllers/budgetController');

const router = express.Router();

router.get('/status',        protect, ctrl.status);
router.get('/report',        protect, ctrl.report);
router.post('/start',        protect, authorize('admin'), ...ctrl.start);
router.post('/stop',         protect, authorize('admin'), ctrl.stop);

module.exports = router;
