const express = require('express');
const { protect, authorize } = require('../middleware/auth');
const {
  getAIStatus,
  runBacktest,
  getFeedbackStats,
  triggerEvaluation,
  getModelHealth,
} = require('../controllers/aiController');

const router = express.Router();

router.use(protect);

router.get('/status',        getAIStatus);
router.get('/health',        getModelHealth);
router.get('/feedback',      getFeedbackStats);
router.post('/backtest',     authorize('admin', 'premium'), runBacktest);
router.post('/feedback/run', authorize('admin'), triggerEvaluation);

module.exports = router;
