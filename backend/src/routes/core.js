const express  = require('express');
const router   = express.Router();
const ctrl     = require('../controllers/coreController');
const simCtrl  = require('../controllers/coreSimulatorController');
const { protect } = require('../middleware/auth');

router.use(protect);
router.get('/advice',    ctrl.advice);
router.get('/status',    ctrl.status);
router.get('/simulator', simCtrl.simulate);

module.exports = router;
