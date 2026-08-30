/**
 * T-074b (2026-08-30) — best-effort, clearly-labeled backfill of
 * `likelyTestOrigin` on pre-existing VirtualTrade documents.
 *
 * Reuses WINRATE_DIAGNOSIS.md's own duplicate-fingerprint definition
 * verbatim (see its Section 1) rather than inventing a new heuristic:
 *
 *   "Grouping all ... closed trades by exact fingerprint (asset +
 *    entryPrice + stopLoss, to floating-point precision -- this level of
 *    exact match cannot happen by coincidence from independent live price
 *    fetches)" -- any group of >=2 trades sharing that exact fingerprint
 *    is a duplicate-fingerprint batch, traced there to repeated
 *    testing/validation sessions calling the live approve endpoint.
 *
 * Differences from the report's own one-off analysis, both intentional
 * and disclosed here (not hidden): the report scoped its 147/112 headline
 * to *closed* trades only; this script applies the identical grouping
 * rule across ALL existing trades regardless of status, since the same
 * duplication mechanism (a test session hitting the approve endpoint
 * repeatedly) applies equally to a trade that happens to still be open.
 * The closed-only subset is reported separately below specifically so it
 * can be sanity-checked against the report's 112/147 number.
 *
 * This is purely additive metadata: it never touches pnl/result/status,
 * never deletes anything, and does not change any win-rate calculation.
 * Idempotent -- safe to re-run; it always recomputes from the current
 * stored data rather than only filling in blanks, so re-running after new
 * (non-inferred, T-074a-tagged) trades exist is still correct: any trade
 * that already carries a real `origin` (T-074a) is left alone rather than
 * re-inferred, since its real origin is already known.
 *
 * Usage:  node scripts/backfillLikelyTestOrigin.js [--dry-run]
 */
const DRY_RUN = process.argv.includes('--dry-run');

function fingerprintKey(trade) {
  // Exact match only, per WINRATE_DIAGNOSIS.md -- null/undefined
  // asset/entryPrice/stopLoss are excluded from grouping entirely (see
  // classify() below) rather than treated as a matching "null"
  // fingerprint, to avoid a false-positive batch of unrelated trades that
  // all happen to have no stop-loss set.
  return `${trade.asset}|${trade.entryPrice}|${trade.stopLoss}`;
}

// Pure classification logic, exported separately from main() so it can be
// unit-tested without a live database connection.
// trades: array of { _id, asset, entryPrice, stopLoss, status }
function classify(trades) {
  const groupable = trades.filter(t => t.asset != null && t.entryPrice != null && t.stopLoss != null);
  const excludedCount = trades.length - groupable.length;

  const groups = new Map(); // fingerprint -> [trade, ...]
  for (const t of groupable) {
    const key = fingerprintKey(t);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
  }

  const duplicateBatches = [...groups.values()].filter(g => g.length >= 2);
  const flaggedTrueIds   = duplicateBatches.flat().map(t => t._id);
  const flaggedTrueSet   = new Set(flaggedTrueIds.map(String));

  const flaggedFalseIds = trades
    .filter(t => !flaggedTrueSet.has(String(t._id)))
    .map(t => t._id);

  const closedTrades           = trades.filter(t => t.status && t.status.startsWith('closed'));
  const closedFlaggedTrueCount = closedTrades.filter(t => flaggedTrueSet.has(String(t._id))).length;

  return {
    excludedCount,
    duplicateBatches,
    flaggedTrueIds,
    flaggedFalseIds,
    batchSizes: duplicateBatches.map(g => g.length).sort((a, b) => b - a),
    closedTotal: closedTrades.length,
    closedFlaggedTrueCount,
  };
}

async function main() {
  /* eslint-disable global-require */
  require('dotenv').config();
  const { connectDB, disconnectDB } = require('../src/config/db');
  const VirtualTrade = require('../src/models/VirtualTrade');
  /* eslint-enable global-require */

  await connectDB();

  // T-074a trades already carry a real, known origin -- never overwrite
  // that with an inference. Only pre-existing trades (undefined `origin`)
  // are eligible for this backfill.
  const trades = await VirtualTrade.find({ origin: { $exists: false } })
    .select('_id asset entryPrice stopLoss status likelyTestOrigin')
    .lean();

  console.log(`[T-074b] ${trades.length} pre-existing (no known origin) trades found.`);

  const result = classify(trades);

  if (result.excludedCount > 0) {
    console.log(`[T-074b] ${result.excludedCount} trade(s) excluded from grouping (missing asset/entryPrice/stopLoss) -- flagged likelyTestOrigin: false, cannot be part of an exact-fingerprint batch.`);
  }

  console.log(`[T-074b] Rule: exact-match (asset, entryPrice, stopLoss) fingerprint, groups of size >= 2 = duplicate-fingerprint batch (WINRATE_DIAGNOSIS.md Section 1).`);
  console.log(`[T-074b] ${result.duplicateBatches.length} duplicate-fingerprint batch(es) found, covering ${result.flaggedTrueIds.length} trade(s).`);
  console.log(`[T-074b] ${result.flaggedFalseIds.length} trade(s) flagged likelyTestOrigin: false (unique fingerprint or missing data).`);
  console.log(`[T-074b] Batch sizes (largest first): ${result.batchSizes.join(', ') || '(none)'}`);
  console.log(`[T-074b] Closed-trade subset: ${result.closedFlaggedTrueCount}/${result.closedTotal} flagged likelyTestOrigin: true (report's own analysis: 112/147).`);

  if (DRY_RUN) {
    console.log('[T-074b] --dry-run: no writes performed.');
    await disconnectDB();
    return;
  }

  if (result.flaggedTrueIds.length > 0) {
    const res = await VirtualTrade.updateMany(
      { _id: { $in: result.flaggedTrueIds } },
      { $set: { likelyTestOrigin: true } }
    );
    console.log(`[T-074b] Set likelyTestOrigin: true on ${res.modifiedCount} trade(s).`);
  }
  if (result.flaggedFalseIds.length > 0) {
    const res = await VirtualTrade.updateMany(
      { _id: { $in: result.flaggedFalseIds } },
      { $set: { likelyTestOrigin: false } }
    );
    console.log(`[T-074b] Set likelyTestOrigin: false on ${res.modifiedCount} trade(s).`);
  }

  console.log('[T-074b] Done.');
  await disconnectDB();
}

module.exports = { classify, fingerprintKey };

if (require.main === module) {
  main().catch(err => {
    console.error('[T-074b] Backfill failed:', err);
    process.exit(1);
  });
}
