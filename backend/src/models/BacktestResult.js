const mongoose = require('mongoose');

const backtestResultSchema = new mongoose.Schema(
  {
    asset:            { type: String, required: true, uppercase: true },
    interval:         { type: String, default: '1h' },
    periodStart:      { type: Date },
    periodEnd:        { type: Date },
    totalTrades:      { type: Number, default: 0 },
    wins:             { type: Number, default: 0 },
    losses:           { type: Number, default: 0 },
    winRate:          { type: Number, default: 0 },
    totalReturnPct:   { type: Number, default: 0 },
    profitFactor:     { type: Number, default: 0 },
    maxDrawdownPct:   { type: Number, default: 0 },
    sharpeRatio:      { type: Number, default: 0 },
    avgWinPct:        { type: Number, default: 0 },
    avgLossPct:       { type: Number, default: 0 },
    totalPnlUsd:      { type: Number, default: 0 },
    triggeredBy:      { type: String, default: 'system' },
  },
  { timestamps: true }
);

backtestResultSchema.index({ asset: 1, createdAt: -1 });

module.exports = mongoose.model('BacktestResult', backtestResultSchema);
