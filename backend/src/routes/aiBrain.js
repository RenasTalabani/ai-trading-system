const express = require('express');
const { protect } = require('../middleware/auth');
const ctrl = require('../controllers/aiBrainController');

const router = express.Router();

router.get('/latest',           protect, ctrl.latest);
router.get('/stats',            protect, ctrl.stats);
router.get('/pending',          protect, ctrl.pending);
router.get('/pending-proposal', protect, ctrl.pendingProposal);
router.get('/decisions',        protect, ctrl.history);
router.get('/decisions/:asset', protect, ctrl.assetHistory);
router.post('/decisions/:id/approve', protect, ctrl.approve);
router.post('/decisions/:id/reject',  protect, ctrl.reject);
router.post('/proposals/:id/approve', protect, ctrl.approveProposal);
router.post('/proposals/:id/reject',  protect, ctrl.rejectProposal);

module.exports = router;
