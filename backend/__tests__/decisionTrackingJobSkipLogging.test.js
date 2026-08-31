/**
 * T-085 (2026-08-31): evaluateOpenDecisions() used to `continue` silently
 * whenever a decision's price was unavailable -- found live in production:
 * two OPEN decisions (XAUUSD, XAGUSD) sat unevaluated for three straight
 * weeks, silently re-skipped every 15-minute cron cycle, with zero trace in
 * the logs. The only reason this was ever noticed was a user staring at a
 * frozen "If you followed every AI decision" portfolio balance that turned
 * out to be replaying data nearly four months stale (see brainController.js
 * performanceReport()'s T-085 comment for the full root-cause chain).
 *
 * This doesn't change what gets skipped or retried (the 15-minute cron
 * already provides the retry) -- it only makes a skip visible instead of
 * silent, so a decision stuck for weeks shows up in the logs immediately
 * instead of only being discoverable by noticing a frozen UI number months
 * later.
 */
jest.mock('axios');
const axios = require('axios');
const logger = require('../src/config/logger');
const AIDecision = require('../src/models/AIDecision');
const { evaluateOpenDecisions } = require('../src/jobs/decisionTrackingJob');

function fakeBulk() {
  const ops = [];
  return {
    ops,
    find(filter) {
      return { updateOne: (update) => ops.push({ filter, update }) };
    },
    execute: jest.fn(async () => ({})),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(logger, 'warn').mockImplementation(() => {});
  jest.spyOn(logger, 'info').mockImplementation(() => {});
});

describe('evaluateOpenDecisions — skip logging (T-085)', () => {
  test('a decision with no live price available is logged as skipped, not silently dropped', async () => {
    const stuck = {
      _id: 'stuck1', asset: 'XAUUSD', action: 'BUY', entryPrice: 4706.9,
      expiresAt: new Date(0), createdAt: new Date('2026-05-06T20:20:01.684Z'),
    };
    AIDecision.find = jest.fn(() => ({ limit: () => ({ lean: async () => [stuck] }) }));
    const bulk = fakeBulk();
    AIDecision.collection = { initializeUnorderedBulkOp: () => bulk };
    axios.get.mockRejectedValue(new Error('502'));

    await evaluateOpenDecisions();

    expect(bulk.ops).toHaveLength(0);
    expect(bulk.execute).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(expect.stringMatching(/XAUUSD.*no live price available/));
  });

  test('a decision with a missing entryPrice is logged with that specific reason', async () => {
    const bad = {
      _id: 'bad1', asset: 'XAGUSD', action: 'BUY', entryPrice: null,
      expiresAt: new Date(0), createdAt: new Date('2026-05-06T20:20:01.379Z'),
    };
    AIDecision.find = jest.fn(() => ({ limit: () => ({ lean: async () => [bad] }) }));
    const bulk = fakeBulk();
    AIDecision.collection = { initializeUnorderedBulkOp: () => bulk };
    axios.get.mockResolvedValue({ data: { price: 78.0 } });

    await evaluateOpenDecisions();

    expect(bulk.ops).toHaveLength(0);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringMatching(/XAGUSD.*entryPrice missing/));
  });

  test('a normal successful evaluation is unaffected — no warn, decision evaluated (regression)', async () => {
    const ok = {
      _id: 'ok1', asset: 'BTCUSDT', action: 'BUY', entryPrice: 60000,
      expiresAt: new Date(0), createdAt: new Date(),
    };
    AIDecision.find = jest.fn(() => ({ limit: () => ({ lean: async () => [ok] }) }));
    const bulk = fakeBulk();
    AIDecision.collection = { initializeUnorderedBulkOp: () => bulk };
    axios.get.mockResolvedValue({ data: { price: 65000 } });

    await evaluateOpenDecisions();

    expect(bulk.ops).toHaveLength(1);
    expect(bulk.execute).toHaveBeenCalledTimes(1);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  test('one stuck asset does not block evaluation of a different, healthy asset in the same batch', async () => {
    const stuck = {
      _id: 'stuck2', asset: 'XAUUSD', action: 'BUY', entryPrice: 4706.9,
      expiresAt: new Date(0), createdAt: new Date(),
    };
    const ok = {
      _id: 'ok2', asset: 'BTCUSDT', action: 'BUY', entryPrice: 60000,
      expiresAt: new Date(0), createdAt: new Date(),
    };
    AIDecision.find = jest.fn(() => ({ limit: () => ({ lean: async () => [stuck, ok] }) }));
    const bulk = fakeBulk();
    AIDecision.collection = { initializeUnorderedBulkOp: () => bulk };
    axios.get.mockImplementation((url) => {
      if (url.includes('XAUUSD')) return Promise.reject(new Error('timeout'));
      return Promise.resolve({ data: { price: 65000 } });
    });

    await evaluateOpenDecisions();

    expect(bulk.ops).toHaveLength(1);
    expect(bulk.ops[0].filter).toEqual({ _id: 'ok2' });
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });
});
