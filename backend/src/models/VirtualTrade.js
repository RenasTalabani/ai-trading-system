const mongoose = require('mongoose');

const virtualTradeSchema = new mongoose.Schema(
  {
    // Source of trade: 'signal' (old flow) or 'ai' (AI worker)
    source:       { type: String, enum: ['signal', 'ai'], default: 'signal' },
    signalId:     { type: mongoose.Schema.Types.ObjectId, ref: 'Signal',     default: null, index: true },
    aiDecisionId: { type: mongoose.Schema.Types.ObjectId, ref: 'AIDecision', default: null, index: true },

    asset:     { type: String, required: true, uppercase: true },
    direction: { type: String, enum: ['BUY', 'SELL'], required: true },

    entryPrice: { type: Number, required: true },
    stopLoss:   { type: Number, default: null },
    takeProfit: { type: Number, default: null },
    sizeUsd:    { type: Number, required: true },

    // Simulated futures/leverage — spot trades leave these at their defaults.
    productType:      { type: String, enum: ['spot', 'futures'], default: 'spot' },
    leverage:         { type: Number, default: 1, min: 1, max: 20 },
    marginUsd:        { type: Number, default: null },  // capital committed (deducted from balance)
    liquidationPrice: { type: Number, default: null },
    fundingPaid:      { type: Number, default: 0 },      // cumulative funding payments

    // Trailing stop-loss — opt-in per trade (open trades only). When enabled,
    // stopLoss only ever tightens toward the current price as it moves
    // favorably, locking in gains instead of sitting at the original SL.
    trailingStopEnabled:  { type: Boolean, default: false },
    trailingStopDistance: { type: Number, default: null }, // $ distance maintained from price

    status: {
      type: String,
      enum: ['open', 'closed_profit', 'closed_loss', 'cancelled', 'expired'],
      default: 'open',
      index: true,
    },
    result:     { type: String, enum: ['win', 'loss', 'cancelled', null], default: null },
    exitReason: { type: String, enum: ['TP', 'SL', 'LIQUIDATED', 'EXPIRED', 'session_reset', null], default: null },
    exitPrice:  { type: Number, default: null },
    pnl:        { type: Number, default: null },
    pnlPct:     { type: Number, default: null },

    balanceBefore:   { type: Number, default: null },
    balanceAfter:    { type: Number, default: null },
    durationMinutes: { type: Number, default: null },

    openedAt: { type: Date, default: Date.now },
    closedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

virtualTradeSchema.index({ status: 1, openedAt: -1 });
virtualTradeSchema.index({ asset: 1, openedAt: -1 });
virtualTradeSchema.index({ closedAt: -1 });

module.exports = mongoose.model('VirtualTrade', virtualTradeSchema);
