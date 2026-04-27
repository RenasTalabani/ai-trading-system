const User = require('../models/User');

exports.getProfile = async (req, res) => {
  res.status(200).json({ success: true, user: req.user });
};

exports.updatePreferences = async (req, res, next) => {
  try {
    const allowed = [
      'assets',
      'confidenceThreshold',
      'notificationsEnabled',
      'fcmEnabled',
      'telegramEnabled',
      'maxNotificationsPerHour',
    ];

    const updates = {};
    allowed.forEach(key => {
      if (req.body[key] !== undefined) updates[`preferences.${key}`] = req.body[key];
    });

    if (!Object.keys(updates).length) {
      return res.status(400).json({ success: false, message: 'No valid preference fields provided.' });
    }

    const user = await User.findByIdAndUpdate(
      req.user._id,
      { $set: updates },
      { new: true, runValidators: true }
    );

    res.status(200).json({ success: true, preferences: user.preferences });
  } catch (err) {
    next(err);
  }
};

exports.getAllUsers = async (req, res, next) => {
  try {
    const { page = 1, limit = 50 } = req.query;
    const skip = (Number(page) - 1) * Number(limit);
    const [users, total] = await Promise.all([
      User.find().select('-password').skip(skip).limit(Number(limit)).sort({ createdAt: -1 }),
      User.countDocuments(),
    ]);
    res.status(200).json({ success: true, total, users });
  } catch (err) {
    next(err);
  }
};
