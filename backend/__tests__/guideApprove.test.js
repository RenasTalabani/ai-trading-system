/**
 * Regression suite for T-061 (2026-08-26, product-to-code audit follow-up).
 *
 * Bug: approve() always sources a Guide suggestion from an AI signal or the
 * global-scan cache (never from client input -- confirmed in the audit),
 * but the resulting VirtualTrade persisted neither `signalId` nor
 * `aiDecisionId`, so a `source: 'guide'` trade could not be traced back to
 * the specific AI-sourced pick that justified it, unlike every other
 * trade-opening path in the app.
 *
 * Fix: thread the source id through. A Signal-sourced suggestion links
 * exactly via `signalId`. A global-scan-sourced suggestion has no
 * synchronously-available persisted id, so this does a best-effort lookup
 * of the most recent matching AIDecision and links `aiDecisionId` on a hit,
 * leaving it null (not blocking approval) on a miss.
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

beforeEach(() => {
  approveSuggestion.mockClear();
  getCache.mockReturnValue(null);
  VirtualTrade.distinct = async () => []; // no open positions blocking the suggestion
  AIDecision.findOne = jest.fn(() => ({ sort: () => ({ lean: async () => null }) }));
});

describe('guideController.approve — traces the resulting trade back to its AI source (T-061)', () => {
  test('a Signal-sourced suggestion passes that exact signalId through, with no AIDecision lookup', async () => {
    Signal.findOne = () => ({
      sort: () => ({
        _id: 'sig123', asset: 'BTCUSDT', direction: 'BUY',
        price: { entry: 65000, stopLoss: 63000, takeProfit: 68000 },
        confidence: 80, createdAt: new Date(),
      }),
    });

    await guideController.approve({}, mockRes());

    expect(approveSuggestion).toHaveBeenCalledTimes(1);
    const args = approveSuggestion.mock.calls[0][0];
    expect(args.signalId).toBe('sig123');
    expect(args.aiDecisionId).toBeNull();
    expect(AIDecision.findOne).not.toHaveBeenCalled();
  });

  test('a global-scan-sourced suggestion links to the most recent matching AIDecision when one exists', async () => {
    Signal.findOne = () => ({ sort: () => null }); // no signal fallback needed
    getCache.mockReturnValue({
      result: { best: { asset: 'ETHUSDT', action: 'BUY', current_price: 3000, confidence: 75 } },
      scannedAt: new Date(),
    });
    AIDecision.findOne = jest.fn((query) => {
      expect(query).toEqual({ asset: 'ETHUSDT', action: 'BUY' });
      return { sort: () => ({ lean: async () => ({ _id: 'decision456' }) }) };
    });

    await guideController.approve({}, mockRes());

    const args = approveSuggestion.mock.calls[0][0];
    expect(args.signalId).toBeNull();
    expect(args.aiDecisionId).toBe('decision456');
  });

  test('a global-scan-sourced suggestion with no matching AIDecision leaves aiDecisionId null and still approves', async () => {
    Signal.findOne = () => ({ sort: () => null });
    getCache.mockReturnValue({
      result: { best: { asset: 'ETHUSDT', action: 'BUY', current_price: 3000, confidence: 75 } },
      scannedAt: new Date(),
    });
    AIDecision.findOne = () => ({ sort: () => ({ lean: async () => null }) });

    const res = mockRes();
    await guideController.approve({}, res);

    const args = approveSuggestion.mock.calls[0][0];
    expect(args.signalId).toBeNull();
    expect(args.aiDecisionId).toBeNull();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });
});

describe('guideController.approve — client-supplied sizing is always ignored (T-071)', () => {
  test('an arbitrary/garbage amountUsd in the request body produces the exact same approveSuggestion call as no body at all', async () => {
    Signal.findOne = () => ({
      sort: () => ({
        _id: 'sig123', asset: 'BTCUSDT', direction: 'BUY',
        price: { entry: 65000, stopLoss: 63000, takeProfit: 68000 },
        confidence: 80, createdAt: new Date(),
      }),
    });

    await guideController.approve({}, mockRes());
    const noBodyArgs = approveSuggestion.mock.calls[0][0];

    approveSuggestion.mockClear();

    await guideController.approve({ body: { amountUsd: 999999999 } }, mockRes());
    const hugeAmountArgs = approveSuggestion.mock.calls[0][0];

    approveSuggestion.mockClear();

    await guideController.approve({ body: { amountUsd: -50 } }, mockRes());
    const negativeAmountArgs = approveSuggestion.mock.calls[0][0];

    // Same trade every time -- the handler never reads req.body, so a
    // garbage/hostile amountUsd has literally zero effect on sizing.
    expect(hugeAmountArgs).toEqual(noBodyArgs);
    expect(negativeAmountArgs).toEqual(noBodyArgs);
    expect(hugeAmountArgs.asset).toBe('BTCUSDT');
  });
});

describe('guideController.approve — threads atrAtEntry through from the resolved suggestion (T-073)', () => {
  test('a global-scan-sourced suggestion passes best.atr through as atrAtEntry', async () => {
    Signal.findOne = () => ({ sort: () => null });
    getCache.mockReturnValue({
      result: { best: { asset: 'ETHUSDT', action: 'BUY', current_price: 3000, confidence: 75, atr: 45.6 } },
      scannedAt: new Date(),
    });

    await guideController.approve({}, mockRes());

    expect(approveSuggestion.mock.calls[0][0].atrAtEntry).toBe(45.6);
  });

  test('a Signal-sourced suggestion (no ATR data available) passes atrAtEntry: null, not fabricated', async () => {
    Signal.findOne = () => ({
      sort: () => ({
        _id: 'sig123', asset: 'BTCUSDT', direction: 'BUY',
        price: { entry: 65000, stopLoss: 63000, takeProfit: 68000 },
        confidence: 80, createdAt: new Date(),
      }),
    });

    await guideController.approve({}, mockRes());

    expect(approveSuggestion.mock.calls[0][0].atrAtEntry).toBeNull();
  });
});
