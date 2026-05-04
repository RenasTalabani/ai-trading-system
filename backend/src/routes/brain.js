const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/brainController');
const { protect } = require('../middleware/auth');

router.use(protect);
router.get('/report/action',      ctrl.actionReport);
router.get('/report/performance', ctrl.performanceReport);

module.exports = router;
