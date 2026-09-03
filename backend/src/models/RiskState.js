const mongoose = require('mongoose');

/**
 * Persistent, portfolio-wide safety state — deliberately separate from
 * VirtualPortfolio's own bookkeeping fields (peakBalance/maxDrawdown) which
 * are historical stats, not a live gate.
 *
 * Master-plan decision #16 (Decision Log, 2026-09-03): once the portfolio's
 * cumulative loss for the current UTC day reaches DAILY_LOSS_HALT_PCT (see
 * safetyLimitsGate.js), ALL new-trade paths must stop until a human
 * explicitly resets this record (`manualReset()` in riskStateService.js).
 * This does NOT self-clear when the losing trade ages out of a rolling
 * window -- that was the old aiWorkerService-only 5% check's behavior
 * (T-see aiWorkerService.js history), which decision #16 explicitly
 * replaces because a self-resuming limit isn't a real circuit breaker.
 */
const riskStateSchema = new mongoose.Schema(
  {
    riskKey: { type: String, default: 'global', unique: true },

    dailyLossHalted:  { type: Boolean, default: false },
    haltedAt:         { type: Date, default: null },
    haltReason:       { type: String, default: null },
    dailyLossAtHalt:  { type: Number, default: null }, // $ amount that triggered the halt
    haltDayKey:       { type: String, default: null },  // UTC yyyy-mm-dd the halt happened on

    resetAt: { type: Date, default: null },
    resetBy: { type: String, default: null }, // free-text identifier (e.g. 'user' / userId) — who cleared it
  },
  { timestamps: true }
);

module.exports = mongoose.model('RiskState', riskStateSchema);
