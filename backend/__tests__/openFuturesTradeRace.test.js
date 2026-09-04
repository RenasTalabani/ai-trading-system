/**
 * Regression guard for a real, unconditional duplication bug (2026-09-04,
 * overnight continuous-improvement pass): openFuturesTrade() -- unlike
 * every other trade-opening path in this file (approveSuggestion,
 * pickupNewSignals) -- had NO "already open" dedup check at all and no
 * lock around its check-through-create critical section. Two taps of
 * "Open Futures" on the same signal (a double-tap, or a client retry
 * after a slow response that actually succeeded) created TWO independent
 * futures positions for the same signal, each sized off the same
 * portfolio balance -- duplicated exposure and duplicated margin spend,
 * silently, every single time (not a narrow timing window -- there was
 * nothing to even race against before this fix).
 *
 * Like the sibling race suites (virtualTrackingServiceApproveRace.test.js,
 * dcaServiceApproveDueBuyRace.test.js), this one gives its mocks a genuine
 * setTimeout-based delay positioned between the dedup check and the
 * write (on riskStateService.checkAndMaybeHalt, which the fixed code
 * calls after the check and before VirtualTrade.create), not just a
 * same-tick resolved promise. A same-tick mock is NOT enough to prove a
 * lock actually serializes anything here: Node fully drains one call's
 * check-through-create microtask chain before the other call's own
 * findOne() timer callback ever fires, so two calls started
 * back-to-back would appear to "not race" even against completely
 * unlocked code -- verified the hard way while building the DCA sibling
 * suite.
 */
jest.mock('../src/services/riskStateService', () => ({
  checkAndMaybeHalt: jest.fn(async () => { await delay(20); return { halted: false }; }),
}));

const Signal           = require('../src/models/Signal');
const VirtualTrade     = require('../src/models/VirtualTrade');
const VirtualPortfolio = require('../src/models/VirtualPortfolio');

function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

function makePortfolio(overrides = {}) {
  return {
    currentBalance: 1000, riskPerTradePct: 5,
    ...overrides,
  };
}

function makeSignal(overrides = {}) {
  return {
    _id: 'sig1', asset: 'RACEUSDT', direction: 'BUY',
    price: { entry: 100, stopLoss: 95, takeProfit: 110 },
    ...overrides,
  };
}

function chain(result) {
  return { sort: () => ({ limit: () => ({ lean: async () => result }) }) };
}

let FAKE_OPEN_FUTURES, CREATED_TRADES, FAKE_PORTFOLIO, FAKE_SIGNALS;

beforeEach(() => {
  FAKE_OPEN_FUTURES = [];
  CREATED_TRADES = [];
  FAKE_PORTFOLIO = makePortfolio();
  FAKE_SIGNALS = { sig1: makeSignal() };

  Signal.findById = async (id) => FAKE_SIGNALS[id] || null;

  // Deliberately delayed, same reasoning as the sibling suites: makes two
  // openFuturesTrade() calls started back-to-back actually interleave at
  // the DB-access points, the way two real concurrent HTTP requests
  // against a real MongoDB would.
  VirtualTrade.findOne = async (query) => {
    await delay(10);
    return FAKE_OPEN_FUTURES.find(
      (t) => t.signalId === query.signalId && t.productType === query.productType && t.status === query.status
    ) || null;
  };
  VirtualTrade.create = async (doc) => {
    await delay(10);
    const created = { ...doc, _id: 'fake_' + (CREATED_TRADES.length + 1), status: 'open' };
    CREATED_TRADES.push(created);
    FAKE_OPEN_FUTURES.push(created); // makes the dedup check actually see it
    return created;
  };
  VirtualTrade.find = () => chain([]); // no closed-trade history -- getEdgeMultiplier stays at 1.0x

  VirtualPortfolio.findOne = async () => FAKE_PORTFOLIO;
});

const svc = require('../src/services/virtualTrackingService');

describe('openFuturesTrade — concurrent-open race (2026-09-04 regression)', () => {
  test('two near-simultaneous "open futures" taps on the SAME signal: exactly one opens, the other is cleanly rejected', async () => {
    const results = await Promise.allSettled([
      svc.openFuturesTrade('sig1', 1),
      svc.openFuturesTrade('sig1', 1),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected  = results.filter((r) => r.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason.message).toMatch(/already open/i);
    // The real, load-bearing assertion: the DB only ends up with ONE
    // futures position for this signal, not two duplicated ones.
    expect(CREATED_TRADES).toHaveLength(1);
  });

  test('two near-simultaneous "open futures" taps on two DIFFERENT signals: both succeed independently (the lock does not over-serialize)', async () => {
    FAKE_SIGNALS.sig2 = makeSignal({ _id: 'sig2', asset: 'OTHERUSDT' });

    const results = await Promise.allSettled([
      svc.openFuturesTrade('sig1', 1),
      svc.openFuturesTrade('sig2', 1),
    ]);

    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
    expect(CREATED_TRADES).toHaveLength(2);
    expect(CREATED_TRADES.map((t) => t.asset).sort()).toEqual(['OTHERUSDT', 'RACEUSDT']);
  });
});
