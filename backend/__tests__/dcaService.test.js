/**
 * Safety-fix regression suite for DCA (2026-09-04).
 *
 * Before this fix, runDueBuys() executed a buy the instant it came due, on
 * an unattended daily cron, with zero human approval and zero
 * circuit-breaker check -- silently bypassing two locked, "no exceptions"
 * master-plan decisions: #11 (every single trade needs explicit user
 * approval) and #16 (the daily-loss circuit breaker halts ALL new-trade
 * paths, not just the AI worker's). This file had no test coverage at all
 * before this fix.
 *
 * All Mongoose models and dependent services are monkey-patched with
 * in-memory fakes -- this suite never opens a real database connection.
 */
jest.mock('../src/services/notificationService', () => ({
  sendDcaBuyDueNotification: jest.fn(async () => {}),
}));
jest.mock('../src/services/binanceService', () => ({
  getCachedPrice: jest.fn(() => 50000),
}));
// Bug fix (2026-09-04, overnight continuous-improvement pass, follow-up
// audit): dcaService.js now calls checkAndMaybeHalt(portfolio) (recompute-
// and-persist), not isHalted() (a plain flag read) -- matching every other
// trade-opening path (approveSuggestion, openFuturesTrade,
// approveAllocationProposal). See dcaService.js's own isHaltedNow() comment
// for why a plain read could silently stay "not halted" past the real
// threshold. This also needs virtualTrackingService.getPortfolio() mocked,
// since checkAndMaybeHalt(portfolio) needs a portfolio to check against.
jest.mock('../src/services/riskStateService', () => ({
  checkAndMaybeHalt: jest.fn(async () => ({ halted: false })),
}));
jest.mock('../src/services/virtualTrackingService', () => ({
  getPortfolio: jest.fn(async () => ({ currentBalance: 1000 })),
}));
jest.mock('../src/models/DCAPlan', () => ({
  find: jest.fn(),
  findById: jest.fn(),
  create: jest.fn(),
}));

const DCAPlan = require('../src/models/DCAPlan');
const riskStateService = require('../src/services/riskStateService');
const { sendDcaBuyDueNotification } = require('../src/services/notificationService');
const dcaService = require('../src/services/dcaService');

let FAKE_PLANS;

function makePlan(overrides = {}) {
  const plan = {
    _id: 'plan1',
    asset: 'BTC',
    amountPerBuy: 50,
    frequencyDays: 7,
    status: 'active',
    purchases: [],
    totalInvested: 50,
    totalUnits: 0.001,
    // 10 days ago -- overdue for a 7-day plan by default.
    lastBuyAt: new Date(Date.now() - 10 * 24 * 3_600_000),
    dueBuyPending: false,
    ...overrides,
  };
  plan.save = jest.fn(async () => plan);
  return plan;
}

beforeEach(() => {
  jest.clearAllMocks();
  FAKE_PLANS = [];
  DCAPlan.find.mockImplementation(async (query = {}) => FAKE_PLANS.filter((p) => {
    if (query.status && p.status !== query.status) return false;
    if ('dueBuyPending' in query && p.dueBuyPending !== query.dueBuyPending) return false;
    return true;
  }));
  DCAPlan.findById.mockImplementation(async (id) => FAKE_PLANS.find((p) => p._id === id) || null);
  DCAPlan.create.mockImplementation(async (doc) => {
    const plan = { _id: 'plan' + (FAKE_PLANS.length + 1), status: 'active', dueBuyPending: false, ...doc };
    plan.save = jest.fn(async () => plan);
    FAKE_PLANS.push(plan);
    return plan;
  });
});

describe('runDueBuys — flags a due buy, never executes it (decision #11)', () => {
  test('an overdue plan is flagged pending and notified, but no money moves', async () => {
    const plan = makePlan();
    FAKE_PLANS.push(plan);

    await dcaService.runDueBuys();

    expect(plan.dueBuyPending).toBe(true);
    expect(plan.purchases).toHaveLength(0);
    expect(plan.totalInvested).toBe(50);
    expect(sendDcaBuyDueNotification).toHaveBeenCalledTimes(1);
    expect(sendDcaBuyDueNotification).toHaveBeenCalledWith(plan);
  });

  test('a plan already pending approval is left alone — no re-notify spam', async () => {
    const plan = makePlan({ dueBuyPending: true });
    FAKE_PLANS.push(plan);

    await dcaService.runDueBuys();

    expect(sendDcaBuyDueNotification).not.toHaveBeenCalled();
  });

  test('a plan that is not yet due is untouched', async () => {
    const plan = makePlan({ lastBuyAt: new Date() }); // just bought
    FAKE_PLANS.push(plan);

    await dcaService.runDueBuys();

    expect(plan.dueBuyPending).toBe(false);
    expect(sendDcaBuyDueNotification).not.toHaveBeenCalled();
  });
});

describe('approveDueBuy — the only path that can actually move money', () => {
  test('executes at the current price and clears the pending flag', async () => {
    const plan = makePlan({ dueBuyPending: true });
    FAKE_PLANS.push(plan);

    const result = await dcaService.approveDueBuy('plan1');

    expect(result.dueBuyPending).toBe(false);
    expect(result.purchases).toHaveLength(1);
    expect(result.purchases[0]).toMatchObject({ price: 50000, amountUsd: 50 });
    expect(result.totalInvested).toBe(100);
  });

  test('is blocked by the daily-loss circuit breaker (decision #16) and leaves the buy pending', async () => {
    riskStateService.checkAndMaybeHalt.mockResolvedValueOnce({ halted: true, reason: 'Daily loss reached $50.00 (>= 10% of $500.00 balance)' });
    const plan = makePlan({ dueBuyPending: true });
    FAKE_PLANS.push(plan);

    await expect(dcaService.approveDueBuy('plan1')).rejects.toThrow(/paused/i);

    expect(plan.dueBuyPending).toBe(true);
    expect(plan.purchases).toHaveLength(0);
  });

  test('a circuit-breaker rejection is flagged isSafetyGateRejection (drives the route\'s 422)', async () => {
    riskStateService.checkAndMaybeHalt.mockResolvedValueOnce({ halted: true, reason: 'Daily loss reached $50.00 (>= 10% of $500.00 balance)' });
    const plan = makePlan({ dueBuyPending: true });
    FAKE_PLANS.push(plan);

    await expect(dcaService.approveDueBuy('plan1')).rejects.toMatchObject({ isSafetyGateRejection: true });
  });

  test('throws if the plan has no buy currently pending approval', async () => {
    const plan = makePlan({ dueBuyPending: false });
    FAKE_PLANS.push(plan);

    await expect(dcaService.approveDueBuy('plan1')).rejects.toThrow(/no buy waiting/i);
  });
});

describe('skipDueBuy — declines this cycle without spending anything', () => {
  test('clears the pending flag and pushes lastBuyAt forward with no purchase recorded', async () => {
    const plan = makePlan({ dueBuyPending: true, totalInvested: 50 });
    FAKE_PLANS.push(plan);
    const before = plan.lastBuyAt.getTime();

    const result = await dcaService.skipDueBuy('plan1');

    expect(result.dueBuyPending).toBe(false);
    expect(result.purchases).toHaveLength(0);
    expect(result.totalInvested).toBe(50);
    expect(result.lastBuyAt.getTime()).toBeGreaterThan(before);
  });

  test('throws if the plan has no buy currently pending approval', async () => {
    const plan = makePlan({ dueBuyPending: false });
    FAKE_PLANS.push(plan);

    await expect(dcaService.skipDueBuy('plan1')).rejects.toThrow(/no buy waiting/i);
  });
});

// Bug fix regression suite (2026-09-04, overnight continuous-improvement
// pass, follow-up audit): startPlan()'s first buy is a real (paper) trade
// opening, same as every buy approveDueBuy() executes, but it never checked
// the daily-loss circuit breaker at all -- silently bypassing decision #16
// the same way the pre-fix approveDueBuy() did (see the top-of-file header
// comment: "the daily-loss circuit breaker halts ALL new-trade paths, not
// just the AI worker's").
describe('startPlan — the one-time first buy a user makes by starting a plan', () => {
  test('executes the first buy immediately and creates the plan', async () => {
    const plan = await dcaService.startPlan('btc', 50, 7);

    expect(plan.asset).toBe('BTC');
    expect(plan.purchases).toHaveLength(1);
    expect(plan.purchases[0]).toMatchObject({ price: 50000, amountUsd: 50 });
    expect(plan.totalInvested).toBe(50);
  });

  test('is blocked by the daily-loss circuit breaker (decision #16) and creates no plan at all', async () => {
    riskStateService.checkAndMaybeHalt.mockResolvedValueOnce({ halted: true, reason: 'Daily loss reached $50.00 (>= 10% of $500.00 balance)' });

    await expect(dcaService.startPlan('BTC', 50, 7)).rejects.toThrow(/paused/i);
    expect(DCAPlan.create).not.toHaveBeenCalled();
    expect(FAKE_PLANS).toHaveLength(0);
  });

  test('a circuit-breaker rejection is flagged isSafetyGateRejection (drives the route\'s 422)', async () => {
    riskStateService.checkAndMaybeHalt.mockResolvedValueOnce({ halted: true, reason: 'Daily loss reached $50.00 (>= 10% of $500.00 balance)' });

    await expect(dcaService.startPlan('BTC', 50, 7)).rejects.toMatchObject({ isSafetyGateRejection: true });
  });
});

// Bug fix regression suite (2026-09-04, overnight continuous-improvement
// pass, follow-up audit): a plan could be stopped while a buy was already
// flagged dueBuyPending (the daily cron ran before the user tapped Stop).
// approveDueBuy() only ever checked dueBuyPending, never status, so that
// stale flag could still be approved and executed on a stopped plan --
// the opposite of what stopping it was supposed to guarantee.
describe('stopPlan — clears any stale pending-buy flag along with stopping', () => {
  test('stopping a plan with a buy pending clears dueBuyPending too', async () => {
    const plan = makePlan({ dueBuyPending: true });
    FAKE_PLANS.push(plan);

    const result = await dcaService.stopPlan('plan1');

    expect(result.status).toBe('stopped');
    expect(result.dueBuyPending).toBe(false);
  });
});

describe('approveDueBuy — refuses a buy on a plan that is no longer active', () => {
  test('a stopped plan\'s (stale) pending buy cannot be approved', async () => {
    // Simulates data from before stopPlan()'s own fix above (or any other
    // path that could leave dueBuyPending true on a non-active plan) --
    // approveDueBuy() must not trust dueBuyPending alone.
    const plan = makePlan({ status: 'stopped', dueBuyPending: true });
    FAKE_PLANS.push(plan);

    await expect(dcaService.approveDueBuy('plan1')).rejects.toThrow(/not active/i);
    expect(plan.purchases).toHaveLength(0);
  });
});
