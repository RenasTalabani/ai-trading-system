/**
 * Regression suite for T-053 (2026-08-26, overnight continuous-improvement
 * pass). Zero prior test coverage existed for budgetController.js.
 *
 * FINDING (owner decision, no source change made this pass): `BudgetSession`
 * (`sessionKey: 'global'`) and `VirtualPortfolio` (`portfolioKey: 'global'`)
 * are both app-wide singletons — there is exactly one AI paper-trading
 * "budget manager" shared by every user of the app, not one per user. Its
 * routes (`backend/src/routes/budget.js`) gate every endpoint with `protect`
 * only:
 *
 *   router.post('/start', protect, ...ctrl.start);
 *   router.post('/stop',  protect, ctrl.stop);
 *
 * `protect` only requires a valid JWT — it does NOT check `role`. Self-
 * registration (`POST /api/v1/auth/register`, `routes/auth.js`) is open to
 * anyone and always creates `role: 'user'` (`models/User.js`), never
 * 'admin'. So today, ANY authenticated user of the app — not just an admin —
 * can:
 *
 *   - POST /budget/start with any budget $1..$1,000,000: this WIPES the
 *     single shared VirtualPortfolio (totalProfit, totalLoss, winCount,
 *     lossCount, peakBalance, maxDrawdown, bestTrade, worstTrade,
 *     balanceHistory — the whole performance history shown to every user)
 *     and resets it to their chosen starting budget, AND force-closes every
 *     currently open virtual trade system-wide
 *     (`VirtualTrade.updateMany({status:'open'}, {$set:{status:'expired',
 *     exitReason:'session_reset'}})` — not scoped to the caller, ALL open
 *     trades for ALL users/sources).
 *   - POST /budget/stop: pauses the shared AI budget manager for everyone.
 *
 * This is the same class of gap as T-052 (a state-mutating endpoint
 * reachable by a caller with less privilege than the mutation warrants), but
 * unlike T-052 there is no single unambiguous fix here: this project's own
 * sibling endpoints show BOTH patterns already in use for endpoints that
 * mutate this same kind of global state --
 *   `routes/signals.js`:  `router.post('/scan', authorize('admin'), ...)`
 *   `routes/tracker.js`:  `router.post('/evaluate', authorize('admin'), ...)`
 * -- which argues start/stop should be admin-gated too. But the Flutter
 * mobile app's Start/Stop budget-manager controls
 * (`mobile/lib/core/providers/budget_provider.dart`) are wired for ANY
 * signed-in user with no role check on the client side either, and there is
 * no web/admin dashboard in this repo — meaning the feature was built
 * end-to-end (backend route + mobile UI) as available to any account.
 * Whether that's an intentional "this app is for a small set of trusted
 * accounts, all users are treated as trusted" design, or an oversight that
 * missed the `authorize('admin')` pattern used elsewhere, is a product/
 * access-control decision, not a code-correctness bug — and naively adding
 * `authorize('admin')` risks locking the owner's own mobile app out of its
 * core interactive feature if the owner's own account isn't flagged admin.
 * See PROJECT_STATUS.md T-053 for the full options writeup.
 *
 * This pass adds first-ever test coverage for budgetController.js and locks
 * in CURRENT behavior (non-admin start/stop succeeds) as an explicit
 * regression guard, without changing any authorization or trading logic.
 */
const express = require('express');
const request = require('supertest');

jest.mock('../src/middleware/auth', () => ({
  protect: (req, res, next) => {
    // Deliberately role:'user' (NOT admin) -- this is the exact caller
    // shape T-053 documents as currently able to reach these routes.
    req.user = { _id: 'user1', id: 'user1', role: 'user' };
    next();
  },
  authorize: () => (req, res, next) => next(),
}));

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

describe('T-053 regression guard: budget/start and budget/stop are reachable by a non-admin user', () => {
  test('a role:"user" (non-admin) caller can start the shared budget session and it wipes/resets global state', async () => {
    BudgetSession.findOne = jest.fn(async () => ({
      sessionKey: 'global', status: 'paused', save: jest.fn(async function () { return this; }),
    }));
    VirtualPortfolio.findOneAndUpdate = jest.fn(async () => ({}));
    VirtualTrade.updateMany = jest.fn(async () => ({ modifiedCount: 3 }));

    const res = await request(app).post('/budget/start').send({ budget: 1000 });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    // Confirms the non-admin caller's request really did reach and mutate
    // the GLOBAL singleton, not something scoped to them.
    expect(VirtualPortfolio.findOneAndUpdate).toHaveBeenCalledWith(
      { portfolioKey: 'global' },
      expect.objectContaining({ startingBalance: 1000, currentBalance: 1000 }),
      expect.objectContaining({ upsert: true }),
    );
    // Confirms it force-closes ALL open trades system-wide, not just the
    // caller's own.
    expect(VirtualTrade.updateMany).toHaveBeenCalledWith(
      { status: 'open' },
      { $set: { status: 'expired', exitReason: 'session_reset' } },
    );
  });

  test('a role:"user" (non-admin) caller can pause the shared budget session', async () => {
    const save = jest.fn(async function () { return this; });
    BudgetSession.findOne = jest.fn(async () => ({ sessionKey: 'global', status: 'active', save }));

    const res = await request(app).post('/budget/stop').send({});

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(save).toHaveBeenCalled();
  });
});

describe('budgetController.start validation (general coverage)', () => {
  test('rejects a budget below the $1 minimum', async () => {
    const res = await request(app).post('/budget/start').send({ budget: 0 });
    expect(res.status).toBe(400);
  });

  test('rejects a budget above the $1,000,000 maximum', async () => {
    const res = await request(app).post('/budget/start').send({ budget: 1_000_001 });
    expect(res.status).toBe(400);
  });

  test('rejects an invalid riskLevel', async () => {
    const res = await request(app).post('/budget/start').send({ budget: 500, riskLevel: 'extreme' });
    expect(res.status).toBe(400);
  });

  test('accepts a valid budget and defaults riskLevel/preferredAsset', async () => {
    BudgetSession.findOne = jest.fn(async () => ({
      sessionKey: 'global', save: jest.fn(async function () { return this; }),
    }));
    VirtualPortfolio.findOneAndUpdate = jest.fn(async () => ({}));
    VirtualTrade.updateMany = jest.fn(async () => ({}));

    const res = await request(app).post('/budget/start').send({ budget: 750 });

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
