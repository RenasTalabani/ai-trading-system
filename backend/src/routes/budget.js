const express = require('express');
const { protect } = require('../middleware/auth');
const ctrl = require('../controllers/budgetController');

const router = express.Router();

router.get('/status',        protect, ctrl.status);
router.get('/report',        protect, ctrl.report);
router.post('/start',        protect, ...ctrl.start);
router.post('/stop',         protect, ctrl.stop);

module.exports = router;
