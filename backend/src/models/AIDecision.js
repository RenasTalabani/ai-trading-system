const mongoose = require('mongoose');

const aiDecisionSchema = new mongoose.Schema(
  {
    asset:       { type: String, required: true, uppercase: true },
    displayName: { type: String, default: '' },
    assetClass:  { type: String, enum: ['crypto', 'commodity', 'forex'], default: 'crypto' },

    action:     { type: String, enum: ['BUY', 'SELL', 'HOLD'], required: true },
    confidence: { type: Number, required: true },

    entryPrice:  { type: Number, default: null },
    stopLoss:    { type: Number, default: null },
    takeProfit:  { type: Number, default: null },
    riskReward:  { type: String, default: null },

    reason:    { type: String, default: null },
    rsi:       { type: Number, default: null },
    trend:     { type: String, default: null },
    newsScore: { type: Number, default: null },
    fusedScore:{ type: Number, default: null },

    tradeCreated: { type: Boolean, default: false },
    tradeId:      { type: mongoose.Schema.Types.ObjectId, ref: 'VirtualTrade', default: null },
  },
  { timestamps: true }
);

aiDecisionSchema.index({ asset: 1, createdAt: -1 });
aiDecisionSchema.index({ action: 1, confidence: -1 });
aiDecisionSchema.index({ createdAt: -1 });

module.exports = mongoose.model('AIDecision', aiDecisionSchema);
