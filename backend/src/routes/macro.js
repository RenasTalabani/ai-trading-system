const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/macroController');
const { protect } = require('../middleware/authMiddleware');

router.use(protect);
router.get('/snapshot',      ctrl.snapshot);
router.get('/fear-greed',    ctrl.fearGreed);
router.get('/funding-rates', ctrl.fundingRates);

module.exports = router;
