const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/conversationController');
const { protect } = require('../middleware/auth');

router.use(protect);
router.get('/',         ctrl.getThread);
router.post('/message', ctrl.postMessage);

module.exports = router;
