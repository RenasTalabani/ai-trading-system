/**
 * Regression suite for the multi-option allocation builder (master-plan
 * decision #14). Pure function, zero mocking needed.
 */
const { buildAllocationOptions, MAX_OPTIONS } = require('../src/services/allocationOptionsBuilder');

describe('buildAllocationOptions', () => {
  test('empty input returns no options', () => {
    expect(buildAllocationOptions([])).toEqual([]);
  });

  test('a single candidate produces only the recommended single-asset option', () => {
    const opts = buildAllocationOptions([
      { asset: 'PAXG', direction: 'BUY', entryPrice: 2600, stopLoss: 2450, confidence: 80, fusedScore: 70, sizeUsd: 1000, aiDecisionId: 'd1' },
    ]);
    expect(opts).toHaveLength(1);
    expect(opts[0].key).toBe('best_single');
    expect(opts[0].isRecommended).toBe(true);
    expect(opts[0].allocations[0].asset).toBe('PAXG');
    expect(opts[0].totalUsd).toBe(1000);
  });

  test('multiple candidates: best pick is ranked by confidence, then a diversified split, then singles, capped at MAX_OPTIONS', () => {
    const opts = buildAllocationOptions([
      { asset: 'BTC',  direction: 'BUY', entryPrice: 100,  stopLoss: 95,   confidence: 70, fusedScore: 70, sizeUsd: 200,  aiDecisionId: 'd2' },
      { asset: 'PAXG', direction: 'BUY', entryPrice: 2600, stopLoss: 2450, confidence: 90, fusedScore: 80, sizeUsd: 1000, aiDecisionId: 'd1' },
      { asset: 'SOL',  direction: 'BUY', entryPrice: 150,  stopLoss: 140,  confidence: 60, fusedScore: 60, sizeUsd: 150,  aiDecisionId: 'd3' },
    ]);

    expect(opts.length).toBeLessThanOrEqual(MAX_OPTIONS);
    expect(opts[0].key).toBe('best_single');
    expect(opts[0].allocations[0].asset).toBe('PAXG'); // highest confidence wins the recommendation
    expect(opts[0].isRecommended).toBe(true);

    expect(opts[1].key).toBe('diversified');
    expect(opts[1].allocations).toHaveLength(3);
    expect(opts[1].totalUsd).toBe(200 + 1000 + 150);

    // Every option after the first is explicitly NOT the recommendation —
    // decision #14 requires exactly one flagged choice, never more.
    expect(opts.slice(1).every(o => o.isRecommended === false)).toBe(true);
    expect(opts.filter(o => o.isRecommended).length).toBe(1);
  });

  test('confidence ties fall back to fusedScore for ranking', () => {
    const opts = buildAllocationOptions([
      { asset: 'A', direction: 'BUY', entryPrice: 100, stopLoss: 90, confidence: 80, fusedScore: 50, sizeUsd: 100, aiDecisionId: 'a' },
      { asset: 'B', direction: 'BUY', entryPrice: 100, stopLoss: 90, confidence: 80, fusedScore: 90, sizeUsd: 100, aiDecisionId: 'b' },
    ]);
    expect(opts[0].allocations[0].asset).toBe('B');
  });

  test('every allocation entry carries what approveSuggestion needs to open a trade', () => {
    const opts = buildAllocationOptions([
      { asset: 'ETH', direction: 'SELL', entryPrice: 3000, stopLoss: 3200, takeProfit: 2700, confidence: 75, fusedScore: 65, sizeUsd: 500, aiDecisionId: 'e1' },
    ]);
    const alloc = opts[0].allocations[0];
    expect(alloc).toMatchObject({
      asset: 'ETH', direction: 'SELL', amountUsd: 500,
      entryPrice: 3000, stopLoss: 3200, takeProfit: 2700, aiDecisionId: 'e1',
    });
  });
});
