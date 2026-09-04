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
    //
    // Bug found 2026-09-04 (overnight continuous-improvement pass): two
    // newer call sites -- notificationService.sendDcaBuyDueNotification()
    // and sendProposalExpiredNotification() -- pass 'dca_buy_due' and
    // 'proposal_expired' to persistTradeEventNotification(), but this enum
    // never listed either value. Every such Notification.create() call
    // therefore failed Mongoose's own enum validation on every single
    // invocation -- and because persistTradeEventNotification() wraps each
    // per-user create() in its own `.catch(() => null)` (so one user's
    // failure can't stop the others' from persisting), that ValidationError
    // was swallowed with no warning logged anywhere: the DCA-buy-due and
    // proposal-expired features read as fully wired up but silently
    // produced zero in-app notifications in production. Same root-cause
    // shape as BUG-004 above -- a documented notification path that was
    // actually structurally unreachable.
    enum: [
      'signal', 'alert', 'system', 'news', 'trade_open', 'trade_closed',
      'dca_buy_due', 'proposal_expired',
    ],
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
    // dca_buy_due (see the `type` enum comment above) -- also stripped
    // silently until named here.
    planId:     String,
    amountUsd:  Number,
    // proposal_expired (see the `type` enum comment above) -- ditto.
    proposalId: String,
    assets:     [String],
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
