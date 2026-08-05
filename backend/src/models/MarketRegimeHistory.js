const mongoose = require('mongoose');

const marketRegimeHistorySchema = new mongoose.Schema({
  asset:      { type: String, required: true, index: true },
  regime:     { type: String, enum: ['TRENDING', 'DOWNTREND', 'SIDEWAYS', 'VOLATILE'], required: true },
  action:     { type: String, enum: ['BUY', 'SELL', 'HOLD'] },
  confidence: Number,
  fusedScore: Number,
  result:     { type: String, enum: ['WIN', 'LOSS', 'OPEN', null], default: null },
  recordedAt: { type: Date, default: Date.now, index: true },
}, { timestamps: false });

module.exports = mongoose.model('MarketRegimeHistory', marketRegimeHistorySchema);
