/**
 * Regression suite for the Guide approve() stale-suggestion-identity
 * mismatch bug (2026-09-04, overnight continuous-improvement pass).
 *
 * Bug: resolveSuggestion() is a live, real-time query -- it can legitimately
 * return a DIFFERENT asset/direction on each call (a higher-confidence
 * signal appearing, the previously-suggested asset getting opened
 * elsewhere and excluded via openAssets, or the global-scan cache
 * refreshing every 30 min). The mobile client's approve() used to POST
 * with no body at all, and the backend independently re-called
 * resolveSuggestion() at approval time -- so the suggestion actually
 * approved and traded could differ from whatever the user read and
 * consciously decided to approve on screen, even from ordinary
 * decide-then-tap timing (no background refresh needed). This is the
 * same class of bug as fix/reno-stale-opportunity-approve, but more
 * fundamental since Guide's suggestion screen has no staleness signal at
 * all -- a violation of decision #11's informed-approval intent.
 *
 * Fix: a soft, backward-compatible identity check. When the client sends
 * `asset`/`action` in the POST body, the backend verifies they still
 * match the freshly-resolved suggestion before approving; a mismatch
 * returns 409 { staleApproval: true } instead of silently opening a
 * different trade. Omitting the fields (older clients, and every
 * existing test in guideApprove.test.js) preserves the exact old
 * behavior. This only checks suggestion IDENTITY -- never amount, which
 * stays 100% server-computed (T-071, untouched).
 */
jest.mock('../src/services/virtualTrackingService', () => ({
  approveSuggestion: jest.fn(async (params) => ({
    _id: 'trade1', direction: params.direction, sizeUsd: 42,
  })),
  previewSizeUsd: jest.fn(async () => 50),
  getSummary:     jest.fn(async () => ({ currentBalance: 1000 })),
  closePositionNow: jest.fn(),
}));
jest.mock('../src/jobs/globalScanJob', () => ({ getCache: jest.fn(() => null) }));

const { getCache } = require('../src/jobs/globalScanJob');
const { approveSuggestion } = require('../src/services/virtualTrackingService');
const Signal       = require('../src/models/Signal');
const AIDecision   = require('../src/models/AIDecision');
const VirtualTrade = require('../src/models/VirtualTrade');
const guideController = require('../src/controllers/guideController');

function mockRes() {
  const res = {};
  res.status = jest.fn(() => res);
  res.json   = jest.fn(() => res);
  return res;
}

function mockSignal(overrides) {
  const base = {
    _id: 'sig123', asset: 'BTCUSDT', direction: 'BUY',
    price: { entry: 65000, stopLoss: 63000, takeProfit: 68000 },
    confidence: 80, createdAt: new Date(),
  };
  return { ...base, ...overrides };
}

beforeEach(() => {
  approveSuggestion.mockClear();
  getCache.mockReturnValue(null);
  VirtualTrade.distinct = async () => [];
  AIDecision.findOne = jest.fn(() => ({ sort: () => ({ lean: async () => null }) }));
});

describe('guideController.approve — rejects a stale/mismatched client-echoed suggestion', () => {
  test('matching asset/action proceeds to approve normally', async () => {
    Signal.findOne = () => ({ sort: () => mockSignal() });
    const res = mockRes();

    await guideController.approve({ body: { asset: 'BTCUSDT', action: 'BUY' } }, res);

    expect(approveSuggestion).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalledWith(409);
  });

  test('mismatched asset is rejected with 409 staleApproval and does NOT approve', async () => {
    // Server now resolves to ETHUSDT/SELL -- different from what the client
    // says it displayed and is trying to approve (BTCUSDT/BUY), simulating
    // the suggestion having changed server-side between GET and POST.
    Signal.findOne = () => ({
      sort: () => mockSignal({ _id: 'sig999', asset: 'ETHUSDT', direction: 'SELL' }),
    });
    const res = mockRes();

    await guideController.approve({ body: { asset: 'BTCUSDT', action: 'BUY' } }, res);

    expect(approveSuggestion).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(409);
    const payload = res.json.mock.calls[0][0];
    expect(payload.success).toBe(false);
    expect(payload.staleApproval).toBe(true);
  });

  test('mismatched action alone (same asset, flipped direction) is also rejected', async () => {
    Signal.findOne = () => ({
      sort: () => mockSignal({ asset: 'BTCUSDT', direction: 'SELL' }),
    });
    const res = mockRes();

    await guideController.approve({ body: { asset: 'BTCUSDT', action: 'BUY' } }, res);

    expect(approveSuggestion).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json.mock.calls[0][0].staleApproval).toBe(true);
  });

  test('an empty body (older client, and every existing guideApprove.test.js case) skips the check entirely', async () => {
    Signal.findOne = () => ({ sort: () => mockSignal() });
    const res = mockRes();

    await guideController.approve({}, res);

    expect(approveSuggestion).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalledWith(409);
  });

  test('a body with no asset/action fields at all also skips the check (backward compatible)', async () => {
    Signal.findOne = () => ({ sort: () => mockSignal() });
    const res = mockRes();

    await guideController.approve({ body: {} }, res);

    expect(approveSuggestion).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalledWith(409);
  });
});
