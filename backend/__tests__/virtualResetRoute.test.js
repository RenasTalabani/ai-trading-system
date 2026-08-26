/**
 * Regression suite for T-056 (2026-08-26, overnight continuous-improvement
 * pass). Zero prior route-level test coverage existed for
 * `backend/src/routes/virtual.js`'s `/reset` and `/set-capital` endpoints.
 *
 * FINDING (owner decision, no source change made this pass): exactly like
 * T-053's `budget/start` and `budget/stop`, `POST /virtual/reset` and
 * `POST /virtual/set-capital` are gated with `protect` only:
 *
 *   router.use(protect);
 *   router.post('/reset', [...validators...], async (req, res) => { ... });
 *   router.post('/set-capital', [...validators...], async (req, res) => { ... });
 *
 * `protect` only requires a valid JWT — it does not check `role`, and
 * self-registration always creates `role: 'user'` (see T-053's writeup in
 * `budgetController.test.js` and `PROJECT_STATUS.md`). `VirtualPortfolio`
 * (`portfolioKey: 'global'`) and every `VirtualTrade` document are shared,
 * app-wide singletons with no per-user ownership field at all — so this is
 * the SAME global state T-053 already documented, reached through a
 * different, even more severe endpoint:
 *
 *   - POST /virtual/reset calls virtualTrackingService.resetPortfolio(),
 *     which does `VirtualTrade.deleteMany({})` (permanently deletes EVERY
 *     trade record for EVERY user of the app, not just the caller's own)
 *     followed by `VirtualPortfolio.deleteMany({})` and a fresh
 *     VirtualPortfolio.create() at the caller's chosen starting balance.
 *     This is data destruction, not just a state overwrite like T-053's
 *     budget/start.
 *   - POST /virtual/set-capital calls setCapital(), which overwrites the
 *     shared portfolio's startingBalance/riskPerTradePct for everyone.
 *
 * Confirmed via `mobile/lib/core/providers/virtual_portfolio_provider.dart`
 * that both are called by the Flutter app for any signed-in user with no
 * client-side role check (`ApiService.dio.post('virtual/reset', ...)` /
 * `('virtual/set-capital', ...)`), the same "built end-to-end as available
 * to any account, no separate admin surface exists in this repo" situation
 * T-053 already found for budget/start+stop — so this is not a single
 * unambiguous fix either; see PROJECT_STATUS.md T-056 for the full options
 * writeup, following T-053's precedent.
 *
 * This pass adds first-ever route-level test coverage for these two
 * endpoints and locks in CURRENT behavior (non-admin reset/set-capital
 * succeeds and reaches the underlying service call) as an explicit
 * regression guard, without changing any authorization logic.
 */
const express = require('express');
const request = require('supertest');

jest.mock('../src/middleware/auth', () => ({
  protect: (req, res, next) => {
    // Deliberately role:'user' (NOT admin) -- this is the exact caller
    // shape T-056 documents as currently able to reach these routes.
    req.user = { _id: 'user1', id: 'user1', role: 'user' };
    next();
  },
  authorize: () => (req, res, next) => next(),
}));

// virtual.js destructures `{ resetPortfolio, setCapital, ... }` out of
// virtualTrackingService at require-time, so the test must mutate the SAME
// jest.fn() instances via .mockResolvedValue (not reassign the property to
// a new function afterwards), or the router's already-captured references
// won't see the test's stub.
jest.mock('../src/services/virtualTrackingService', () => ({
  getPerformance: jest.fn(),
  getSummary: jest.fn(),
  resetPortfolio: jest.fn(),
  setCapital: jest.fn(),
  openFuturesTrade: jest.fn(),
  enableTrailingStop: jest.fn(),
  getExposureSummary: jest.fn(),
}));
jest.mock('../src/services/dcaService', () => ({
  startPlan: jest.fn(),
  stopPlan: jest.fn(),
  getPlansWithSummary: jest.fn(),
}));

const virtualTrackingService = require('../src/services/virtualTrackingService');
const virtualRouter = require('../src/routes/virtual');

function appFor() {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/virtual', virtualRouter);
  app.use((err, req, res, _next) => res.status(500).json({ error: err.message }));
  return app;
}

describe('virtual.js — /reset and /set-capital route auth-gating (T-056)', () => {
  let app;

  beforeEach(() => {
    app = appFor();
    virtualTrackingService.resetPortfolio.mockReset().mockResolvedValue(undefined);
    virtualTrackingService.setCapital.mockReset().mockResolvedValue(undefined);
  });

  test('regression: a non-admin user can reset the shared portfolio (wipes all trades for everyone)', async () => {
    const res = await request(app)
      .post('/api/v1/virtual/reset')
      .send({ startingBalance: 1000, riskPerTradePct: 10 });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(virtualTrackingService.resetPortfolio).toHaveBeenCalledTimes(1);
    expect(virtualTrackingService.resetPortfolio).toHaveBeenCalledWith(1000, 10);
  });

  test('regression: reset with no body still succeeds, defaulting to $500 / 5% (no admin check blocks it)', async () => {
    const res = await request(app).post('/api/v1/virtual/reset').send({});

    expect(res.status).toBe(200);
    expect(virtualTrackingService.resetPortfolio).toHaveBeenCalledWith(500, 5);
  });

  test('regression: a non-admin user can overwrite the shared portfolio capital settings', async () => {
    const res = await request(app)
      .post('/api/v1/virtual/set-capital')
      .send({ startingBalance: 2000, riskPerTradePct: 20 });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(virtualTrackingService.setCapital).toHaveBeenCalledTimes(1);
    expect(virtualTrackingService.setCapital).toHaveBeenCalledWith(2000, 20);
  });

  test('reset still validates its own field bounds (out-of-range startingBalance is rejected)', async () => {
    const res = await request(app)
      .post('/api/v1/virtual/reset')
      .send({ startingBalance: 5 }); // below the isFloat({min:10}) bound

    expect(res.status).toBe(400);
    expect(virtualTrackingService.resetPortfolio).not.toHaveBeenCalled();
  });

  test('set-capital still validates its own field bounds (riskPerTradePct above 50 is rejected)', async () => {
    const res = await request(app)
      .post('/api/v1/virtual/set-capital')
      .send({ riskPerTradePct: 90 });

    expect(res.status).toBe(400);
    expect(virtualTrackingService.setCapital).not.toHaveBeenCalled();
  });
});
