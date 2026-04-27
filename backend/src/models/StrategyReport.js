const mongoose = require('mongoose');

const assetResultSchema = new mongoose.Schema({
  asset:          { type: String, required: true },
  recommendation: { type: String, enum: ['BUY', 'SELL', 'HOLD'], required: true },
  confidence:     { type: Number, default: 0 },
  trend:          { type: String, default: null },
  expectedMove:   { type: Number, default: 0 },
  currentPrice:   { type: Number, default: 0 },
  reason:         { type: String, default: null },
  // simulation fields (optional)
  initialCapital: { type: Number, default: null },
  finalBalance:   { type: Number, default: null },
  profit:         { type: Number, default: null },
  loss:           { type: Number, default: null },
  trades:         { type: Number, default: null },
  returnPct:      { type: Number, default: null },
}, { _id: false });

const strategyReportSchema = new mongoose.Schema({
  userId:         { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  assets:         { type: [String], required: true },
  timeframe:      { type: String, enum: ['1d', '7d', '30d'], required: true },
  type:           { type: String, enum: ['holding', 'simulate'], required: true },

  // holding result
  bestAsset:       { type: String, default: null },
  expectedProfit:  { type: Number, default: null },
  expectedLoss:    { type: Number, default: null },
  winRate:         { type: Number, default: null },

  // simulation result
  initialBalance:  { type: Number, default: null },
  finalBalance:    { type: Number, default: null },
  netPnl:          { type: Number, default: null },
  returnPct:       { type: Number, default: null },
  totalTrades:     { type: Number, default: null },

  capital:         { type: Number, default: 500 },
  perAsset:        { type: [assetResultSchema], default: [] },
}, { timestamps: true });

strategyReportSchema.index({ userId: 1, createdAt: -1 });
strategyReportSchema.index({ createdAt: -1 });

module.exports = mongoose.model('StrategyReport', strategyReportSchema);
