const mongoose = require('mongoose');

const budgetSessionSchema = new mongoose.Schema(
  {
    // Singleton — always sessionKey: 'global'
    sessionKey:     { type: String, default: 'global', unique: true },

    budget:         { type: Number, required: true, default: 500 },
    riskLevel:      { type: String, enum: ['low', 'medium', 'high'], default: 'medium' },
    preferredAsset: { type: String, default: 'ALL' }, // 'ALL' or specific asset
    status:         { type: String, enum: ['active', 'paused'], default: 'paused' },

    startedAt:      { type: Date, default: null },
    pausedAt:       { type: Date, default: null },

    // Snapshot at session start for relative P&L
    snapshotBalance: { type: Number, default: null },
  },
  { timestamps: true },
);

module.exports = mongoose.model('BudgetSession', budgetSessionSchema);
