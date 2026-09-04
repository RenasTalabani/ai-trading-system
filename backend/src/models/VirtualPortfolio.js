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

    // Bug fix (2026-09-04, overnight continuous-improvement pass): decision
    // #22's graduation benchmark (getBenchmarkComparison() in
    // virtualTrackingService.js) needs the ACTUAL dollar amount that was in
    // the portfolio at the moment trading started, frozen -- but
    // `startingBalance` above isn't frozen: the admin-only POST
    // /virtual/set-capital endpoint (setCapital()) can change it at any
    // later time without touching `startedAt` or trade history (by design,
    // for adjusting risk% or topping up paper capital mid-experiment).
    // Using `startingBalance` directly in the benchmark math meant a later
    // set-capital call would silently retroact onto the whole benchmark
    // comparison as if the new capital had been invested since day one.
    // Lazily frozen the first time getBenchmarkComparison() runs after
    // `startedAt` is set (see that function's own comment) rather than at
    // the exact trade-open instant, deliberately: that keeps this fix to
    // ONE function, with no risk of colliding with any other patch that
    // also touches approveSuggestion()'s trade-opening critical section.
    benchmarkStartBalance: { type: Number, default: null },

    // Snapshot of balance after each closed trade (for chart)
    balanceHistory: { type: [balancePointSchema], default: [] },
  },
  { timestamps: true }
);

module.exports = mongoose.model('VirtualPortfolio', virtualPortfolioSchema);
