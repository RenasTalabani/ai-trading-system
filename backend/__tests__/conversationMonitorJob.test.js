/**
 * Phase 2, step 2 (2026-09-01) — tests for conversationMonitorJob.js.
 * Updated in Phase 3, step 3 (RENO-012, 2026-09-01) for the 4-state RENO
 * recommendation model (buildRenoRecommendation()) replacing the old
 * binary HOLD/SELL flip detection, the renamed state-specific proactive
 * triggers ('recommendation_exit' / 'recommendation_take_profit' /
 * 'recommendation_extend' / 'data_unavailable', replacing the old single
 * 'position_flip'), and TradeThesis changeEvent recording.
 *
 * Same in-memory-fake convention as the rest of this repo's test suite
 * (see virtualTrackingService.test.js / conversationService.test.js) —
 * no real DB connection, no real network call.
 */

jest.mock('../src/services/binanceService', () => ({
  getAllCachedPrices: jest.fn(() => ({})),
  TRACKED_ASSETS: [],
  getSymbolStatus: jest.fn(async () => null),
}));
jest.mock('../src/services/aiService', () => ({
  getPrice: jest.fn(async () => null),
}));

describe('conversationMonitorJob', () => {
  let VirtualTrade, Signal, ConversationThread, ConversationMessage, TradeThesis, binanceService;
  let OPEN_TRADES, MESSAGES, THREADS;

  function freshMocks() {
    OPEN_TRADES = [];
    MESSAGES = [];
    THREADS = [{ _id: 'thread1', userId: 'user1' }];

    VirtualTrade.find = async (query) => {
      if (query.status === 'open') return OPEN_TRADES;
      return [];
    };
    VirtualTrade.findById = (id) => ({
      lean: async () => CLOSED_TRADE_LOOKUP[id] || null,
    });

    Signal.find = () => ({ sort: async () => [] });

    ConversationMessage.find = ({ relatedTradeIds }) => ({
      distinct: async (field) => {
        const tid = String(relatedTradeIds);
        return MESSAGES
          .filter(m => (m.relatedTradeIds || []).some(t => String(t) === tid))
          .map(m => m[field]);
      },
    });
    ConversationMessage.create = async (doc) => {
      const m = { ...doc, _id: 'msg_' + (MESSAGES.length + 1), createdAt: new Date() };
      MESSAGES.push(m);
      return m;
    };
    ConversationThread.updateOne = async () => {};

    // No thesis by default -- _recordChangeEvent() is a documented no-op
    // when a trade has no linked TradeThesis (e.g. Guide-approved trades).
    TradeThesis.findOne = async () => null;

    binanceService.getAllCachedPrices.mockReturnValue({});
    binanceService.getSymbolStatus.mockResolvedValue(null);
  }

  let CLOSED_TRADE_LOOKUP;

  function openTrade(overrides = {}) {
    return {
      _id: 'trade1', asset: 'ETHUSDT', direction: 'BUY', entryPrice: 100,
      sizeUsd: 50, status: 'open', openedAt: new Date(), stopLoss: 90, takeProfit: 120,
      ...overrides,
    };
  }

  beforeEach(() => {
    jest.resetModules();
    VirtualTrade         = require('../src/models/VirtualTrade');
    Signal                = require('../src/models/Signal');
    ConversationThread    = require('../src/models/ConversationThread');
    ConversationMessage   = require('../src/models/ConversationMessage');
    TradeThesis            = require('../src/models/TradeThesis');
    binanceService         = require('../src/services/binanceService');
    CLOSED_TRADE_LOOKUP    = {};
    freshMocks();
  });

  it('does nothing when there are no open trades and nothing was previously tracked', async () => {
    const job = require('../src/jobs/conversationMonitorJob');
    job._resetStateForTests();
    await job.runConversationMonitor();
    expect(MESSAGES).toHaveLength(0);
  });

  it('never posts an alert on the very first cycle a trade is seen (no prior state to compare against)', async () => {
    binanceService.getAllCachedPrices.mockReturnValue({ ETHUSDT: { price: 105 } }); // modest unrealized gain, still HOLD
    OPEN_TRADES = [openTrade()];
    MESSAGES = [{ threadId: 'thread1', relatedTradeIds: ['trade1'] }]; // thread has discussed this trade

    const job = require('../src/jobs/conversationMonitorJob');
    job._resetStateForTests();
    await job.runConversationMonitor();

    // Only the pre-seeded MESSAGES entry should exist — no proactive message added yet.
    expect(MESSAGES).toHaveLength(1);
  });

  it('posts an EXIT alert only to threads that have actually discussed the trade, never a blind broadcast', async () => {
    OPEN_TRADES = [openTrade()];
    MESSAGES = []; // no thread has discussed this trade at all

    const job = require('../src/jobs/conversationMonitorJob');
    job._resetStateForTests();

    binanceService.getAllCachedPrices.mockReturnValue({ ETHUSDT: { price: 105 } });
    await job.runConversationMonitor(); // cycle 1 — warms state at HOLD, no signal contradiction yet

    // Force a move to EXIT via a contradicting active signal on cycle 2.
    Signal.find = () => ({
      sort: async () => [{ asset: 'ETHUSDT', status: 'active', direction: 'SELL' }],
    });
    await job.runConversationMonitor(); // cycle 2 — recommendation should move to EXIT

    // No thread ever referenced trade1, so nothing should have been posted.
    expect(MESSAGES).toHaveLength(0);
  });

  it('posts an EXIT alert with real, tool-sourced P&L into a thread that previously discussed the trade, and records the change event on its thesis', async () => {
    OPEN_TRADES = [openTrade()];
    MESSAGES = [{ threadId: 'thread1', relatedTradeIds: ['trade1'] }];

    const thesis = { tradeId: 'trade1', changeEvents: [], save: async function () {} };
    TradeThesis.findOne = async ({ tradeId }) => (tradeId === 'trade1' ? thesis : null);

    const job = require('../src/jobs/conversationMonitorJob');
    job._resetStateForTests();

    binanceService.getAllCachedPrices.mockReturnValue({ ETHUSDT: { price: 110 } });
    Signal.find = () => ({ sort: async () => [] });
    await job.runConversationMonitor(); // cycle 1 — warms state at HOLD

    Signal.find = () => ({
      sort: async () => [{ asset: 'ETHUSDT', status: 'active', direction: 'SELL' }],
    });
    await job.runConversationMonitor(); // cycle 2 — moves to EXIT

    const posted = MESSAGES.find(m => m.proactiveTrigger === 'recommendation_exit');
    expect(posted).toBeTruthy();
    expect(posted.threadId).toBe('thread1');
    expect(posted.content).toMatch(/paper P&L, not yet realized/i);
    expect(posted.content).toMatch(/ETHUSDT/);

    // The trade's TradeThesis got a real append-only change event, not a rewrite.
    expect(thesis.changeEvents).toHaveLength(1);
    expect(thesis.changeEvents[0].newState).toBe('EXIT');
    expect(thesis.changeEvents[0].previousState).toBe('HOLD');
    expect(typeof thesis.changeEvents[0].reason).toBe('string');
  });

  it('posts a TAKE_PROFIT alert once price reaches the original target', async () => {
    OPEN_TRADES = [openTrade()]; // entry 100, takeProfit 120
    MESSAGES = [{ threadId: 'thread1', relatedTradeIds: ['trade1'] }];

    const job = require('../src/jobs/conversationMonitorJob');
    job._resetStateForTests();

    binanceService.getAllCachedPrices.mockReturnValue({ ETHUSDT: { price: 105 } }); // 25% progress -> HOLD
    await job.runConversationMonitor(); // cycle 1 — warms state at HOLD

    binanceService.getAllCachedPrices.mockReturnValue({ ETHUSDT: { price: 119 } }); // 95% progress -> TAKE_PROFIT
    await job.runConversationMonitor(); // cycle 2

    const posted = MESSAGES.find(m => m.proactiveTrigger === 'recommendation_take_profit');
    expect(posted).toBeTruthy();
    expect(posted.content).toMatch(/target/i);
  });

  it('posts an EXTEND alert once price is well past halfway to target with momentum still intact', async () => {
    OPEN_TRADES = [openTrade()]; // entry 100, takeProfit 120
    MESSAGES = [{ threadId: 'thread1', relatedTradeIds: ['trade1'] }];

    const job = require('../src/jobs/conversationMonitorJob');
    job._resetStateForTests();

    binanceService.getAllCachedPrices.mockReturnValue({ ETHUSDT: { price: 105 } }); // 25% progress -> HOLD
    await job.runConversationMonitor(); // cycle 1 — warms state at HOLD

    binanceService.getAllCachedPrices.mockReturnValue({ ETHUSDT: { price: 112 } }); // 60% progress, no contradicting signal -> EXTEND
    await job.runConversationMonitor(); // cycle 2

    const posted = MESSAGES.find(m => m.proactiveTrigger === 'recommendation_extend');
    expect(posted).toBeTruthy();
    expect(posted.content).toMatch(/halfway/i);
  });

  it('posts a data-unavailable alert (never silently HOLD) when a tracked asset goes halted', async () => {
    OPEN_TRADES = [openTrade()];
    MESSAGES = [{ threadId: 'thread1', relatedTradeIds: ['trade1'] }];
    binanceService.TRACKED_ASSETS.push('ETHUSDT');

    const job = require('../src/jobs/conversationMonitorJob');
    job._resetStateForTests();

    binanceService.getAllCachedPrices.mockReturnValue({ ETHUSDT: { price: 105 } });
    await job.runConversationMonitor(); // cycle 1 — warms state at HOLD

    binanceService.getAllCachedPrices.mockReturnValue({}); // no cached price at all
    binanceService.getSymbolStatus.mockResolvedValue('HALT'); // confirmed halt, not just a transient gap
    await job.runConversationMonitor(); // cycle 2 — should move to INSUFFICIENT_DATA

    const posted = MESSAGES.find(m => m.proactiveTrigger === 'data_unavailable');
    expect(posted).toBeTruthy();
    expect(posted.content).toMatch(/halted/i);
    expect(posted.content).not.toMatch(/\bhold\b/i); // never dressed up as an ordinary HOLD update
  });

  it('posts a real close notification (real pnl/exitReason from the trade document) once a tracked trade disappears from the open list, and records a final CLOSED change event', async () => {
    OPEN_TRADES = [openTrade()];
    MESSAGES = [{ threadId: 'thread1', relatedTradeIds: ['trade1'] }];
    CLOSED_TRADE_LOOKUP = {
      trade1: {
        _id: 'trade1', asset: 'ETHUSDT', direction: 'BUY', status: 'closed_profit',
        result: 'win', exitReason: 'TP', pnl: 12.5, pnlPct: 25,
      },
    };
    const thesis = { tradeId: 'trade1', changeEvents: [], save: async function () {} };
    TradeThesis.findOne = async ({ tradeId }) => (tradeId === 'trade1' ? thesis : null);

    const job = require('../src/jobs/conversationMonitorJob');
    job._resetStateForTests();

    binanceService.getAllCachedPrices.mockReturnValue({ ETHUSDT: { price: 105 } });
    await job.runConversationMonitor(); // cycle 1 — trade is open, state warmed

    OPEN_TRADES = []; // trade closed between cycles
    await job.runConversationMonitor(); // cycle 2 — should detect the close

    const posted = MESSAGES.find(m => m.proactiveTrigger === 'position_closed');
    expect(posted).toBeTruthy();
    expect(posted.threadId).toBe('thread1');
    expect(posted.content).toMatch(/\$12\.50/);
    expect(posted.content).toMatch(/\+25%/);
    expect(posted.content).toMatch(/TP/);
    expect(posted.content).toMatch(/closed in profit/i);

    expect(thesis.changeEvents).toHaveLength(1);
    expect(thesis.changeEvents[0].newState).toBe('CLOSED');
  });

  it('never invents a close notification for a trade no thread ever discussed', async () => {
    OPEN_TRADES = [openTrade()];
    MESSAGES = []; // never discussed
    CLOSED_TRADE_LOOKUP = {
      trade1: { _id: 'trade1', asset: 'ETHUSDT', direction: 'BUY', status: 'closed_profit', result: 'win', exitReason: 'TP', pnl: 12.5, pnlPct: 25 },
    };

    const job = require('../src/jobs/conversationMonitorJob');
    job._resetStateForTests();

    binanceService.getAllCachedPrices.mockReturnValue({ ETHUSDT: { price: 105 } });
    await job.runConversationMonitor();
    OPEN_TRADES = [];
    await job.runConversationMonitor();

    expect(MESSAGES).toHaveLength(0);
  });

  it('never lets a TradeThesis write failure block or lose the proactive chat notification', async () => {
    OPEN_TRADES = [openTrade()];
    MESSAGES = [{ threadId: 'thread1', relatedTradeIds: ['trade1'] }];
    TradeThesis.findOne = async () => { throw new Error('simulated DB error'); };

    const job = require('../src/jobs/conversationMonitorJob');
    job._resetStateForTests();

    binanceService.getAllCachedPrices.mockReturnValue({ ETHUSDT: { price: 105 } });
    Signal.find = () => ({ sort: async () => [] });
    await job.runConversationMonitor(); // cycle 1 — warms state at HOLD

    Signal.find = () => ({
      sort: async () => [{ asset: 'ETHUSDT', status: 'active', direction: 'SELL' }],
    });
    await job.runConversationMonitor(); // cycle 2 — EXIT alert should still post despite thesis write failing

    const posted = MESSAGES.find(m => m.proactiveTrigger === 'recommendation_exit');
    expect(posted).toBeTruthy();
  });
});
