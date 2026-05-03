const mongoose = require('mongoose');

const aiRecommendationSchema = new mongoose.Schema(
  {
    asset:      { type: String, required: true, uppercase: true, index: true },
    action:     { type: String, enum: ['BUY', 'SELL', 'HOLD'], required: true },
    confidence: { type: Number, required: true, min: 0, max: 100 },
    timeframe:  { type: String, required: true },

    priceAtRecommendation: { type: Number, required: true },
    priceAtExpiry:         { type: Number, default: null },

    expectedReturnPct: { type: String },
    reason:            { type: String },

    // Set after expiry window passes
    actualReturnPct:   { type: Number, default: null },
    wasCorrect:        { type: Boolean, default: null },
    profitIfFollowed:  { type: Number, default: null },  // $ on $100 invested

    status: {
      type: String,
      enum: ['pending', 'evaluated'],
      default: 'pending',
      index: true,
    },
    expiresAt: { type: Date, required: true, index: true },
    evaluatedAt: { type: Date, default: null },

    source: { type: String, enum: ['advisor', 'signal', 'brain'], default: 'advisor' },
  },
  { timestamps: true }
);

aiRecommendationSchema.index({ asset: 1, createdAt: -1 });
aiRecommendationSchema.index({ status: 1, expiresAt: 1 });

module.exports = mongoose.model('AIRecommendation', aiRecommendationSchema);
