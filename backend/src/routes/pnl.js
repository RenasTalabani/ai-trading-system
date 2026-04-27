const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const { getToday } = require('../controllers/pnlController');

router.get('/today', protect, getToday);

module.exports = router;
