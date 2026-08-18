/**
 * Regression suite for buildPositionGuidance() -- decides HOLD vs SELL for a
 * position you already opened, and estimates a rough HOLD duration. Pure
 * function (no DB/network), so tested directly with synthetic inputs.
 */
const { buildPositionGuidance, maxLossFor, maxGainFor } = require('../src/controllers/guideController');

function trade(overrides = {}) {
  return {
    asset: 'BTCUSDT', direction: 'BUY', sizeUsd: 25,
    entryPrice: 100, takeProfit: 110, stopLoss: 95,
    openedAt: new Date(),
    ...overrides,
  };
}

describe('buildPositionGuidance', () => {
  test('recommends HOLD with no contradicting signal or RSI extreme', () => {
    const g = buildPositionGuidance(trade(), 103, null);
    expect(g.recommendation).toBe('HOLD');
    expect(g.holdEstimate).not.toBeNull();
  });

  test('recommends SELL when the latest active signal has flipped direction', () => {
    const latestSignal = { status: 'active', direction: 'SELL', sources: {} };
    const g = buildPositionGuidance(trade({ direction: 'BUY' }), 103, latestSignal);
    expect(g.recommendation).toBe('SELL');
    expect(g.why.join(' ')).toMatch(/flipped/i);
  });

  test('does not flip on a same-direction signal', () => {
    const latestSignal = { status: 'active', direction: 'BUY', sources: {} };
    const g = buildPositionGuidance(trade({ direction: 'BUY' }), 103, latestSignal);
    expect(g.recommendation).toBe('HOLD');
  });

  test('ignores a contradicting signal that is not active', () => {
    const latestSignal = { status: 'expired', direction: 'SELL', sources: {} };
    const g = buildPositionGuidance(trade({ direction: 'BUY' }), 103, latestSignal);
    expect(g.recommendation).toBe('HOLD');
  });

  test('recommends SELL on a BUY position that looks overbought (RSI > 75)', () => {
    const latestSignal = { status: 'active', direction: 'BUY', sources: { market: { indicators: { rsi: 82 } } } };
    const g = buildPositionGuidance(trade({ direction: 'BUY' }), 103, latestSignal);
    expect(g.recommendation).toBe('SELL');
    expect(g.why.join(' ')).toMatch(/overbought/i);
  });

  test('recommends SELL on a SELL (short) position that looks oversold (RSI < 25)', () => {
    const latestSignal = { status: 'active', direction: 'SELL', sources: { market: { indicators: { rsi: 12 } } } };
    const g = buildPositionGuidance(trade({ direction: 'SELL', entryPrice: 100, takeProfit: 90 }), 97, latestSignal);
    expect(g.recommendation).toBe('SELL');
    expect(g.why.join(' ')).toMatch(/oversold/i);
  });

  test('mid-range RSI does not trigger a SELL', () => {
    const latestSignal = { status: 'active', direction: 'BUY', sources: { market: { indicators: { rsi: 50 } } } };
    const g = buildPositionGuidance(trade({ direction: 'BUY' }), 103, latestSignal);
    expect(g.recommendation).toBe('HOLD');
  });

  test('HOLD duration shortens as price gets closer to the take-profit target', () => {
    const near = buildPositionGuidance(trade({ entryPrice: 100, takeProfit: 110 }), 108, null); // 80% there
    const mid  = buildPositionGuidance(trade({ entryPrice: 100, takeProfit: 110 }), 105, null); // 50% there
    const far  = buildPositionGuidance(trade({ entryPrice: 100, takeProfit: 110 }), 101, null); // 10% there
    expect(near.holdEstimate).toMatch(/few more hours/i);
    expect(mid.holdEstimate).toMatch(/about a day/i);
    expect(far.holdEstimate).toMatch(/few days/i);
  });

  test('no holdEstimate when the trade has no take-profit set', () => {
    const g = buildPositionGuidance(trade({ takeProfit: null }), 103, null);
    expect(g.recommendation).toBe('HOLD');
    expect(g.holdEstimate).toBeNull();
  });

  test('SELL positions never carry a holdEstimate', () => {
    const latestSignal = { status: 'active', direction: 'SELL', sources: {} };
    const g = buildPositionGuidance(trade({ direction: 'BUY' }), 103, latestSignal);
    expect(g.holdEstimate).toBeNull();
  });

  test('pnlPct is computed correctly for BUY and SELL directions', () => {
    const buy  = buildPositionGuidance(trade({ direction: 'BUY',  entryPrice: 100 }), 110, null);
    expect(buy.pnlPct).toBeCloseTo(10, 6);
    const sell = buildPositionGuidance(trade({ direction: 'SELL', entryPrice: 100, takeProfit: 90 }), 90, null);
    expect(sell.pnlPct).toBeCloseTo(10, 6);
  });

  test('carries the worst-case dollar loss (maxLossUsd) computed from the stop-loss', () => {
    // BUY $25 at entry 100, stop at 95 -> 5% downside -> $1.25 max loss
    const g = buildPositionGuidance(trade({ direction: 'BUY', sizeUsd: 25, entryPrice: 100, stopLoss: 95 }), 103, null);
    expect(g.maxLossUsd).toBeCloseTo(1.25, 6);
  });

  test('maxLossUsd is null when there is no stop-loss (undefined downside, not zero)', () => {
    const g = buildPositionGuidance(trade({ stopLoss: null }), 103, null);
    expect(g.maxLossUsd).toBeNull();
  });

  test('carries the potential dollar gain (maxGainUsd) computed from the take-profit', () => {
    // BUY $25 at entry 100, take-profit 110 -> 10% upside -> $2.50 max gain
    const g = buildPositionGuidance(trade({ direction: 'BUY', sizeUsd: 25, entryPrice: 100, takeProfit: 110 }), 103, null);
    expect(g.maxGainUsd).toBeCloseTo(2.5, 6);
  });

  test('maxGainUsd is null when there is no take-profit set', () => {
    const g = buildPositionGuidance(trade({ takeProfit: null }), 103, null);
    expect(g.maxGainUsd).toBeNull();
  });
});

describe('maxLossFor — live "how much could I lose" figure', () => {
  test('BUY: loss is the % distance from entry down to the stop, times position size', () => {
    // entry 100, stop 90 -> 10% downside on $50 -> $5
    expect(maxLossFor('BUY', 100, 90, 50)).toBeCloseTo(5, 6);
  });

  test('SELL: loss is the % distance from entry up to the stop, times position size', () => {
    // entry 100, stop 110 -> 10% downside on $50 -> $5
    expect(maxLossFor('SELL', 100, 110, 50)).toBeCloseTo(5, 6);
  });

  test('returns null with no stop-loss', () => {
    expect(maxLossFor('BUY', 100, null, 50)).toBeNull();
  });

  test('returns null with no entry price or size', () => {
    expect(maxLossFor('BUY', null, 90, 50)).toBeNull();
    expect(maxLossFor('BUY', 100, 90, 0)).toBeNull();
  });

  test('returns null for a nonsensical stop on the wrong side (would imply negative loss)', () => {
    // BUY with stop ABOVE entry makes no sense as a stop-loss
    expect(maxLossFor('BUY', 100, 110, 50)).toBeNull();
  });
});

describe('maxGainFor — live "how much could I win" figure (symmetric to maxLossFor)', () => {
  test('BUY: gain is the % distance from entry up to the target, times position size', () => {
    // entry 100, target 110 -> 10% upside on $50 -> $5
    expect(maxGainFor('BUY', 100, 110, 50)).toBeCloseTo(5, 6);
  });

  test('SELL: gain is the % distance from entry down to the target, times position size', () => {
    // entry 100, target 90 -> 10% upside on $50 -> $5
    expect(maxGainFor('SELL', 100, 90, 50)).toBeCloseTo(5, 6);
  });

  test('returns null with no take-profit', () => {
    expect(maxGainFor('BUY', 100, null, 50)).toBeNull();
  });

  test('returns null with no entry price or size', () => {
    expect(maxGainFor('BUY', null, 110, 50)).toBeNull();
    expect(maxGainFor('BUY', 100, 110, 0)).toBeNull();
  });

  test('returns null for a nonsensical target on the wrong side (would imply negative gain)', () => {
    // BUY with target BELOW entry makes no sense as a take-profit
    expect(maxGainFor('BUY', 100, 90, 50)).toBeNull();
  });
});
