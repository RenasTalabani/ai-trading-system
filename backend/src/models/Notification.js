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
    // BUG-004 (2026-08-29 overnight validation): trade-open events had no
    // notification-creation code at all, and trade-close was push/Telegram-
    // only, never persisted in-app -- a user relying on the in-app
    // notification list to know when the AI opened or closed a position
    // for them would never find out. 'trade_open'/'trade_closed' added so
    // both now use the same persisted-notification list signals already do.
    enum: ['signal', 'alert', 'system', 'news', 'trade_open', 'trade_closed'],
    default: 'signal',
    index: true,
  },

  title:   { type: String, required: true, maxlength: 200 },
  body:    { type: String, required: true, maxlength: 1000 },

  data: {
    signalId:   String,
    tradeId:    String,
    asset:      String,
    action:     String,
    confidence: Number,
    price:      Number,
    stopLoss:   Number,
    takeProfit: Number,
    // Trade-close-specific fields (BUG-004) -- undeclared fields are
    // silently stripped by Mongoose's default strict embedded-object mode,
    // so these need to be named explicitly, same as every field above.
    pnl:        Number,
    pnlPct:     Number,
    exitReason: String,
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
