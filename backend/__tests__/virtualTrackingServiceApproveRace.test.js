/**
 * Regression guard for a real TOCTOU (time-of-check-to-time-of-use) race
 * (2026-09-04, overnight continuous-improvement pass): approveSuggestion()'s
 * "already open" dedup check (`VirtualTrade.findOne`) and the
 * `VirtualTrade.create()` that follows it used to straddle real async work
 * (portfolio load, riskStateService.checkAndMaybeHalt, the safety gate,
 * computeSpotSizeUsd) with nothing serializing the two. Two near-simultaneous
 * approvals for the same asset -- a network retry, a double-tap that beats
 * the mobile app's own in-flight guard, or Guide and RENO chat both
 * resolving and approving the same underlying suggestion in the same window
 * -- could both pass the check and both open a position, silently doubling
 * real (paper) exposure on that asset. Since EVERY trade-opening path in
 * this app (Guide, RENO, AI-worker decisions, AI-worker allocation
 * proposals) funnels through this one function, this was a single point of
 * failure for all of them.
 *
 * Unlike virtualTrackingService.test.js's mocks (which never make a created
 * trade visible to a later VirtualTrade.findOne call in the same test, so
 * that suite structurally cannot detect this class of bug), this suite's
 * mocks deliberately DO make a create() show up in a later findOne() --
 * with an artificial delay on both, so two concurrently-started
 * approveSuggestion() calls actually interleave the way two real concurrent
 * HTTP requests against a real MongoDB would, instead of the two just
 * happening to run one after the other because nothing here ever yields.
 *
 * The fix wraps approveSuggestion()'s check-through-create critical section
 * in the same shared portfolio mutex (withPortfolioLock, real and unmocked
 * here -- it's a plain in-process AsyncMutex, no DB/network involved) this
 * file already uses for checkOpenTrades/applyFundingPayments/
 * closePositionNow. This suite confirms it actually serializes: exactly one
 * of two concurrent approvals for the same asset succeeds, and the other
 * cleanly rejects with the existing "already open" error rather than both
 * silently succeeding.
 */
const VirtualTrade     = require('../src/models/VirtualTrade');
const VirtualPortfolio = require('../src/models/VirtualPortfolio');
const Signal           = require('../src/models/Signal');
const BudgetSession    = require('../src/models/BudgetSession');
const RiskState        = require('../src/models/RiskState');

jest.mock('../src/services/notificationService', () => ({
  sendTradeOpenedNotification: jest.fn(async () => {}),
}));

function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

function makePortfolio(balance = 1000, riskPct = 2) {
  return {
    currentBalance: balance, riskPerTradePct: riskPct, startedAt: new Date(), save: async () => {},
    totalProfit: 0, totalLoss: 0, winCount: 0, lossCount: 0,
    peakBalance: balance, maxDrawdown: 0, bestTrade: null, worstTrade: null,
    balanceHistory: [],
  };
}

function makeRiskState() {
  const state = { riskKey: 'global', dailyLossHalted: false, haltReason: null };
  state.save = async () => state;
  return state;
}

function chain(result) {
  return { sort: () => ({ limit: () => ({ lean: async () => result }) }) };
}

let FAKE_OPEN_TRADES, CREATED_TRADES, FAKE_PORTFOLIO;

beforeEach(() => {
  FAKE_OPEN_TRADES = [];
  CREATED_TRADES = [];
  FAKE_PORTFOLIO = makePortfolio();

  // Deliberately delayed (unlike the sibling suite's synchronous-in-disguise
  // mocks) so two approveSuggestion() calls started back-to-back actually
  // interleave at the DB-access points, the way two real concurrent HTTP
  // requests against a real MongoDB would.
  VirtualTrade.findOne = async (query) => {
    await delay(15);
    return FAKE_OPEN_TRADES.find(t => t.asset === query.asset && query.status === 'open') || null;
  };
  VirtualTrade.create = async (doc) => {
    await delay(15);
    const created = { ...doc, _id: 'fake_' + (CREATED_TRADES.length + 1), status: 'open' };
    CREATED_TRADES.push(created);
    FAKE_OPEN_TRADES.push(created); // <-- makes the dedup check actually see it, unlike the sibling suite
    return created;
  };
  VirtualTrade.find = () => chain([]);
  VirtualTrade.distinct = async () => [];
  VirtualTrade.aggregate = async () => [];

  VirtualPortfolio.findOne = async () => FAKE_PORTFOLIO;
  BudgetSession.findOne = async () => ({ status: 'active' });
  Signal.findById = async () => null;
  RiskState.findOne = async () => makeRiskState();
  RiskState.create = async () => makeRiskState();
});

const svc = require('../src/services/virtualTrackingService');

describe('approveSuggestion — concurrent-approval race (2026-09-04 regression)', () => {
  test('two near-simultaneous approvals for the SAME asset: exactly one opens, the other is cleanly rejected', async () => {
    const args = { asset: 'RACEUSDT', direction: 'BUY', entryPrice: 100, stopLoss: 95 };

    const results = await Promise.allSettled([
      svc.approveSuggestion(args),
      svc.approveSuggestion(args),
    ]);

    const fulfilled = results.filter(r => r.status === 'fulfilled');
    const rejected  = results.filter(r => r.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason.message).toMatch(/Already have an open RACEUSDT position/);
    // The real, load-bearing assertion: not "one promise rejected" in the
    // abstract, but that the database only actually ended up with ONE trade.
    expect(CREATED_TRADES).toHaveLength(1);
  });

  test('two near-simultaneous approvals for DIFFERENT assets: both succeed independently (the lock does not over-serialize)', async () => {
    const results = await Promise.allSettled([
      svc.approveSuggestion({ asset: 'AAAUSDT', direction: 'BUY', entryPrice: 100, stopLoss: 95 }),
      svc.approveSuggestion({ asset: 'BBBUSDT', direction: 'BUY', entryPrice: 200, stopLoss: 190 }),
    ]);

    expect(results.every(r => r.status === 'fulfilled')).toBe(true);
    expect(CREATED_TRADES).toHaveLength(2);
    expect(CREATED_TRADES.map(t => t.asset).sort()).toEqual(['AAAUSDT', 'BBBUSDT']);
  });
});
