/**
 * Persists and reads the portfolio-wide daily-loss circuit breaker
 * (RiskState) that safetyLimitsGate.js's math feeds into. Split out from the
 * gate itself so the gate stays a pure, dependency-free function set that's
 * trivial to unit test, while this file owns the one Mongo document that
 * needs to survive across server restarts and cron cycles.
 */
const RiskState = require('../models/RiskState');
const VirtualTrade = require('../models/VirtualTrade');
const logger = require('../config/logger');
const { shouldHaltForDailyLoss, DAILY_LOSS_HALT_PCT } = require('./safetyLimitsGate');

function _utcDayKey(d = new Date()) {
  return d.toISOString().slice(0, 10); // 'YYYY-MM-DD'
}

async function getState() {
  let state = await RiskState.findOne({ riskKey: 'global' });
  if (!state) {
    state = await RiskState.create({ riskKey: 'global' });
  }
  // A halt from a previous UTC day doesn't auto-clear -- decision #16 is
  // explicit that this requires a human ("stops until manual reactivation"),
  // not the calendar. haltDayKey is kept only so the UI can show "halted
  // since <date>", not to auto-resume.
  return state;
}

async function isHalted() {
  const state = await getState();
  return !!state.dailyLossHalted;
}

/**
 * Recomputes today's realized loss from closed VirtualTrades and, if it has
 * crossed the DAILY_LOSS_HALT_PCT threshold, persists a halt. Idempotent --
 * safe to call from every trade-proposal path; a call while already halted
 * is a no-op read.
 */
async function checkAndMaybeHalt(portfolio) {
  const existing = await getState();
  if (existing.dailyLossHalted) {
    return { halted: true, reason: existing.haltReason, alreadyHalted: true };
  }

  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);

  const agg = await VirtualTrade.aggregate([
    { $match: { status: { $in: ['closed_profit', 'closed_loss'] }, closedAt: { $gte: dayStart }, pnl: { $lt: 0 } } },
    { $group: { _id: null, totalLoss: { $sum: '$pnl' } } },
  ]);
  const todaysLossUsd = Math.abs(agg[0]?.totalLoss || 0);

  if (shouldHaltForDailyLoss(portfolio.currentBalance, todaysLossUsd)) {
    existing.dailyLossHalted = true;
    existing.haltedAt = new Date();
    existing.haltReason = `Daily loss reached $${todaysLossUsd.toFixed(2)} (>= ${DAILY_LOSS_HALT_PCT}% of $${portfolio.currentBalance.toFixed(2)} balance)`;
    existing.dailyLossAtHalt = todaysLossUsd;
    existing.haltDayKey = _utcDayKey();
    await existing.save();
    logger.warn(`[RiskState] Daily-loss circuit breaker TRIPPED — ${existing.haltReason}`);
    return { halted: true, reason: existing.haltReason, alreadyHalted: false };
  }

  return { halted: false, todaysLossUsd };
}

/**
 * The ONLY way the halt clears. Deliberately requires an explicit caller
 * identity string -- the point of decision #16 is that this is never
 * automatic, so there is always a "who cleared it" to look back on.
 */
async function manualReset(resetBy = 'user') {
  const state = await getState();
  state.dailyLossHalted = false;
  state.resetAt = new Date();
  state.resetBy = resetBy;
  await state.save();
  logger.info(`[RiskState] Daily-loss circuit breaker manually reset by "${resetBy}".`);
  return state;
}

module.exports = { getState, isHalted, checkAndMaybeHalt, manualReset };
