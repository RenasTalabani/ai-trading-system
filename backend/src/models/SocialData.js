const mongoose = require('mongoose');

const socialDataSchema = new mongoose.Schema(
  {
    platform: {
      type: String,
      enum: ['telegram', 'twitter', 'reddit'],
      required: true,
    },
    content: { type: String, required: true },
    author: { type: String, default: 'anonymous' },
    authorFollowers: { type: Number, default: 0 },
    channel: { type: String, default: '' },   // Telegram channel / subreddit / Twitter handle

    sentiment: {
      label: { type: String, enum: ['bullish', 'bearish', 'neutral', 'spam'], default: 'neutral' },
      score: { type: Number, default: 0 },
      confidence: { type: Number, default: 0 },
    },

    relatedAssets: { type: [String], default: [] },

    flags: {
      isSpam: { type: Boolean, default: false },
      isHype: { type: Boolean, default: false },
      isFear: { type: Boolean, default: false },
      isManipulation: { type: Boolean, default: false },
      isInfluencer: { type: Boolean, default: false },
    },

    influence: {
      score: { type: Number, default: 0, min: 0, max: 100 },
      weight: { type: Number, default: 1.0 },
    },

    engagements: {
      likes: { type: Number, default: 0 },
      shares: { type: Number, default: 0 },
      replies: { type: Number, default: 0 },
    },

    publishedAt: { type: Date, required: true },
  },
  { timestamps: true }
);

socialDataSchema.index({ platform: 1, publishedAt: -1 });
socialDataSchema.index({ relatedAssets: 1, publishedAt: -1 });
socialDataSchema.index({ 'sentiment.label': 1, publishedAt: -1 });

// Auto-delete after 3 days
socialDataSchema.index({ createdAt: 1 }, { expireAfterSeconds: 3 * 24 * 60 * 60 });

module.exports = mongoose.model('SocialData', socialDataSchema);
