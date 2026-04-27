const mongoose = require('mongoose');

const newsDataSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    summary: { type: String, default: '' },
    url: { type: String, required: true, unique: true },
    source: { type: String, required: true },
    publishedAt: { type: Date, required: true },

    sentiment: {
      label: { type: String, enum: ['positive', 'negative', 'neutral'], default: 'neutral' },
      score: { type: Number, default: 0 },         // -1 to +1
      confidence: { type: Number, default: 0 },    // 0–100
      model: { type: String, default: 'vader' },
    },

    // Which assets this news relates to
    relatedAssets: { type: [String], default: [] },

    // Market impact
    impact: {
      score: { type: Number, default: 0, min: 0, max: 100 },
      level: { type: String, enum: ['low', 'medium', 'high', 'critical'], default: 'low' },
    },

    // Detected market events
    events: {
      type: [String],
      default: [],
      // e.g. ['interest_rate', 'regulation', 'partnership', 'hack', 'earnings']
    },

    // Keywords extracted
    keywords: { type: [String], default: [] },

    processed: { type: Boolean, default: false },
  },
  { timestamps: true }
);

newsDataSchema.index({ publishedAt: -1 });
newsDataSchema.index({ relatedAssets: 1, publishedAt: -1 });
newsDataSchema.index({ 'sentiment.label': 1, publishedAt: -1 });
newsDataSchema.index({ 'impact.level': 1, publishedAt: -1 });

// Auto-delete news older than 7 days
newsDataSchema.index({ createdAt: 1 }, { expireAfterSeconds: 7 * 24 * 60 * 60 });

module.exports = mongoose.model('NewsData', newsDataSchema);
