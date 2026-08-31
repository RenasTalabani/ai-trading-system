/**
 * T-083 (2026-08-31): brainController.actionReport(), brainController's
 * _buildAnswer() (via askBrain, intent 'action'/'picks'), and
 * coreController.advice() all previously collapsed two different states
 * into the same 503 "AI Brain is warming up — retry in 30 seconds":
 *   (a) no global scan has completed yet since this instance booted
 *       (getGlobalCache() returns null/undefined) -- genuinely transient.
 *   (b) a scan DID complete but zero assets cleared the confidence/quality
 *       filter (getGlobalCache() returns a cache with result.best === null)
 *       -- a legitimate market-conditions outcome that can persist for
 *       hours, not a "retry in 30 seconds" situation.
 *
 * Reported live 2026-08-31: the mobile Radar screen's brainActionProvider
 * has no error handling around this call, so state (b) being misreported
 * as a 503 surfaced as an unhandled DioException in the UI ("radar is not
 * working at all it says dio expiction"). These tests lock in the fix:
 * state (a) still 503s, state (b) now returns a normal 200 with a
 * null-signal payload (matching guideController.js's existing T-079
 * "no strong recommendation" pattern), and the real-best-picked path is
 * unaffected (regression check).
 */
jest.mock('../src/jobs/globalScanJob', () => ({ getCache: jest.fn() }));

const { getCache: getGlobalCache } = require('../src/jobs/globalScanJob');
const AIDecision = require('../src/models/AIDecision');
const NewsData   = require('../src/models/NewsData');
const brainController = require('../src/controllers/brainController');
const coreController  = require('../src/controllers/coreController');

function mockRes() {
  const res = {};
  res.status = jest.fn(() => res);
  res.json   = jest.fn(() => res);
  return res;
}

function chainReturning(value) {
  return { sort: () => ({ limit: () => ({ lean: async () => value }) }) };
}

const scannedResult = {
  success: true, scanned: 13, passed_filter: 0, blocked: 13,
  best: null, top_opportunities: [],
};

describe('brainController.actionReport — never-scanned vs scanned-with-no-pick (T-083)', () => {
  test('getGlobalCache() === null (never scanned) still returns 503 "warming up"', async () => {
    getGlobalCache.mockReturnValue(null);
    const res = mockRes();

    await brainController.actionReport({}, res);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json.mock.calls[0][0].message).toMatch(/warming up/i);
  });

  test('cache populated but result.best is null now returns 200, not 503', async () => {
    getGlobalCache.mockReturnValue({ result: scannedResult, scannedAt: new Date('2026-08-31T13:15:00Z') });
    const res = mockRes();

    await brainController.actionReport({}, res);

    expect(res.status).not.toHaveBeenCalledWith(503);
    const payload = res.json.mock.calls[0][0];
    expect(payload.success).toBe(true);
    expect(payload.action.bestAsset).toBe('');
    expect(payload.action.action).toBe('HOLD');
    expect(payload.action.confidence).toBe(0);
    expect(payload.action.reason).toMatch(/no strong recommendation/i);
    expect(payload.action.topPicks).toEqual([]);
  });
});

describe('brainController._buildAnswer via askBrain — same distinction for the chat intent (T-083)', () => {
  beforeEach(() => {
    AIDecision.find = jest.fn(() => chainReturning([]));
    AIDecision.countDocuments = jest.fn(async () => 0);
    AIDecision.aggregate = jest.fn(async () => []);
    NewsData.find = jest.fn(() => chainReturning([]));
  });

  test('never scanned: "top picks" question gets the warming-up text', async () => {
    getGlobalCache.mockReturnValue(null);
    const req = { body: { question: 'what are the top picks right now?' } };
    const res = mockRes();

    await brainController.askBrain(req, res);

    const payload = res.json.mock.calls[0][0];
    expect(payload.text).toMatch(/still warming up/i);
  });

  test('scanned with no pick: "top picks" question gets a "no strong recommendation" text, not warming-up', async () => {
    getGlobalCache.mockReturnValue({ result: scannedResult, scannedAt: new Date() });
    const req = { body: { question: 'what are the top picks right now?' } };
    const res = mockRes();

    await brainController.askBrain(req, res);

    const payload = res.json.mock.calls[0][0];
    expect(payload.text).toMatch(/no strong recommendation/i);
    expect(payload.text).not.toMatch(/warming up/i);
  });
});

describe('coreController.advice — same distinction (T-083)', () => {
  test('getGlobalCache() === null (never scanned) still returns 503 "warming up"', async () => {
    getGlobalCache.mockReturnValue(null);
    const res = mockRes();

    await coreController.advice({}, res);

    expect(res.status).toHaveBeenCalledWith(503);
  });

  test('cache populated but result.best is null now returns 200 with advice: null', async () => {
    getGlobalCache.mockReturnValue({ result: scannedResult, scannedAt: new Date() });
    const res = mockRes();

    await coreController.advice({}, res);

    expect(res.status).not.toHaveBeenCalledWith(503);
    const payload = res.json.mock.calls[0][0];
    expect(payload.success).toBe(true);
    expect(payload.advice).toBeNull();
    expect(payload.top_picks).toEqual([]);
  });
});
