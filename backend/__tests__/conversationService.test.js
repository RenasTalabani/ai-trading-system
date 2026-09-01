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

  describe('approvePlan — Phase 2 (2026-09-01), approving a trade plan from RENO chat', () => {
    // Fire-and-forget push notification inside the real approveSuggestion()
    // path -- mocked the same way virtualTrackingService.test.js does, so
    // this suite never opens a real Mongoose/Firebase handle.
    jest.mock('../src/services/notificationService', () => ({
      sendTradeOpenedNotification: jest.fn(async () => {}),
      sendTradeClosedNotification: jest.fn(async () => {}),
    }));

    it('replies honestly and does not open a trade when no suggestion is available', async () => {
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
      const result = await svc.approvePlan('user1');

      expect(result.success).toBe(false);
      expect(result.message).toMatch(/no suggestion available/i);
      expect(MESSAGES.some(m => /no suggestion available/i.test(m.content))).toBe(true);
    });

    it('never trusts client-supplied trade parameters — approves exactly the server-resolved suggestion (T-071 parity) and tags origin "conversation_approval"', async () => {
      process.env.ANTHROPIC_API_KEY = 'test-key';
      jest.resetModules();
      ConversationThread  = require('../src/models/ConversationThread');
      ConversationMessage = require('../src/models/ConversationMessage');
      VirtualTrade         = require('../src/models/VirtualTrade');
      freshMocks();
      VirtualTrade.distinct = async () => [];

      const Signal = require('../src/models/Signal');
      const fakeSignal = {
        _id: 'sig_eth1', asset: 'ETHUSDT', direction: 'BUY', confidence: 82,
        price: { entry: 3000, stopLoss: 2900, takeProfit: 3200 },
        createdAt: new Date(), sources: {},
      };
      Signal.findOne = () => ({ sort: async () => fakeSignal });

      // approveSuggestion() (real, unmocked) needs its own underlying models wired.
      const VirtualPortfolio = require('../src/models/VirtualPortfolio');
      VirtualPortfolio.findOne = async () => ({
        currentBalance: 1000, riskPerTradePct: 5, startedAt: new Date(),
        save: async () => {}, totalProfit: 0, totalLoss: 0, winCount: 0, lossCount: 0,
        peakBalance: 1000, maxDrawdown: 0, bestTrade: null, worstTrade: null, balanceHistory: [],
      });
      const BudgetSession = require('../src/models/BudgetSession');
      BudgetSession.findOne = async () => ({ status: 'active' });
      VirtualTrade.findOne = async () => null; // no already-open ETHUSDT position
      VirtualTrade.create  = async (doc) => ({ ...doc, _id: 'newtrade1' });

      const TradeThesis = require('../src/models/TradeThesis');
      const CREATED_THESES = [];
      TradeThesis.create = async (doc) => { CREATED_THESES.push(doc); return { ...doc, _id: 'thesis1' }; };

      const svc = require('../src/services/conversationService');
      const result = await svc.approvePlan('user1');

      expect(result.success).toBe(true);
      expect(result.trade.asset).toBe('ETHUSDT');
      expect(result.trade.direction).toBe('BUY');
      expect(result.trade.entryPrice).toBe(3000);
      expect(result.trade.origin).toBe('conversation_approval');
      expect(result.reply.relatedTradeIds).toEqual(['newtrade1']);
      expect(result.reply.content).toMatch(/bought/i);

      // Phase 3, step 2: a TradeThesis was persisted with real, server-
      // resolved values -- never anything a client/LLM could have supplied.
      expect(CREATED_THESES).toHaveLength(1);
      const thesis = CREATED_THESES[0];
      expect(thesis.tradeId).toBe('newtrade1');
      expect(thesis.asset).toBe('ETHUSDT');
      expect(thesis.entry).toBe(3000);
      expect(thesis.originalRecommendation).toBe('BUY');
      expect(thesis.approvedByUser).toBe(true);
      expect(thesis.invalidationConditions).toMatch(/ETHUSDT/);
      expect(thesis.supportingMarketFactors.confidence).toBe(82);
    });

    it('does not lose the approval when persisting the trade thesis fails -- logged and swallowed, trade still reported as opened', async () => {
      process.env.ANTHROPIC_API_KEY = 'test-key';
      jest.resetModules();
      ConversationThread  = require('../src/models/ConversationThread');
      ConversationMessage = require('../src/models/ConversationMessage');
      VirtualTrade         = require('../src/models/VirtualTrade');
      freshMocks();
      VirtualTrade.distinct = async () => [];

      const Signal = require('../src/models/Signal');
      const fakeSignal = {
        _id: 'sig_eth2', asset: 'ETHUSDT', direction: 'BUY', confidence: 82,
        price: { entry: 3000, stopLoss: 2900, takeProfit: 3200 },
        createdAt: new Date(), sources: {},
      };
      Signal.findOne = () => ({ sort: async () => fakeSignal });

      const VirtualPortfolio = require('../src/models/VirtualPortfolio');
      VirtualPortfolio.findOne = async () => ({
        currentBalance: 1000, riskPerTradePct: 5, startedAt: new Date(),
        save: async () => {}, totalProfit: 0, totalLoss: 0, winCount: 0, lossCount: 0,
        peakBalance: 1000, maxDrawdown: 0, bestTrade: null, worstTrade: null, balanceHistory: [],
      });
      const BudgetSession = require('../src/models/BudgetSession');
      BudgetSession.findOne = async () => ({ status: 'active' });
      VirtualTrade.findOne = async () => null;
      VirtualTrade.create  = async (doc) => ({ ...doc, _id: 'newtrade2' });

      const TradeThesis = require('../src/models/TradeThesis');
      TradeThesis.create = async () => { throw new Error('simulated write failure'); };

      const svc = require('../src/services/conversationService');
      const result = await svc.approvePlan('user1');

      expect(result.success).toBe(true);
      expect(result.trade.asset).toBe('ETHUSDT');
    });

    it('reports the real rejection reason (e.g. already-open position) rather than a generic failure', async () => {
      process.env.ANTHROPIC_API_KEY = 'test-key';
      jest.resetModules();
      ConversationThread  = require('../src/models/ConversationThread');
      ConversationMessage = require('../src/models/ConversationMessage');
      VirtualTrade         = require('../src/models/VirtualTrade');
      freshMocks();
      VirtualTrade.distinct = async () => [];

      const Signal = require('../src/models/Signal');
      const fakeSignal = {
        _id: 'sig_eth1', asset: 'ETHUSDT', direction: 'BUY', confidence: 82,
        price: { entry: 3000, stopLoss: 2900, takeProfit: 3200 },
        createdAt: new Date(), sources: {},
      };
      Signal.findOne = () => ({ sort: async () => fakeSignal });

      const VirtualPortfolio = require('../src/models/VirtualPortfolio');
      VirtualPortfolio.findOne = async () => ({
        currentBalance: 1000, riskPerTradePct: 5, startedAt: new Date(),
        save: async () => {}, totalProfit: 0, totalLoss: 0, winCount: 0, lossCount: 0,
        peakBalance: 1000, maxDrawdown: 0, bestTrade: null, worstTrade: null, balanceHistory: [],
      });
      const BudgetSession = require('../src/models/BudgetSession');
      BudgetSession.findOne = async () => ({ status: 'active' });
      VirtualTrade.findOne = async () => ({ _id: 'already1', asset: 'ETHUSDT', status: 'open' });

      const svc = require('../src/services/conversationService');
      const result = await svc.approvePlan('user1');

      expect(result.success).toBe(false);
      expect(result.message).toMatch(/already have an open/i);
    });
  });

  describe('get_track_record — Phase 2, step 3 (2026-09-01)', () => {
    it('reports the honest "no closed trades" message when the account has none', async () => {
      process.env.ANTHROPIC_API_KEY = 'test-key';
      jest.resetModules();
      ConversationThread  = require('../src/models/ConversationThread');
      ConversationMessage = require('../src/models/ConversationMessage');
      VirtualTrade         = require('../src/models/VirtualTrade');
      freshMocks();
      VirtualTrade.find = (query) => {
        if (query.status && query.status.$in) return { lean: async () => [] };
        return { sort: () => OPEN_TRADES };
      };

      const svc = require('../src/services/conversationService');
      const result = await svc.TOOL_EXECUTORS.get_track_record({});

      expect(result.message).toMatch(/no closed trades/i);
    });

    it('returns a real, unmodified per-asset breakdown sourced from virtualTrackingService.getTrackRecordByAsset', async () => {
      process.env.ANTHROPIC_API_KEY = 'test-key';
      jest.resetModules();
      ConversationThread  = require('../src/models/ConversationThread');
      ConversationMessage = require('../src/models/ConversationMessage');
      VirtualTrade         = require('../src/models/VirtualTrade');
      freshMocks();
      VirtualTrade.find = (query) => {
        if (query.status && query.status.$in) {
          return {
            lean: async () => [
              { asset: 'BTCUSDT', status: 'closed_profit', result: 'win',  pnl: 10 },
              { asset: 'BTCUSDT', status: 'closed_loss',   result: 'loss', pnl: -4 },
              { asset: 'XAUUSD',  status: 'closed_profit', result: 'win',  pnl: 50 },
            ],
          };
        }
        return { sort: () => OPEN_TRADES };
      };

      const svc = require('../src/services/conversationService');
      const result = await svc.TOOL_EXECUTORS.get_track_record({});

      const btc = result.perAsset.find(a => a.asset === 'BTCUSDT');
      expect(btc.totalTrades).toBe(2);
      expect(btc.totalPnl).toBe(6);
      const gold = result.perAsset.find(a => a.asset === 'XAUUSD');
      expect(gold.winRate).toBe(100);
    });

    it('filters to a single asset when asked, and reports honestly when that asset has no closed trades', async () => {
      process.env.ANTHROPIC_API_KEY = 'test-key';
      jest.resetModules();
      ConversationThread  = require('../src/models/ConversationThread');
      ConversationMessage = require('../src/models/ConversationMessage');
      VirtualTrade         = require('../src/models/VirtualTrade');
      freshMocks();
      VirtualTrade.find = (query) => {
        if (query.status && query.status.$in) {
          return { lean: async () => [{ asset: 'BTCUSDT', status: 'closed_profit', result: 'win', pnl: 10 }] };
        }
        return { sort: () => OPEN_TRADES };
      };

      const svc = require('../src/services/conversationService');

      const found = await svc.TOOL_EXECUTORS.get_track_record({ asset: 'btcusdt' });
      expect(found.asset).toBe('BTCUSDT');
      expect(found.totalTrades).toBe(1);

      const notFound = await svc.TOOL_EXECUTORS.get_track_record({ asset: 'ETHUSDT' });
      expect(notFound.message).toMatch(/no closed trades for ETHUSDT/i);
    });
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
