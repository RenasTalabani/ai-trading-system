/**
 * Phase 3, step 1 (2026-09-01) — tests for renoRecommendationService.js.
 * Pure function, no Mongoose models involved — no mocking needed, these
 * are genuine unit tests against real inputs/outputs.
 */
const { buildRenoRecommendation, TAKE_PROFIT_THRESHOLD, EXTEND_THRESHOLD } = require('../src/services/renoRecommendationService');

function trade(overrides = {}) {
  return {
    asset: 'BTCUSDT', direction: 'BUY', entryPrice: 100, takeProfit: 120, stopLoss: 90,
    ...overrides,
  };
}
function guidance(overrides = {}) {
  return {
    currentPrice: 100, pnlPct: 0, recommendation: 'HOLD', why: ['Nothing has changed since you opened this — the original reasons still hold.'],
    isHalted: false,
    ...overrides,
  };
}

describe('buildRenoRecommendation', () => {
  it('returns INSUFFICIENT_DATA, never HOLD, when the position is halted', () => {
    const r = buildRenoRecommendation(trade(), guidance({ isHalted: true, currentPrice: null }), null);
    expect(r.state).toBe('INSUFFICIENT_DATA');
    expect(r.state).not.toBe('HOLD');
    expect(r.evidence.currentPrice).toBeNull();
  });

  it('returns INSUFFICIENT_DATA, never HOLD, when there is simply no current price', () => {
    const r = buildRenoRecommendation(trade(), guidance({ isHalted: false, currentPrice: null }), null);
    expect(r.state).toBe('INSUFFICIENT_DATA');
  });

  it('returns EXIT, carrying evidence, when buildPositionGuidance already recommended SELL (thesis broken)', () => {
    const g = guidance({ recommendation: 'SELL', pnlPct: -1.2, why: ["The AI's outlook on BTCUSDT has flipped since you bought — it now leans the other way."] });
    const latestSignal = { status: 'active', direction: 'SELL' };
    const r = buildRenoRecommendation(trade(), g, latestSignal);
    expect(r.state).toBe('EXIT');
    expect(r.reason).toMatch(/flipped/i);
    expect(r.evidence.contradictingSignal).toBe(true);
    expect(r.evidence.pnlPct).toBe(-1.2);
  });

  it('returns TAKE_PROFIT when price is at/near the original target', () => {
    // entry 100, target 120 -> 96% of the way is price 119.2
    const g = guidance({ currentPrice: 119.2, pnlPct: 19.2 });
    const r = buildRenoRecommendation(trade(), g, null);
    expect(r.state).toBe('TAKE_PROFIT');
    expect(r.evidence.progressToTargetPct).toBeGreaterThanOrEqual(TAKE_PROFIT_THRESHOLD * 100);
  });

  it('returns EXTEND when well past halfway to target and nothing shows the move is exhausted', () => {
    // entry 100, target 120 -> 70% of the way is price 114
    const g = guidance({ currentPrice: 114, pnlPct: 14 });
    const r = buildRenoRecommendation(trade(), g, null);
    expect(r.state).toBe('EXTEND');
    expect(r.evidence.progressToTargetPct).toBeGreaterThanOrEqual(EXTEND_THRESHOLD * 100);
  });

  it('does NOT return EXTEND when progress is high but RSI shows the move is overbought (momentum not intact)', () => {
    const g = guidance({ currentPrice: 114, pnlPct: 14 });
    const latestSignal = { sources: { market: { indicators: { rsi: 82 } } } };
    const r = buildRenoRecommendation(trade(), g, latestSignal);
    expect(r.state).toBe('HOLD');
    expect(r.evidence.rsi).toBe(82);
  });

  it('does NOT return EXTEND when progress is high but a contradicting active signal exists', () => {
    const g = guidance({ currentPrice: 114, pnlPct: 14 });
    const latestSignal = { status: 'active', direction: 'SELL' };
    const r = buildRenoRecommendation(trade(), g, latestSignal);
    // Note: buildPositionGuidance() itself would already have flagged this as
    // SELL (contradicting signal) before this function ever sees it in real
    // use -- this test isolates renoRecommendationService's own EXTEND-
    // suppression logic in case it's ever called with a HOLD guidance and a
    // contradicting signal in combination (defensive, not a real production path).
    expect(r.state).toBe('HOLD');
  });

  it('returns HOLD when there is no take-profit target set at all (progress cannot be evaluated)', () => {
    const g = guidance({ currentPrice: 105, pnlPct: 5 });
    const r = buildRenoRecommendation(trade({ takeProfit: null }), g, null);
    expect(r.state).toBe('HOLD');
    expect(r.evidence.progressToTargetPct).toBeNull();
  });

  it('returns HOLD when progress is real but below the EXTEND threshold', () => {
    // entry 100, target 120 -> 20% of the way is price 104
    const g = guidance({ currentPrice: 104, pnlPct: 4 });
    const r = buildRenoRecommendation(trade(), g, null);
    expect(r.state).toBe('HOLD');
    expect(r.evidence.progressToTargetPct).toBeCloseTo(20, 0);
  });

  it('never invents a number not present in guidance/trade/latestSignal — evidence.rsi is null when no signal is supplied', () => {
    const r = buildRenoRecommendation(trade(), guidance({ currentPrice: 104, pnlPct: 4 }), null);
    expect(r.evidence.rsi).toBeNull();
  });
});
