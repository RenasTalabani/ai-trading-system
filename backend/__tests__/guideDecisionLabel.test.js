/**
 * Regression suite for T-066 (2026-08-29, product-consistency follow-up to
 * T-065).
 *
 * T-065 added a derived WAIT/AVOID `decision` label to ai-service's
 * SignalEngine (the /predict pipeline), but the Guide home screen's
 * suggestion comes from a different pipeline: globalScanJob's cache
 * (primary) or the regular Signal collection (fallback, and per this
 * controller's own docstring, what "makes this screen actually show
 * something most of the time"). Neither path surfaced a `decision` label,
 * so the Guide could show a plain BUY/SELL suggestion even when the
 * underlying models had flagged a real risk (e.g. social manipulation) --
 * inconsistent with the /predict pipeline's new behavior.
 *
 * Fixed (ai-service side, T-066): UnifiedAnalyzer.analyze() now surfaces
 * `manipulation_detected` (already-fetched data, zero new I/O) and computes
 * `signal.decision` via the same _decision_label() function T-065 already
 * uses; GlobalAnalyzer._score_crypto() passes it through unchanged.
 *
 * This suite covers the backend half: resolveSuggestion() must read and
 * pass through `decision` from both the global-scan cache and the Signal
 * fallback, without changing `action` (trading eligibility) at all.
 */
jest.mock('../src/jobs/globalScanJob', () => ({ getCache: jest.fn(() => null) }));

const { getCache } = require('../src/jobs/globalScanJob');
const Signal        = require('../src/models/Signal');
const VirtualTrade   = require('../src/models/VirtualTrade');
const { resolveSuggestion } = require('../src/controllers/guideController');

beforeEach(() => {
  getCache.mockReturnValue(null);
  VirtualTrade.distinct = async () => []; // no open positions blocking the suggestion
  Signal.findOne = () => ({ sort: () => null }); // no fallback signal unless a test overrides it
});

describe('resolveSuggestion — global-scan branch surfaces decision (T-066)', () => {
  test('a plain BUY pick carries decision === action unchanged', async () => {
    getCache.mockReturnValue({
      result: { best: { asset: 'BTCUSDT', action: 'BUY', decision: 'BUY', current_price: 65000, confidence: 80 } },
      scannedAt: new Date(),
    });

    const suggestion = await resolveSuggestion();

    expect(suggestion.action).toBe('BUY');
    expect(suggestion.decision).toBe('BUY');
  });

  test('a manipulation-flagged BUY pick surfaces decision=AVOID without changing action', async () => {
    getCache.mockReturnValue({
      result: { best: { asset: 'BTCUSDT', action: 'BUY', decision: 'AVOID', current_price: 65000, confidence: 80 } },
      scannedAt: new Date(),
    });

    const suggestion = await resolveSuggestion();

    // action stays BUY -- approve()'s trade direction and every existing
    // trading/notification path keyed off `action` is completely untouched.
    expect(suggestion.action).toBe('BUY');
    // decision is the new, additive signal a caller can react to differently.
    expect(suggestion.decision).toBe('AVOID');
  });

  test('an older ai-service response missing `decision` falls back to `action`, not undefined', async () => {
    getCache.mockReturnValue({
      result: { best: { asset: 'BTCUSDT', action: 'SELL', current_price: 65000, confidence: 80 } },
      scannedAt: new Date(),
    });

    const suggestion = await resolveSuggestion();

    expect(suggestion.decision).toBe('SELL');
  });
});

describe('resolveSuggestion — Signal fallback branch surfaces decision (T-066)', () => {
  test('a Signal document with a persisted decision field passes it through', async () => {
    Signal.findOne = () => ({
      sort: () => ({
        _id: 'sig1', asset: 'ETHUSDT', direction: 'SELL', decision: 'AVOID',
        price: { entry: 3000, stopLoss: 3100, takeProfit: 2800 },
        confidence: 75, createdAt: new Date(),
      }),
    });

    const suggestion = await resolveSuggestion();

    expect(suggestion.action).toBe('SELL'); // unchanged
    expect(suggestion.decision).toBe('AVOID');
  });

  test('a Signal document from before this field existed (decision undefined) falls back to direction', async () => {
    Signal.findOne = () => ({
      sort: () => ({
        _id: 'sig2', asset: 'ETHUSDT', direction: 'BUY',
        price: { entry: 3000, stopLoss: 2900, takeProfit: 3200 },
        confidence: 75, createdAt: new Date(),
      }),
    });

    const suggestion = await resolveSuggestion();

    expect(suggestion.decision).toBe('BUY');
  });
});
