const mongoose = require('mongoose');

const purchaseSchema = new mongoose.Schema({
  price:    { type: Number, required: true },
  amountUsd:{ type: Number, required: true },
  units:    { type: Number, required: true },
  date:     { type: Date, default: Date.now },
}, { _id: false });

const dcaPlanSchema = new mongoose.Schema(
  {
    asset:         { type: String, required: true, uppercase: true },
    amountPerBuy:  { type: Number, required: true, min: 1 },
    frequencyDays: { type: Number, required: true, min: 1, max: 30 },
    status:        { type: String, enum: ['active', 'stopped'], default: 'active', index: true },

    purchases:     { type: [purchaseSchema], default: [] },
    totalInvested: { type: Number, default: 0 },
    totalUnits:    { type: Number, default: 0 },

    startedAt: { type: Date, default: Date.now },
    lastBuyAt: { type: Date, default: null },

    // Safety fix (2026-09-04, decision #11): the daily cron used to execute
    // a due buy immediately, with no human approval at all. Now it only
    // ever sets this flag + notifies -- approveDueBuy()/skipDueBuy() in
    // dcaService.js are the sole path that can move money or clear it.
    dueBuyPending: { type: Boolean, default: false },
  },
  { timestamps: true }
);

dcaPlanSchema.index({ status: 1, lastBuyAt: 1 });

module.exports = mongoose.model('DCAPlan', dcaPlanSchema);
