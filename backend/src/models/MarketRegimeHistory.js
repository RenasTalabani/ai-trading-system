const mongoose = require('mongoose');

const marketRegimeHistorySchema = new mongoose.Schema({
  asset:      { type: String, required: true, index: true },
  regime:     { type: String, enum: ['TRENDING', 'DOWNTREND', 'SIDEWAYS', 'VOLATILE'], required: true },
  action:     { type: String, enum: ['BUY', 'SELL', 'HOLD'] },
  confidence: Number,
  fusedScore: Number,
  // Bug found 2026-09-04 (overnight continuous-improvement pass): `result`
  // declares WIN/LOSS/OPEN as valid states, and performanceAnalysisJob.js's
  // "Regime WR last 6h" log line aggregates on exactly this field -- but
  // nothing ever wrote it after creation (it always stayed at its `null`
  // default). That log line has therefore never fired once in production:
  // its query (`result: {$in:['WIN','LOSS']}`) matched zero documents, ever.
  // Fixed by linking each record to the AIDecision it was recorded
  // alongside (see aiWorkerService.js's MarketRegimeHistory.create() call)
  // and having decisionTrackingJob.evaluateOpenDecisions() -- the one place
  // that already resolves an AIDecision to WIN/LOSS -- propagate that same
  // result onto the linked regime-history record too.
  aiDecisionId: { type: mongoose.Schema.Types.ObjectId, ref: 'AIDecision', default: null, index: true },
  result:     { type: String, enum: ['WIN', 'LOSS', 'OPEN', null], default: null },
  recordedAt: { type: Date, default: Date.now, index: true },
}, { timestamps: false });

module.exports = mongoose.model('MarketRegimeHistory', marketRegimeHistorySchema);
