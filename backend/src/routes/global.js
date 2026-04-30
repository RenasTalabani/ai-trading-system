const express = require('express');
const { protect } = require('../middleware/auth');
const ctrl = require('../controllers/globalController');

const router = express.Router();

// GET  /api/v1/global/latest  — instant cached result (updated every 30 min)
router.get('/latest', protect, ctrl.latest);

// POST /api/v1/global/scan    — on-demand full scan (takes ~60 s)
router.post('/scan', protect, ...ctrl.scan);

module.exports = router;
