const mongoose = require('mongoose');

const userFollowSchema = new mongoose.Schema({
  userId:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  asset:       { type: String, required: true },
  displayName: { type: String, required: true },
  action:      { type: String, enum: ['BUY', 'SELL', 'HOLD'], required: true },
  entryPrice:  { type: Number, default: null },
  stopLoss:    { type: Number, default: null },
  takeProfit:  { type: Number, default: null },
  confidence:  { type: Number, required: true },
  timeframe:   { type: String, default: '4H' },
  outcome:     { type: String, enum: ['OPEN', 'WIN', 'LOSS', 'CANCELLED'], default: 'OPEN' },
  exitPrice:   { type: Number, default: null },
  profitPct:   { type: Number, default: null },
  closedAt:    { type: Date, default: null },
  note:        { type: String, default: '' },
}, { timestamps: true });

module.exports = mongoose.model('UserFollow', userFollowSchema);
