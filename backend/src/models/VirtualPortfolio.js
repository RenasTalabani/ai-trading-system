const mongoose = require('mongoose');

const balancePointSchema = new mongoose.Schema(
  { date: { type: Date, default: Date.now }, balance: { type: Number, required: true } },
  { _id: false }
);

const tradeSnapshotSchema = new mongoose.Schema(
  {
    pnl:       { type: Number, default: null },
    asset:     { type: String, default: null },
    direction: { type: String, default: null },
    closedAt:  { type: Date,   default: null },
  },
  { _id: false }
);

const virtualPortfolioSchema = new mongoose.Schema(
  {
    // Singleton key — always use portfolioKey: 'global'
    portfolioKey: { type: String, default: 'global', unique: true },

    startingBalance:  { type: Number, default: 500 },
    currentBalance:   { type: Number, default: 500 },
    riskPerTradePct:  { type: Number, default: 5, min: 1, max: 50 },

    totalProfit: { type: Number, default: 0 },
    totalLoss:   { type: Number, default: 0 },
    winCount:    { type: Number, default: 0 },
    lossCount:   { type: Number, default: 0 },

    // Drawdown tracking
    peakBalance:  { type: Number, default: 500 },
    maxDrawdown:  { type: Number, default: 0 },

    // Notable trades
    bestTrade:  { type: tradeSnapshotSchema, default: null },
    worstTrade: { type: tradeSnapshotSchema, default: null },

    // Lifecycle
    startedAt: { type: Date, default: null },

    // Snapshot of balance after each closed trade (for chart)
    balanceHistory: { type: [balancePointSchema], default: [] },
  },
  { timestamps: true }
);

module.exports = mongoose.model('VirtualPortfolio', virtualPortfolioSchema);
