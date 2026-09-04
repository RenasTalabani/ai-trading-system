/**
 * Regression guard for a real TOCTOU race (2026-09-04, overnight
 * continuous-improvement pass), the same shape already found and fixed in
 * approveSuggestion() (see virtualTrackingServiceApproveRace.test.js):
 * approveDueBuy()'s `dueBuyPending` check and the `plan.save()` that
 * clears it used to straddle real async work (the circuit-breaker check,
 * the live price fetch) with nothing serializing the two. Two
 * near-simultaneous approve taps on the same due buy -- a double-tap, a
 * network retry -- could both see `dueBuyPending: true` and both execute a
 * buy, silently double-spending this cycle's DCA amount.
 *
 * Like the sibling suite, this one deliberately gives its mocks a real
 * artificial mockDelay so two approveDueBuy() calls started back-to-back
 * actually interleave, unlike dcaService.test.js's effectively-synchronous
 * mocks (which cannot detect this class of bug because nothing in them
 * ever yields between the check and the write).
 */
jest.mock('../src/services/notificationService', () => ({
  sendDcaBuyDueNotification: jest.fn(async () => {}),
}));
jest.mock('../src/services/binanceService', () => ({
  getCachedPrice: jest.fn(() => 50000),
}));
jest.mock('../src/services/virtualTrackingService', () => ({
  // 2026-09-04 follow-up fix: approveDueBuy() now calls
  // riskStateService.checkAndMaybeHalt(portfolio) (recompute-and-persist,
  // matching every other trade-opening path) instead of the plain
  // isHalted() read -- which needs a portfolio to check against.
  getPortfolio: jest.fn(async () => ({ currentBalance: 1000 })),
}));
jest.mock('../src/services/riskStateService', () => ({
  // Deliberately delayed with a REAL timer (not just a resolved promise).
  // approveDueBuy()'s `dueBuyPending` check runs *before* this call, so
  // this is the gap the race needs: both concurrent calls can pass the
  // check (neither has mutated `dueBuyPending` yet) and then both sit here
  // at the same time, before either reaches the write. A same-tick
  // resolved promise (the original version of this mock) doesn't force
  // that interleaving -- Node drains one call's whole microtask chain
  // (check-through-mutation) before the other call's own `findById` timer
  // callback is even invoked, so the "race" never actually happened and
  // this suite passed even against the unfixed function. This mockDelay is
  // what makes the two calls actually overlap the way two real concurrent
  // HTTP requests would.
  checkAndMaybeHalt: jest.fn(async () => { await mockDelay(20); return { halted: false }; }),
}));
jest.mock('../src/models/DCAPlan', () => ({
  find: jest.fn(),
  findById: jest.fn(),
  create: jest.fn(),
}));

const DCAPlan = require('../src/models/DCAPlan');
const dcaService = require('../src/services/dcaService');

function mockDelay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

function makePlan(overrides = {}) {
  const plan = {
    _id: 'plan1', asset: 'BTC', amountPerBuy: 50, frequencyDays: 7, status: 'active',
    purchases: [], totalInvested: 50, totalUnits: 0.001,
    lastBuyAt: new Date(Date.now() - 10 * 24 * 3_600_000),
    dueBuyPending: true,
    ...overrides,
  };
  plan.save = jest.fn(async () => { await mockDelay(10); return plan; });
  return plan;
}

let FAKE_PLANS;

beforeEach(() => {
  jest.clearAllMocks();
  FAKE_PLANS = [];
  // Deliberately delayed, unlike dcaService.test.js's instant mock, so two
  // approveDueBuy() calls actually interleave at the DB-read point.
  DCAPlan.findById.mockImplementation(async (id) => {
    await mockDelay(15);
    return FAKE_PLANS.find((p) => p._id === id) || null;
  });
});

describe('approveDueBuy — concurrent-approval race (2026-09-04 regression)', () => {
  test('two near-simultaneous approvals for the SAME due buy: exactly one executes, the other is cleanly rejected', async () => {
    const plan = makePlan();
    FAKE_PLANS = [plan];

    const results = await Promise.allSettled([
      dcaService.approveDueBuy('plan1'),
      dcaService.approveDueBuy('plan1'),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected  = results.filter((r) => r.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason.message).toMatch(/no buy waiting/i);
    // The real, load-bearing assertion: exactly one purchase was recorded,
    // not two -- this is what "double-spent this cycle's DCA amount" would
    // look like if the race weren't closed.
    expect(plan.purchases).toHaveLength(1);
    expect(plan.totalInvested).toBe(100); // 50 (initial) + 50 (one buy), not 150
  });

  test('two near-simultaneous approvals for two DIFFERENT plans: both succeed independently (the lock does not over-serialize)', async () => {
    const planA = makePlan({ _id: 'planA', asset: 'BTC' });
    const planB = makePlan({ _id: 'planB', asset: 'ETH' });
    FAKE_PLANS = [planA, planB];

    const results = await Promise.allSettled([
      dcaService.approveDueBuy('planA'),
      dcaService.approveDueBuy('planB'),
    ]);

    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
    expect(planA.purchases).toHaveLength(1);
    expect(planB.purchases).toHaveLength(1);
  });
});
