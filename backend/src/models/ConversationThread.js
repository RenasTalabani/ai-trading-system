const mongoose = require('mongoose');

// RENO Phase 1, step 2 (2026-09-01): the conversation-memory model the
// audit (reno-phase0-audit-2026-09-01.md) found missing entirely. A
// thread is one ongoing conversation between a user and the AI --
// deliberately singular-per-user rather than one-thread-per-topic, so
// "remember the trade we did together" has one obvious place to look
// instead of needing to search across many threads.
const conversationThreadSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true, index: true },

    // Denormalized for cheap list/preview rendering without a join --
    // kept in sync by the message-creation path, not authoritative
    // (ConversationMessage.createdAt is authoritative for ordering).
    lastMessageAt: { type: Date, default: null },
    lastMessagePreview: { type: String, default: null },

    status: { type: String, enum: ['active', 'archived'], default: 'active' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('ConversationThread', conversationThreadSchema);
