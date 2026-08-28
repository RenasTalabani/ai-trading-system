/**
 * Regression suite for T-056 (2026-08-26, overnight continuous-improvement
 * pass; admin-gated 2026-08-28 per owner decision).
 *
 * ORIGINAL FINDING: exactly like T-053's `budget/start`/`budget/stop`,
 * `POST /virtual/reset` and `POST /virtual/set-capital` were gated with
 * `protect` only (no role check). `VirtualPortfolio` (`portfolioKey:
 * 'global'`) and every `VirtualTrade` document are shared, app-wide
 * singletons with no per-user ownership field — so any authenticated user
 * could permanently delete every user's trade history
 * (`VirtualTrade.deleteMany({})`) via `/reset`, or silently overwrite the
 * shared portfolio's capital settings via `/set-capital`. This was flagged
 * as HIGHER urgency than T-053 since `/reset` is data deletion, not a
 * reversible overwrite.
 *
 * OWNER DECISION (2026-08-28): admin-gate both endpoints, matching
 * T-053's resolution and this project's sibling pattern (`authorize
 * ('admin')`). `virtual.js` now reads:
 *
 *   router.post('/reset',       authorize('admin'), [...validators...], ...);
 *   router.post('/set-capital', authorize('admin'), [...validators...], ...);
 *
 * This suite now locks in the FIXED behavior: a non-admin caller is
 * rejected with 403 before validation or the service call ever runs, and
 * an admin caller behaves exactly as any caller did before the fix. See
 * PROJECT_STATUS.md T-056 for the full history.
 *
 * IMPORTANT OPERATIONAL NOTE: same caveat as T-053 — this only protects
 * the app if the owner's own account has role:'admin' in the database.
 */
const express = require('express');
const request = require('supertest');

// Mock `protect` only (auth-by-header for test control); use the REAL
// `authorize` implementation so this suite actually exercises the fix.
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

describe('virtual.js — /reset and /set-capital are admin-only (T-056)', () => {
  let app;

  beforeEach(() => {
    app = appFor();
    virtualTrackingService.resetPortfolio.mockReset().mockResolvedValue(undefined);
    virtualTrackingService.setCapital.mockReset().mockResolvedValue(undefined);
  });

  test('a non-admin user is rejected with 403 and the shared portfolio/trades are never touched', async () => {
    const res = await request(app)
      .post('/api/v1/virtual/reset')
      .set('x-test-role', 'user')
      .send({ startingBalance: 1000, riskPerTradePct: 10 });

    expect(res.status).toBe(403);
    expect(virtualTrackingService.resetPortfolio).not.toHaveBeenCalled();
  });

  test('a non-admin user cannot overwrite the shared portfolio capital settings either', async () => {
    const res = await request(app)
      .post('/api/v1/virtual/set-capital')
      .set('x-test-role', 'user')
      .send({ startingBalance: 2000, riskPerTradePct: 20 });

    expect(res.status).toBe(403);
    expect(virtualTrackingService.setCapital).not.toHaveBeenCalled();
  });

  test('an admin can reset the shared portfolio (same behavior as before the fix)', async () => {
    const res = await request(app)
      .post('/api/v1/virtual/reset')
      .set('x-test-role', 'admin')
      .send({ startingBalance: 1000, riskPerTradePct: 10 });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(virtualTrackingService.resetPortfolio).toHaveBeenCalledTimes(1);
    expect(virtualTrackingService.resetPortfolio).toHaveBeenCalledWith(1000, 10);
  });

  test('an admin resetting with no body still defaults to $500 / 5%', async () => {
    const res = await request(app).post('/api/v1/virtual/reset').set('x-test-role', 'admin').send({});

    expect(res.status).toBe(200);
    expect(virtualTrackingService.resetPortfolio).toHaveBeenCalledWith(500, 5);
  });

  test('an admin can overwrite the shared portfolio capital settings', async () => {
    const res = await request(app)
      .post('/api/v1/virtual/set-capital')
      .set('x-test-role', 'admin')
      .send({ startingBalance: 2000, riskPerTradePct: 20 });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(virtualTrackingService.setCapital).toHaveBeenCalledTimes(1);
    expect(virtualTrackingService.setCapital).toHaveBeenCalledWith(2000, 20);
  });

  test('reset still validates its own field bounds for an admin caller (out-of-range startingBalance is rejected)', async () => {
    const res = await request(app)
      .post('/api/v1/virtual/reset')
      .set('x-test-role', 'admin')
      .send({ startingBalance: 5 }); // below the isFloat({min:10}) bound

    expect(res.status).toBe(400);
    expect(virtualTrackingService.resetPortfolio).not.toHaveBeenCalled();
  });

  test('set-capital still validates its own field bounds for an admin caller (riskPerTradePct above 50 is rejected)', async () => {
    const res = await request(app)
      .post('/api/v1/virtual/set-capital')
      .set('x-test-role', 'admin')
      .send({ riskPerTradePct: 90 });

    expect(res.status).toBe(400);
    expect(virtualTrackingService.setCapital).not.toHaveBeenCalled();
  });
});
