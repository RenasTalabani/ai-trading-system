/**
 * Regression suite for T-054 (2026-08-26, overnight continuous-improvement
 * pass). Zero prior test coverage existed for trackerEvalJob.js.
 *
 * trackerEvalJob.js is a SEPARATE, independent implementation of the same
 * "evaluate pending AI recommendations" logic as trackerController.js's
 * evaluate() (fixed for T-052) -- and it's the one that actually runs
 * automatically in production (node-cron, every 2 hours), unlike
 * trackerController.js's evaluate() which is only reached via an
 * admin-only manual HTTP call. T-052's fix never touched this file.
 *
 * Its zero-price guard (`!rec.priceAtRecommendation`) already correctly
 * caught exactly 0 (JS falsy), but NOT a negative price. A negative
 * priceAtRecommendation isn't reachable through any current write path
 * (store()'s validator rejects it post-T-052; advisorController's
 * _autoTrack() only ever writes 0 or a real positive price, and T-054
 * closes the 0 case there too), so this pass strengthens the guard to
 * `!(rec.priceAtRecommendation > 0)` purely as defense-in-depth, matching
 * T-052's established pattern, in case a bad record ever reaches this
 * collection some other way.
 */

jest.mock('axios');
const axios = require('axios');

const AIRecommendation = require('../src/models/AIRecommendation');
const { evaluatePending } = require('../src/jobs/trackerEvalJob');

function fakeBulk() {
  const ops = [];
  return {
    ops,
    find(filter) {
      return {
        updateOne(update) {
          ops.push({ filter, update });
        },
      };
    },
    execute: jest.fn(async () => ({ modifiedCount: ops.length })),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('T-054 regression guard: evaluatePending() defense-in-depth price guard', () => {
  test('skips a pending record with priceAtRecommendation=0 (already worked before this pass)', async () => {
    AIRecommendation.find = jest.fn(() => ({ limit: () => ({ lean: async () => [
      { _id: 'z1', asset: 'BTCUSDT', action: 'BUY', priceAtRecommendation: 0, expiresAt: new Date(0) },
    ] }) }));
    const bulk = fakeBulk();
    AIRecommendation.collection = { initializeUnorderedBulkOp: () => bulk };
    axios.get.mockResolvedValue({ data: { price: 51000 } });

    await evaluatePending();

    expect(bulk.ops).toHaveLength(0);
    expect(bulk.execute).not.toHaveBeenCalled();
  });

  test('now also skips a pending record with a negative priceAtRecommendation (T-054 fix)', async () => {
    AIRecommendation.find = jest.fn(() => ({ limit: () => ({ lean: async () => [
      { _id: 'z2', asset: 'BTCUSDT', action: 'BUY', priceAtRecommendation: -10, expiresAt: new Date(0) },
    ] }) }));
    const bulk = fakeBulk();
    AIRecommendation.collection = { initializeUnorderedBulkOp: () => bulk };
    axios.get.mockResolvedValue({ data: { price: 51000 } });

    await evaluatePending();

    expect(bulk.ops).toHaveLength(0);
    expect(bulk.execute).not.toHaveBeenCalled();
  });
});

describe('evaluatePending() (general coverage)', () => {
  test('evaluates a valid BUY record correctly and marks it evaluated', async () => {
    AIRecommendation.find = jest.fn(() => ({ limit: () => ({ lean: async () => [
      { _id: 'r1', asset: 'BTCUSDT', action: 'BUY', priceAtRecommendation: 100, expiresAt: new Date(0) },
    ] }) }));
    const bulk = fakeBulk();
    AIRecommendation.collection = { initializeUnorderedBulkOp: () => bulk };
    axios.get.mockResolvedValue({ data: { price: 110 } });

    await evaluatePending();

    expect(bulk.ops).toHaveLength(1);
    expect(bulk.ops[0].filter).toEqual({ _id: 'r1' });
    expect(bulk.ops[0].update.$set.wasCorrect).toBe(true);
    expect(bulk.ops[0].update.$set.actualReturnPct).toBe(10);
    expect(bulk.execute).toHaveBeenCalledTimes(1);
  });

  test('batches price lookups by unique asset (one axios call per distinct asset, not per record)', async () => {
    AIRecommendation.find = jest.fn(() => ({ limit: () => ({ lean: async () => [
      { _id: 'a1', asset: 'BTCUSDT', action: 'BUY', priceAtRecommendation: 100, expiresAt: new Date(0) },
      { _id: 'a2', asset: 'BTCUSDT', action: 'SELL', priceAtRecommendation: 200, expiresAt: new Date(0) },
      { _id: 'a3', asset: 'ETHUSDT', action: 'BUY', priceAtRecommendation: 50, expiresAt: new Date(0) },
    ] }) }));
    const bulk = fakeBulk();
    AIRecommendation.collection = { initializeUnorderedBulkOp: () => bulk };
    axios.get.mockImplementation((url) => {
      if (url.includes('ETHUSDT')) return Promise.resolve({ data: { price: 55 } });
      return Promise.resolve({ data: { price: 90 } });
    });

    await evaluatePending();

    expect(axios.get).toHaveBeenCalledTimes(2);
    expect(bulk.ops).toHaveLength(3);
  });

  test('a price-fetch failure for one asset does not abort evaluation of records for other assets', async () => {
    AIRecommendation.find = jest.fn(() => ({ limit: () => ({ lean: async () => [
      { _id: 'f1', asset: 'DEADCOIN', action: 'BUY', priceAtRecommendation: 1, expiresAt: new Date(0) },
      { _id: 'f2', asset: 'BTCUSDT', action: 'BUY', priceAtRecommendation: 100, expiresAt: new Date(0) },
    ] }) }));
    const bulk = fakeBulk();
    AIRecommendation.collection = { initializeUnorderedBulkOp: () => bulk };
    axios.get.mockImplementation((url) => {
      if (url.includes('DEADCOIN')) return Promise.reject(new Error('404'));
      return Promise.resolve({ data: { price: 110 } });
    });

    await evaluatePending();

    expect(bulk.ops).toHaveLength(1);
    expect(bulk.ops[0].filter).toEqual({ _id: 'f2' });
  });

  test('no pending records returns early without querying prices', async () => {
    AIRecommendation.find = jest.fn(() => ({ limit: () => ({ lean: async () => [] }) }));
    await evaluatePending();
    expect(axios.get).not.toHaveBeenCalled();
  });
});
