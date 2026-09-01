/**
 * RENO Phase 1, step 3 (2026-09-01) — tests for conversationService.js.
 * All Mongoose models are monkey-patched with in-memory fakes, matching
 * this repo's existing convention (see virtualTrackingService.test.js) —
 * no real DB connection, no real network call to any LLM provider.
 */

describe('conversationService', () => {
  let ConversationThread, ConversationMessage, VirtualTrade;
  let THREADS, MESSAGES, OPEN_TRADES, CLOSED_TRADES;

  function freshMocks() {
    THREADS = [];
    MESSAGES = [];
    OPEN_TRADES = [];
    CLOSED_TRADES = [];

    ConversationThread.findOne = async ({ userId }) =>
      THREADS.find(t => String(t.userId) === String(userId)) || null;
    ConversationThread.create = async (doc) => {
      const t = { ...doc, _id: 'thread_' + (THREADS.length + 1) };
      THREADS.push(t);
      return t;
    };
    ConversationThread.updateOne = async (filter, update) => {
      const t = THREADS.find(x => x._id === filter._id);
      if (t) Object.assign(t, update);
    };

    function chain(arr) {
      return { sort: () => ({ limit: (n) => ({ lean: async () => arr.slice(0, n) }) }) };
    }
    ConversationMessage.find = ({ threadId }) => {
      const arr = MESSAGES.filter(m => m.threadId === threadId).slice().reverse();
      return chain(arr);
    };
    ConversationMessage.create = async (doc) => {
      const m = { ...doc, _id: 'msg_' + (MESSAGES.length + 1), createdAt: new Date() };
      MESSAGES.push(m);
      return m;
    };

    VirtualTrade.find = (query) => {
      if (query.status === 'open') return { sort: () => OPEN_TRADES };
      return { sort: () => ({ limit: (n) => ({ lean: async () => CLOSED_TRADES.slice(0, n) }) }) };
    };
  }

  beforeEach(() => {
    jest.resetModules();
    ConversationThread  = require('../src/models/ConversationThread');
    ConversationMessage = require('../src/models/ConversationMessage');
    VirtualTrade         = require('../src/models/VirtualTrade');
    freshMocks();
  });

  describe('when ANTHROPIC_API_KEY is not configured', () => {
    it('saves the user message, returns a clear not-set-up reply, and never calls the network', async () => {
      delete process.env.ANTHROPIC_API_KEY;
      jest.resetModules();
      // Re-require models against the same module registry the service will use.
      ConversationThread  = require('../src/models/ConversationThread');
      ConversationMessage = require('../src/models/ConversationMessage');
      VirtualTrade         = require('../src/models/VirtualTrade');
      freshMocks();

      jest.mock('axios');
      const axios = require('axios');
      axios.post = jest.fn();

      const svc = require('../src/services/conversationService');
      const reply = await svc.sendMessage('user1', 'buy gold');

      expect(axios.post).not.toHaveBeenCalled();
      expect(reply.role).toBe('assistant');
      expect(reply.content).toMatch(/not fully wired up/i);
      expect(MESSAGES.some(m => m.role === 'user' && m.content === 'buy gold')).toBe(true);
    });
  });

  describe('tool executors', () => {
    it('get_open_positions reports "no open positions" honestly when there are none', async () => {
      process.env.ANTHROPIC_API_KEY = 'test-key';
      jest.resetModules();
      ConversationThread  = require('../src/models/ConversationThread');
      ConversationMessage = require('../src/models/ConversationMessage');
      VirtualTrade         = require('../src/models/VirtualTrade');
      freshMocks();

      const svc = require('../src/services/conversationService');
      const result = await svc.TOOL_EXECUTORS.get_open_positions();

      expect(result.positions).toEqual([]);
      expect(result.message).toMatch(/no open positions/i);
    });

    it('get_recent_trade_outcomes returns only real, closed-trade fields sourced from VirtualTrade', async () => {
      process.env.ANTHROPIC_API_KEY = 'test-key';
      jest.resetModules();
      ConversationThread  = require('../src/models/ConversationThread');
      ConversationMessage = require('../src/models/ConversationMessage');
      VirtualTrade         = require('../src/models/VirtualTrade');
      freshMocks();
      CLOSED_TRADES = [
        { asset: 'XAUUSD', direction: 'BUY', result: 'win', exitReason: 'TP', pnl: 42.5, pnlPct: 3.1, entryPrice: 2000, exitPrice: 2062, openedAt: new Date('2026-08-30'), closedAt: new Date('2026-08-31') },
      ];

      const svc = require('../src/services/conversationService');
      const result = await svc.TOOL_EXECUTORS.get_recent_trade_outcomes({ limit: 5 });

      expect(result.trades).toHaveLength(1);
      expect(result.trades[0]).toMatchObject({ asset: 'XAUUSD', result: 'win', pnl: 42.5, exitReason: 'TP' });
    });
  });


    it('get_suggestion returns the honest "no strong recommendation" message when nothing qualifies (no global-scan cache, no active signal)', async () => {
      process.env.ANTHROPIC_API_KEY = 'test-key';
      jest.resetModules();
      ConversationThread  = require('../src/models/ConversationThread');
      ConversationMessage = require('../src/models/ConversationMessage');
      VirtualTrade         = require('../src/models/VirtualTrade');
      freshMocks();
      VirtualTrade.distinct = async () => [];
      const Signal = require('../src/models/Signal');
      Signal.findOne = () => ({ sort: async () => null });

      const svc = require('../src/services/conversationService');
      const result = await svc.TOOL_EXECUTORS.get_suggestion();

      expect(result.message).toMatch(/no strong recommendation/i);
    });

    it('get_suggestion returns a real signal-sourced suggestion end to end when one exists, unmodified from resolveSuggestion', async () => {
      process.env.ANTHROPIC_API_KEY = 'test-key';
      jest.resetModules();
      ConversationThread  = require('../src/models/ConversationThread');
      ConversationMessage = require('../src/models/ConversationMessage');
      VirtualTrade         = require('../src/models/VirtualTrade');
      freshMocks();
      VirtualTrade.distinct = async () => [];
      const Signal = require('../src/models/Signal');
      const fakeSignal = {
        asset: 'ETHUSDT', direction: 'BUY', confidence: 82,
        price: { entry: 3000, stopLoss: 2900, takeProfit: 3200 },
        createdAt: new Date(), sources: {},
      };
      Signal.findOne = () => ({ sort: async () => fakeSignal });

      const svc = require('../src/services/conversationService');
      const result = await svc.TOOL_EXECUTORS.get_suggestion();

      expect(result.asset).toBe('ETHUSDT');
      expect(result.action).toBe('BUY');
      expect(result.confidence).toBe(82);
      expect(result.entryPrice).toBe(3000);
    });

    it('get_portfolio_summary returns real, unmodified numbers from virtualTrackingService.getSummary', async () => {
      process.env.ANTHROPIC_API_KEY = 'test-key';
      jest.resetModules();
      ConversationThread  = require('../src/models/ConversationThread');
      ConversationMessage = require('../src/models/ConversationMessage');
      VirtualTrade         = require('../src/models/VirtualTrade');
      freshMocks();
      const VirtualPortfolio = require('../src/models/VirtualPortfolio');
      VirtualPortfolio.findOne = async () => ({
        startingBalance: 500, currentBalance: 587.34, riskPerTradePct: 5,
        maxDrawdown: 4.2, peakBalance: 610, bestTrade: null, worstTrade: null,
        balanceHistory: [], startedAt: null, updatedAt: null,
      });
      VirtualTrade.find = (query) => {
        if (query.status && query.status.$in) return { lean: async () => [] };
        return { sort: () => OPEN_TRADES };
      };
      VirtualTrade.countDocuments = async () => 2;

      const svc = require('../src/services/conversationService');
      const result = await svc.TOOL_EXECUTORS.get_portfolio_summary();

      expect(result.currentBalance).toBe(587.34);
      expect(result.startingBalance).toBe(500);
      expect(result.openTrades).toBe(2);
    });

  describe('getThread', () => {
    it('creates a thread on first access and returns it with an empty message list', async () => {
      process.env.ANTHROPIC_API_KEY = 'test-key';
      jest.resetModules();
      ConversationThread  = require('../src/models/ConversationThread');
      ConversationMessage = require('../src/models/ConversationMessage');
      VirtualTrade         = require('../src/models/VirtualTrade');
      freshMocks();

      const svc = require('../src/services/conversationService');
      const { thread, messages } = await svc.getThread('user1');

      expect(thread.userId).toBe('user1');
      expect(messages).toEqual([]);
      expect(THREADS).toHaveLength(1);
    });
  });
});
