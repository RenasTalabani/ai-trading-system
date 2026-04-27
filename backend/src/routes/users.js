const express = require('express');
const { protect, authorize } = require('../middleware/auth');
const { getProfile, updatePreferences, getAllUsers } = require('../controllers/userController');

const router = express.Router();

router.use(protect);

router.get('/profile', getProfile);
router.patch('/preferences', updatePreferences);
router.get('/', authorize('admin'), getAllUsers);

module.exports = router;
