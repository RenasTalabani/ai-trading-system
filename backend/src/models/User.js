const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true,
      maxlength: [50, 'Name cannot exceed 50 characters'],
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      match: [/^\S+@\S+\.\S+$/, 'Invalid email format'],
    },
    password: {
      type: String,
      required: [true, 'Password is required'],
      minlength: [8, 'Password must be at least 8 characters'],
      select: false,
    },
    role: {
      type: String,
      enum: ['user', 'premium', 'admin'],
      default: 'user',
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    fcmToken: {
      type: String,
      default: null,
    },
    telegramChatId: {
      type: String,
      default: null,
    },
    telegramLinkToken: { type: String, select: false },
    telegramLinkExpiry: { type: Date, select: false },
    preferences: {
      assets:               { type: [String], default: ['BTCUSDT', 'ETHUSDT'] },
      confidenceThreshold:  { type: Number,  default: 70,  min: 0, max: 100 },
      notificationsEnabled: { type: Boolean, default: true },
      fcmEnabled:           { type: Boolean, default: true },
      telegramEnabled:      { type: Boolean, default: false },
      maxNotificationsPerHour: { type: Number, default: 5, min: 1, max: 20 },
    },
    lastLogin: { type: Date },
    passwordChangedAt: { type: Date },
  },
  { timestamps: true }
);

userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

userSchema.methods.comparePassword = async function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

// Single access token, no refresh-token flow — a deliberate choice, not an
// oversight. This app has no real login for most users (see auth_provider.dart:
// a guest account is auto-created on first launch and the "login" screen is
// only reached if a session is explicitly cleared), there is no real-money or
// exchange-custody data behind the token, and the mobile client already
// handles expiry gracefully (401 -> auto-logout, see api_service.dart's
// onUnauthorized). Adding refresh-token rotation would add real complexity
// (secure refresh-token storage, a revocation store, new endpoints) without a
// corresponding security need for this app's threat model. Revisit if the
// product ever adds real user accounts holding real financial data.
userSchema.methods.generateAuthToken = function () {
  return jwt.sign({ id: this._id, role: this.role }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  });
};

userSchema.methods.changedPasswordAfter = function (jwtTimestamp) {
  if (this.passwordChangedAt) {
    const changedAt = parseInt(this.passwordChangedAt.getTime() / 1000, 10);
    return jwtTimestamp < changedAt;
  }
  return false;
};

module.exports = mongoose.model('User', userSchema);
