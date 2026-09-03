const mongoose = require('mongoose');

/**
 * What the single main screen actually shows (master-plan decisions #14 and
 * #21): one pending "here's what I found, here's your choices" card, built
 * from whichever AIDecision(s) cleared the safety gate + confidence bar in
 * one worker cycle. Approving picks exactly one option's allocations to
 * become real (paper) trades; every AIDecision NOT part of the chosen
 * option is marked REJECTED rather than left dangling.
 */
const allocationSchema = new mongoose.Schema(
  {
    asset:        { type: String, required: true, uppercase: true },
    direction:    { type: String, enum: ['BUY', 'SELL'], required: true },
    amountUsd:    { type: Number, required: true },
    entryPrice:   { type: Number, required: true },
    stopLoss:     { type: Number, default: null },
    takeProfit:   { type: Number, default: null },
    aiDecisionId: { type: mongoose.Schema.Types.ObjectId, ref: 'AIDecision', required: true },
  },
  { _id: false }
);

const optionSchema = new mongoose.Schema(
  {
    key:           { type: String, required: true }, // e.g. 'best_single', 'diversified', 'single_SOL'
    label:         { type: String, required: true }, // human-readable, shown directly on the card
    isRecommended: { type: Boolean, default: false },
    totalUsd:      { type: Number, required: true },
    allocations:   { type: [allocationSchema], default: [] },
  },
  { _id: false }
);

const allocationProposalSchema = new mongoose.Schema(
  {
    options: { type: [optionSchema], default: [] },

    status: {
      type: String,
      enum: ['PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'EXPIRED'],
      default: 'PENDING_APPROVAL',
    },
    chosenOptionKey: { type: String, default: null },
    tradeIds:        { type: [mongoose.Schema.Types.ObjectId], ref: 'VirtualTrade', default: [] },
    decidedAt:       { type: Date, default: null },
  },
  { timestamps: true }
);

allocationProposalSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model('AllocationProposal', allocationProposalSchema);
