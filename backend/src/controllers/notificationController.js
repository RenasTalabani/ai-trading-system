const Notification = require('../models/Notification');
const User = require('../models/User');
const { sendPushToUser } = require('../services/notificationService');
const logger = require('../config/logger');

// GET /api/v1/notifications  — user's own notifications
exports.getNotifications = async (req, res, next) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page)  || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 20);
    const skip  = (page - 1) * limit;
    const query = { userId: req.user._id };
    if (req.query.type)   query.type = req.query.type;
    if (req.query.unread) query.readAt = null;

    const [notifications, total] = await Promise.all([
      Notification.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      Notification.countDocuments(query),
    ]);

    res.json({
      success: true,
      data: notifications,
      pagination: { total, page, limit, pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    next(err);
  }
};

// GET /api/v1/notifications/unread-count
exports.getUnreadCount = async (req, res, next) => {
  try {
    const count = await Notification.countDocuments({ userId: req.user._id, readAt: null });
    res.json({ success: true, unreadCount: count });
  } catch (err) {
    next(err);
  }
};

// PATCH /api/v1/notifications/:id/read
exports.markRead = async (req, res, next) => {
  try {
    const notification = await Notification.findOneAndUpdate(
      { _id: req.params.id, userId: req.user._id },
      { readAt: new Date() },
      { new: true }
    );
    if (!notification) return res.status(404).json({ success: false, message: 'Notification not found' });
    res.json({ success: true, data: notification });
  } catch (err) {
    next(err);
  }
};

// PATCH /api/v1/notifications/read-all
exports.markAllRead = async (req, res, next) => {
  try {
    const result = await Notification.updateMany(
      { userId: req.user._id, readAt: null },
      { readAt: new Date() }
    );
    res.json({ success: true, modifiedCount: result.modifiedCount });
  } catch (err) {
    next(err);
  }
};

// DELETE /api/v1/notifications/:id
exports.deleteNotification = async (req, res, next) => {
  try {
    const notification = await Notification.findOneAndDelete({
      _id: req.params.id,
      userId: req.user._id,
    });
    if (!notification) return res.status(404).json({ success: false, message: 'Notification not found' });
    res.json({ success: true, message: 'Notification deleted' });
  } catch (err) {
    next(err);
  }
};

// POST /api/v1/notifications/test — sends a test push (own device)
exports.sendTestNotification = async (req, res, next) => {
  try {
    const result = await sendPushToUser(
      req.user._id,
      '🧪 Test Notification',
      'Push notifications are working correctly!',
      { type: 'test' }
    );
    res.json({ success: result.success, result });
  } catch (err) {
    next(err);
  }
};

// POST /api/v1/notifications/register-token
exports.registerToken = async (req, res, next) => {
  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({ success: false, message: 'token is required' });

    await User.findByIdAndUpdate(req.user._id, { fcmToken: token });
    logger.info(`FCM token registered for user ${req.user._id}`);
    res.json({ success: true, message: 'FCM token registered' });
  } catch (err) {
    next(err);
  }
};

// DELETE /api/v1/notifications/register-token
exports.unregisterToken = async (req, res, next) => {
  try {
    await User.findByIdAndUpdate(req.user._id, { $unset: { fcmToken: '' } });
    res.json({ success: true, message: 'FCM token removed' });
  } catch (err) {
    next(err);
  }
};

// GET /api/v1/notifications/stats  (admin)
exports.getNotificationStats = async (req, res, next) => {
  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [total, byType, deliverySummary] = await Promise.all([
      Notification.countDocuments({ createdAt: { $gte: since } }),
      Notification.aggregate([
        { $match: { createdAt: { $gte: since } } },
        { $group: { _id: '$type', count: { $sum: 1 } } },
      ]),
      Notification.aggregate([
        { $match: { createdAt: { $gte: since } } },
        {
          $group: {
            _id: null,
            totalSuccess: { $sum: '$successCount' },
            totalFailure: { $sum: '$failureCount' },
          },
        },
      ]),
    ]);

    res.json({
      success: true,
      stats: {
        last24h:      total,
        byType:       Object.fromEntries(byType.map(b => [b._id, b.count])),
        delivered:    deliverySummary[0]?.totalSuccess ?? 0,
        failed:       deliverySummary[0]?.totalFailure ?? 0,
      },
    });
  } catch (err) {
    next(err);
  }
};
