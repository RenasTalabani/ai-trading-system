/**
 * Safety Limits Gate — deterministic, plain-code enforcement of the hard
 * numeric limits locked in master_plan_v1.md's Decision Log (decisions #13,
 * #15, #16, #23). Every code path that can create a real or paper trade
 * MUST call this before writing anything, and MUST honor a `allowed: false`
 * result as a hard stop, not a warning.
 *
 * Why this file exists at all (decision #23): an LLM being "asked nicely" to
 * respect a limit is not an enforcement mechanism -- it can be wrong,
 * mis-prompted, or have a bug in the surrounding pipeline. This module has
 * no dependency on the AI service, no LLM call, and no configuration that a
 * prompt can influence. It is pure arithmetic on the numbers the caller
 * gives it.
 */

// Decision #13 (locked, non-negotiable): no leverage, ever, in any product
// this app offers a user directly. The paper-trading "futures" feature
// predates this decision and is being kept only as a UI-less internal
// mechanism (funding-rate math, liquidation simulation) -- every entry
// point that can create a trade must force this value.
const ALLOWED_LEVERAGE = 1;

// Decision #15 (locked): a stop-loss is mandatory on every trade, and no
// matter what level the AI's own analysis picks, the resulting loss can
// never exceed this fraction of the position if the stop is actually hit.
const MAX_PER_TRADE_LOSS_PCT = 25;

// Decision #16 (locked): once realized losses for the current UTC day reach
// this fraction of the portfolio's current balance, ALL new trades stop
// until a human clears it via riskStateService.manualReset() -- this
// module only computes the number; riskStateService.js persists the halt.
const DAILY_LOSS_HALT_PCT = 10;

function _round2(n) {
  return Math.round(n * 100) / 100;
}

/**
 * Validates a single proposed trade's leverage + stop-loss against the hard
 * per-trade limits. Pure function -- no I/O, safe to unit test directly.
 *
 * @param {{entryPrice:number, stopLoss:?number, direction:'BUY'|'SELL', leverage?:number}} trade
 * @returns {{allowed:boolean, reasons:string[], impliedLossPct:?number, suggestedStopLoss:?number}}
 */
function evaluateProposedTrade({ entryPrice, stopLoss, direction, leverage = 1 }) {
  const reasons = [];

  if (!entryPrice || entryPrice <= 0) {
    return { allowed: false, reasons: ['INVALID_ENTRY_PRICE'], impliedLossPct: null, suggestedStopLoss: null };
  }
  if (!['BUY', 'SELL'].includes(direction)) {
    return { allowed: false, reasons: ['INVALID_DIRECTION'], impliedLossPct: null, suggestedStopLoss: null };
  }

  const lev = Number(leverage) || 1;
  if (lev !== ALLOWED_LEVERAGE) {
    reasons.push('LEVERAGE_NOT_ALLOWED');
  }

  if (stopLoss == null || isNaN(stopLoss) || stopLoss <= 0) {
    reasons.push('STOP_LOSS_REQUIRED');
    return {
      allowed: false,
      reasons,
      impliedLossPct: null,
      suggestedStopLoss: direction === 'BUY'
        ? _round2(entryPrice * (1 - MAX_PER_TRADE_LOSS_PCT / 100))
        : _round2(entryPrice * (1 + MAX_PER_TRADE_LOSS_PCT / 100)),
    };
  }

  const impliedLossPct = direction === 'BUY'
    ? ((entryPrice - stopLoss) / entryPrice) * 100
    : ((stopLoss - entryPrice) / entryPrice) * 100;

  if (impliedLossPct <= 0) {
    reasons.push('STOP_LOSS_WRONG_SIDE'); // e.g. a BUY with stopLoss above entry
  } else if (impliedLossPct > MAX_PER_TRADE_LOSS_PCT) {
    reasons.push('STOP_LOSS_EXCEEDS_CEILING');
  }

  const suggestedStopLoss = direction === 'BUY'
    ? _round2(entryPrice * (1 - MAX_PER_TRADE_LOSS_PCT / 100))
    : _round2(entryPrice * (1 + MAX_PER_TRADE_LOSS_PCT / 100));

  return {
    allowed: reasons.length === 0,
    reasons,
    impliedLossPct: _round2(impliedLossPct),
    suggestedStopLoss,
  };
}

/**
 * Given a portfolio's current balance and today's realized loss so far ($),
 * says whether the daily circuit breaker SHOULD be tripped. Pure function --
 * riskStateService.js is what actually persists the halt so it survives
 * past the moment the loss aged out of any rolling window.
 */
function shouldHaltForDailyLoss(currentBalance, todaysRealizedLossUsd) {
  if (!currentBalance || currentBalance <= 0) return false;
  const lossPct = (Math.abs(todaysRealizedLossUsd) / currentBalance) * 100;
  return lossPct >= DAILY_LOSS_HALT_PCT;
}

/**
 * Throws a plain Error (matching this codebase's existing convention of
 * throwing on invalid trade params -- see virtualTrackingService.js) if the
 * evaluation says the trade isn't allowed. Callers that already wrap their
 * work in try/catch (every controller in this repo does) get this for free.
 */
function assertTradeAllowed(evaluation) {
  if (!evaluation.allowed) {
    const err = new Error(
      `Blocked by safety limits: ${evaluation.reasons.join(', ')}` +
      (evaluation.suggestedStopLoss != null ? ` (max-compliant stop-loss would be ${evaluation.suggestedStopLoss})` : '')
    );
    err.safetyGateReasons = evaluation.reasons;
    err.isSafetyGateRejection = true;
    throw err;
  }
}

module.exports = {
  ALLOWED_LEVERAGE,
  MAX_PER_TRADE_LOSS_PCT,
  DAILY_LOSS_HALT_PCT,
  evaluateProposedTrade,
  shouldHaltForDailyLoss,
  assertTradeAllowed,
};
