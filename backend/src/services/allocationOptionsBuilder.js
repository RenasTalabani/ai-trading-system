/**
 * Builds the 2-4 allocation choices a pending proposal shows the user
 * (master-plan decision #14, locked 2026-09-03): "the AI gives me a choice
 * — buy all of one asset, OR split across several, OR just one of the
 * others — plus its own best pick, and I decide." No rigid position-size
 * percentage cap replaces this; the choice itself IS the safety mechanism
 * (the user always sees the smaller/split alternatives next to the AI's
 * favorite, never just one fixed number).
 *
 * Pure function — every dollar amount it works with (`sizeUsd` on each
 * candidate) is computed elsewhere (virtualTrackingService.computeSpotSizeUsd,
 * the same sizing math every other trade path uses) and passed in, so this
 * file has no DB dependency and is trivial to unit test.
 */

const MAX_OPTIONS = 4;

function _round2(n) {
  return Math.round(n * 100) / 100;
}

/**
 * @param {Array<{asset:string, direction:'BUY'|'SELL', entryPrice:number,
 *   stopLoss:?number, takeProfit:?number, confidence:number, fusedScore:?number,
 *   sizeUsd:number, aiDecisionId:string}>} candidates — already safety-gate-passed
 *   opportunities from one scan cycle, each already sized via the shared
 *   sizing helper.
 * @returns {Array<{key:string, label:string, isRecommended:boolean, totalUsd:number,
 *   allocations:Array}>}
 */
function buildAllocationOptions(candidates) {
  if (!Array.isArray(candidates) || candidates.length === 0) return [];

  // Rank by confidence first, fusedScore as tiebreaker — this ranking decides
  // which single asset is "the AI's best pick" (isRecommended).
  const ranked = [...candidates].sort((a, b) => {
    const confDiff = (b.confidence || 0) - (a.confidence || 0);
    if (confDiff !== 0) return confDiff;
    return (b.fusedScore || 0) - (a.fusedScore || 0);
  });

  const options = [];

  const toAllocation = (c) => ({
    asset: c.asset,
    direction: c.direction,
    amountUsd: c.sizeUsd,
    entryPrice: c.entryPrice,
    stopLoss: c.stopLoss,
    takeProfit: c.takeProfit,
    aiDecisionId: c.aiDecisionId,
  });

  // Option 1 — the AI's single best pick, always present, always recommended.
  const best = ranked[0];
  options.push({
    key: 'best_single',
    label: `Just ${best.asset} — $${_round2(best.sizeUsd)}`,
    isRecommended: true,
    totalUsd: _round2(best.sizeUsd),
    allocations: [toAllocation(best)],
  });

  // Option 2 — split across everything that qualified this cycle, if there's
  // more than one candidate (mirrors the user's own example: "$200 PAXG +
  // $300 BTC + $150 SOL").
  if (ranked.length >= 2) {
    const combo = ranked.slice(0, MAX_OPTIONS); // don't let one huge cycle explode the split option
    options.push({
      key: 'diversified',
      label: `Split across ${combo.length}: ` + combo.map(c => c.asset).join(', '),
      isRecommended: false,
      totalUsd: _round2(combo.reduce((s, c) => s + c.sizeUsd, 0)),
      allocations: combo.map(toAllocation),
    });
  }

  // Options 3+ — each remaining candidate alone, up to MAX_OPTIONS total.
  for (const c of ranked.slice(1)) {
    if (options.length >= MAX_OPTIONS) break;
    options.push({
      key: `single_${c.asset}`,
      label: `Just ${c.asset} — $${_round2(c.sizeUsd)}`,
      isRecommended: false,
      totalUsd: _round2(c.sizeUsd),
      allocations: [toAllocation(c)],
    });
  }

  // Always leave room for a "not now" — that's a client-side default, not an
  // option object (rejecting the whole proposal needs no allocation at all).
  return options.slice(0, MAX_OPTIONS);
}

module.exports = { buildAllocationOptions, MAX_OPTIONS };
