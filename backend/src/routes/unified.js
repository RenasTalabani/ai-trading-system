const express = require('express');
const { protect } = require('../middleware/auth');
const ctrl = require('../controllers/unifiedController');

const router = express.Router();

// POST /api/v1/unified/analyze
router.post('/analyze', protect, ...ctrl.analyze);

module.exports = router;
