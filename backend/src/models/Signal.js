const mongoose = require('mongoose');

const signalSchema = new mongoose.Schema(
  {
    asset: {
      type: String,
      required: true,
      uppercase: true,
      index: true,
    },
    direction: {
      type: String,
      enum: ['BUY', 'SELL', 'HOLD'],
      required: true,
    },
    // T-066: derived, display-only label from the ai-service pipeline's
    // decision_label (T-065) -- e.g. BUY with a manipulation/risk flag
    // present becomes 'AVOID'. Purely additive: `direction` above stays
    // exactly what it always was and is what every existing trading/
    // notification code path in this app still reads. Not required/no
    // default, so pre-existing Signal documents (created before this
    // field existed) are unaffected and simply have it undefined.
    decision: {
      type: String,
      enum: ['BUY', 'SELL', 'WAIT', 'AVOID'],
    },
    confidence: {
      type: Number,
      required: true,
      min: 0,
      max: 100,
    },
    price: {
      entry: { type: Number, required: true },
      stopLoss: { type: Number },
      takeProfit: { type: Number },
    },
    reason: {
      type: String,
      required: true,
    },
    // T-078 (2026-08-31): audit trail for how `confidence` (raw_confidence
    // from ai-service, see signalJob.js) ended up at its stored value --
    // records each sequential adjustment stage's output (event override,
    // regime modifier, multi-timeframe confirmation, funding-rate
    // contrarian bias) plus the inputs that drove each one. Closes a real
    // gap: a stored confidence landing on a suspiciously round number
    // (e.g. exactly 100) previously couldn't be traced back to why without
    // re-running the whole pipeline retroactively, which isn't possible
    // after the fact. Purely additive -- no default, so pre-existing
    // Signal documents (created before this field existed) are simply
    // undefined on it, same convention as `decision` above.
    confidenceTrace: {
      type: mongoose.Schema.Types.Mixed,
    },
    sources: {
      market: {
        score: { type: Number, default: 0 },
        indicators: { type: mongoose.Schema.Types.Mixed, default: {} },
      },
      news: {
        score: { type: Number, default: 0 },
        headlines: { type: [String], default: [] },
      },
      social: {
        score: { type: Number, default: 0 },
        sentiment: { type: String, enum: ['bullish', 'bearish', 'neutral'], default: 'neutral' },
      },
    },
    status: {
      type: String,
      enum: ['active', 'closed', 'expired', 'cancelled'],
      default: 'active',
    },
    notificationSent: {
      fcm: { type: Boolean, default: false },
      telegram: { type: Boolean, default: false },
    },
    expiresAt: {
      type: Date,
      default: () => new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
  },
  { timestamps: true }
);

signalSchema.index({ asset: 1, createdAt: -1 });
signalSchema.index({ direction: 1, confidence: -1 });
signalSchema.index({ status: 1, expiresAt: 1 });
// T-014 (2026-08-18): getSignals()'s default path (no status/asset query
// param -- the common dashboard load) filters and sorts on createdAt alone,
// which none of the three indexes above cover (none has createdAt as a
// leading/standalone key). getLatestSignals() and getSignalStats() filter by
// status='active' then sort/group -- also not served by {status,expiresAt}.
signalSchema.index({ createdAt: -1 });
signalSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model('Signal', signalSchema);
