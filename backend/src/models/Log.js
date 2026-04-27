const mongoose = require('mongoose');

const logSchema = new mongoose.Schema(
  {
    level: {
      type: String,
      enum: ['info', 'warn', 'error', 'debug'],
      required: true,
    },
    service: {
      type: String,
      enum: ['backend', 'ai-service', 'signal-engine', 'notifier', 'market-fetcher'],
      required: true,
    },
    message: { type: String, required: true },
    meta: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

logSchema.index({ level: 1, createdAt: -1 });
logSchema.index({ service: 1, createdAt: -1 });

// TTL: auto-delete logs older than 30 days
logSchema.index({ createdAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });

module.exports = mongoose.model('Log', logSchema);
