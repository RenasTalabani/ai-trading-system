const mongoose = require('mongoose');

// RENO Phase 1, step 2 (2026-09-01): one message in a ConversationThread.
// `toolCalls` records exactly which existing, already-correct backend
// logic (Guide's resolveSuggestion/buildPositionGuidance, a VirtualTrade
// history query, etc.) an assistant reply actually pulled real numbers
// from -- so a reply can always be traced back to real data instead of
// trusting the LLM's own claim about what it looked up. This is the
// same "show your work" principle guideController.js already applies
// (why[] arrays, null instead of a fabricated number) -- extended to a
// conversational message instead of a suggestion card.
const toolCallSchema = new mongoose.Schema(
  {
    name:   { type: String, required: true },   // e.g. 'resolveSuggestion', 'buildPositionGuidance', 'getRecentTradeOutcomes'
    args:   { type: mongoose.Schema.Types.Mixed, default: null },
    result: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { _id: false }
);

const conversationMessageSchema = new mongoose.Schema(
  {
    threadId: { type: mongoose.Schema.Types.ObjectId, ref: 'ConversationThread', required: true, index: true },

    role:    { type: String, enum: ['user', 'assistant', 'system'], required: true },
    content: { type: String, required: true },

    // Populated only on assistant messages that actually called a tool.
    toolCalls: { type: [toolCallSchema], default: [] },

    // Trades this message is genuinely about -- e.g. the assistant told
    // the user "you're up $340 on this" or the user asked "how's my gold
    // trade doing" and got an answer sourced from one of these. Lets a
    // later query answer "what did we say about trade X" without text
    // search, and keeps this linkage to VirtualTrade (the single source
    // of truth for real P&L/result, per the Phase 0 audit) rather than
    // duplicating trade data into the message itself.
    relatedTradeIds: { type: [mongoose.Schema.Types.ObjectId], ref: 'VirtualTrade', default: [] },

    // Set when this message was sent proactively (e.g. a TP/SL hit, a
    // meaningful P&L swing) rather than in direct reply to something the
    // user typed -- distinguishes "the AI started this" from "the AI
    // answered a question," which the UI will want to render differently.
    proactiveTrigger: { type: String, default: null },
  },
  { timestamps: true }
);

conversationMessageSchema.index({ threadId: 1, createdAt: 1 });

module.exports = mongoose.model('ConversationMessage', conversationMessageSchema);
