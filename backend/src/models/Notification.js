const mongoose = require('mongoose');

const deliverySchema = new mongoose.Schema({
  channel:       { type: String, enum: ['fcm', 'telegram'], required: true },
  status:        { type: String, enum: ['sent', 'failed', 'pending'], default: 'pending' },
  attempts:      { type: Number, default: 0 },
  lastError:     String,
  sentAt:        Date,
  lastAttemptAt: Date,
}, { _id: false });

const notificationSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },

  type: {
    type: String,
    enum: ['signal', 'alert', 'system', 'news'],
    default: 'signal',
    index: true,
  },

  title:   { type: String, required: true, maxlength: 200 },
  body:    { type: String, required: true, maxlength: 1000 },

  data: {
    signalId:   String,
    asset:      String,
    action:     String,
    confidence: Number,
    price:      Number,
    stopLoss:   Number,
    takeProfit: Number,
  },

  delivery: [deliverySchema],

  // Aggregate delivery summary
  successCount: { type: Number, default: 0 },
  failureCount: { type: Number, default: 0 },

  readAt: Date,
}, {
  timestamps: true,
});

// Auto-delete after 30 days
notificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 30 * 24 * 3600 });

notificationSchema.index({ userId: 1, createdAt: -1 });
notificationSchema.index({ 'data.asset': 1, createdAt: -1 });

module.exports = mongoose.model('Notification', notificationSchema);
