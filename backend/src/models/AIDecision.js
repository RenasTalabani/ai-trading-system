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

    // Phase 3 — outcome tracking
    timeframe:       { type: String, default: '1h' },
    expectedProfitPct: { type: String, default: 'N/A' },
    exitPrice:       { type: Number, default: null },
    profit:          { type: Number, default: null },   // $ on $100
    profitPct:       { type: Number, default: null },   // % return
    result:          { type: String, enum: ['WIN', 'LOSS', 'OPEN', 'SKIPPED'], default: 'OPEN' },
    closedAt:        { type: Date, default: null },
    expiresAt:       { type: Date, default: null },
    source:          { type: String, default: 'global_scan' },
  },
  { timestamps: true }
);

aiDecisionSchema.index({ asset: 1, createdAt: -1 });
aiDecisionSchema.index({ action: 1, confidence: -1 });
aiDecisionSchema.index({ createdAt: -1 });

module.exports = mongoose.model('AIDecision', aiDecisionSchema);
