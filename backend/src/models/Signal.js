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

module.exports = mongoose.model('Signal', signalSchema);
