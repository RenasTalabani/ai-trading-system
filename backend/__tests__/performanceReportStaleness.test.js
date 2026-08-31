/**
 * T-085 (2026-08-31): brainController.performanceReport() powers the
 * Portfolio screen's "If you followed every AI decision" balance -- a full
 * replay of every closed AIDecision, so it's mathematically frozen for as
 * long as nothing new closes, with nothing in the response to say so.
 * Found live in production: the balance had shown the exact same $304.58
 * for nearly four months (the most recent AIDecision of any kind was from
 * 2026-05-06) because storeGlobalDecision() only fires when a scan's `best`
 * pick is non-null, and the confidence/fused-score filter has been
 * blocking effectively every asset (see T-083/T-084's evidence trail).
 * These tests lock in the new `stale`/`lastDecisionAt` fields so the UI can
 * be honest about replaying old data instead of silently looking broken.
 */
jest.mock('../src/jobs/globalScanJob', () => ({ getCache: jest.fn(() => null) }));

const AIDecision = require('../src/models/AIDecision');
const brainController = require('../src/controllers/brainController');

function mockRes() {
  const res = {};
  res.status = jest.fn(() => res);
  res.json   = jest.fn(() => res);
  return res;
}

function chainFind(value) {
  return { sort: () => ({ lean: async () => value }) };
}

describe('performanceReport — staleness (T-085)', () => {
  test('recent activity (< 24h): stale is false', async () => {
    const recentDate = new Date(Date.now() - 60 * 60 * 1000); // 1h ago
    AIDecision.find = jest.fn((q) => {
      if (q.result?.$in?.includes('WIN')) {
        return chainFind([{ asset: 'BTCUSDT', result: 'WIN', profitPct: 5, createdAt: recentDate }]);
      }
      return { sort: () => ({ limit: () => ({ lean: async () => [] }) }) };
    });
    AIDecision.countDocuments = jest.fn(async () => 0);
    AIDecision.findOne = jest.fn(() => ({ sort: () => ({ select: () => ({ lean: async () => ({ createdAt: recentDate }) }) }) }));

    const res = mockRes();
    await brainController.performanceReport({ query: {} }, res);

    const payload = res.json.mock.calls[0][0];
    expect(payload.stale).toBe(false);
    expect(payload.lastDecisionAt).toEqual(recentDate);
    expect(payload.message).toBeUndefined();
  });

  test('no activity in ~4 months: stale is true with an explanatory message', async () => {
    const oldDate = new Date('2026-05-06T20:20:01.684Z');
    AIDecision.find = jest.fn((q) => {
      if (q.result?.$in?.includes('WIN')) {
        return chainFind([{ asset: 'WTI', result: 'LOSS', profitPct: -3.6, createdAt: oldDate }]);
      }
      return { sort: () => ({ limit: () => ({ lean: async () => [] }) }) };
    });
    AIDecision.countDocuments = jest.fn(async () => 2);
    AIDecision.findOne = jest.fn(() => ({ sort: () => ({ select: () => ({ lean: async () => ({ createdAt: oldDate }) }) }) }));

    const res = mockRes();
    await brainController.performanceReport({ query: {} }, res);

    const payload = res.json.mock.calls[0][0];
    expect(payload.stale).toBe(true);
    expect(payload.lastDecisionAt).toEqual(oldDate);
    expect(payload.message).toMatch(/2026-05-06/);
    expect(payload.message).toMatch(/not live performance/i);
    // Data itself is unaffected -- still the real replayed numbers, just honestly labeled.
    expect(payload.totalTrades).toBe(1);
  });

  test('zero closed decisions ever: stale is true (never scanned / nothing evaluated)', async () => {
    AIDecision.find = jest.fn(() => chainFind([]));
    AIDecision.countDocuments = jest.fn(async () => 0);
    AIDecision.findOne = jest.fn(() => ({ sort: () => ({ select: () => ({ lean: async () => null }) }) }));

    const res = mockRes();
    await brainController.performanceReport({ query: {} }, res);

    const payload = res.json.mock.calls[0][0];
    expect(payload.stale).toBe(true);
    expect(payload.lastDecisionAt).toBeNull();
    expect(payload.totalTrades).toBe(0);
  });
});
