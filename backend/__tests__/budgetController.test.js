/**
 * Regression suite for T-053 (2026-08-26, overnight continuous-improvement
 * pass; admin-gated 2026-08-28 per owner decision).
 *
 * ORIGINAL FINDING: `BudgetSession` (`sessionKey: 'global'`) and
 * `VirtualPortfolio` (`portfolioKey: 'global'`) are both app-wide
 * singletons — there is exactly one AI paper-trading "budget manager"
 * shared by every user of the app, not one per user. `POST /budget/start`
 * and `POST /budget/stop` were gated with `protect` only (no role check),
 * and self-registration always creates `role: 'user'` — so any
 * authenticated user could wipe the shared VirtualPortfolio's entire
 * performance history and force-close every open virtual trade
 * system-wide.
 *
 * OWNER DECISION (2026-08-28): admin-gate both endpoints, matching this
 * project's sibling pattern (`routes/signals.js`'s `/scan`,
 * `routes/tracker.js`'s `/evaluate`, both `authorize('admin')`).
 * `budget.js` now reads:
 *
 *   router.post('/start', protect, authorize('admin'), ...ctrl.start);
 *   router.post('/stop',  protect, authorize('admin'), ctrl.stop);
 *
 * This suite now locks in the FIXED behavior: a non-admin caller is
 * rejected with 403 before ever reaching validation or the controller, and
 * an admin caller behaves exactly as any caller did before the fix. See
 * PROJECT_STATUS.md T-053 for the full history.
 *
 * IMPORTANT OPERATIONAL NOTE left for the owner: this gate only protects
 * the app if the owner's own account actually has role:'admin' in the
 * database — self-registration never assigns it. If the owner's account is
 * still role:'user', this change will lock them out of Start/Stop in the
 * mobile app until their account is promoted (see PROJECT_STATUS.md).
 */
const express = require('express');
const request = require('supertest');

// Mock `protect` only (auth-by-header for test control); use the REAL
// `authorize` implementation so this suite actually exercises the fix
// rather than continuing to bypass it like the pre-fix version did.
jest.mock('../src/middleware/auth', () => {
  const actual = jest.requireActual('../src/middleware/auth');
  return {
    ...actual,
    protect: (req, res, next) => {
      const role = req.headers['x-test-role'] || 'user';
      req.user = { _id: 'user1', id: 'user1', role };
      next();
    },
  };
});

// budgetController destructures `{ getSummary }` out of this module at
// require-time, so the test must mutate the SAME jest.fn() instance via
// .mockResolvedValue/.mockImplementation (not reassign the property to a
// new function), or the controller's already-captured reference won't see
// the test's stub.
jest.mock('../src/services/virtualTrackingService', () => ({ getSummary: jest.fn() }));

const BudgetSession    = require('../src/models/BudgetSession');
const VirtualPortfolio = require('../src/models/VirtualPortfolio');
const VirtualTrade     = require('../src/models/VirtualTrade');
const virtualTrackingService = require('../src/services/virtualTrackingService');
const budgetRouter  = require('../src/routes/budget');
const budgetController = require('../src/controllers/budgetController');

function appFor(routePath, router) {
  const app = express();
  app.use(express.json());
  app.use(routePath, router);
  app.use((err, req, res, _next) => res.status(500).json({ error: err.message }));
  return app;
}

const app = appFor('/budget', budgetRouter);

beforeEach(() => {
  jest.clearAllMocks();
});

function fakeReqRes(body = {}, query = {}) {
  const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  return { req: { body, query }, res };
}

describe('T-053 fix: budget/start and budget/stop are admin-only', () => {
  test('a role:"user" (non-admin) caller is rejected with 403 and never reaches the global-state mutation', async () => {
    BudgetSession.findOne = jest.fn(async () => ({
      sessionKey: 'global', status: 'paused', save: jest.fn(async function () { return this; }),
    }));
    VirtualPortfolio.findOneAndUpdate = jest.fn(async () => ({}));
    VirtualTrade.updateMany = jest.fn(async () => ({ modifiedCount: 3 }));

    const res = await request(app)
      .post('/budget/start')
      .set('x-test-role', 'user')
      .send({ budget: 1000 });

    expect(res.status).toBe(403);
    expect(VirtualPortfolio.findOneAndUpdate).not.toHaveBeenCalled();
    expect(VirtualTrade.updateMany).not.toHaveBeenCalled();
  });

  test('a role:"user" (non-admin) caller cannot pause the shared budget session either', async () => {
    const save = jest.fn(async function () { return this; });
    BudgetSession.findOne = jest.fn(async () => ({ sessionKey: 'global', status: 'active', save }));

    const res = await request(app).post('/budget/stop').set('x-test-role', 'user').send({});

    expect(res.status).toBe(403);
    expect(save).not.toHaveBeenCalled();
  });

  test('an admin caller can still start the shared budget session (same behavior as before the fix)', async () => {
    BudgetSession.findOne = jest.fn(async () => ({
      sessionKey: 'global', status: 'paused', save: jest.fn(async function () { return this; }),
    }));
    VirtualPortfolio.findOneAndUpdate = jest.fn(async () => ({}));
    VirtualTrade.updateMany = jest.fn(async () => ({ modifiedCount: 3 }));

    const res = await request(app)
      .post('/budget/start')
      .set('x-test-role', 'admin')
      .send({ budget: 1000 });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(VirtualPortfolio.findOneAndUpdate).toHaveBeenCalledWith(
      { portfolioKey: 'global' },
      expect.objectContaining({ startingBalance: 1000, currentBalance: 1000 }),
      expect.objectContaining({ upsert: true }),
    );
    expect(VirtualTrade.updateMany).toHaveBeenCalledWith(
      { status: 'open' },
      { $set: { status: 'expired', exitReason: 'session_reset' } },
    );
  });

  test('an admin caller can still pause the shared budget session', async () => {
    const save = jest.fn(async function () { return this; });
    BudgetSession.findOne = jest.fn(async () => ({ sessionKey: 'global', status: 'active', save }));

    const res = await request(app).post('/budget/stop').set('x-test-role', 'admin').send({});

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(save).toHaveBeenCalled();
  });
});

describe('budgetController.start validation (general coverage, admin caller)', () => {
  test('rejects a budget below the $1 minimum', async () => {
    const res = await request(app).post('/budget/start').set('x-test-role', 'admin').send({ budget: 0 });
    expect(res.status).toBe(400);
  });

  test('rejects a budget above the $1,000,000 maximum', async () => {
    const res = await request(app).post('/budget/start').set('x-test-role', 'admin').send({ budget: 1_000_001 });
    expect(res.status).toBe(400);
  });

  test('rejects an invalid riskLevel', async () => {
    const res = await request(app).post('/budget/start').set('x-test-role', 'admin').send({ budget: 500, riskLevel: 'extreme' });
    expect(res.status).toBe(400);
  });

  test('accepts a valid budget and defaults riskLevel/preferredAsset', async () => {
    BudgetSession.findOne = jest.fn(async () => ({
      sessionKey: 'global', save: jest.fn(async function () { return this; }),
    }));
    VirtualPortfolio.findOneAndUpdate = jest.fn(async () => ({}));
    VirtualTrade.updateMany = jest.fn(async () => ({}));

    const res = await request(app).post('/budget/start').set('x-test-role', 'admin').send({ budget: 750 });

    expect(res.status).toBe(200);
    expect(res.body.session.riskLevel).toBe('medium');
    expect(res.body.session.preferredAsset).toBe('ALL');
  });
});

describe('budgetController.status (general coverage)', () => {
  test('computes sessionPnL, winRate, and totalTrades correctly from portfolio + session snapshot', async () => {
    BudgetSession.findOne = jest.fn(async () => ({
      status: 'active', budget: 1000, riskLevel: 'medium', preferredAsset: 'ALL',
      startedAt: new Date(), snapshotBalance: 1000,
    }));
    VirtualPortfolio.findOne = jest.fn(async () => ({
      currentBalance: 1150, startingBalance: 1000,
      totalProfit: 200, totalLoss: -50,
      winCount: 6, lossCount: 4,
      maxDrawdown: 30, bestTrade: 80, worstTrade: -20,
    }));
    VirtualTrade.countDocuments = jest.fn(async () => 2);

    const { req, res } = fakeReqRes();
    await budgetController.status(req, res);

    expect(res.body.performance.sessionPnL).toBe(150);
    expect(res.body.performance.totalPnL).toBe(150);
    expect(res.body.performance.winRate).toBe(60);
    expect(res.body.performance.totalTrades).toBe(10);
    expect(res.body.performance.activeTrades).toBe(2);
  });

  test('winRate and sessionPnL default safely when no trades / no snapshot yet exist', async () => {
    BudgetSession.findOne = jest.fn(async () => ({
      status: 'paused', budget: 500, riskLevel: 'medium', preferredAsset: 'ALL',
      startedAt: null, snapshotBalance: null,
    }));
    VirtualPortfolio.findOne = jest.fn(async () => ({
      currentBalance: 500, startingBalance: 500,
      totalProfit: 0, totalLoss: 0, winCount: 0, lossCount: 0,
      maxDrawdown: 0, bestTrade: null, worstTrade: null,
    }));
    VirtualTrade.countDocuments = jest.fn(async () => 0);

    const { req, res } = fakeReqRes();
    await budgetController.status(req, res);

    expect(res.body.performance.sessionPnL).toBe(0);
    expect(res.body.performance.winRate).toBe(0);
    expect(res.body.performance.totalTrades).toBe(0);
  });
});

describe('budgetController.report (general coverage)', () => {
  test('defaults to the daily (1d) range and shapes the summary passthrough correctly', async () => {
    const fakeSummary = {
      totalTrades: 5, openTrades: 1, winCount: 3, lossCount: 2, winRate: 60,
      avgDurationMinutes: 45, totalPnl: 20, totalProfit: 30, totalLoss: -10,
      netProfitPct: 2, currentBalance: 1020, startingBalance: 1000,
      maxDrawdown: 5, peakBalance: 1030, bestTrade: 15, worstTrade: -5,
      balanceHistory: Array.from({ length: 60 }, (_, i) => ({ t: i, balance: 1000 + i })),
    };
    virtualTrackingService.getSummary.mockResolvedValue(fakeSummary);
    BudgetSession.findOne = jest.fn(async () => ({
      status: 'active', budget: 1000, riskLevel: 'medium', startedAt: new Date(),
    }));

    const { req, res } = fakeReqRes({}, {});
    await budgetController.report(req, res);

    expect(virtualTrackingService.getSummary).toHaveBeenCalledWith('1d');
    expect(res.body.period).toBe('Last 24 hours');
    expect(res.body.pnl.net).toBe(20);
    // balanceHistory is capped to the last 50 entries
    expect(res.body.balanceHistory.length).toBe(50);
  });

  test('uses the weekly (7d) range when range=weekly is passed', async () => {
    virtualTrackingService.getSummary.mockResolvedValue({
      totalTrades: 0, openTrades: 0, winCount: 0, lossCount: 0, winRate: 0,
      avgDurationMinutes: 0, totalPnl: 0, totalProfit: 0, totalLoss: 0,
      netProfitPct: 0, currentBalance: 500, startingBalance: 500,
      maxDrawdown: 0, peakBalance: 500, bestTrade: null, worstTrade: null,
      balanceHistory: [],
    });
    BudgetSession.findOne = jest.fn(async () => null);

    const { req, res } = fakeReqRes({}, { range: 'weekly' });
    await budgetController.report(req, res);

    expect(virtualTrackingService.getSummary).toHaveBeenCalledWith('7d');
    expect(res.body.period).toBe('Last 7 days');
    expect(res.body.session).toBeNull();
  });
});
