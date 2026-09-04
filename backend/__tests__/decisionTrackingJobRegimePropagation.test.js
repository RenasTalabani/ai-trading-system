/**
 * Regression suite for a real bug found 2026-09-04 (overnight
 * continuous-improvement pass): MarketRegimeHistory.result declares WIN/
 * LOSS/OPEN as valid states, and performanceAnalysisJob.js's "Regime WR
 * last 6h" log line aggregates on exactly that field -- but nothing ever
 * wrote it after creation, so it always stayed at its `null` default. That
 * log line has therefore never fired once in production.
 *
 * Fix: aiWorkerService.js now stores `aiDecisionId` on each
 * MarketRegimeHistory record it creates, and evaluateOpenDecisions() here
 * (the one place that already resolves an AIDecision to WIN/LOSS)
 * propagates that same result onto the linked regime-history record too.
 */
jest.mock('axios');
const axios = require('axios');
const logger = require('../src/config/logger');
const AIDecision = require('../src/models/AIDecision');
jest.mock('../src/models/MarketRegimeHistory', () => ({ collection: { initializeUnorderedBulkOp: jest.fn() } }));
const MarketRegimeHistory = require('../src/models/MarketRegimeHistory');
const { evaluateOpenDecisions } = require('../src/jobs/decisionTrackingJob');

function fakeBulk() {
  const ops = [];
  return {
    ops,
    find(filter) { return { updateOne: (update) => ops.push({ filter, update }) }; },
    execute: jest.fn(async () => ({})),
  };
}

let decisionBulk, regimeBulk;

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(logger, 'warn').mockImplementation(() => {});
  jest.spyOn(logger, 'info').mockImplementation(() => {});
  decisionBulk = fakeBulk();
  regimeBulk   = fakeBulk();
  AIDecision.collection = { initializeUnorderedBulkOp: () => decisionBulk };
  MarketRegimeHistory.collection.initializeUnorderedBulkOp.mockImplementation(() => regimeBulk);
});

function decision(overrides = {}) {
  return {
    _id: 'dec1', asset: 'BTCUSDT', action: 'BUY', entryPrice: 60000,
    expiresAt: new Date(0), createdAt: new Date(),
    ...overrides,
  };
}

describe('evaluateOpenDecisions — propagates result onto the linked MarketRegimeHistory record (bug fix, 2026-09-04)', () => {
  test('a WIN queues a MarketRegimeHistory update keyed by aiDecisionId', async () => {
    AIDecision.find = jest.fn(() => ({ limit: () => ({ lean: async () => [decision()] }) }));
    axios.get.mockResolvedValue({ data: { price: 65000 } }); // +8.3% on a BUY -> WIN

    await evaluateOpenDecisions();

    expect(decisionBulk.ops).toHaveLength(1);
    expect(decisionBulk.ops[0].update.$set.result).toBe('WIN');

    expect(regimeBulk.ops).toHaveLength(1);
    expect(regimeBulk.ops[0].filter).toEqual({ aiDecisionId: 'dec1' });
    expect(regimeBulk.ops[0].update.$set.result).toBe('WIN');
    expect(regimeBulk.execute).toHaveBeenCalledTimes(1);
  });

  test('a LOSS propagates LOSS the same way', async () => {
    AIDecision.find = jest.fn(() => ({ limit: () => ({ lean: async () => [decision()] }) }));
    axios.get.mockResolvedValue({ data: { price: 55000 } }); // -8.3% on a BUY -> LOSS

    await evaluateOpenDecisions();

    expect(regimeBulk.ops[0].update.$set.result).toBe('LOSS');
  });

  test('a decision with no live price is skipped entirely — no regime bulk op, no regime bulk.execute() call', async () => {
    AIDecision.find = jest.fn(() => ({ limit: () => ({ lean: async () => [decision({ asset: 'STUCKUSDT' })] }) }));
    axios.get.mockRejectedValue(new Error('502'));

    await evaluateOpenDecisions();

    expect(regimeBulk.ops).toHaveLength(0);
    expect(regimeBulk.execute).not.toHaveBeenCalled();
  });

  test('a decision with no linked MarketRegimeHistory record (zero matches for that op) does not fail the batch', async () => {
    // The fake bulk's execute() always "succeeds" here regardless of match
    // count (matching real MongoDB semantics — a zero-match update is not
    // an error) — this asserts evaluateOpenDecisions() as a whole still
    // completes and the AIDecision itself is still correctly evaluated.
    AIDecision.find = jest.fn(() => ({ limit: () => ({ lean: async () => [decision({ _id: 'orphanDec' })] }) }));
    axios.get.mockResolvedValue({ data: { price: 65000 } });

    await expect(evaluateOpenDecisions()).resolves.not.toThrow();

    expect(decisionBulk.ops[0].update.$set.result).toBe('WIN');
    expect(regimeBulk.ops).toHaveLength(1); // still queued -- whether it matches anything is MongoDB's business, not this job's
  });

  test('a DB error propagating the regime result does not crash evaluateOpenDecisions or lose the real decision update', async () => {
    AIDecision.find = jest.fn(() => ({ limit: () => ({ lean: async () => [decision()] }) }));
    axios.get.mockResolvedValue({ data: { price: 65000 } });
    regimeBulk.execute.mockRejectedValue(new Error('connection reset'));

    await expect(evaluateOpenDecisions()).resolves.not.toThrow();

    expect(decisionBulk.execute).toHaveBeenCalledTimes(1); // the important write still happened
    expect(logger.warn).toHaveBeenCalledWith(expect.stringMatching(/MarketRegimeHistory.*connection reset/));
  });

  test('a HOLD decision still queues a regime update (harmless no-op in practice: aiWorkerService.js never creates a MarketRegimeHistory record for a HOLD opportunity, so this always matches zero documents for that source, but evaluateOpenDecisions() itself doesn\'t know or need to know which AIDecision came from which source)', async () => {
    AIDecision.find = jest.fn(() => ({ limit: () => ({ lean: async () => [decision({ action: 'HOLD' })] }) }));
    axios.get.mockResolvedValue({ data: { price: 60100 } }); // within HOLD's <2% "WIN" band

    await evaluateOpenDecisions();

    expect(decisionBulk.ops[0].update.$set.result).toBe('WIN');
    expect(regimeBulk.ops).toHaveLength(1);
    expect(regimeBulk.ops[0].update.$set.result).toBe('WIN');
  });
});
