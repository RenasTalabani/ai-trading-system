const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  userId:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  asset:       { type: String, required: true },
  displayName: { type: String, default: '' },
  targetPrice: { type: Number, required: true },
  direction:   { type: String, enum: ['above', 'below'], required: true },
  active:      { type: Boolean, default: true, index: true },
  note:        { type: String, default: '' },
  triggeredAt: { type: Date },
  createdAt:   { type: Date, default: Date.now },
});

module.exports = mongoose.model('PriceAlert', schema);
