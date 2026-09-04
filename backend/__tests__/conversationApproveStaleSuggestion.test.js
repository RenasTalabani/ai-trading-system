/**
 * Regression suite for the RENO chat approvePlan() stale-suggestion-identity
 * mismatch bug (2026-09-04, overnight continuous-improvement pass) — the
 * exact same shape of bug just fixed in guideController.approve()
 * (backend/__tests__/guideApproveStaleSuggestion.test.js), but for RENO's
 * chat "Approve" button instead of Guide's screen.
 *
 * Bug: conversationService.approvePlan() calls resolveSuggestion() a SECOND
 * time, independently of whatever `get_suggestion` tool call rendered the
 * opportunity card the user is looking at in the chat transcript. Between
 * that render and the tap, resolveSuggestion() can legitimately return a
 * different asset/direction (a fresher signal, the previous asset opened
 * elsewhere and excluded, the global-scan cache refreshing) — approving
 * would then silently open a paper position in something the user never
 * saw. A violation of decision #11's informed-approval intent.
 *
 * Fix: same soft, backward-compatible identity check as guideController.
 * approve() — approvePlan(userId, clientAsset, clientAction) only checks
 * when both are supplied; the pre-existing conversationService.test.js
 * suite calls approvePlan('user1') with neither, so it is untouched.
 *
 * This suite mocks virtualTrackingService/guideController directly (lighter
 * than conversationService.test.js's real-approveSuggestion integration
 * style) specifically to isolate and prove the new identity check itself.
 */
jest.mock('../src/services/virtualTrackingService', () => ({
  approveSuggestion: jest.fn(async (params) => ({
    _id: 'trade1', asset: params.asset, direction: params.direction, sizeUsd: 42, origin: params.origin,
  })),
  getSummary: jest.fn(async () => ({})),
  getTrackRecordByAsset: jest.fn(async () => ({})),
  getWinLossBreakdown: jest.fn(async () => ({})),
}));
jest.mock('../src/controllers/guideController', () => ({
  resolveSuggestion: jest.fn(),
  buildPositionGuidance: jest.fn(),
}));
jest.mock('../src/services/binanceService', () => ({
  getAllCachedPrices: jest.fn(() => ({})),
  TRACKED_ASSETS: [],
}));
jest.mock('../src/services/aiService', () => ({}));

const { resolveSuggestion } = require('../src/controllers/guideController');
const { approveSuggestion } = require('../src/services/virtualTrackingService');
const ConversationThread  = require('../src/models/ConversationThread');
const ConversationMessage = require('../src/models/ConversationMessage');
const AIDecision   = require('../src/models/AIDecision');
const TradeThesis  = require('../src/models/TradeThesis');

let THREADS, MESSAGES;

function freshMocks() {
  THREADS = [];
  MESSAGES = [];
  ConversationThread.findOne = async ({ userId }) =>
    THREADS.find((t) => String(t.userId) === String(userId)) || null;
  ConversationThread.create = async (doc) => {
    const t = { ...doc, _id: 'thread_' + (THREADS.length + 1) };
    THREADS.push(t);
    return t;
  };
  ConversationThread.updateOne = async (filter, update) => {
    const t = THREADS.find((x) => x._id === filter._id);
    if (t) Object.assign(t, update);
  };
  ConversationMessage.create = async (doc) => {
    const m = { ...doc, _id: 'msg_' + (MESSAGES.length + 1), createdAt: new Date() };
    MESSAGES.push(m);
    return m;
  };
  AIDecision.findOne = () => ({ sort: () => ({ lean: async () => null }) });
  TradeThesis.create = async (doc) => ({ ...doc, _id: 'thesis1' });
}

function mockSuggestion(overrides) {
  return {
    asset: 'BTCUSDT', displayName: 'BTCUSDT', action: 'BUY', decision: 'BUY',
    entryPrice: 65000, stopLoss: 63000, takeProfit: 68000, atrAtEntry: null,
    confidence: 80, why: [], generatedAt: new Date(), timeframe: null,
    signalId: 'sig123', isOlderSignal: false,
    ...overrides,
  };
}

beforeEach(() => {
  freshMocks();
  approveSuggestion.mockClear();
  resolveSuggestion.mockClear();
});

describe('conversationService.approvePlan — rejects a stale/mismatched client-echoed plan', () => {
  test('matching asset/action proceeds to approve normally', async () => {
    resolveSuggestion.mockImplementation(async () => mockSuggestion());
    const conversationService = require('../src/services/conversationService');

    const result = await conversationService.approvePlan('user1', 'BTCUSDT', 'BUY');

    expect(result.success).toBe(true);
    expect(approveSuggestion).toHaveBeenCalledTimes(1);
  });

  test('mismatched asset is rejected with staleApproval and does NOT approve', async () => {
    // Server now resolves to a different asset than what the client says
    // it displayed -- simulating the plan having changed between the chat
    // card render and this tap.
    resolveSuggestion.mockImplementation(async () => mockSuggestion({ asset: 'ETHUSDT', action: 'SELL' }));
    const conversationService = require('../src/services/conversationService');

    const result = await conversationService.approvePlan('user1', 'BTCUSDT', 'BUY');

    expect(result.success).toBe(false);
    expect(result.staleApproval).toBe(true);
    expect(approveSuggestion).not.toHaveBeenCalled();
    expect(MESSAGES.some((m) => /changed since you last saw it/i.test(m.content))).toBe(true);
  });

  test('mismatched action alone (same asset, flipped direction) is also rejected', async () => {
    resolveSuggestion.mockImplementation(async () => mockSuggestion({ asset: 'BTCUSDT', action: 'SELL' }));
    const conversationService = require('../src/services/conversationService');

    const result = await conversationService.approvePlan('user1', 'BTCUSDT', 'BUY');

    expect(result.success).toBe(false);
    expect(result.staleApproval).toBe(true);
    expect(approveSuggestion).not.toHaveBeenCalled();
  });

  test('no client asset/action (the pre-existing call shape) skips the check entirely', async () => {
    resolveSuggestion.mockImplementation(async () => mockSuggestion());
    const conversationService = require('../src/services/conversationService');

    const result = await conversationService.approvePlan('user1');

    expect(result.success).toBe(true);
    expect(approveSuggestion).toHaveBeenCalledTimes(1);
  });
});
