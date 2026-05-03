const mongoose = require('mongoose');

const aiReportSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ['hourly', 'daily', 'weekly'],
      required: true,
      index: true,
    },
    period: {
      start: { type: Date, required: true },
      end:   { type: Date, required: true },
    },
    marketSummary: {
      topAsset:       { type: String },
      topAction:      { type: String, enum: ['BUY', 'SELL', 'HOLD'] },
      topConfidence:  { type: Number },
      marketMood:     { type: String, enum: ['bullish', 'bearish', 'neutral'] },
      moodPct:        { type: Number },
      activeSignals:  { type: Number, default: 0 },
    },
    bestOpportunity: {
      asset:          { type: String },
      action:         { type: String },
      confidence:     { type: Number },
      expectedReturn: { type: String },
      reason:         { type: String },
    },
    topPicks: [
      {
        asset:      { type: String },
        action:     { type: String },
        confidence: { type: Number },
        price:      { type: Number },
      },
    ],
    portfolioSummary: {
      balance:    { type: Number },
      change:     { type: Number },
      changePct:  { type: Number },
      openTrades: { type: Number },
    },
    aiInsight:     { type: String },
    notificationSent: {
      fcm:      { type: Boolean, default: false },
      telegram: { type: Boolean, default: false },
    },
  },
  { timestamps: true }
);

aiReportSchema.index({ type: 1, createdAt: -1 });

module.exports = mongoose.model('AIReport', aiReportSchema);
