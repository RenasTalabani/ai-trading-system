/**
 * TradeThesis — Phase 3, step 2 (2026-09-01).
 *
 * "RENO must remember why an approved trade exists" -- persists the exact
 * plan and reasoning a trade was approved on, immutably, so it can later
 * be compared against what actually happened. Every field here is a
 * real, server-resolved value at the moment of approval (see
 * conversationService.approvePlan(), the only place that creates one) --
 * never a client-supplied value, and never something the LLM could have
 * silently altered.
 *
 * Scope note, stated plainly: this is created only from RENO chat's own
 * approval path (conversationService.approvePlan()), not from Guide's
 * approve() -- guideController.js remains completely untouched by this
 * feature (its resolveSuggestion() gained one small additive field this
 * same pass, unrelated to this model; approve() itself is unchanged).
 * A Guide-approved trade simply has no TradeThesis document, which is an
 * honest reflection of what's actually recorded, not a bug.
 *
 * "If the plan changes later, record a new decision/change event instead
 * of overwriting history" -- changeEvents[] is append-only. Nothing here
 * ever rewrites entry/stopLoss/takeProfit/originalReasoning after
 * creation; a later recommendation change (RENO-012's monitoring job)
 * pushes a new entry onto changeEvents instead.
 */
const mongoose = require('mongoose');

const changeEventSchema = new mongoose.Schema(
  {
    timestamp:     { type: Date, default: Date.now },
    previousState: { type: String, default: null },
    newState:      { type: String, required: true },
    reason:        { type: String, required: true },
    evidence:      { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { _id: false }
);

const tradeThesisSchema = new mongoose.Schema(
  {
    tradeId:  { type: mongoose.Schema.Types.ObjectId, ref: 'VirtualTrade', required: true, unique: true, index: true },
    threadId: { type: mongoose.Schema.Types.ObjectId, ref: 'ConversationThread', required: true, index: true },

    asset:               { type: String, required: true },
    direction:           { type: String, enum: ['BUY', 'SELL'], required: true },
    entry:               { type: Number, required: true },
    investmentAmountUsd: { type: Number, required: true },
    stopLoss:            { type: Number, default: null },
    takeProfit:          { type: Number, default: null },
    timeframe:           { type: String, default: null },

    originalRecommendation:  { type: String, required: true }, // e.g. 'BUY' -- the action approved on
    originalReasoning:       { type: [String], default: [] },  // the real plain-language `why` lines shown at approval time
    supportingMarketFactors: { type: mongoose.Schema.Types.Mixed, default: null }, // real fields off the resolved suggestion (confidence, decision label, etc.) -- never invented

    invalidationConditions: { type: String, default: null },
    expectedConditions:     { type: String, default: null },

    approvedByUser:    { type: Boolean, default: true }, // always true today -- see scope note above, this model is only ever created from an explicit approval action
    approvalTimestamp: { type: Date, required: true },

    changeEvents: { type: [changeEventSchema], default: [] },
  },
  { timestamps: true } // createdAt doubles as the spec's "creation_timestamp"
);

module.exports = mongoose.model('TradeThesis', tradeThesisSchema);
