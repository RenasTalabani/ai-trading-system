/**
 * renoRecommendationService — Phase 3, step 1 (2026-09-01).
 *
 * A NEW, RENO-specific guidance layer that sits ON TOP of
 * guideController.buildPositionGuidance() rather than replacing or
 * modifying it. Per the explicit Phase 3 instruction: "Do not blindly
 * modify buildPositionGuidance(). First map every caller and dependency.
 * Determine whether a new RENO-specific guidance layer can be added
 * without changing existing Guide behavior. Preserve backward
 * compatibility for Guide." That mapping was done first (all 3 real call
 * sites: guideController.getPositions(), conversationMonitorJob.js's
 * _guidanceFor(), conversationService.js's _execGetOpenPositions()) —
 * buildPositionGuidance() itself is untouched by this file, byte for
 * byte, and every existing caller's behavior is unaffected.
 *
 * Extends Guide's binary HOLD/SELL into RENO's four-state model:
 *   HOLD        — nothing material changed, same reasoning as entry.
 *   EXIT        — thesis broken (exactly buildPositionGuidance()'s
 *                 existing SELL condition — signal contradiction or an
 *                 overbought/oversold RSI reading against the trade).
 *   TAKE_PROFIT — price is already at/very near the original target —
 *                 worth locking in gains now rather than waiting.
 *   EXTEND      — well past the halfway point to target, still trending
 *                 favorably, and nothing (RSI, a contradicting signal)
 *                 shows the move running out of steam — the original
 *                 target may have been conservative.
 *   INSUFFICIENT_DATA — no live price (halted, or a genuine gap) — never
 *                 silently defaulted to HOLD, exactly per the explicit
 *                 "never convert missing data into HOLD" rule.
 *
 * Every state carries a plain-language `reason` and a machine-readable
 * `evidence` object built ONLY from numbers already computed by
 * buildPositionGuidance() or present on the trade/signal documents
 * themselves — nothing here is invented, estimated, or pulled from a
 * data source (news/social sentiment, market regime) that isn't
 * actually wired into this function. That's a deliberate, honestly-
 * documented scope boundary, not an oversight — see this module's
 * header note in the Phase 3 commit message for what's NOT covered yet.
 */

// How far price has moved from entry toward the take-profit target,
// as a 0..1+ fraction (can exceed 1 if price has already passed target).
// Returns null when there's no target to measure progress against.
function _progressToTarget(trade, currentPrice) {
  if (!trade.takeProfit || currentPrice == null) return null;
  const totalMove = Math.abs(trade.takeProfit - trade.entryPrice);
  if (totalMove <= 0) return null;
  const doneMove = trade.direction === 'BUY'
    ? (currentPrice - trade.entryPrice)
    : (trade.entryPrice - currentPrice);
  return doneMove / totalMove;
}

// Reads the same RSI field buildPositionGuidance() already reads, so
// "momentum still intact" here means exactly what it means there.
function _rsi(latestSignal) {
  const rsi = latestSignal?.sources?.market?.indicators?.rsi;
  return typeof rsi === 'number' ? rsi : null;
}

// True when nothing in the available evidence (RSI, a contradicting
// active signal) suggests the move is exhausted — i.e. safe to consider
// EXTEND rather than banking the gain now.
function _momentumStillIntact(trade, latestSignal) {
  const rsi = _rsi(latestSignal);
  if (rsi !== null) {
    if (trade.direction === 'BUY'  && rsi > 75) return false;
    if (trade.direction === 'SELL' && rsi < 25) return false;
  }
  const contradicts = latestSignal
    && latestSignal.status === 'active'
    && ['BUY', 'SELL'].includes(latestSignal.direction)
    && latestSignal.direction !== trade.direction;
  return !contradicts;
}

const TAKE_PROFIT_THRESHOLD = 0.95; // 95%+ of the way to target
const EXTEND_THRESHOLD      = 0.6;  // 60%+ of the way to target

/**
 * @param trade        The raw VirtualTrade document (needs asset,
 *                      direction, entryPrice, takeProfit, stopLoss).
 * @param guidance      buildPositionGuidance()'s own, already-computed
 *                      output for this trade — reused, never recomputed.
 * @param latestSignal  Same latestSignal buildPositionGuidance() itself
 *                      was called with (may be null/undefined).
 */
function buildRenoRecommendation(trade, guidance, latestSignal = null) {
  if (guidance.isHalted || guidance.currentPrice == null) {
    return {
      state: 'INSUFFICIENT_DATA',
      reason: guidance.why?.[0] || `No live price is available for ${trade.asset} right now.`,
      evidence: { currentPrice: null, isHalted: !!guidance.isHalted },
    };
  }

  // buildPositionGuidance()'s own SELL condition IS the thesis-broken
  // condition -- reused verbatim as EXIT, not recomputed differently.
  if (guidance.recommendation === 'SELL') {
    return {
      state: 'EXIT',
      reason: guidance.why?.[0] || 'The original reasons for this trade no longer hold.',
      evidence: {
        pnlPct: guidance.pnlPct,
        rsi: _rsi(latestSignal),
        contradictingSignal: !!(latestSignal?.status === 'active'
          && ['BUY', 'SELL'].includes(latestSignal.direction)
          && latestSignal.direction !== trade.direction),
      },
    };
  }

  const progress = _progressToTarget(trade, guidance.currentPrice);

  if (progress !== null && progress >= TAKE_PROFIT_THRESHOLD) {
    return {
      state: 'TAKE_PROFIT',
      reason: `${trade.asset} is already at (or essentially at) your original target — worth considering locking in the gain now rather than waiting for it to fill exactly.`,
      evidence: { pnlPct: guidance.pnlPct, progressToTargetPct: parseFloat((progress * 100).toFixed(1)) },
    };
  }

  if (progress !== null && progress >= EXTEND_THRESHOLD && _momentumStillIntact(trade, latestSignal)) {
    return {
      state: 'EXTEND',
      reason: `${trade.asset} has moved well past halfway to your target and nothing in the current data shows it running out of steam — the original target may have been conservative.`,
      evidence: {
        pnlPct: guidance.pnlPct,
        progressToTargetPct: parseFloat((progress * 100).toFixed(1)),
        rsi: _rsi(latestSignal),
      },
    };
  }

  return {
    state: 'HOLD',
    reason: guidance.why?.[guidance.why.length - 1] || 'Nothing material has changed since you opened this.',
    evidence: {
      pnlPct: guidance.pnlPct,
      progressToTargetPct: progress !== null ? parseFloat((progress * 100).toFixed(1)) : null,
      rsi: _rsi(latestSignal),
    },
  };
}

module.exports = { buildRenoRecommendation, TAKE_PROFIT_THRESHOLD, EXTEND_THRESHOLD };
