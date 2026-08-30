/**
 * T-074b (2026-08-30): unit tests for backfillLikelyTestOrigin.js's pure
 * classification logic (no live DB connection needed), reusing
 * WINRATE_DIAGNOSIS.md's exact duplicate-fingerprint definition
 * (asset + entryPrice + stopLoss, exact match, groups of size >= 2).
 */
const { classify } = require('../scripts/backfillLikelyTestOrigin');

function trade(id, overrides = {}) {
  return {
    _id: id,
    asset: 'BTCUSDT',
    entryPrice: 65000,
    stopLoss: 63000,
    status: 'closed_loss',
    ...overrides,
  };
}

describe('classify — duplicate-fingerprint grouping (T-074b)', () => {
  test('two trades sharing the exact same asset/entryPrice/stopLoss are flagged true', () => {
    const trades = [
      trade('a'),
      trade('b'),
    ];
    const result = classify(trades);
    expect(result.flaggedTrueIds.sort()).toEqual(['a', 'b']);
    expect(result.flaggedFalseIds).toEqual([]);
    expect(result.duplicateBatches).toHaveLength(1);
  });

  test('a genuinely unique trade (no fingerprint match) is flagged false', () => {
    const trades = [trade('a')];
    const result = classify(trades);
    expect(result.flaggedTrueIds).toEqual([]);
    expect(result.flaggedFalseIds).toEqual(['a']);
  });

  test('a tiny difference in entryPrice or stopLoss (not an exact match) does NOT count as a duplicate', () => {
    const trades = [
      trade('a', { entryPrice: 65000 }),
      trade('b', { entryPrice: 65000.01 }), // one cent off -- not exact
      trade('c', { asset: 'ETHUSDT', entryPrice: 3000, stopLoss: 2900 }),
      trade('d', { asset: 'ETHUSDT', entryPrice: 3000, stopLoss: 2900.01 }), // one cent off -- not exact
    ];
    const result = classify(trades);
    expect(result.flaggedTrueIds).toEqual([]);
    expect(result.flaggedFalseIds.sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  test('different assets at the same price/stop are not grouped together', () => {
    const trades = [
      trade('a', { asset: 'BTCUSDT' }),
      trade('b', { asset: 'ETHUSDT' }),
    ];
    const result = classify(trades);
    expect(result.flaggedTrueIds).toEqual([]);
  });

  test('trades missing asset/entryPrice/stopLoss are excluded from grouping and flagged false, never crash', () => {
    const trades = [
      trade('a', { stopLoss: null }),
      trade('b', { stopLoss: null }),
      trade('c', { entryPrice: null }),
      trade('d', { asset: null }),
    ];
    const result = classify(trades);
    expect(result.excludedCount).toBe(4);
    expect(result.flaggedTrueIds).toEqual([]);
    expect(result.flaggedFalseIds.sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  test('a batch of 3+ trades: every member is flagged true, not just the "extra" ones beyond the first', () => {
    const trades = [trade('a'), trade('b'), trade('c')];
    const result = classify(trades);
    expect(result.flaggedTrueIds.sort()).toEqual(['a', 'b', 'c']);
    expect(result.batchSizes).toEqual([3]);
  });

  test('multiple independent batches are each counted and reported separately', () => {
    const trades = [
      trade('a', { asset: 'BTCUSDT' }), trade('b', { asset: 'BTCUSDT' }),
      trade('c', { asset: 'ETHUSDT', entryPrice: 3000, stopLoss: 2900 }),
      trade('d', { asset: 'ETHUSDT', entryPrice: 3000, stopLoss: 2900 }),
      trade('e', { asset: 'ETHUSDT', entryPrice: 3000, stopLoss: 2900 }),
      trade('f', { asset: 'SOLUSDT', entryPrice: 100, stopLoss: 95 }), // unique
    ];
    const result = classify(trades);
    expect(result.duplicateBatches).toHaveLength(2);
    expect(result.batchSizes.sort((x, y) => y - x)).toEqual([3, 2]);
    expect(result.flaggedTrueIds.sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(result.flaggedFalseIds).toEqual(['f']);
  });

  test('closed-trade subset counts only closed trades, matching WINRATE_DIAGNOSIS.md\'s own closed-only scoping', () => {
    const trades = [
      trade('a', { status: 'closed_win' }),
      trade('b', { status: 'closed_win' }),
      trade('c', { asset: 'XRPUSDT', entryPrice: 1, stopLoss: 0.9, status: 'open' }),
      trade('d', { asset: 'XRPUSDT', entryPrice: 1, stopLoss: 0.9, status: 'open' }),
    ];
    const result = classify(trades);
    // all 4 are duplicate-fingerprint batches (2 batches of 2), but only
    // the 2 closed ones count toward the closed-only subset
    expect(result.flaggedTrueIds).toHaveLength(4);
    expect(result.closedTotal).toBe(2);
    expect(result.closedFlaggedTrueCount).toBe(2);
  });

  test('does not mutate pnl/result/status or any field other than what it reports on', () => {
    const t = trade('a', { pnl: -12.5, result: 'loss' });
    const original = JSON.parse(JSON.stringify(t));
    classify([t, trade('b')]);
    expect(t).toEqual(original); // classify() never writes to its inputs
  });
});
