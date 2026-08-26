/**
 * Regression suite for T-058 (2026-08-26, product-to-code audit follow-up).
 *
 * Bug: storeGlobalDecision() only skipped writing a new AIDecision when the
 * *identical* asset+action pair had already been written in the last 15
 * minutes. globalScanJob (every 30 min) plus aiDecisionJob (which just
 * re-triggers the same scan, offset at :15/:45) together produce an
 * effective scan roughly every 15 minutes -- so the window barely outlasted
 * the job's own cadence, and a near-duplicate AIDecision row got written on
 * almost every cycle even when nothing about the market actually changed.
 *
 * Fix: replace the fixed time window with real state-change detection --
 * skip only when action, confidence (within 5pp), and price (within 1.5%)
 * all match the most recent decision for that asset, and that decision
 * isn't older than the 6h staleness ceiling.
 */
const AIDecision = require('../src/models/AIDecision');
const { storeGlobalDecision } = require('../src/jobs/decisionTrackingJob');

function baseBest(overrides = {}) {
  return {
    asset: 'BTCUSDT', action: 'BUY', confidence: 80, current_price: 65000,
    timeframe: '1h', ...overrides,
  };
}

let CREATED;

beforeEach(() => {
  CREATED = [];
  AIDecision.create = async (doc) => { CREATED.push(doc); return { ...doc, _id: 'fake' }; };
});

describe('decisionTrackingJob.storeGlobalDecision — state-change detection (T-058)', () => {
  test('creates a decision when none exists yet for this asset', async () => {
    AIDecision.findOne = () => ({ sort: () => ({ lean: async () => null }) });

    await storeGlobalDecision(baseBest());

    expect(CREATED).toHaveLength(1);
  });

  test('skips creating a new decision when action, confidence, and price are all unchanged and recent', async () => {
    AIDecision.findOne = () => ({
      sort: () => ({
        lean: async () => ({
          action: 'BUY', confidence: 80, entryPrice: 65000,
          createdAt: new Date(Date.now() - 5 * 60 * 1000), // 5 min ago
        }),
      }),
    });

    await storeGlobalDecision(baseBest());

    expect(CREATED).toHaveLength(0);
  });

  test('creates a new decision when the action flips (BUY -> SELL)', async () => {
    AIDecision.findOne = () => ({
      sort: () => ({
        lean: async () => ({
          action: 'SELL', confidence: 80, entryPrice: 65000,
          createdAt: new Date(Date.now() - 5 * 60 * 1000),
        }),
      }),
    });

    await storeGlobalDecision(baseBest({ action: 'BUY' }));

    expect(CREATED).toHaveLength(1);
  });

  test('creates a new decision when confidence moves by more than the 5pp threshold', async () => {
    AIDecision.findOne = () => ({
      sort: () => ({
        lean: async () => ({
          action: 'BUY', confidence: 70, entryPrice: 65000,
          createdAt: new Date(Date.now() - 5 * 60 * 1000),
        }),
      }),
    });

    await storeGlobalDecision(baseBest({ confidence: 80 })); // 10pp jump

    expect(CREATED).toHaveLength(1);
  });

  test('does NOT create a new decision for a small confidence wobble under the threshold', async () => {
    AIDecision.findOne = () => ({
      sort: () => ({
        lean: async () => ({
          action: 'BUY', confidence: 78, entryPrice: 65000,
          createdAt: new Date(Date.now() - 5 * 60 * 1000),
        }),
      }),
    });

    await storeGlobalDecision(baseBest({ confidence: 80 })); // 2pp wobble

    expect(CREATED).toHaveLength(0);
  });

  test('creates a new decision when price moves by more than the 1.5% threshold', async () => {
    AIDecision.findOne = () => ({
      sort: () => ({
        lean: async () => ({
          action: 'BUY', confidence: 80, entryPrice: 65000,
          createdAt: new Date(Date.now() - 5 * 60 * 1000),
        }),
      }),
    });

    await storeGlobalDecision(baseBest({ current_price: 66500 })); // ~2.3% move

    expect(CREATED).toHaveLength(1);
  });

  test('creates a fresh decision once the last one is older than the 6h staleness ceiling, even if unchanged', async () => {
    AIDecision.findOne = () => ({
      sort: () => ({
        lean: async () => ({
          action: 'BUY', confidence: 80, entryPrice: 65000,
          createdAt: new Date(Date.now() - 7 * 60 * 60 * 1000), // 7h ago
        }),
      }),
    });

    await storeGlobalDecision(baseBest());

    expect(CREATED).toHaveLength(1);
  });
});
