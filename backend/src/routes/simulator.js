const router = require('express').Router();
const { protect } = require('../middleware/auth');
const ctrl   = require('../controllers/simulatorController');

router.use(protect);
router.post('/run', ...ctrl.run);

module.exports = router;
