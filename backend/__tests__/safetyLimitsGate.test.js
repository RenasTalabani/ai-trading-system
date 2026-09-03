/**
 * Regression suite for the deterministic safety gate (master_plan_v1.md
 * decisions #13, #15, #16, #23). Pure functions, zero mocking needed.
 */
const {
  evaluateProposedTrade,
  shouldHaltForDailyLoss,
  assertTradeAllowed,
  MAX_PER_TRADE_LOSS_PCT,
  DAILY_LOSS_HALT_PCT,
} = require('../src/services/safetyLimitsGate');

describe('evaluateProposedTrade — leverage (decision #13)', () => {
  test('rejects any leverage other than 1x, even a "confident" AI proposal', () => {
    const result = evaluateProposedTrade({ entryPrice: 100, stopLoss: 90, direction: 'BUY', leverage: 20 });
    expect(result.allowed).toBe(false);
    expect(result.reasons).toContain('LEVERAGE_NOT_ALLOWED');
  });

  test('allows a plain 1x spot trade with a compliant stop-loss', () => {
    const result = evaluateProposedTrade({ entryPrice: 100, stopLoss: 90, direction: 'BUY', leverage: 1 });
    expect(result.allowed).toBe(true);
    expect(result.reasons).toEqual([]);
  });
});

describe('evaluateProposedTrade — mandatory stop-loss (decision #15)', () => {
  test('rejects a trade with no stop-loss at all', () => {
    const result = evaluateProposedTrade({ entryPrice: 100, stopLoss: null, direction: 'BUY' });
    expect(result.allowed).toBe(false);
    expect(result.reasons).toContain('STOP_LOSS_REQUIRED');
    expect(result.suggestedStopLoss).toBeCloseTo(75, 2); // 25% below entry
  });

  test('rejects a BUY stop-loss placed on the wrong side (above entry)', () => {
    const result = evaluateProposedTrade({ entryPrice: 100, stopLoss: 110, direction: 'BUY' });
    expect(result.allowed).toBe(false);
    expect(result.reasons).toContain('STOP_LOSS_WRONG_SIDE');
  });

  test(`rejects a stop-loss implying more than ${MAX_PER_TRADE_LOSS_PCT}% loss`, () => {
    const result = evaluateProposedTrade({ entryPrice: 100, stopLoss: 70, direction: 'BUY' }); // 30% away
    expect(result.allowed).toBe(false);
    expect(result.reasons).toContain('STOP_LOSS_EXCEEDS_CEILING');
    expect(result.impliedLossPct).toBeCloseTo(30, 5);
  });

  test(`allows a stop-loss exactly at the ${MAX_PER_TRADE_LOSS_PCT}% ceiling`, () => {
    const result = evaluateProposedTrade({ entryPrice: 100, stopLoss: 75, direction: 'BUY' });
    expect(result.allowed).toBe(true);
  });

  test('SELL direction: computes implied loss on the correct side', () => {
    const ok = evaluateProposedTrade({ entryPrice: 100, stopLoss: 120, direction: 'SELL' }); // 20% away
    expect(ok.allowed).toBe(true);
    const bad = evaluateProposedTrade({ entryPrice: 100, stopLoss: 90, direction: 'SELL' }); // wrong side
    expect(bad.allowed).toBe(false);
    expect(bad.reasons).toContain('STOP_LOSS_WRONG_SIDE');
  });
});

describe('assertTradeAllowed', () => {
  test('throws a tagged Error when the gate rejects', () => {
    const evalResult = evaluateProposedTrade({ entryPrice: 100, stopLoss: 70, direction: 'BUY' });
    expect(() => assertTradeAllowed(evalResult)).toThrow(/Blocked by safety limits/);
    try {
      assertTradeAllowed(evalResult);
    } catch (e) {
      expect(e.isSafetyGateRejection).toBe(true);
      expect(e.safetyGateReasons).toContain('STOP_LOSS_EXCEEDS_CEILING');
    }
  });

  test('does not throw when the gate allows', () => {
    const evalResult = evaluateProposedTrade({ entryPrice: 100, stopLoss: 90, direction: 'BUY' });
    expect(() => assertTradeAllowed(evalResult)).not.toThrow();
  });
});

describe(`shouldHaltForDailyLoss (decision #16, ${DAILY_LOSS_HALT_PCT}% halt-until-manual-reset)`, () => {
  test('does not halt below the threshold', () => {
    expect(shouldHaltForDailyLoss(1000, 90)).toBe(false); // 9%
  });
  test('halts exactly at the threshold', () => {
    expect(shouldHaltForDailyLoss(1000, 100)).toBe(true); // 10%
  });
  test('halts above the threshold', () => {
    expect(shouldHaltForDailyLoss(1000, 250)).toBe(true); // 25%
  });
  test('never halts on a zero/invalid balance (avoid divide-by-zero false positive)', () => {
    expect(shouldHaltForDailyLoss(0, 50)).toBe(false);
  });
});
