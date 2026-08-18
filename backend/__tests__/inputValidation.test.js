// Route-level input validation tests for the highest-risk previously-
// unvalidated routes (Priority 2 security pass): price alerts (financial
// parameter, user-owned resource), brain "follows" (writes trade-adjacent
// data, user-controlled id), and the guide "sell now" action (user-
// controlled trade id). Mongoose model / controller logic is mocked out —
// these tests only prove the express-validator chain on each route rejects
// bad input with 400 and lets well-formed input through to the controller,
// without needing a DB connection or the ~30s full app boot.

const express = require('express');
const request = require('supertest');

jest.mock('../src/middleware/auth', () => ({
  protect: (req, res, next) => {
    req.user = { _id: 'user1', id: 'user1', role: 'user' };
    next();
  },
  authorize: () => (req, res, next) => next(),
}));

jest.mock('../src/controllers/priceAlertController', () => ({
  list: (req, res) => res.json({ success: true, alerts: [] }),
  create: (req, res) => res.status(201).json({ success: true, alert: req.body }),
  remove: (req, res) => res.json({ success: true }),
  toggle: (req, res) => res.json({ success: true, active: true }),
}));

jest.mock('../src/controllers/brainController', () => ({
  actionReport: (req, res) => res.json({ success: true }),
  performanceReport: (req, res) => res.json({ success: true }),
  brainStats: (req, res) => res.json({ success: true }),
  brainAnalytics: (req, res) => res.json({ success: true }),
  askBrain: (req, res) => res.json({ success: true }),
}));

jest.mock('../src/controllers/userFollowController', () => ({
  list: (req, res) => res.json({ success: true, follows: [] }),
  stats: (req, res) => res.json({ success: true }),
  follow: (req, res) => res.json({ success: true, follow: req.body }),
  close: (req, res) => res.json({ success: true }),
  remove: (req, res) => res.json({ success: true }),
}));

jest.mock('../src/controllers/guideController', () => ({
  getSuggestion: (req, res) => res.json({ success: true }),
  approve: (req, res) => res.json({ success: true }),
  getPositions: (req, res) => res.json({ success: true }),
  sellNow: (req, res) => res.json({ success: true, tradeId: req.params.tradeId }),
}));

function appFor(routePath, router) {
  const app = express();
  app.use(express.json());
  app.use(routePath, router);
  app.use((err, req, res, _next) => res.status(500).json({ error: err.message }));
  return app;
}

describe('POST /price-alerts (validation)', () => {
  const priceAlertsRouter = require('../src/routes/priceAlerts');
  const app = appFor('/price-alerts', priceAlertsRouter);

  test('rejects missing required fields', async () => {
    const res = await request(app).post('/price-alerts').send({});
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  test('rejects a non-numeric targetPrice', async () => {
    const res = await request(app)
      .post('/price-alerts')
      .send({ asset: 'BTCUSDT', targetPrice: 'not-a-number', direction: 'above' });
    expect(res.status).toBe(400);
  });

  test('rejects a negative or zero targetPrice', async () => {
    const res = await request(app)
      .post('/price-alerts')
      .send({ asset: 'BTCUSDT', targetPrice: -5, direction: 'above' });
    expect(res.status).toBe(400);
  });

  test('rejects an invalid direction', async () => {
    const res = await request(app)
      .post('/price-alerts')
      .send({ asset: 'BTCUSDT', targetPrice: 50000, direction: 'sideways' });
    expect(res.status).toBe(400);
  });

  test('accepts a well-formed alert', async () => {
    const res = await request(app)
      .post('/price-alerts')
      .send({ asset: 'BTCUSDT', targetPrice: 50000, direction: 'above' });
    expect(res.status).toBe(201);
  });

  test('rejects a non-ObjectId :id on delete', async () => {
    const res = await request(app).delete('/price-alerts/not-an-id');
    expect(res.status).toBe(400);
  });
});

describe('POST /brain/follows (validation)', () => {
  const brainRouter = require('../src/routes/brain');
  const app = appFor('/brain', brainRouter);

  test('rejects an invalid action', async () => {
    const res = await request(app)
      .post('/brain/follows')
      .send({ asset: 'BTCUSDT', action: 'MAYBE', confidence: 80 });
    expect(res.status).toBe(400);
  });

  test('rejects out-of-range confidence', async () => {
    const res = await request(app)
      .post('/brain/follows')
      .send({ asset: 'BTCUSDT', action: 'BUY', confidence: 150 });
    expect(res.status).toBe(400);
  });

  test('rejects a negative entryPrice', async () => {
    const res = await request(app)
      .post('/brain/follows')
      .send({ asset: 'BTCUSDT', action: 'BUY', confidence: 80, entryPrice: -10 });
    expect(res.status).toBe(400);
  });

  test('accepts a well-formed follow', async () => {
    const res = await request(app)
      .post('/brain/follows')
      .send({ asset: 'BTCUSDT', action: 'BUY', confidence: 80 });
    expect(res.status).toBe(200);
  });

  test('rejects a non-ObjectId :id on close', async () => {
    const res = await request(app).patch('/brain/follows/not-an-id/close').send({});
    expect(res.status).toBe(400);
  });
});

describe('POST /guide/positions/:tradeId/sell (validation)', () => {
  const guideRouter = require('../src/routes/guide');
  const app = appFor('/guide', guideRouter);

  test('rejects a non-ObjectId tradeId', async () => {
    const res = await request(app).post('/guide/positions/not-an-id/sell');
    expect(res.status).toBe(400);
  });

  test('accepts a well-formed ObjectId tradeId', async () => {
    const res = await request(app).post('/guide/positions/507f1f77bcf86cd799439011/sell');
    expect(res.status).toBe(200);
  });
});
