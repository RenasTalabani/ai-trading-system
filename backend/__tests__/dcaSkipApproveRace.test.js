/**
 * Regression guard for a real TOCTOU race (2026-09-04, overnight
 * continuous-improvement pass), a variant of the one already fixed in
 * approveDueBuy() itself (see dcaServiceApproveDueBuyRace.test.js):
 * skipDueBuy()'s own check-then-write wasn't wrapped in the same shared
 * portfolio mutex approveDueBuy() uses, so the two were never serialized
 * against EACH OTHER. A "Skip" tap and an "Approve" tap landing close
 * together for the SAME due buy (two devices open on the same account, a
 * slow network causing a retry) could both read dueBuyPending: true before
 * either wrote -- letting approveDueBuy() still push a real purchase and
 * spend money moments after the user told the app to skip this cycle.
 *
 * Fixed by having skipDueBuy() acquire the same shared mutex. This suite
 * verifies both directions cleanly serialize: whichever of the two calls
 * actually acquires the lock first wins entirely, and the other sees an
 * up-to-date (already-cleared) dueBuyPending flag and is cleanly rejected
 * -- never both succeeding, and never a purchase happening despite a
 * skip winning the race.
 */
jest.mock('../src/services/notificationService', () => ({
  sendDcaBuyDueNotification: jest.fn(async () => {}),
}));
jest.mock('../src/services/binanceService', () => ({
  getCachedPrice: jest.fn(() => 50000),
}));
jest.mock('../src/services/virtualTrackingService', () => ({
  // 2026-09-04 follow-up fix: approveDueBuy() now calls
  // riskStateService.checkAndMaybeHalt(portfolio) instead of the plain
  // isHalted() read -- which needs a portfolio to check against.
  getPortfolio: jest.fn(async () => ({ currentBalance: 1000 })),
}));
jest.mock('../src/services/riskStateService', () => ({
  // Real mockDelay so approveDueBuy(), when it wins the lock, actually spends
  // meaningful time inside the critical section -- not load-bearing for
  // proving the lock serializes (FIFO lock acquisition order alone proves
  // that), but keeps this suite consistent with the sibling race suites.
  checkAndMaybeHalt: jest.fn(async () => { await mockDelay(15); return { halted: false }; }),
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
  DCAPlan.findById.mockImplementation(async (id) => {
    await mockDelay(5);
    return FAKE_PLANS.find((p) => p._id === id) || null;
  });
});

describe('skipDueBuy vs approveDueBuy — cross-function concurrent race (2026-09-04 regression)', () => {
  test('Skip fired first: skip wins, approve is cleanly rejected, and NO purchase is ever recorded', async () => {
    const plan = makePlan();
    FAKE_PLANS = [plan];

    const results = await Promise.allSettled([
      dcaService.skipDueBuy('plan1'),
      dcaService.approveDueBuy('plan1'),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected  = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason.message).toMatch(/no buy waiting/i);

    // The real, load-bearing assertion: the user asked to skip, and the
    // buy genuinely never executed -- not "eventually consistent", never
    // happened at all.
    expect(plan.purchases).toHaveLength(0);
    expect(plan.totalInvested).toBe(50); // unchanged from the initial seed
    expect(plan.dueBuyPending).toBe(false);
  });

  test('Approve fired first: approve wins, skip is cleanly rejected, and exactly one purchase is recorded', async () => {
    const plan = makePlan();
    FAKE_PLANS = [plan];

    const results = await Promise.allSettled([
      dcaService.approveDueBuy('plan1'),
      dcaService.skipDueBuy('plan1'),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected  = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason.message).toMatch(/no buy waiting/i);

    expect(plan.purchases).toHaveLength(1);
    expect(plan.totalInvested).toBe(100); // 50 initial + 50 one buy, not double-touched by skip
    expect(plan.dueBuyPending).toBe(false);
  });
});
