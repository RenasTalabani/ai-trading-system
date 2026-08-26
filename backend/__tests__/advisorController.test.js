/**
 * Regression suite for T-054 (2026-08-26, overnight continuous-improvement
 * pass). Zero prior test coverage existed for advisorController.js.
 *
 * Bug: `_autoTrack()` (called fire-and-forget from `analyze()` after every
 * successful ai-service call) built AIRecommendation docs with
 * `priceAtRecommendation: tf.current_price || 0` and inserted them via
 * `AIRecommendation.insertMany()` -- a raw model write that bypasses
 * `trackerController.js`'s store() express-validator entirely (that
 * validator only runs on the POST /tracker/store HTTP path). Whenever
 * ai-service returned a timeframe recommendation with a missing/zero
 * current_price, this silently created a permanently-untrackable record:
 * with priceAtRecommendation=0, neither evaluate() implementation
 * (trackerController.js's admin endpoint or trackerEvalJob.js's cron) can
 * ever evaluate it -- it stays status:'pending' forever and is
 * re-fetched/re-skipped by the tracker-eval cron every 2 hours,
 * indefinitely, permanently occupying a slot in that query's result limit.
 *
 * Fixed by filtering out any timeframe rec with a non-positive/missing
 * current_price BEFORE building docs, so such recs are never inserted at
 * all (root-cause fix, mirrors T-052's principle at the other write path).
 */
const express = require('express');
const request = require('supertest');

jest.mock('../src/middleware/auth', () => ({
  protect: (req, res, next) => { req.user = { _id: 'user1', id: 'user1', role: 'user' }; next(); },
  authorize: () => (req, res, next) => next(),
}));

jest.mock('axios');
const axios = require('axios');

const AIRecommendation = require('../src/models/AIRecommendation');
const advisorRouter    = require('../src/routes/advisor');

function appFor(routePath, router) {
  const app = express();
  app.use(express.json());
  app.use(routePath, router);
  app.use((err, req, res, _next) => res.status(500).json({ error: err.message }));
  return app;
}

const app = appFor('/advisor', advisorRouter);

beforeEach(() => {
  jest.clearAllMocks();
  AIRecommendation.insertMany = jest.fn(async () => []);
});

describe('T-054 regression guard: _autoTrack() no longer creates zero-price zombie records', () => {
  test('a timeframe rec with no current_price is dropped, not inserted with priceAtRecommendation=0', async () => {
    axios.post.mockResolvedValue({
      data: {
        asset: 'BTCUSDT',
        timeframes: [
          { timeframe: '1h', action: 'BUY', confidence: 70, current_price: 50000 },
          { timeframe: '4h', action: 'BUY', confidence: 65 /* no current_price -- degraded ai-service response */ },
        ],
      },
    });

    await request(app).post('/advisor/analyze').send({ asset: 'BTCUSDT' });

    expect(AIRecommendation.insertMany).toHaveBeenCalledTimes(1);
    const [docs] = AIRecommendation.insertMany.mock.calls[0];
    expect(docs).toHaveLength(1);
    expect(docs[0]).toEqual(expect.objectContaining({ timeframe: '1h', priceAtRecommendation: 50000 }));
    expect(docs.some(d => d.priceAtRecommendation === 0)).toBe(false);
  });

  test('a timeframe rec with current_price: 0 is dropped the same way', async () => {
    axios.post.mockResolvedValue({
      data: {
        asset: 'ETHUSDT',
        timeframes: [{ timeframe: '1d', action: 'SELL', confidence: 80, current_price: 0 }],
      },
    });

    await request(app).post('/advisor/analyze').send({ asset: 'ETHUSDT' });

    expect(AIRecommendation.insertMany).not.toHaveBeenCalled();
  });

  test('a negative current_price is also dropped (defensive, not just falsy)', async () => {
    axios.post.mockResolvedValue({
      data: {
        asset: 'ETHUSDT',
        timeframes: [{ timeframe: '1d', action: 'SELL', confidence: 80, current_price: -5 }],
      },
    });

    await request(app).post('/advisor/analyze').send({ asset: 'ETHUSDT' });

    expect(AIRecommendation.insertMany).not.toHaveBeenCalled();
  });

  test('all-valid recommendations are still auto-tracked exactly as before (no over-filtering)', async () => {
    axios.post.mockResolvedValue({
      data: {
        asset: 'SOLUSDT',
        timeframes: [
          { timeframe: '1h', action: 'BUY', confidence: 70, current_price: 150.5 },
          { timeframe: '4h', action: 'HOLD', confidence: 55, current_price: 151.2 },
        ],
      },
    });

    const res = await request(app).post('/advisor/analyze').send({ asset: 'SOLUSDT' });

    expect(res.status).toBe(200);
    expect(AIRecommendation.insertMany).toHaveBeenCalledTimes(1);
    const [docs] = AIRecommendation.insertMany.mock.calls[0];
    expect(docs).toHaveLength(2);
  });
});

describe('advisorController (general coverage)', () => {
  test('GET /advisor/supported returns the static asset/timeframe lists', async () => {
    const res = await request(app).get('/advisor/supported');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.assets).toContain('BTCUSDT');
    expect(res.body.timeframes).toEqual(['1h', '4h', '1d', '7d', '30d']);
  });

  test('analyze() filters unknown timeframes before calling ai-service', async () => {
    axios.post.mockResolvedValue({ data: { asset: 'BTCUSDT', timeframes: [] } });

    await request(app).post('/advisor/analyze').send({ asset: 'BTCUSDT', timeframes: ['1h', 'bogus'] });

    expect(axios.post).toHaveBeenCalledWith(
      expect.stringContaining('/api/advisor/analyze'),
      expect.objectContaining({ asset: 'BTCUSDT', timeframes: ['1h'] }),
      expect.any(Object),
    );
  });

  test('returns 502 when ai-service is unavailable', async () => {
    axios.post.mockRejectedValue(new Error('ECONNREFUSED'));
    const res = await request(app).post('/advisor/analyze').send({ asset: 'BTCUSDT' });
    expect(res.status).toBe(502);
  });
});
