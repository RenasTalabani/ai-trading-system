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
  },
  { timestamps: true }
);

dcaPlanSchema.index({ status: 1, lastBuyAt: 1 });

module.exports = mongoose.model('DCAPlan', dcaPlanSchema);
