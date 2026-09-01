/**
 * Schema validation tests for the RENO Phase 1, step 2 conversation-memory
 * models (ConversationThread, ConversationMessage) -- the data layer the
 * Phase 0 audit (reno-phase0-audit-2026-09-01.md) found entirely missing.
 * Pure schema validation via validateSync() -- no DB connection, matching
 * this repo's existing model-test convention.
 */
const mongoose = require('mongoose');
const ConversationThread  = require('../src/models/ConversationThread');
const ConversationMessage = require('../src/models/ConversationMessage');

describe('ConversationThread', () => {
  it('requires userId', () => {
    const doc = new ConversationThread({});
    const err = doc.validateSync();
    expect(err.errors.userId).toBeDefined();
  });

  it('defaults status to active and lastMessageAt/Preview to null', () => {
    const doc = new ConversationThread({ userId: new mongoose.Types.ObjectId() });
    expect(doc.validateSync()).toBeUndefined();
    expect(doc.status).toBe('active');
    expect(doc.lastMessageAt).toBeNull();
    expect(doc.lastMessagePreview).toBeNull();
  });

  it('rejects a status outside the enum', () => {
    const doc = new ConversationThread({ userId: new mongoose.Types.ObjectId(), status: 'deleted' });
    const err = doc.validateSync();
    expect(err.errors.status).toBeDefined();
  });
});

describe('ConversationMessage', () => {
  const threadId = new mongoose.Types.ObjectId();

  it('requires threadId, role, and content', () => {
    const doc = new ConversationMessage({});
    const err = doc.validateSync();
    expect(err.errors.threadId).toBeDefined();
    expect(err.errors.role).toBeDefined();
    expect(err.errors.content).toBeDefined();
  });

  it('rejects a role outside the enum (user/assistant/system)', () => {
    const doc = new ConversationMessage({ threadId, role: 'admin', content: 'hi' });
    const err = doc.validateSync();
    expect(err.errors.role).toBeDefined();
  });

  it('accepts a valid user message with default empty toolCalls/relatedTradeIds', () => {
    const doc = new ConversationMessage({ threadId, role: 'user', content: 'buy gold' });
    expect(doc.validateSync()).toBeUndefined();
    expect(doc.toolCalls).toEqual([]);
    expect(doc.relatedTradeIds).toEqual([]);
    expect(doc.proactiveTrigger).toBeNull();
  });

  it('accepts an assistant message carrying a toolCalls entry and a relatedTradeIds link', () => {
    const tradeId = new mongoose.Types.ObjectId();
    const doc = new ConversationMessage({
      threadId,
      role: 'assistant',
      content: "You're up $340 today on that gold position — hold or sell?",
      toolCalls: [{ name: 'buildPositionGuidance', args: { tradeId }, result: { pnlPct: 3.2 } }],
      relatedTradeIds: [tradeId],
    });
    const err = doc.validateSync();
    expect(err).toBeUndefined();
    expect(doc.toolCalls[0].name).toBe('buildPositionGuidance');
    expect(doc.relatedTradeIds[0].toString()).toBe(tradeId.toString());
  });

  it('rejects a toolCalls entry missing the required name field', () => {
    const doc = new ConversationMessage({
      threadId, role: 'assistant', content: 'hi',
      toolCalls: [{ args: {}, result: {} }],
    });
    const err = doc.validateSync();
    expect(err).toBeDefined();
  });
});
