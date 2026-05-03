const router  = require('express').Router();
const { protect } = require('../middleware/auth');
const ctrl    = require('../controllers/advisorController');

router.use(protect);
router.post('/analyze',   ...ctrl.analyze);
router.get('/supported',  ctrl.supported);

module.exports = router;
