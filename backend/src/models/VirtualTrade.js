const mongoose = require('mongoose');

const virtualTradeSchema = new mongoose.Schema(
  {
    // Source of trade: 'signal' (old flow), 'ai' (AI worker), or 'guide' (user tapped Yes on a Guide suggestion)
    source:       { type: String, enum: ['signal', 'ai', 'guide'], default: 'signal' },
    signalId:     { type: mongoose.Schema.Types.ObjectId, ref: 'Signal',     default: null, index: true },
    aiDecisionId: { type: mongoose.Schema.Types.ObjectId, ref: 'AIDecision', default: null, index: true },

    // T-074a (2026-08-30): `source` above distinguishes *which code path*
    // opened a trade, not *who/what actually triggered it* -- and per
    // WINRATE_DIAGNOSIS.md's own root-cause finding, every `source:'guide'`
    // trade (100% of the analyzed history) is opened by the same
    // POST /guide/suggestion/approve endpoint whether a real user tapped
    // "Yes" in the app or a testing/validation session called that endpoint
    // directly -- `source` cannot and does not already carry that
    // distinction, so this is a genuinely new axis, not a duplicate of it.
    // `origin` records the real, 100%-certain code path for every NEW trade
    // going forward:
    //   - 'ai_worker'           — aiWorkerService.js's autonomous cycle;
    //                             no HTTP request or human involved at all.
    //   - 'signal_auto_pickup'  — pickupNewSignals()'s automatic sweep;
    //                             same certainty as ai_worker (no human
    //                             involved), though this path is not
    //                             currently wired into any running job.
    //   - 'guide_approval'      — POST /guide/suggestion/approve. Honestly
    //                             NOT further distinguishable: there is no
    //                             test-account flag, role, header, or any
    //                             other reliable signal in this codebase
    //                             today that tells a real user's tap apart
    //                             from a testing/validation session calling
    //                             the same endpoint directly (confirmed by
    //                             checking User.js's role enum and
    //                             middleware/auth.js -- nothing exists to
    //                             key off). Recording the real, honest
    //                             answer rather than inventing a heuristic
    //                             that would just be guessing.
    //   - 'futures_manual'      — POST /virtual/trades/:signalId/open-futures.
    //                             Same ambiguity as 'guide_approval' above.
    //   - 'conversation_approval' — Phase 2 (2026-09-01), POST
    //                             /conversation/approve, RENO chat's own
    //                             approve action. Server-side re-resolves
    //                             the suggestion exactly like guide_approval
    //                             does (see conversationService.approvePlan) --
    //                             kept as its own honest value rather than
    //                             reusing 'guide_approval' so a trade opened
    //                             from a chat tap is distinguishable from one
    //                             opened from the Guide screen's button.
    // No default -- pre-existing trades are simply undefined on this field
    // (see likelyTestOrigin below for a separate, clearly-labeled
    // best-effort backfill for those), matching this schema's existing
    // convention for additive fields (see `decision` on Signal.js, T-066).
    origin: {
      type: String,
      enum: ['ai_worker', 'signal_auto_pickup', 'guide_approval', 'futures_manual', 'conversation_approval'],
      index: true,
    },

    // T-074b (2026-08-30): best-effort, INFERRED backfill for trades that
    // predate `origin` above -- deliberately a separate field so a reader
    // can always tell "we know this one for a fact" (origin) apart from
    // "we inferred this one from a pattern" (likelyTestOrigin). Computed by
    // backend/scripts/backfillLikelyTestOrigin.js, reusing
    // WINRATE_DIAGNOSIS.md's exact duplicate-fingerprint definition
    // (same asset + entryPrice + stopLoss, exact match) rather than a new
    // heuristic. true = this trade belongs to a fingerprint-duplicate batch
    // (>=2 trades sharing the same asset+entryPrice+stopLoss), the same
    // signature WINRATE_DIAGNOSIS.md traced to repeated
    // testing/validation-session calls against the live approve endpoint.
    // Never set for trades created after `origin` exists -- those have a
    // known, not inferred, origin instead. Does not change pnl/result/
    // status or any win-rate calculation by itself.
    likelyTestOrigin: { type: Boolean, default: null },

    asset:     { type: String, required: true, uppercase: true },
    direction: { type: String, enum: ['BUY', 'SELL'], required: true },

    entryPrice: { type: Number, required: true },
    stopLoss:   { type: Number, default: null },
    takeProfit: { type: Number, default: null },
    // T-073 (2026-08-30): the ATR value that fed this trade's SL/TP sizing
    // at open time (whichever calculation already produced stopLoss/
    // takeProfit above -- this field does not compute anything new). Added
    // so a tight-stop hypothesis (SL-hit trades showing a 0% win rate by
    // definition, MANUAL closes showing 57.5% -- see WINRATE_DIAGNOSIS.md)
    // can actually be tested against real per-trade ATR data instead of
    // only inferred. null wherever the opening path has no ATR available
    // (e.g. the plain Signal-sourced pickup/approve paths, which carry no
    // ATR field at all -- an honest gap, not a bug to paper over here).
    atrAtEntry: { type: Number, default: null },
    sizeUsd:    { type: Number, required: true },
    // How much sizeUsd was scaled from the baseline risk% — 1.0 = baseline,
    // >1 = this asset has a proven recent edge, <1 = it doesn't (yet). See
    // getEdgeMultiplier() in virtualTrackingService.js.
    sizeMultiplier: { type: Number, default: 1.0 },

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
    exitReason: { type: String, enum: ['TP', 'SL', 'LIQUIDATED', 'EXPIRED', 'MANUAL', 'HALTED', 'session_reset', null], default: null },
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
