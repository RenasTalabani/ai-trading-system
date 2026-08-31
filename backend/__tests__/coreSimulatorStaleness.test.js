/**
 * T-085 (2026-08-31): coreSimulatorController.simulate() ("if you followed
 * every AI decision, how much would you have?") is the same full-replay
 * pattern as brainController.performanceReport() -- see that file's T-085
 * test for the full root-cause evidence trail (nothing had closed in ~4
 * months in production). This locks in the identical staleness fields here.
 */
const AIDecision = require('../src/models/AIDecision');
const coreSimulatorController = require('../src/controllers/coreSimulatorController');

function mockRes() {
  const res = {};
  res.status = jest.fn(() => res);
  res.json   = jest.fn(() => res);
  return res;
}

function chainFind(value) {
  return { sort: () => ({ lean: async () => value }) };
}

describe('coreSimulatorController.simulate — staleness (T-085)', () => {
  test('recent activity: stale is false, no message', async () => {
    const recentDate = new Date(Date.now() - 60 * 60 * 1000);
    AIDecision.find = jest.fn(() => chainFind([{ asset: 'BTCUSDT', result: 'WIN', profitPct: 5, createdAt: recentDate }]));
    AIDecision.findOne = jest.fn(() => ({ sort: () => ({ select: () => ({ lean: async () => ({ createdAt: recentDate }) }) }) }));

    const res = mockRes();
    await coreSimulatorController.simulate({ query: {} }, res);

    const payload = res.json.mock.calls[0][0];
    expect(payload.stale).toBe(false);
    expect(payload.message).toBeUndefined();
  });

  test('~4 months stale: stale is true with an explanatory message, data still returned', async () => {
    const oldDate = new Date('2026-05-06T20:20:01.684Z');
    AIDecision.find = jest.fn(() => chainFind([{ asset: 'WTI', result: 'LOSS', profitPct: -3.6, createdAt: oldDate }]));
    AIDecision.findOne = jest.fn(() => ({ sort: () => ({ select: () => ({ lean: async () => ({ createdAt: oldDate }) }) }) }));

    const res = mockRes();
    await coreSimulatorController.simulate({ query: {} }, res);

    const payload = res.json.mock.calls[0][0];
    expect(payload.stale).toBe(true);
    expect(payload.last_decision_at).toEqual(oldDate);
    expect(payload.message).toMatch(/2026-05-06/);
    expect(payload.total_trades).toBe(1);
  });

  test('zero closed decisions: stale is true even in the early-return branch', async () => {
    AIDecision.find = jest.fn(() => chainFind([]));
    AIDecision.findOne = jest.fn(() => ({ sort: () => ({ select: () => ({ lean: async () => null }) }) }));

    const res = mockRes();
    await coreSimulatorController.simulate({ query: {} }, res);

    const payload = res.json.mock.calls[0][0];
    expect(payload.stale).toBe(true);
    expect(payload.last_decision_at).toBeNull();
    expect(payload.total_trades).toBe(0);
  });
});
