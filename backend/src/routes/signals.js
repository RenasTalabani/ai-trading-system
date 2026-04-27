const express = require('express');
const { protect, authorize } = require('../middleware/auth');
const {
  getSignals,
  getSignalById,
  generateSignal,
  getLatestSignals,
  runSignalScan,
  getSignalStats,
} = require('../controllers/signalController');

const router = express.Router();

router.use(protect);

router.get('/', getSignals);
router.get('/latest', getLatestSignals);
router.get('/stats', getSignalStats);
router.get('/:id', getSignalById);

// Admin / premium only: manually trigger signal for one asset
router.post('/generate', authorize('admin', 'premium'), generateSignal);

// Admin only: scan all assets and generate signals
router.post('/scan', authorize('admin'), runSignalScan);

module.exports = router;
