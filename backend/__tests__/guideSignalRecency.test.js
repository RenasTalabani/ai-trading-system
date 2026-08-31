/**
 * T-079 (2026-08-31): resolveSuggestion()'s Signal-fallback branch used to
 * pick the highest-confidence status:'active' signal with no age check at
 * all -- confirmed live to serve a signal several hours old over much
 * fresher, lower-confidence ones, for that signal's entire 24h lifetime.
 *
 * Fix: prefer a signal from the last 2h; if none qualifies, widen to 6h
 * and flag the result isOlderSignal:true; if nothing qualifies even within
 * 6h, resolveSuggestion() returns null (the existing "nothing at all"
 * empty state) rather than forcing a stale pick.
 */
jest.mock('../src/jobs/globalScanJob', () => ({ getCache: jest.fn(() => null) }));
jest.mock('../src/services/virtualTrackingService', () => ({
  approveSuggestion: jest.fn(),
  previewSizeUsd: jest.fn(async () => 50),
  getSummary: jest.fn(),
  closePositionNow: jest.fn(),
}));

const { getCache } = require('../src/jobs/globalScanJob');
const Signal = require('../src/models/Signal');
const VirtualTrade = require('../src/models/VirtualTrade');
const guideController = require('../src/controllers/guideController');

function mockRes() {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
}

function hoursAgo(h) {
  return new Date(Date.now() - h * 60 * 60 * 1000);
}

// Simulates Signal.findOne({...,createdAt:{$gte: cutoff}}).sort({confidence:-1})
// against a fixed pool of fake documents, same semantics Mongo would apply.
function mockSignalPool(docs) {
  Signal.findOne = jest.fn((query) => ({
    sort: () => {
      const cutoff = query.createdAt?.$gte;
      const matching = docs.filter(d => !cutoff || d.createdAt >= cutoff);
      matching.sort((a, b) => b.confidence - a.confidence);
      return matching[0] || null;
    },
  }));
}

beforeEach(() => {
  getCache.mockReturnValue(null);
  VirtualTrade.distinct = async () => [];
});

describe('resolveSuggestion — recency guard on the Signal-fallback branch (T-079)', () => {
  test('a fresh (<2h) signal wins even when an older, higher-confidence one also exists', async () => {
    mockSignalPool([
      { _id: 'old', asset: 'BTCUSDT', direction: 'BUY', confidence: 99, createdAt: hoursAgo(5), price: { entry: 100 } },
      { _id: 'fresh', asset: 'ETHUSDT', direction: 'BUY', confidence: 60, createdAt: hoursAgo(0.5), price: { entry: 200 } },
    ]);

    const res = mockRes();
    await guideController.getSuggestion({}, res);

    const payload = res.json.mock.calls[0][0];
    expect(payload.asset).toBe('ETHUSDT');
    expect(payload.isOlderSignal).toBe(false);
  });

  test('falls back to the 2-6h window when nothing qualifies within 2h, and flags it', async () => {
    mockSignalPool([
      { _id: 'mid', asset: 'LINKUSDT', direction: 'SELL', confidence: 80, createdAt: hoursAgo(4), price: { entry: 15 } },
      { _id: 'too-old', asset: 'SOLUSDT', direction: 'BUY', confidence: 100, createdAt: hoursAgo(20), price: { entry: 105 } },
    ]);

    const res = mockRes();
    await guideController.getSuggestion({}, res);

    const payload = res.json.mock.calls[0][0];
    expect(payload.asset).toBe('LINKUSDT');
    expect(payload.isOlderSignal).toBe(true);
  });

  test('returns "no strong recommendation" when nothing qualifies even within the 6h fallback window', async () => {
    mockSignalPool([
      { _id: 'too-old', asset: 'SOLUSDT', direction: 'BUY', confidence: 100, createdAt: hoursAgo(20), price: { entry: 105 } },
    ]);

    const res = mockRes();
    await guideController.getSuggestion({}, res);

    const payload = res.json.mock.calls[0][0];
    expect(payload.available).toBe(false);
    expect(payload.message).toMatch(/still studying/i);
  });

  test('the exact previously-reported symptom is fixed: a 24h-old confidence=100 signal no longer wins over a 5-hour-old one', async () => {
    // Directly mirrors the live SOLUSDT case from tonight's investigation.
    mockSignalPool([
      { _id: 'solusdt-stale', asset: 'SOLUSDT', direction: 'BUY', confidence: 100, createdAt: hoursAgo(23.8), price: { entry: 105.03 } },
      { _id: 'avax-real', asset: 'AVAXUSDT', direction: 'BUY', confidence: 94.7, createdAt: hoursAgo(4.8), price: { entry: 20 } },
    ]);

    const res = mockRes();
    await guideController.getSuggestion({}, res);

    const payload = res.json.mock.calls[0][0];
    expect(payload.asset).toBe('AVAXUSDT'); // not SOLUSDT
    expect(payload.isOlderSignal).toBe(true); // honestly flagged -- it's outside the 2h preferred window
  });

  test('global-scan-sourced suggestions always report isOlderSignal: false (always fresh by construction)', async () => {
    getCache.mockReturnValue({
      result: { best: { asset: 'ETHUSDT', action: 'BUY', current_price: 3000, confidence: 75 } },
      scannedAt: new Date(),
    });

    const res = mockRes();
    await guideController.getSuggestion({}, res);

    const payload = res.json.mock.calls[0][0];
    expect(payload.asset).toBe('ETHUSDT');
    expect(payload.isOlderSignal).toBe(false);
  });
});
