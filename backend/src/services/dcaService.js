/**
 * DCA (Dollar-Cost Averaging) — simulated recurring-buy strategy.
 * Paper trading only, same as the rest of the virtual portfolio system.
 *
 * SAFETY FIX (2026-09-04): runDueBuys() used to execute a buy the instant it
 * came due, on an unattended daily cron, with zero human approval and zero
 * circuit-breaker check. That silently bypassed two locked, "no exceptions"
 * master-plan decisions -- #11 (every single trade requires explicit user
 * approval) and #16 (the daily-loss circuit breaker halts ALL new-trade
 * paths, not just the AI worker's). Neither gap was caught by any test;
 * this file had zero test coverage before this fix.
 *
 * Fixed by splitting "a buy is due" from "a buy is executed": the daily
 * cron (runDueBuys) now only flags a plan (dueBuyPending) and notifies the
 * user. approveDueBuy()/skipDueBuy() -- reachable only from an explicit tap
 * in the app -- are now the sole path that can actually move money,
 * mirroring the propose-then-approve shape used everywhere else in this
 * codebase (approveSuggestion, approveAllocationProposal).
 *
 * Deliberately NOT changed: stop-loss (decision #15) is not required on a
 * DCA buy. That decision's mandatory-stop-loss language is written for a
 * directional trade with a defined entry/exit pair; a DCA buy is a
 * long-horizon accumulation add with no exit leg to attach a stop to. If
 * this reading is wrong, it needs a human call, not a silent code choice --
 * flagged in the handoff for the user to weigh in on.
 */
const DCAPlan = require('../models/DCAPlan');
const binanceService = require('./binanceService');
const riskStateService = require('./riskStateService');
const logger = require('../config/logger');
const { withPortfolioLock } = require('../utils/portfolioLock');

function aiSvc() { return require('./aiService'); } // lazy — avoid load-order issues
function notifySvc() { return require('./notificationService'); } // lazy, same pattern as elsewhere
function vtSvc() { return require('./virtualTrackingService'); } // lazy, same pattern as elsewhere

// Bug fix (2026-09-04, overnight continuous-improvement pass, follow-up
// audit): this used to call riskStateService.isHalted(), a plain read of
// the persisted `dailyLossHalted` flag -- but that flag is only ever SET by
// riskStateService.checkAndMaybeHalt(portfolio), which every other
// trade-opening path (approveSuggestion, openFuturesTrade,
// approveAllocationProposal via aiWorkerService) calls on every single
// approval attempt, not just isHalted()'s read. If today's realized losses
// crossed the halt threshold purely through automatic TP/SL closures --
// with no other path happening to call checkAndMaybeHalt() in the
// meantime -- the flag would never actually flip, and isHalted() would
// keep reporting "not halted" indefinitely. A DCA buy could then slip
// through the circuit breaker on a day it should already be halted.
// Fixed by recomputing (and, if crossed, persisting) the halt here too,
// exactly like every other trade-opening path does -- checkAndMaybeHalt()
// is documented as idempotent and safe to call from every trade-proposal
// path for exactly this reason.
async function isHaltedNow() {
  const portfolio = await vtSvc().getPortfolio();
  const halt = await riskStateService.checkAndMaybeHalt(portfolio);
  return halt.halted ? halt.reason : null;
}

// Crypto uses the live WS/REST price cache (no extra network call); anything
// else (e.g. gold) falls back to the AI service's price lookup, which itself
// dispatches to the right source (Binance vs Yahoo Finance) per asset.
async function getLivePrice(asset) {
  const cached = binanceService.getCachedPrice(asset);
  if (cached) return typeof cached === 'object' ? cached.price : cached;
  return await aiSvc().getPrice(asset);
}

// Starting a plan is itself the user's one-time, explicit approval for this
// first buy (same asset/amount they just chose, executed immediately at the
// current price) -- unlike every *subsequent* due buy, this one doesn't
// need a second approval step (decision #11 is satisfied by the user's own
// "Start plan" tap).
//
// Bug fix (2026-09-04, overnight continuous-improvement pass): this first
// buy is still a real (paper) trade opening, and decision #16 is explicit
// that the daily-loss circuit breaker halts ALL new-trade paths, not just
// the AI worker's -- this function's own header comment already says so,
// but the code never actually checked it. A user could keep starting brand
// new DCA plans (each one immediately executing a real first buy) on a day
// the breaker had already tripped, silently bypassing the halt the same
// way the pre-fix approveDueBuy() did. Same error shape/convention as
// approveDueBuy()'s own halt check below.
async function startPlan(asset, amountPerBuy, frequencyDays) {
  asset = asset.toUpperCase();

  const haltReason = await isHaltedNow();
  if (haltReason) {
    const err = new Error(`Trading is paused (daily loss limit) — resume it before starting a new DCA plan. (${haltReason})`);
    err.isSafetyGateRejection = true;
    throw err;
  }

  const price = await getLivePrice(asset);
  if (!price) throw new Error(`Price unavailable for ${asset} — can't start a DCA plan.`);

  const units = amountPerBuy / price;
  const plan = await DCAPlan.create({
    asset, amountPerBuy, frequencyDays,
    purchases: [{ price, amountUsd: amountPerBuy, units, date: new Date() }],
    totalInvested: amountPerBuy,
    totalUnits: units,
    lastBuyAt: new Date(),
  });

  logger.info(`[DCA] Started plan for ${asset}: $${amountPerBuy} every ${frequencyDays}d (first buy @ $${price})`);
  return plan;
}

async function stopPlan(planId) {
  const plan = await DCAPlan.findById(planId);
  if (!plan) throw new Error('DCA plan not found.');
  plan.status = 'stopped';
  // Bug fix (2026-09-04, overnight continuous-improvement pass): a plan
  // could be stopped while a buy was already flagged dueBuyPending (the
  // daily cron ran before the user tapped Stop). Without clearing the flag
  // here, that stale `dueBuyPending: true` survived onto the now-stopped
  // plan -- and approveDueBuy() only ever checked dueBuyPending, never
  // status, so the buy could still be approved and executed on a plan the
  // user just told the app to stop. See approveDueBuy()'s matching status
  // check below -- this clears the flag as defense in depth on this side
  // too, so a stopped plan never shows/keeps a stale "buy due" state at all.
  plan.dueBuyPending = false;
  await plan.save();
  return plan;
}

// Called on a daily cron. Flags any plan whose next buy has come due as
// pending approval and notifies the user -- never executes a buy itself.
// A plan already flagged is left alone (no re-notification spam every
// cron tick while it waits on the user).
async function runDueBuys() {
  const activePlans = await DCAPlan.find({ status: 'active', dueBuyPending: false });
  if (activePlans.length === 0) return;

  for (const plan of activePlans) {
    try {
      const dueAt = new Date(plan.lastBuyAt.getTime() + plan.frequencyDays * 24 * 3_600_000);
      if (Date.now() < dueAt.getTime()) continue;

      plan.dueBuyPending = true;
      await plan.save();
      logger.info(`[DCA] Buy due for ${plan.asset} (plan ${plan._id}) — flagged for approval, notifying.`);
      await notifySvc().sendDcaBuyDueNotification(plan).catch(() => {});
    } catch (err) {
      logger.error(`[DCA] Failed to flag due buy for plan ${plan._id} (${plan.asset}):`, err.message);
    }
  }
}

// The ONLY path that can actually move money for a DCA plan (decision #11).
// Executes at whatever the price is right now, not whatever it was when the
// buy first became due -- same "propose now, price at approval time" shape
// the rest of the app's approval flows already use.
async function approveDueBuy(planId) {
  // Bug fix (2026-09-04, overnight continuous-improvement pass): the
  // `dueBuyPending` check below and the `plan.save()` that clears it used
  // to straddle real async work (the circuit-breaker check, the live price
  // fetch) with nothing serializing the two -- the same TOCTOU shape
  // already found and fixed in approveSuggestion() (see
  // virtualTrackingServiceApproveRace.test.js). Two near-simultaneous
  // approve taps on the same due buy -- a double-tap, a network retry --
  // could both see `dueBuyPending: true` and both execute a buy, silently
  // double-spending this cycle's DCA amount. Reusing the same shared
  // portfolio mutex the trade-opening path uses (see portfolioLock.js) for
  // the same reason: it's an in-process lock appropriate for this app's
  // single-process deployment model, and a DCA buy is exactly the same
  // class of "read a pending flag, do async work, write money" critical
  // section that lock already exists to serialize.
  const plan = await withPortfolioLock(async () => {
    const p = await DCAPlan.findById(planId);
    if (!p) throw new Error('DCA plan not found.');
    if (!p.dueBuyPending) throw new Error('This plan has no buy waiting on approval right now.');
    // Bug fix (2026-09-04, overnight continuous-improvement pass): this
    // only ever checked dueBuyPending, never status -- a plan stopped after
    // the daily cron already flagged it (or, before stopPlan()'s own fix
    // above, any plan carrying a stale flag from before it was stopped)
    // could still have its buy approved and executed, doing the exact
    // opposite of what the user just asked for by tapping Stop.
    if (p.status !== 'active') throw new Error('This plan is not active, so its pending buy can no longer be approved.');

    // Decision #16: the daily-loss circuit breaker halts ALL new-trade
    // paths, not just the AI worker's -- this was the other gap the fix
    // closed. The buy stays flagged as due; it isn't silently dropped.
    //
    // Uses isHaltedNow() (recompute-and-persist, same as every other
    // trade-opening path), not a plain flag read -- see isHaltedNow()'s own
    // comment above for why a plain read could stay "not halted" even past
    // the real threshold.
    const haltReason = await isHaltedNow();
    if (haltReason) {
      const err = new Error(`Trading is paused (daily loss limit) — resume it before approving this buy. (${haltReason})`);
      err.isSafetyGateRejection = true;
      throw err;
    }

    const price = await getLivePrice(p.asset);
    if (!price) throw new Error(`Price unavailable for ${p.asset} — try again shortly.`);

    const units = p.amountPerBuy / price;
    p.purchases.push({ price, amountUsd: p.amountPerBuy, units, date: new Date() });
    p.totalInvested += p.amountPerBuy;
    p.totalUnits += units;
    p.lastBuyAt = new Date();
    p.dueBuyPending = false;
    await p.save();

    return p;
  });

  logger.info(`[DCA] Approved buy for ${plan.asset}: $${plan.amountPerBuy} @ $${plan.purchases[plan.purchases.length - 1].price} (${plan.purchases.length} total buys)`);
  return plan;
}

// Declines this cycle's buy without spending anything. lastBuyAt is pushed
// forward to now so the plan waits a full frequencyDays before flagging due
// again, rather than immediately re-flagging on the next daily cron tick.
async function skipDueBuy(planId) {
  // Bug fix (2026-09-04, overnight continuous-improvement pass): this
  // function's own check-then-write wasn't wrapped in the shared portfolio
  // mutex the way approveDueBuy() now is (see the fix above) -- meaning a
  // "Skip" tap and an "Approve" tap landing at close to the same time for
  // the SAME due buy (two devices open on the same account, or a slow
  // network causing one action to retry while the user has already tapped
  // the other) were not serialized against EACH OTHER at all. Both could
  // read dueBuyPending: true before either wrote, and skipDueBuy()'s own
  // save (only $set-ing dueBuyPending/lastBuyAt, per how Mongoose persists
  // a modified document) would not stop approveDueBuy() from still pushing
  // a real purchase and incrementing totalInvested moments later --
  // silently executing the buy the user just told the app to skip.
  //
  // Fixed by acquiring the SAME shared mutex approveDueBuy() uses, so the
  // two can no longer interleave: whichever call's lock.run() actually
  // enters first sees the accurate, up-to-date dueBuyPending value and the
  // loser's own dueBuyPending check (running after the first has already
  // cleared it) correctly reports "no buy waiting" instead of quietly
  // racing ahead. Safe to reuse: skipDueBuy() is only ever reached from its
  // own HTTP route, never called from inside approveDueBuy() or any other
  // function that already holds this lock.
  const plan = await withPortfolioLock(async () => {
    const p = await DCAPlan.findById(planId);
    if (!p) throw new Error('DCA plan not found.');
    if (!p.dueBuyPending) throw new Error('This plan has no buy waiting on approval right now.');

    p.dueBuyPending = false;
    p.lastBuyAt = new Date();
    await p.save();
    return p;
  });

  logger.info(`[DCA] Buy skipped for ${plan.asset} (plan ${plan._id}).`);
  return plan;
}

async function getPlansWithSummary() {
  const plans = await DCAPlan.find().sort({ createdAt: -1 }).lean();
  const summaries = [];

  for (const plan of plans) {
    const currentPrice = await getLivePrice(plan.asset);
    const currentValue = currentPrice ? plan.totalUnits * currentPrice : null;
    const unrealizedPnl = currentValue !== null ? currentValue - plan.totalInvested : null;
    const unrealizedPnlPct = currentValue !== null && plan.totalInvested > 0
      ? (unrealizedPnl / plan.totalInvested) * 100 : null;
    const avgCostBasis = plan.totalUnits > 0 ? plan.totalInvested / plan.totalUnits : 0;

    summaries.push({
      ...plan,
      currentPrice, currentValue, unrealizedPnl, unrealizedPnlPct, avgCostBasis,
    });
  }
  return summaries;
}

module.exports = { startPlan, stopPlan, runDueBuys, approveDueBuy, skipDueBuy, getPlansWithSummary };
