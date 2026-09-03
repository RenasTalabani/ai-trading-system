/**
 * Regression suite for the paper-trading engine's core money-handling logic:
 * position sizing (the Kelly-inspired edge multiplier + the hard safety cap
 * added after a live-DB incident on 2026-08-09) and trade-closing math
 * (TP/SL/liquidation/trailing-stop). All Mongoose models are monkey-patched
 * with in-memory fakes -- this suite never opens a real database connection.
 */
const VirtualTrade     = require('../src/models/VirtualTrade');
const VirtualPortfolio = require('../src/models/VirtualPortfolio');
const Signal           = require('../src/models/Signal');
const BudgetSession    = require('../src/models/BudgetSession');
const RiskState        = require('../src/models/RiskState');

// Fire-and-forget push notifications aren't under test here and would otherwise
// try real Mongoose/Firebase calls against a connection that never exists in
// this suite, leaving an open handle after the run.
jest.mock('../src/services/notificationService', () => ({
  sendTradeClosedNotification: jest.fn(async () => {}),
  sendTradeOpenedNotification: jest.fn(async () => {}),
}));
const { sendTradeOpenedNotification } = require('../src/services/notificationService');

function chain(result) {
  return { sort: () => ({ limit: () => ({ lean: async () => result }) }) };
}

let FAKE_HISTORY, FAKE_PORTFOLIO, FAKE_SIGNAL, FAKE_OPEN_TRADES, CREATED_TRADES, UPDATE_CALLS, FAKE_RISK_STATE;

// riskStateService.checkAndMaybeHalt() (wired into approveSuggestion,
// openFuturesTrade and pickupNewSignals as of the safety-gate patch) hits
// RiskState.findOne/create and VirtualTrade.aggregate for real -- unmocked,
// Mongoose buffers the call forever with no live connection and every test
// that reaches it hangs to Jest's timeout instead of failing cleanly. Not a
// change to any safety-limit number or approval logic -- purely closing the
// same kind of in-memory-fake gap this suite already uses everywhere else.
function makeRiskState(overrides = {}) {
  const state = { riskKey: 'global', dailyLossHalted: false, haltReason: null, ...overrides };
  state.save = async () => state;
  return state;
}

beforeEach(() => {
  FAKE_HISTORY = [];
  FAKE_PORTFOLIO = null;
  FAKE_SIGNAL = null;
  FAKE_OPEN_TRADES = [];
  CREATED_TRADES = [];
  UPDATE_CALLS = [];
  FAKE_RISK_STATE = makeRiskState();

  VirtualTrade.find = (query) => {
    if (query.status && query.status.$in) return chain(FAKE_HISTORY.filter(t => t.asset === query.asset));
    if (query.status === 'open') return Promise.resolve(FAKE_OPEN_TRADES);
    return chain([]);
  };
  VirtualTrade.distinct = async () => [];
  VirtualTrade.findOne = async (query) =>
    FAKE_OPEN_TRADES.find(t =>
      (query.asset === undefined || t.asset === query.asset) &&
      (query._id   === undefined || t._id   === query._id) &&
      query.status === 'open'
    ) || null;
  VirtualTrade.insertMany = async (docs) => { CREATED_TRADES.push(...docs); return docs; };
  VirtualTrade.create = async (doc) => { CREATED_TRADES.push(doc); return { ...doc, _id: 'fake_' + CREATED_TRADES.length }; };
  VirtualTrade.updateOne = async (filter, update) => { UPDATE_CALLS.push({ filter, update }); };
  VirtualTrade.aggregate = async () => []; // riskStateService.checkAndMaybeHalt's daily-loss sum -- no losses by default

  VirtualPortfolio.findOne = async () => FAKE_PORTFOLIO;
  BudgetSession.findOne = async () => ({ status: 'active' });
  Signal.findById = async () => FAKE_SIGNAL;
  Signal.find = () => ({ sort: () => ({ limit: async () => (FAKE_SIGNAL ? [FAKE_SIGNAL] : []) }) });
  RiskState.findOne = async () => FAKE_RISK_STATE;
  RiskState.create = async () => FAKE_RISK_STATE;
});

// Required after the mocks are wired so the real module picks them up (module cache is shared).
const svc = require('../src/services/virtualTrackingService');

function historyDoc(asset, result, pnlPct) {
  return { asset, result, pnlPct, direction: 'BUY', entryPrice: 100, sizeUsd: 100 };
}
function makePortfolio(balance, riskPct) {
  return {
    currentBalance: balance, riskPerTradePct: riskPct, startedAt: new Date(), save: async () => {},
    totalProfit: 0, totalLoss: 0, winCount: 0, lossCount: 0,
    peakBalance: balance, maxDrawdown: 0, bestTrade: null, worstTrade: null,
    balanceHistory: [],
  };
}
function makeSignal(asset, overrides = {}) {
  return { _id: 'sig_' + asset, asset, direction: 'BUY', price: { entry: 100, stopLoss: 95, takeProfit: 110 }, ...overrides };
}
function openTrade(overrides = {}) {
  return {
    _id: 'trade1', asset: 'BTCUSDT', direction: 'BUY', entryPrice: 100,
    sizeUsd: 50, status: 'open', openedAt: new Date(),
    trailingStopEnabled: false, productType: 'spot',
    ...overrides,
  };
}

describe('capToMaxRisk — hard position-size ceiling', () => {
  test('amount under the cap passes through unchanged', () => {
    expect(svc.capToMaxRisk(50, 1000, 'x')).toBe(50);
  });
  test('amount over the cap is clamped to exactly MAX_POSITION_RISK_PCT of balance', () => {
    expect(svc.capToMaxRisk(900, 1000, 'x')).toBe(1000 * svc.MAX_POSITION_RISK_PCT / 100);
  });
  test('amount exactly at the cap passes through unchanged', () => {
    const ceiling = 1000 * svc.MAX_POSITION_RISK_PCT / 100;
    expect(svc.capToMaxRisk(ceiling, 1000, 'x')).toBe(ceiling);
  });
});

describe('getEdgeMultiplier — Kelly-inspired sizing edge cases', () => {
  test('defaults to 1.0 with fewer than MIN_TRADES_FOR_EDGE trades', async () => {
    FAKE_HISTORY = [historyDoc('X', 'win', 50), historyDoc('X', 'loss', 1)];
    expect(await svc.getEdgeMultiplier('X')).toBe(1.0);
  });

  test('defaults to 1.0 when there are zero losses (no payoff ratio computable)', async () => {
    FAKE_HISTORY = Array.from({ length: 15 }, () => historyDoc('X', 'win', 5));
    expect(await svc.getEdgeMultiplier('X')).toBe(1.0);
  });

  test('defaults to 1.0 when there are zero wins', async () => {
    FAKE_HISTORY = Array.from({ length: 15 }, () => historyDoc('X', 'loss', 3));
    expect(await svc.getEdgeMultiplier('X')).toBe(1.0);
  });

  test('floors at 0.5 for a genuinely bad edge', async () => {
    FAKE_HISTORY = [
      ...Array.from({ length: 5 },  () => historyDoc('X', 'win', 1)),
      ...Array.from({ length: 15 }, () => historyDoc('X', 'loss', 5)),
    ];
    expect(await svc.getEdgeMultiplier('X')).toBe(0.5);
  });

  test('stays within [0.5, 1.5] for a strong winning edge (practical ceiling ~1.25, per the Kelly formula)', async () => {
    FAKE_HISTORY = [
      ...Array.from({ length: 25 }, () => historyDoc('X', 'win', 20)),
      ...Array.from({ length: 5 },  () => historyDoc('X', 'loss', 1)),
    ];
    const mult = await svc.getEdgeMultiplier('X');
    expect(mult).toBeGreaterThanOrEqual(0.5);
    expect(mult).toBeLessThanOrEqual(1.5);
    expect(mult).toBeGreaterThan(1.0);
  });

  test('does not throw on missing/null pnlPct fields and still returns a bounded value', async () => {
    FAKE_HISTORY = [
      { asset: 'X', result: 'win' },
      { asset: 'X', result: 'loss', pnlPct: null },
      ...Array.from({ length: 10 }, () => historyDoc('X', 'win', 3)),
      ...Array.from({ length: 2 },  () => historyDoc('X', 'loss', 2)),
    ];
    const mult = await svc.getEdgeMultiplier('X');
    expect(mult).toBeGreaterThanOrEqual(0.5);
    expect(mult).toBeLessThanOrEqual(1.5);
  });
});

describe('pickupNewSignals — spot position sizing never exceeds the hard cap', () => {
  test('normal config (5% risk, no history) sizes at exactly 5%', async () => {
    FAKE_PORTFOLIO = makePortfolio(1000, 5);
    FAKE_SIGNAL = makeSignal('NORMAL');
    await svc.pickupNewSignals();
    expect(CREATED_TRADES[0].sizeUsd).toBe(50);
  });

  test('worst-case config (50% risk + max edge multiplier) is still capped at MAX_POSITION_RISK_PCT', async () => {
    FAKE_HISTORY = [
      ...Array.from({ length: 25 }, () => historyDoc('MAXRISK', 'win', 20)),
      ...Array.from({ length: 5 },  () => historyDoc('MAXRISK', 'loss', 1)),
    ];
    FAKE_PORTFOLIO = makePortfolio(1000, 50);
    FAKE_SIGNAL = makeSignal('MAXRISK');
    await svc.pickupNewSignals();
    const riskPct = (CREATED_TRADES[0].sizeUsd / FAKE_PORTFOLIO.currentBalance) * 100;
    expect(riskPct).toBeLessThanOrEqual(svc.MAX_POSITION_RISK_PCT + 1e-9);
  });

  test('tags the trade origin: "signal_auto_pickup" (T-074a — no human/HTTP request involved)', async () => {
    FAKE_PORTFOLIO = makePortfolio(1000, 5);
    FAKE_SIGNAL = makeSignal('NORMAL');
    await svc.pickupNewSignals();
    expect(CREATED_TRADES[0].origin).toBe('signal_auto_pickup');
  });
});

describe('approveSuggestion — Guide screen "Yes" tap opens a correctly-sized spot trade', () => {
  test('rejects a HOLD or invalid direction', async () => {
    FAKE_PORTFOLIO = makePortfolio(1000, 5);
    await expect(svc.approveSuggestion({ asset: 'X', direction: 'HOLD', entryPrice: 100 }))
      .rejects.toThrow();
  });

  test('rejects when entry price is missing', async () => {
    FAKE_PORTFOLIO = makePortfolio(1000, 5);
    await expect(svc.approveSuggestion({ asset: 'X', direction: 'BUY', entryPrice: null }))
      .rejects.toThrow();
  });

  test('opens a trade tagged source: "guide" at normal-config sizing', async () => {
    FAKE_PORTFOLIO = makePortfolio(1000, 5);
    const trade = await svc.approveSuggestion({ asset: 'X', direction: 'BUY', entryPrice: 100, stopLoss: 95, takeProfit: 110 });
    expect(trade.source).toBe('guide');
    expect(trade.sizeUsd).toBe(50); // 5% of $1000
  });

  test('persists the caller-supplied signalId/aiDecisionId onto the trade (regression: T-061, previously always dropped for source:"guide")', async () => {
    FAKE_PORTFOLIO = makePortfolio(1000, 5);
    const trade = await svc.approveSuggestion({
      asset: 'X', direction: 'BUY', entryPrice: 100,
      signalId: 'sig123', aiDecisionId: null,
    });
    expect(trade.signalId).toBe('sig123');
    expect(trade.aiDecisionId).toBeNull();
  });

  test('defaults signalId/aiDecisionId to null when the caller passes neither (backward compatible)', async () => {
    FAKE_PORTFOLIO = makePortfolio(1000, 5);
    const trade = await svc.approveSuggestion({ asset: 'X', direction: 'BUY', entryPrice: 100 });
    expect(trade.signalId).toBeNull();
    expect(trade.aiDecisionId).toBeNull();
  });

  test('notifies (in-app, BUG-004) that a new position was opened', async () => {
    FAKE_PORTFOLIO = makePortfolio(1000, 5);
    sendTradeOpenedNotification.mockClear();
    const trade = await svc.approveSuggestion({ asset: 'BTCUSDT', direction: 'BUY', entryPrice: 65000 });
    expect(sendTradeOpenedNotification).toHaveBeenCalledTimes(1);
    expect(sendTradeOpenedNotification).toHaveBeenCalledWith(trade);
  });

  test('worst-case config (50% risk + max edge multiplier) is still capped, same as every other path', async () => {
    FAKE_HISTORY = [
      ...Array.from({ length: 25 }, () => historyDoc('MAXRISK', 'win', 20)),
      ...Array.from({ length: 5 },  () => historyDoc('MAXRISK', 'loss', 1)),
    ];
    FAKE_PORTFOLIO = makePortfolio(1000, 50);
    const trade = await svc.approveSuggestion({ asset: 'MAXRISK', direction: 'BUY', entryPrice: 100 });
    const riskPct = (trade.sizeUsd / FAKE_PORTFOLIO.currentBalance) * 100;
    expect(riskPct).toBeLessThanOrEqual(svc.MAX_POSITION_RISK_PCT + 1e-9);
  });

  test('rejects approving the same asset twice while a position is already open (regression: 11 duplicate trades created via repeated taps in the Guide UI)', async () => {
    FAKE_PORTFOLIO = makePortfolio(1000, 5);
    FAKE_OPEN_TRADES = [openTrade({ asset: 'DUPTEST', status: 'open' })];
    await expect(svc.approveSuggestion({ asset: 'DUPTEST', direction: 'BUY', entryPrice: 100 }))
      .rejects.toThrow(/already/i);
    expect(CREATED_TRADES.length).toBe(0);
  });

  test('persists the caller-supplied atrAtEntry onto the trade, reused as-is (T-073)', async () => {
    FAKE_PORTFOLIO = makePortfolio(1000, 5);
    const trade = await svc.approveSuggestion({
      asset: 'X', direction: 'BUY', entryPrice: 100, stopLoss: 95, takeProfit: 110,
      atrAtEntry: 3.3333,
    });
    expect(trade.atrAtEntry).toBe(3.3333);
  });

  test('defaults atrAtEntry to null when the caller does not supply it (e.g. a Signal-sourced suggestion, which has no ATR data)', async () => {
    FAKE_PORTFOLIO = makePortfolio(1000, 5);
    const trade = await svc.approveSuggestion({ asset: 'X', direction: 'BUY', entryPrice: 100 });
    expect(trade.atrAtEntry).toBeNull();
  });

  test('tags the trade origin: "guide_approval" (T-074a)', async () => {
    FAKE_PORTFOLIO = makePortfolio(1000, 5);
    const trade = await svc.approveSuggestion({ asset: 'X', direction: 'BUY', entryPrice: 100 });
    expect(trade.origin).toBe('guide_approval');
  });

  test('Phase 2 (2026-09-01): a caller-supplied origin overrides the "guide_approval" default, e.g. conversationService.approvePlan() passing "conversation_approval"', async () => {
    FAKE_PORTFOLIO = makePortfolio(1000, 5);
    const trade = await svc.approveSuggestion({
      asset: 'X', direction: 'BUY', entryPrice: 100, origin: 'conversation_approval',
    });
    expect(trade.origin).toBe('conversation_approval');
  });
});

describe('previewSizeUsd — read-only sizing preview matches what approveSuggestion would actually charge', () => {
  test('preview amount equals the amount a real approval would size at', async () => {
    FAKE_PORTFOLIO = makePortfolio(1000, 5);
    const preview = await svc.previewSizeUsd('X');
    const trade = await svc.approveSuggestion({ asset: 'X', direction: 'BUY', entryPrice: 100 });
    expect(preview).toBe(trade.sizeUsd);
  });

  test('preview does not create any trade', async () => {
    FAKE_PORTFOLIO = makePortfolio(1000, 5);
    await svc.previewSizeUsd('X');
    expect(CREATED_TRADES.length).toBe(0);
  });
});

describe('openFuturesTrade — margin sizing never exceeds the hard cap', () => {
  test('worst-case config (50% risk + max edge multiplier, 5x leverage) margin is capped', async () => {
    FAKE_HISTORY = [
      ...Array.from({ length: 25 }, () => historyDoc('MAXRISK', 'win', 20)),
      ...Array.from({ length: 5 },  () => historyDoc('MAXRISK', 'loss', 1)),
    ];
    FAKE_PORTFOLIO = makePortfolio(1000, 50);
    FAKE_SIGNAL = makeSignal('MAXRISK');
    const trade = await svc.openFuturesTrade('sig_MAXRISK', 5);
    const riskPct = (trade.marginUsd / FAKE_PORTFOLIO.currentBalance) * 100;
    expect(riskPct).toBeLessThanOrEqual(svc.MAX_POSITION_RISK_PCT + 1e-9);
  });

  test('leverage is force-set to 1x regardless of what the caller requests (decision #13: leverage is banned, non-negotiable)', async () => {
    FAKE_PORTFOLIO = makePortfolio(1000, 5);
    FAKE_SIGNAL = makeSignal('LEVTEST');
    const tradeHigh = await svc.openFuturesTrade('sig_LEVTEST', 999);
    expect(tradeHigh.leverage).toBe(1);
    const tradeLow = await svc.openFuturesTrade('sig_LEVTEST', -5);
    expect(tradeLow.leverage).toBe(1);
  });

  test('liquidation price is null at the forced 1x leverage -- there is no margin-call scenario to compute (decision #13)', async () => {
    FAKE_PORTFOLIO = makePortfolio(1000, 5);
    FAKE_SIGNAL = makeSignal('LIQTEST', { direction: 'BUY' });
    const buyTrade = await svc.openFuturesTrade('sig_LIQTEST', 10);
    expect(buyTrade.liquidationPrice).toBeNull();

    FAKE_SIGNAL = makeSignal('LIQTEST', { direction: 'SELL' });
    const sellTrade = await svc.openFuturesTrade('sig_LIQTEST', 10);
    expect(sellTrade.liquidationPrice).toBeNull();
  });

  test('tags the trade origin: "futures_manual" (T-074a)', async () => {
    FAKE_PORTFOLIO = makePortfolio(1000, 5);
    FAKE_SIGNAL = makeSignal('ORIGINTEST');
    const trade = await svc.openFuturesTrade('sig_ORIGINTEST', 5);
    expect(trade.origin).toBe('futures_manual');
  });
});

describe('checkOpenTrades — TP/SL/liquidation closing logic', () => {
  test('BUY spot trade closes as a win at exactly the take-profit price', async () => {
    FAKE_PORTFOLIO = makePortfolio(1000, 5);
    FAKE_OPEN_TRADES = [openTrade({ direction: 'BUY', entryPrice: 100, takeProfit: 110, sizeUsd: 50 })];
    await svc.checkOpenTrades({ BTCUSDT: 115 }); // price overshoots TP -- exit should still be pinned at TP, not 115
    const closeCall = UPDATE_CALLS.find(c => c.update.status === 'closed_profit');
    expect(closeCall).toBeDefined();
    expect(closeCall.update.exitPrice).toBe(110);
    expect(closeCall.update.pnlPct).toBeCloseTo(10, 6);
    expect(closeCall.update.pnl).toBeCloseTo(5, 6); // 50 * 10%
    expect(FAKE_PORTFOLIO.currentBalance).toBeCloseTo(1005, 6);
    expect(FAKE_PORTFOLIO.winCount).toBe(1);
  });

  test('BUY spot trade closes as a loss at exactly the stop-loss price', async () => {
    FAKE_PORTFOLIO = makePortfolio(1000, 5);
    FAKE_OPEN_TRADES = [openTrade({ direction: 'BUY', entryPrice: 100, stopLoss: 95, sizeUsd: 50 })];
    await svc.checkOpenTrades({ BTCUSDT: 80 }); // price crashes well past SL
    const closeCall = UPDATE_CALLS.find(c => c.update.status === 'closed_loss');
    expect(closeCall.update.exitPrice).toBe(95);
    expect(closeCall.update.exitReason).toBe('SL');
  });

  test('SELL spot trade closes correctly on TP/SL (direction-inverted)', async () => {
    FAKE_PORTFOLIO = makePortfolio(1000, 5);
    FAKE_OPEN_TRADES = [openTrade({ direction: 'SELL', entryPrice: 100, takeProfit: 90, stopLoss: 105, sizeUsd: 50 })];
    await svc.checkOpenTrades({ BTCUSDT: 90 });
    const closeCall = UPDATE_CALLS.find(c => c.update.status === 'closed_profit');
    expect(closeCall.update.exitReason).toBe('TP');
    expect(closeCall.update.pnlPct).toBeCloseTo(10, 6);
  });

  test('futures liquidation takes priority over SL, and loss is floored at -marginUsd', async () => {
    FAKE_PORTFOLIO = makePortfolio(1000, 5);
    FAKE_OPEN_TRADES = [openTrade({
      direction: 'BUY', entryPrice: 100, stopLoss: 85, productType: 'futures',
      leverage: 10, marginUsd: 50, sizeUsd: 500, liquidationPrice: 90,
    })];
    await svc.checkOpenTrades({ BTCUSDT: 88 }); // below liquidation (90) but above SL (85)
    const closeCall = UPDATE_CALLS.find(c => c.update.exitReason === 'LIQUIDATED');
    expect(closeCall).toBeDefined();
    expect(closeCall.update.exitPrice).toBe(90);
    expect(closeCall.update.pnl).toBeCloseTo(-50, 6); // exactly -marginUsd, not more
    // Portfolio-level aggregate side effects also completed cleanly:
    expect(FAKE_PORTFOLIO.currentBalance).toBeCloseTo(950, 6);
    expect(FAKE_PORTFOLIO.lossCount).toBe(1);
    expect(FAKE_PORTFOLIO.balanceHistory.length).toBe(1);
  });

  test('trailing stop only tightens, never loosens, and never fires prematurely', async () => {
    FAKE_PORTFOLIO = makePortfolio(1000, 5);
    const trade = openTrade({
      direction: 'BUY', entryPrice: 100, stopLoss: 95, takeProfit: 200,
      trailingStopEnabled: true, trailingStopDistance: 3,
    });
    FAKE_OPEN_TRADES = [trade];
    await svc.checkOpenTrades({ BTCUSDT: 120 }); // favorable move: trailed stop = 120-3=117, improves on 95
    const slUpdate = UPDATE_CALLS.find(c => c.update.stopLoss !== undefined);
    expect(slUpdate.update.stopLoss).toBe(117);
    expect(trade.stopLoss).toBe(117); // in-memory doc mutated too, so a subsequent price check in the same run sees it
  });

  test('a trade with no matching price in the cache is left untouched', async () => {
    FAKE_PORTFOLIO = makePortfolio(1000, 5);
    FAKE_OPEN_TRADES = [openTrade({ asset: 'XAUUSD' })];
    await svc.checkOpenTrades({ BTCUSDT: 100 }); // no XAUUSD price in cache
    expect(UPDATE_CALLS.length).toBe(0);
  });

  test('a stale cached price (regression: T-027, 2026-08-18) is treated like no price at all -- never used to close a trade', async () => {
    FAKE_PORTFOLIO = makePortfolio(1000, 5);
    FAKE_OPEN_TRADES = [openTrade({ direction: 'BUY', entryPrice: 100, takeProfit: 110 })];
    // Object shape with a timestamp from 20 minutes ago -- well past the
    // 10-minute staleness threshold. Price itself (115) would clearly
    // trigger the take-profit if it were trusted.
    const staleTs = Date.now() - 20 * 60 * 1000;
    await svc.checkOpenTrades({ BTCUSDT: { price: 115, ts: staleTs } });
    expect(UPDATE_CALLS.length).toBe(0);
  });

  test('a fresh cached price (object shape, as production actually sends it) still closes trades normally', async () => {
    FAKE_PORTFOLIO = makePortfolio(1000, 5);
    FAKE_OPEN_TRADES = [openTrade({ direction: 'BUY', entryPrice: 100, takeProfit: 110 })];
    await svc.checkOpenTrades({ BTCUSDT: { price: 115, ts: Date.now() } });
    const closeCall = UPDATE_CALLS.find(c => c.update.status === 'closed_profit');
    expect(closeCall).toBeDefined();
    expect(closeCall.update.exitPrice).toBe(110);
  });
});

describe('getTrackRecordByAsset — Phase 2, step 3 (2026-09-01): per-asset real track record', () => {
  function closedTrade(asset, result, pnl) {
    return { asset, status: result === 'win' ? 'closed_profit' : 'closed_loss', result, pnl };
  }

  test('returns an empty breakdown when there are no closed trades', async () => {
    VirtualTrade.find = (query) => {
      if (query.status && query.status.$in) return { lean: async () => [] };
      return { sort: () => [] };
    };
    const result = await svc.getTrackRecordByAsset('all');
    expect(result.perAsset).toEqual([]);
  });

  test('computes correct win rate, total P&L, and average P&L per asset, sorted by trade count', async () => {
    VirtualTrade.find = (query) => {
      if (query.status && query.status.$in) {
        return {
          lean: async () => [
            closedTrade('BTCUSDT', 'win', 10),
            closedTrade('BTCUSDT', 'win', 20),
            closedTrade('BTCUSDT', 'loss', -5),
            closedTrade('XAUUSD',  'win', 50),
          ],
        };
      }
      return { sort: () => [] };
    };
    const result = await svc.getTrackRecordByAsset('all');

    const btc = result.perAsset.find(a => a.asset === 'BTCUSDT');
    expect(btc.totalTrades).toBe(3);
    expect(btc.wins).toBe(2);
    expect(btc.losses).toBe(1);
    expect(btc.winRate).toBeCloseTo(66.7, 1);
    expect(btc.totalPnl).toBe(25);
    expect(btc.avgPnl).toBeCloseTo(8.33, 2);

    const gold = result.perAsset.find(a => a.asset === 'XAUUSD');
    expect(gold.totalTrades).toBe(1);
    expect(gold.winRate).toBe(100);
    expect(gold.totalPnl).toBe(50);

    // Sorted by trade count descending — BTCUSDT (3) before XAUUSD (1).
    expect(result.perAsset[0].asset).toBe('BTCUSDT');
  });

  test('never counts a trade with no real result field toward wins or losses (honest, not silently guessed)', async () => {
    VirtualTrade.find = (query) => {
      if (query.status && query.status.$in) {
        return { lean: async () => [{ asset: 'X', status: 'closed_profit', pnl: 5 }] }; // no `result` field
      }
      return { sort: () => [] };
    };
    const result = await svc.getTrackRecordByAsset('all');
    const x = result.perAsset.find(a => a.asset === 'X');
    expect(x.totalTrades).toBe(1);
    expect(x.wins).toBe(0);
    expect(x.losses).toBe(0);
  });
});

describe('getWinLossBreakdown — real per-period win/loss counts (2026-09-02)', () => {
  // Four closed trades spread across time so each period boundary (1h/1d/7d/all)
  // picks up a different, verifiable subset -- proving this pulls real counted
  // outcomes per window, not a single all-time number relabeled four ways.
  function closedAt(msAgo, result, pnl) {
    return {
      status: result === 'win' ? 'closed_profit' : 'closed_loss',
      result, pnl, closedAt: new Date(Date.now() - msAgo),
    };
  }

  beforeEach(() => {
    FAKE_PORTFOLIO = { ...makePortfolio(1000, 5), startingBalance: 1000 };
    const ALL_CLOSED = [
      closedAt(30 * 60_000, 'win', 10),              // 30 min ago
      closedAt(5 * 3_600_000, 'loss', -5),            // 5 hours ago
      closedAt(3 * 24 * 3_600_000, 'win', 20),        // 3 days ago
      closedAt(20 * 24 * 3_600_000, 'loss', -8),      // 20 days ago
    ];
    VirtualTrade.find = (query) => {
      if (query.status && query.status.$in) {
        const since = query.closedAt && query.closedAt.$gte;
        const filtered = ALL_CLOSED.filter(t => !since || t.closedAt >= since);
        return { lean: async () => filtered };
      }
      return { sort: () => [] };
    };
    VirtualTrade.countDocuments = async (q) => (q && q.status === 'open') ? 3 : 0;
  });

  test('each period only counts trades that actually closed within it', async () => {
    const result = await svc.getWinLossBreakdown();

    expect(result.lastHour).toMatchObject({ wins: 1, losses: 0, trades: 1, netPnl: 10 });
    expect(result.today).toMatchObject({ wins: 1, losses: 1, trades: 2, netPnl: 5 });
    expect(result.thisWeek).toMatchObject({ wins: 2, losses: 1, trades: 3, netPnl: 25 });
    expect(result.allTime).toMatchObject({ wins: 2, losses: 2, trades: 4, netPnl: 17 });
  });

  test('reports real open-trade count and a generation timestamp, not a placeholder', async () => {
    const result = await svc.getWinLossBreakdown();
    expect(result.openTrades).toBe(3);
    expect(result.allTime.openTrades).toBeUndefined(); // pick() only forwards win/loss/trade fields, not openTrades
    expect(new Date(result.generatedAt).getTime()).not.toBeNaN();
  });

  test('a period with zero closed trades reports trades:0 honestly, not a guessed win/loss', async () => {
    VirtualTrade.find = (query) => {
      if (query.status && query.status.$in) return { lean: async () => [] };
      return { sort: () => [] };
    };
    const result = await svc.getWinLossBreakdown();
    expect(result.lastHour).toMatchObject({ wins: 0, losses: 0, trades: 0, winRate: 0, netPnl: 0 });
  });
});

describe('closePositionNow — the Guide screen\'s "Sell Now" button', () => {
  test('closes a BUY position at the current price and records a profit', async () => {
    FAKE_PORTFOLIO = makePortfolio(1000, 5);
    FAKE_OPEN_TRADES = [openTrade({ _id: 't1', direction: 'BUY', entryPrice: 100, sizeUsd: 50 })];
    const result = await svc.closePositionNow('t1', 105); // +5%
    expect(result.result).toBe('win');
    expect(result.pnl).toBeCloseTo(2.5, 6); // 50 * 5%
    expect(result.exitPrice).toBe(105);
    const closeCall = UPDATE_CALLS.find(c => c.update.exitReason === 'MANUAL');
    expect(closeCall).toBeDefined();
    expect(closeCall.update.status).toBe('closed_profit');
    expect(FAKE_PORTFOLIO.currentBalance).toBeCloseTo(1002.5, 6);
    expect(FAKE_PORTFOLIO.winCount).toBe(1);
  });

  test('closes a losing position and records it as a loss', async () => {
    FAKE_PORTFOLIO = makePortfolio(1000, 5);
    FAKE_OPEN_TRADES = [openTrade({ _id: 't2', direction: 'BUY', entryPrice: 100, sizeUsd: 50 })];
    const result = await svc.closePositionNow('t2', 95); // -5%
    expect(result.result).toBe('loss');
    expect(result.pnl).toBeCloseTo(-2.5, 6);
    expect(FAKE_PORTFOLIO.lossCount).toBe(1);
  });

  test('futures manual close is still floored at -marginUsd', async () => {
    FAKE_PORTFOLIO = makePortfolio(1000, 5);
    FAKE_OPEN_TRADES = [openTrade({
      _id: 't3', direction: 'BUY', entryPrice: 100, productType: 'futures',
      leverage: 10, marginUsd: 50, sizeUsd: 500,
    })];
    const result = await svc.closePositionNow('t3', 50); // -50% raw move, *10 leverage = -500%, way past margin
    expect(result.pnl).toBeCloseTo(-50, 6); // floored, not -250
  });

  test('rejects closing a position that does not exist or is already closed', async () => {
    FAKE_PORTFOLIO = makePortfolio(1000, 5);
    FAKE_OPEN_TRADES = [];
    await expect(svc.closePositionNow('missing', 100)).rejects.toThrow(/not found|already closed/i);
  });

  test('rejects when there is no valid current price', async () => {
    FAKE_PORTFOLIO = makePortfolio(1000, 5);
    FAKE_OPEN_TRADES = [openTrade({ _id: 't4' })];
    await expect(svc.closePositionNow('t4', null)).rejects.toThrow(/price/i);
    await expect(svc.closePositionNow('t4', NaN)).rejects.toThrow(/price/i);
  });
});

describe('checkOpenTrades — per-trade error boundary (T-087)', () => {
  test("one trade throwing during close does not lose an earlier trade's already-applied balance change", async () => {
    let saveCalls = 0;
    FAKE_PORTFOLIO = {
      currentBalance: 1000, riskPerTradePct: 5, startedAt: new Date(),
      save: async () => { saveCalls++; },
      totalProfit: 0, totalLoss: 0, winCount: 0, lossCount: 0,
      peakBalance: 1000, maxDrawdown: 0, bestTrade: null, worstTrade: null,
      balanceHistory: [],
    };
    FAKE_OPEN_TRADES = [
      openTrade({ _id: 'good', asset: 'BTCUSDT', direction: 'BUY', entryPrice: 100, takeProfit: 110, sizeUsd: 50 }),
      openTrade({ _id: 'bad',  asset: 'ETHUSDT', direction: 'BUY', entryPrice: 100, takeProfit: 110, sizeUsd: 50 }),
    ];

    const realUpdateOne = VirtualTrade.updateOne;
    VirtualTrade.updateOne = async (filter, update) => {
      if (filter._id === 'bad') throw new Error('simulated transient DB write failure');
      return realUpdateOne(filter, update);
    };

    await svc.checkOpenTrades({ BTCUSDT: 115, ETHUSDT: 115 }); // both would hit TP

    // The good trade's own close was still recorded...
    const goodClose = UPDATE_CALLS.find(c => c.filter._id === 'good' && c.update.status === 'closed_profit');
    expect(goodClose).toBeDefined();

    // ...and critically, the portfolio-level aggregate save still happened despite
    // the other trade throwing -- this is the actual bug (T-087): without a
    // per-trade error boundary, the bad trade's exception propagates straight to
    // checkOpenTrades' outer catch, skipping this save entirely and silently
    // losing the good trade's balance change (it can never be recovered, since
    // the good trade is no longer status:'open' on the next cron cycle).
    expect(saveCalls).toBe(1);
    expect(FAKE_PORTFOLIO.currentBalance).toBeCloseTo(1005, 6); // only the good trade's +$5 applied
    expect(FAKE_PORTFOLIO.winCount).toBe(1);
  });

  test('a throwing trade is logged and skipped, not silently swallowed', async () => {
    FAKE_PORTFOLIO = makePortfolio(1000, 5);
    FAKE_OPEN_TRADES = [openTrade({ _id: 'bad', asset: 'BTCUSDT', direction: 'BUY', entryPrice: 100, takeProfit: 110, sizeUsd: 50 })];

    VirtualTrade.updateOne = async () => { throw new Error('simulated transient DB write failure'); };

    const logger = require('../src/config/logger');
    const errSpy = jest.spyOn(logger, 'error').mockImplementation(() => {});

    await expect(svc.checkOpenTrades({ BTCUSDT: 115 })).resolves.not.toThrow();
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('Error processing trade'));

    errSpy.mockRestore();
  });
});
