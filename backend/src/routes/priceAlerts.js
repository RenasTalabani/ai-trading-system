const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/priceAlertController');
const { protect } = require('../middleware/auth');

router.use(protect);
router.get('/',          ctrl.list);
router.post('/',         ctrl.create);
router.delete('/:id',    ctrl.remove);
router.patch('/:id/toggle', ctrl.toggle);

module.exports = router;
