const mongoose = require('mongoose');

const signalWeightsSchema = new mongoose.Schema({
  weightsKey:   { type: String, default: 'global', unique: true },
  technical:    { type: Number, default: 0.45 },
  news:         { type: Number, default: 0.20 },
  social:       { type: Number, default: 0.10 },
  macro:        { type: Number, default: 0.25 },
  totalUpdates: { type: Number, default: 0 },
  lastResult:   { type: String, enum: ['WIN', 'LOSS', null], default: null },
  updatedAt:    { type: Date,   default: Date.now },
}, { timestamps: true });

module.exports = mongoose.model('SignalWeights', signalWeightsSchema);
