/**
 * Phase 2, step 2 (2026-09-01) — tests for conversationMonitorJob.js.
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
  let VirtualTrade, Signal, ConversationThread, ConversationMessage, binanceService;
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

  it('never posts a flip alert on the very first cycle a trade is seen (no prior state to compare against)', async () => {
    binanceService.getAllCachedPrices.mockReturnValue({ ETHUSDT: { price: 80 } }); // below entry -> BUY at a loss, still HOLD (no RSI/contradiction signal)
    OPEN_TRADES = [openTrade()];
    MESSAGES = [{ threadId: 'thread1', relatedTradeIds: ['trade1'] }]; // thread has discussed this trade

    const job = require('../src/jobs/conversationMonitorJob');
    job._resetStateForTests();
    await job.runConversationMonitor();

    // Only the pre-seeded MESSAGES entry should exist — no proactive message added yet.
    expect(MESSAGES).toHaveLength(1);
  });

  it('posts a flip alert only to threads that have actually discussed the trade, never a blind broadcast', async () => {
    OPEN_TRADES = [openTrade()];
    MESSAGES = []; // no thread has discussed this trade at all

    const job = require('../src/jobs/conversationMonitorJob');
    job._resetStateForTests();

    binanceService.getAllCachedPrices.mockReturnValue({ ETHUSDT: { price: 100 } });
    await job.runConversationMonitor(); // cycle 1 — warms state, no signal contradiction yet

    // Force a flip to SELL via a contradicting active signal on cycle 2.
    Signal.find = () => ({
      sort: async () => [{ asset: 'ETHUSDT', status: 'active', direction: 'SELL' }],
    });
    await job.runConversationMonitor(); // cycle 2 — recommendation should flip to SELL

    // No thread ever referenced trade1, so nothing should have been posted.
    expect(MESSAGES).toHaveLength(0);
  });

  it('posts a flip alert with real, tool-sourced P&L into a thread that previously discussed the trade', async () => {
    OPEN_TRADES = [openTrade()];
    MESSAGES = [{ threadId: 'thread1', relatedTradeIds: ['trade1'] }];

    const job = require('../src/jobs/conversationMonitorJob');
    job._resetStateForTests();

    binanceService.getAllCachedPrices.mockReturnValue({ ETHUSDT: { price: 110 } });
    Signal.find = () => ({ sort: async () => [] });
    await job.runConversationMonitor(); // cycle 1 — warms state at HOLD

    Signal.find = () => ({
      sort: async () => [{ asset: 'ETHUSDT', status: 'active', direction: 'SELL' }],
    });
    await job.runConversationMonitor(); // cycle 2 — flips to SELL

    const posted = MESSAGES.find(m => m.proactiveTrigger === 'position_flip');
    expect(posted).toBeTruthy();
    expect(posted.threadId).toBe('thread1');
    expect(posted.content).toMatch(/paper P&L, not yet realized/i);
    expect(posted.content).toMatch(/ETHUSDT/);
  });

  it('posts a real close notification (real pnl/exitReason from the trade document) once a tracked trade disappears from the open list', async () => {
    OPEN_TRADES = [openTrade()];
    MESSAGES = [{ threadId: 'thread1', relatedTradeIds: ['trade1'] }];
    CLOSED_TRADE_LOOKUP = {
      trade1: {
        _id: 'trade1', asset: 'ETHUSDT', direction: 'BUY', status: 'closed_profit',
        result: 'win', exitReason: 'TP', pnl: 12.5, pnlPct: 25,
      },
    };

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
});
