/**
 * Regression suite for T-052 (2026-08-26, overnight continuous-improvement
 * pass). Zero prior test coverage existed for trackerController.js.
 *
 * Bug: store()'s validator accepted `priceAtRecommendation: 0`
 * (`isFloat({ min: 0 })` -- min is inclusive) from ANY authenticated user
 * (the /store route only requires `protect`, not `authorize('admin')`).
 * evaluate() -- run by an admin-only cron endpoint -- then divides by
 * rec.priceAtRecommendation with no zero-guard:
 *
 *   const actualReturn = priceDiff / rec.priceAtRecommendation * 100;
 *
 * A stored price of exactly 0 makes this Infinity (or NaN for a 0/0 case),
 * which gets persisted as actualReturnPct/profitIfFollowed on that record.
 * accuracy()'s aggregate `avgProfitPerTrade` then sums every evaluated
 * record's profitIfFollowed -- once a single Infinity value enters that
 * sum, avgProfitPerTrade is permanently Infinity (shown to ALL users) until
 * the one bad record is manually removed from the database.
 *
 * Fixed two ways:
 *   1. store()'s validator tightened from `isFloat({ min: 0 })` to
 *      `isFloat({ gt: 0 })`, rejecting exactly-zero (and negative) prices
 *      at write time with a 400.
 *   2. evaluate() now skips any pending record whose priceAtRecommendation
 *      is not strictly positive (defense-in-depth, in case a bad record
 *      already exists from before the validation fix).
 *
 * All Mongoose model methods and axios are monkey-patched; no real DB or
 * network connection is used, following the pattern in
 * priceAlertJob.test.js / inputValidation.test.js.
 */
const express = require('express');
const request = require('supertest');

jest.mock('../src/middleware/auth', () => ({
  protect: (req, res, next) => {
    req.user = { _id: 'user1', id: 'user1', role: 'user' };
    next();
  },
  authorize: () => (req, res, next) => next(),
}));

jest.mock('axios');
const axios = require('axios');

const AIRecommendation = require('../src/models/AIRecommendation');
const trackerRouter    = require('../src/routes/tracker');
const trackerController = require('../src/controllers/trackerController');

function appFor(routePath, router) {
  const app = express();
  app.use(express.json());
  app.use(routePath, router);
  app.use((err, req, res, _next) => res.status(500).json({ error: err.message }));
  return app;
}

const app = appFor('/tracker', trackerRouter);

beforeEach(() => {
  jest.clearAllMocks();
});

describe('POST /tracker/store validation (T-052 regression guard)', () => {
  const validBody = {
    asset: 'BTCUSDT', action: 'BUY', confidence: 70,
    timeframe: '4h', priceAtRecommendation: 50000,
  };

  test('rejects priceAtRecommendation of exactly 0', async () => {
    AIRecommendation.create = jest.fn();
    const res = await request(app).post('/tracker/store').send({ ...validBody, priceAtRecommendation: 0 });
    expect(res.status).toBe(400);
    expect(AIRecommendation.create).not.toHaveBeenCalled();
  });

  test('rejects a negative priceAtRecommendation', async () => {
    AIRecommendation.create = jest.fn();
    const res = await request(app).post('/tracker/store').send({ ...validBody, priceAtRecommendation: -5 });
    expect(res.status).toBe(400);
    expect(AIRecommendation.create).not.toHaveBeenCalled();
  });

  test('accepts a valid positive priceAtRecommendation', async () => {
    AIRecommendation.create = jest.fn(async (doc) => ({ _id: 'rec1', ...doc }));
    const res = await request(app).post('/tracker/store').send(validBody);
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(AIRecommendation.create).toHaveBeenCalledWith(
      expect.objectContaining({ priceAtRecommendation: 50000, asset: 'BTCUSDT', action: 'BUY' })
    );
  });

  test('rejects missing required fields', async () => {
    AIRecommendation.create = jest.fn();
    const res = await request(app).post('/tracker/store').send({});
    expect(res.status).toBe(400);
  });
});

function fakeReqRes() {
  const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  return { req: {}, res };
}

describe('exports.evaluate (T-052 regression guard + general coverage)', () => {
  test('skips a pending record with priceAtRecommendation=0 instead of corrupting stats', async () => {
    AIRecommendation.find = jest.fn(() => ({
      limit: () => ({
        lean: async () => [{ _id: 'bad1', asset: 'BTCUSDT', action: 'BUY', priceAtRecommendation: 0 }],
      }),
    }));
    AIRecommendation.updateOne = jest.fn();

    const { req, res } = fakeReqRes();
    await trackerController.evaluate(req, res);

    expect(AIRecommendation.updateOne).not.toHaveBeenCalled();
    expect(res.body).toEqual({ success: true, evaluated: 0, found: 1 });
  });

  test('skips a pending record with a negative priceAtRecommendation', async () => {
    AIRecommendation.find = jest.fn(() => ({
      limit: () => ({
        lean: async () => [{ _id: 'bad2', asset: 'BTCUSDT', action: 'SELL', priceAtRecommendation: -10 }],
      }),
    }));
    AIRecommendation.updateOne = jest.fn();

    const { req, res } = fakeReqRes();
    await trackerController.evaluate(req, res);

    expect(AIRecommendation.updateOne).not.toHaveBeenCalled();
    expect(res.body.evaluated).toBe(0);
  });

  test('BUY correctly marked wasCorrect=true when price rose', async () => {
    AIRecommendation.find = jest.fn(() => ({
      limit: () => ({
        lean: async () => [{ _id: 'r1', asset: 'BTCUSDT', action: 'BUY', priceAtRecommendation: 100 }],
      }),
    }));
    axios.get.mockResolvedValue({ data: { price: 110 } });
    AIRecommendation.updateOne = jest.fn();

    const { req, res } = fakeReqRes();
    await trackerController.evaluate(req, res);

    expect(AIRecommendation.updateOne).toHaveBeenCalledWith(
      { _id: 'r1' },
      expect.objectContaining({ wasCorrect: true, actualReturnPct: 10, profitIfFollowed: 10 })
    );
    expect(res.body.evaluated).toBe(1);
  });

  test('SELL correctly marked wasCorrect=true and profit positive when price fell', async () => {
    AIRecommendation.find = jest.fn(() => ({
      limit: () => ({
        lean: async () => [{ _id: 'r2', asset: 'BTCUSDT', action: 'SELL', priceAtRecommendation: 100 }],
      }),
    }));
    axios.get.mockResolvedValue({ data: { price: 90 } });
    AIRecommendation.updateOne = jest.fn();

    const { req, res } = fakeReqRes();
    await trackerController.evaluate(req, res);

    expect(AIRecommendation.updateOne).toHaveBeenCalledWith(
      { _id: 'r2' },
      expect.objectContaining({ wasCorrect: true, actualReturnPct: -10, profitIfFollowed: 10 })
    );
  });

  test('SELL marked wasCorrect=false and profit negative when price rose', async () => {
    AIRecommendation.find = jest.fn(() => ({
      limit: () => ({
        lean: async () => [{ _id: 'r3', asset: 'BTCUSDT', action: 'SELL', priceAtRecommendation: 100 }],
      }),
    }));
    axios.get.mockResolvedValue({ data: { price: 110 } });
    AIRecommendation.updateOne = jest.fn();

    const { req, res } = fakeReqRes();
    await trackerController.evaluate(req, res);

    expect(AIRecommendation.updateOne).toHaveBeenCalledWith(
      { _id: 'r3' },
      expect.objectContaining({ wasCorrect: false, profitIfFollowed: -10 })
    );
  });

  test('wasCorrect and profit sign always agree (invariant across BUY/SELL)', async () => {
    const cases = [
      { action: 'BUY',  entry: 100, exit: 120 }, // win
      { action: 'BUY',  entry: 100, exit: 80 },  // loss
      { action: 'SELL', entry: 100, exit: 80 },  // win
      { action: 'SELL', entry: 100, exit: 120 }, // loss
    ];
    for (const c of cases) {
      AIRecommendation.find = jest.fn(() => ({
        limit: () => ({
          lean: async () => [{ _id: 'x', asset: 'BTCUSDT', action: c.action, priceAtRecommendation: c.entry }],
        }),
      }));
      axios.get.mockResolvedValue({ data: { price: c.exit } });
      let captured;
      AIRecommendation.updateOne = jest.fn((_, update) => { captured = update; });

      const { req, res } = fakeReqRes();
      await trackerController.evaluate(req, res);

      expect((captured.profitIfFollowed > 0)).toBe(captured.wasCorrect);
    }
  });

  test('no pending records returns evaluated: 0 without querying axios', async () => {
    AIRecommendation.find = jest.fn(() => ({ limit: () => ({ lean: async () => [] }) }));
    const { req, res } = fakeReqRes();
    await trackerController.evaluate(req, res);
    expect(res.body).toEqual({ success: true, evaluated: 0 });
    expect(axios.get).not.toHaveBeenCalled();
  });

  test('a price-fetch failure for one record does not abort the batch', async () => {
    AIRecommendation.find = jest.fn(() => ({
      limit: () => ({
        lean: async () => [
          { _id: 'fail1', asset: 'DEADCOIN', action: 'BUY', priceAtRecommendation: 1 },
          { _id: 'ok1',   asset: 'BTCUSDT',  action: 'BUY', priceAtRecommendation: 100 },
        ],
      }),
    }));
    axios.get.mockImplementation((url) => {
      if (url.includes('DEADCOIN')) return Promise.reject(new Error('404'));
      return Promise.resolve({ data: { price: 110 } });
    });
    AIRecommendation.updateOne = jest.fn();

    const { req, res } = fakeReqRes();
    await trackerController.evaluate(req, res);

    expect(res.body.evaluated).toBe(1);
    expect(res.body.found).toBe(2);
  });
});

describe('exports.accuracy (general coverage)', () => {
  test('aggregates accuracy, avgProfit, and per-asset stats correctly', async () => {
    AIRecommendation.find = jest.fn((filter) => ({
      lean: async () => {
        if (filter.status === 'evaluated') {
          return [
            { asset: 'BTCUSDT', wasCorrect: true,  profitIfFollowed: 10 },
            { asset: 'BTCUSDT', wasCorrect: false, profitIfFollowed: -5 },
            { asset: 'ETHUSDT', wasCorrect: true,  profitIfFollowed: 3 },
          ];
        }
        return [];
      },
    }));
    AIRecommendation.countDocuments = jest.fn(async () => 2);

    const { req, res } = fakeReqRes();
    await trackerController.accuracy(req, res);

    expect(res.body.total).toBe(3);
    expect(res.body.correct).toBe(2);
    expect(res.body.accuracy).toBe(67);
    expect(Number.isFinite(res.body.avgProfitPerTrade)).toBe(true);
    const btc = res.body.byAsset.find(a => a.asset === 'BTCUSDT');
    expect(btc.total).toBe(2);
    expect(btc.correct).toBe(1);
  });

  test('empty evaluated set returns zeroed-out stats, not NaN/division errors', async () => {
    AIRecommendation.find = jest.fn(() => ({ lean: async () => [] }));
    AIRecommendation.countDocuments = jest.fn(async () => 0);

    const { req, res } = fakeReqRes();
    await trackerController.accuracy(req, res);

    expect(res.body.total).toBe(0);
    expect(res.body.accuracy).toBe(0);
    expect(res.body.avgProfitPerTrade).toBe(0);
    expect(res.body.byAsset).toEqual([]);
  });
});
