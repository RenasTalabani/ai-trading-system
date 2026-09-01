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
const TradeThesis         = require('../src/models/TradeThesis');

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

describe('TradeThesis', () => {
  const tradeId  = new mongoose.Types.ObjectId();
  const threadId = new mongoose.Types.ObjectId();

  function validDoc(overrides = {}) {
    return new TradeThesis({
      tradeId, threadId,
      asset: 'ETHUSDT', direction: 'BUY', entry: 3000, investmentAmountUsd: 50,
      originalRecommendation: 'BUY', approvalTimestamp: new Date(),
      ...overrides,
    });
  }

  it('requires tradeId, threadId, asset, direction, entry, investmentAmountUsd, originalRecommendation, and approvalTimestamp', () => {
    const doc = new TradeThesis({});
    const err = doc.validateSync();
    expect(err.errors.tradeId).toBeDefined();
    expect(err.errors.threadId).toBeDefined();
    expect(err.errors.asset).toBeDefined();
    expect(err.errors.direction).toBeDefined();
    expect(err.errors.entry).toBeDefined();
    expect(err.errors.investmentAmountUsd).toBeDefined();
    expect(err.errors.originalRecommendation).toBeDefined();
    expect(err.errors.approvalTimestamp).toBeDefined();
  });

  it('rejects a direction outside the BUY/SELL enum', () => {
    const doc = validDoc({ direction: 'HOLD' });
    const err = doc.validateSync();
    expect(err.errors.direction).toBeDefined();
  });

  it('accepts a valid thesis with real defaults: approvedByUser true, empty changeEvents/originalReasoning', () => {
    const doc = validDoc();
    expect(doc.validateSync()).toBeUndefined();
    expect(doc.approvedByUser).toBe(true);
    expect(doc.changeEvents).toEqual([]);
    expect(doc.originalReasoning).toEqual([]);
    expect(doc.stopLoss).toBeNull();
    expect(doc.takeProfit).toBeNull();
    expect(doc.timeframe).toBeNull();
  });

  it('accepts an appended changeEvent without touching the original approved values (append-only history)', () => {
    const doc = validDoc({ stopLoss: 2900, takeProfit: 3200 });
    doc.changeEvents.push({
      previousState: 'HOLD', newState: 'EXIT',
      reason: "The AI's outlook flipped.", evidence: { rsi: 78 },
    });
    const err = doc.validateSync();
    expect(err).toBeUndefined();
    expect(doc.changeEvents).toHaveLength(1);
    expect(doc.changeEvents[0].newState).toBe('EXIT');
    // Original plan untouched by adding a change event.
    expect(doc.entry).toBe(3000);
    expect(doc.stopLoss).toBe(2900);
  });

  it('rejects a changeEvent missing the required newState or reason', () => {
    const doc = validDoc();
    doc.changeEvents.push({ previousState: 'HOLD' });
    const err = doc.validateSync();
    expect(err).toBeDefined();
  });
});
