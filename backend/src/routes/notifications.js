const express = require('express');
const { body, param } = require('express-validator');
const { protect, authorize } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const {
  getNotifications,
  getUnreadCount,
  markRead,
  markAllRead,
  deleteNotification,
  sendTestNotification,
  registerToken,
  unregisterToken,
  getNotificationStats,
} = require('../controllers/notificationController');

const router = express.Router();

router.use(protect);

router.get('/',              getNotifications);
router.get('/unread-count',  getUnreadCount);
router.patch('/read-all',    markAllRead);
router.post('/test',         sendTestNotification);

router.post(
  '/register-token',
  [body('token').notEmpty().withMessage('FCM token required')],
  validate,
  registerToken
);

router.delete('/register-token', unregisterToken);

router.patch(
  '/:id/read',
  [param('id').isMongoId()],
  validate,
  markRead
);

router.delete(
  '/:id',
  [param('id').isMongoId()],
  validate,
  deleteNotification
);

router.get('/stats', authorize('admin'), getNotificationStats);

module.exports = router;
