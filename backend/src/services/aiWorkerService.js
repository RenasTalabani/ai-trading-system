/**
 * AI Worker Service
 * Calls the Python AI service every cycle, stores PROPOSED decisions.
 *
 * Master-plan decision #11 (locked, 2026-09-03): this used to be a 24/7
 * autonomous brain that opened VirtualTrades on its own the moment a
 * decision cleared its confidence bar -- that directly contradicts the
 * locked "approval required for every trade" decision from the founder
 * interrogation. It now only ever proposes (creates an AIDecision with
 * status: 'PENDING_APPROVAL') and never calls VirtualTrade.create() itself.
 * A trade is only ever opened by approveDecision() below, which is the one
 * path a human action (the mobile app's Yes/No tap) reaches.
 */
const axios          = require('axios');
const AIDecision     = require('../models/AIDecision');
const AllocationProposal = require('../models/AllocationProposal');
const VirtualTrade   = require('../models/VirtualTrade');
const VirtualPortfolio = require('../models/VirtualPortfolio');
const BudgetSession  = require('../models/BudgetSession');
const MarketRegimeHistory = require('../models/MarketRegimeHistory');
const logger         = require('../config/logger');
const { approveSuggestion, computeSpotSizeUsd } = require('./virtualTrackingService');
const safetyGate     = require('./safetyLimitsGate');
const riskStateService = require('./riskStateService');
const { buildAllocationOptions } = require('./allocationOptionsBuilder');
const { getCache: getGlobalScanCache } = require('../jobs/globalScanJob');

// T-060 (2026-08-26, product-to-code audit follow-up): this worker used to
// make its own independent /api/global/scan call every 5 minutes, separate
// from globalScanJob's own 30-minute cycle -- since that endpoint isn't
// deterministic/cached server-side (live prices, live RL weights, live
// macro), the two pipelines could and did return different results for the
// same asset within minutes of each other, each persisting its own
// AIDecision. Reusing globalScanJob's cached scan when it's fresh enough
// removes that duplicate-decision-generation root cause; falling back to a
// direct call when the cache is empty/stale keeps this worker functional on
// its own (e.g. at boot, or if globalScanJob's own cycle failed).
const MAX_CACHE_AGE_MS = 35 * 60 * 1000; // globalScanJob refreshes every 30 min; small slack

const CONFIDENCE_THRESHOLD  = parseInt(process.env.AI_CONFIDENCE_THRESHOLD)  || 70;  // Phase 18: raised to 70
const MIN_FUSED_SCORE       = parseInt(process.env.AI_MIN_FUSED_SCORE)       || 65;  // Phase 18
const MIN_QUALITY_SCORE     = parseInt(process.env.AI_MIN_QUALITY_SCORE)     || 75;  // Phase 18
const MAX_OPEN_TRADES       = parseInt(process.env.AI_MAX_OPEN_TRADES)       || 5;   // Phase 18: reduced to 5
const MAX_NEW_PER_CYCLE     = parseInt(process.env.AI_MAX_NEW_PER_CYCLE)     || 3;

// Bug found 2026-09-04 (overnight continuous-improvement pass, decision #17/
// #21 spot-check): a PENDING_APPROVAL AllocationProposal never expired.
// AIDecision.js's own schema comment already documents the intent --
// "'EXPIRED' covers a proposal nobody acted on before its price context went
// stale" -- but nothing ever set it. Two real consequences of that gap: (1)
// the "only ever show ONE pending decision" guard a few lines below this
// block means the worker permanently stops proposing anything new the
// moment the founder misses (or is asleep through) a single proposal --
// there was no way for the assistant to ever recover on its own; (2) if the
// founder came back hours/days later and tapped Approve anyway,
// approveSuggestion() would open a trade at the entryPrice/stopLoss the AI
// computed back when the proposal was created -- a price snapshot that old
// no longer reflects the market being approved into. 3h roughly matches the
// '1h' scan timeframe these opportunities are scored on (see the
// {timeframe:'1h'} scan call below) with room to actually notice the app
// while still bounding how stale an approved price snapshot can be.
const PROPOSAL_EXPIRY_HOURS = parseInt(process.env.AI_PROPOSAL_EXPIRY_HOURS) || 3;
// The old self-resuming 5%-over-a-rolling-24h-window check that used to
// live here is gone -- master-plan decision #16 (locked) replaced it with
// riskStateService's persistent, human-reset-only 10% circuit breaker
// (safetyLimitsGate.DAILY_LOSS_HALT_PCT). A limit that quietly re-opens once
// a bad trade "ages out" of a window isn't a real circuit breaker.

// ── Helpers ───────────────────────────────────────────────────────────────────

function _pick(obj, ...keys) {
  for (const k of keys) if (obj[k] != null) return obj[k];
  return null;
}

// Lazy require -- notificationService requires User/Notification models and
// this service is loaded very early at boot; matches the existing
// notifySvc() pattern already used in virtualTrackingService.js for the
// same reason.
function notifySvc() { return require('./notificationService'); }

// Marks a single stale PENDING_APPROVAL proposal (and every AIDecision it
// still references) EXPIRED. Split out from expireStalePendingProposals()
// so a failure notifying/saving one stale proposal can never stop the
// others in the same batch from being processed.
async function _expireOneProposal(proposal) {
  const decisionIds = _allReferencedDecisionIds(proposal);
  if (decisionIds.length) {
    await AIDecision.updateMany(
      { _id: { $in: decisionIds }, status: 'PENDING_APPROVAL' },
      { $set: { status: 'EXPIRED', decidedAt: new Date() } }
    );
  }
  proposal.status    = 'EXPIRED';
  proposal.decidedAt = new Date();
  await proposal.save();
  logger.info(
    `[AIWorker] Proposal ${proposal._id} expired -- sat unanswered past ` +
    `${PROPOSAL_EXPIRY_HOURS}h, its price snapshot is stale.`
  );
  notifySvc().sendProposalExpiredNotification(proposal).catch(() => {});
}

// See the PROPOSAL_EXPIRY_HOURS comment above for why this exists. Called at
// the very top of runAIWorkerCycle() -- before the session/budget check --
// so a stale proposal gets cleared out on the normal 5-minute cron cadence
// even while the budget session is paused or inactive; a proposal a human
// is actively looking at right now is never touched (only ones older than
// the cutoff).
async function expireStalePendingProposals() {
  const cutoff = new Date(Date.now() - PROPOSAL_EXPIRY_HOURS * 60 * 60 * 1000);
  const stale = await AllocationProposal.find({
    status:    'PENDING_APPROVAL',
    createdAt: { $lte: cutoff },
  });
  for (const proposal of stale) {
    try {
      await _expireOneProposal(proposal);
    } catch (err) {
      logger.error(`[AIWorker] Failed expiring stale proposal ${proposal._id}: ${err.message}`);
    }
  }
}

// ── Core cycle ────────────────────────────────────────────────────────────────

async function runAIWorkerCycle() {
  // 0. Clear out any proposal nobody answered in time -- BEFORE the
  // session/budget check below, so this keeps happening every 5-minute
  // cron tick regardless of session state (see PROPOSAL_EXPIRY_HOURS above).
  await expireStalePendingProposals();

  // 1. Budget session must be active
  const session = await BudgetSession.findOne({ sessionKey: 'global' });
  if (!session || session.status !== 'active') {
    return { skipped: 'session_inactive' };
  }

  // 2. Portfolio protection — max open trades
  const openCount = await VirtualTrade.countDocuments({ status: 'open' });
  if (openCount >= MAX_OPEN_TRADES) {
    return { skipped: 'max_trades_reached', openCount };
  }

  // 3. Load portfolio for position sizing
  const portfolio = await VirtualPortfolio.findOne({ portfolioKey: 'global' });
  if (!portfolio) return { skipped: 'no_portfolio' };

  // 2b. Portfolio protection — daily-loss circuit breaker (decision #16:
  // 10% of balance, halted until a human resets it — see riskStateService).
  const halt = await riskStateService.checkAndMaybeHalt(portfolio);
  if (halt.halted) {
    logger.warn(`[AIWorker] Daily-loss circuit breaker is tripped — pausing proposals: ${halt.reason}`);
    return { skipped: 'daily_loss_halted', reason: halt.reason };
  }

  // 3b. Single-screen model (decision #21): only ever show ONE pending
  // decision at a time. Don't pile a new proposal on top of one the user
  // hasn't answered yet.
  const existingPending = await AllocationProposal.findOne({ status: 'PENDING_APPROVAL' });
  if (existingPending) {
    return { skipped: 'pending_proposal_exists', proposalId: existingPending._id };
  }

  // 4. Reuse globalScanJob's cached scan when fresh enough (T-060); only
  // fall back to an independent call when there's no usable cache.
  let scanResult;
  const cached   = getGlobalScanCache();
  const cacheAge = cached?.scannedAt ? Date.now() - new Date(cached.scannedAt).getTime() : Infinity;

  if (cached?.result?.success && cacheAge <= MAX_CACHE_AGE_MS) {
    scanResult = cached.result;
  } else {
    const aiUrl = (process.env.AI_SERVICE_URL || 'http://localhost:8000').replace(/\/$/, '');
    try {
      const { data } = await axios.post(`${aiUrl}/api/global/scan`, {
        capital:   portfolio.currentBalance,
        timeframe: '1h',
        top_n:     5,
      }, { timeout: 90_000 });
      scanResult = data;
    } catch (err) {
      logger.warn('[AIWorker] AI service unreachable:', err.message);
      return { skipped: 'ai_service_error', error: err.message };
    }
  }

  if (!scanResult?.success || !scanResult.top_opportunities?.length) {
    return { skipped: 'no_opportunities' };
  }

  // 5. Assets already in open trades — avoid doubling up. Sizing itself now
  // happens only inside approveSuggestion() at approval time (single source
  // of truth for position sizing — see virtualTrackingService.js), not here.
  const openAssets  = await VirtualTrade.distinct('asset', { status: 'open' });
  const openSet     = new Set(openAssets);

  let proposalsCreated = 0;
  const candidates = []; // feeds buildAllocationOptions() after the loop

  // 6. Process each top opportunity — PROPOSE only (decision #11). Nothing
  // in this loop calls VirtualTrade.create() any more; it only writes an
  // AIDecision the mobile app can show as "waiting for your yes/no", and
  // approveDecision() below is the single place that actually opens a
  // trade, once a human has tapped Approve.
  for (const opp of scanResult.top_opportunities) {
    if (proposalsCreated >= MAX_NEW_PER_CYCLE) break;
    // Bug found 2026-08-18 (PM continuous-improvement pass): the check at
    // the top of this function only gates whether the cycle runs *at all*
    // (openCount >= MAX_OPEN_TRADES -> skip the whole cycle) -- it never
    // limited how many NEW trades this loop could add on top of that
    // starting count. Kept here even though this loop now only proposes,
    // because open positions + pending proposals shouldn't together exceed
    // the portfolio's own declared exposure cap.
    if (openCount + proposalsCreated >= MAX_OPEN_TRADES) break;
    if (opp.action === 'HOLD') continue;
    if ((opp.confidence   || 0) < CONFIDENCE_THRESHOLD) continue;
    if ((opp.fused_score  || 0) < MIN_FUSED_SCORE)      continue;
    if ((opp.quality_score || 0) < MIN_QUALITY_SCORE)   continue;
    if (openSet.has(opp.asset)) continue;

    const entryPrice = _pick(opp, 'current_price', 'currentPrice');
    if (!entryPrice) continue;

    const stopLoss   = _pick(opp, 'stop_loss',   'stopLoss');
    const takeProfit = _pick(opp, 'take_profit',  'takeProfit');

    // Safety Limits Gate BEFORE even proposing — no point showing the user
    // a "Yes/No" card for something that could never be approved anyway
    // (decisions #15/#23). The reasons are stored on the decision itself so
    // the settings/history screen can show exactly why, if it matters later.
    const gateResult = safetyGate.evaluateProposedTrade({
      entryPrice, stopLoss, direction: opp.action, leverage: 1,
    });
    if (!gateResult.allowed) {
      logger.warn(`[AIWorker] ${opp.asset} opportunity failed the safety gate, not proposing: ${gateResult.reasons.join(', ')}`);
      continue;
    }

    // Store the AI decision as a pending proposal — awaiting explicit
    // human approval (mobile app's single-screen Yes/No).
    const decision = await AIDecision.create({
      asset:       opp.asset,
      displayName: _pick(opp, 'display_name', 'displayName') || opp.asset,
      assetClass:  _pick(opp, 'asset_class',  'assetClass')  || 'crypto',
      action:      opp.action,
      confidence:  opp.confidence,
      entryPrice,
      stopLoss:    stopLoss   ?? null,
      takeProfit:  takeProfit ?? null,
      riskReward:  _pick(opp, 'risk_reward',  'riskReward')  ?? null,
      reason:      opp.reason ?? null,
      rsi:         opp.rsi    ?? null,
      trend:       opp.trend  ?? null,
      newsScore:   _pick(opp, 'news_score',  'newsScore')    ?? null,
      fusedScore:  _pick(opp, 'fused_score', 'fusedScore')   ?? null,
      status:      'PENDING_APPROVAL',
      // T-073: same ATR value ai-service's GlobalAnalyzer already computed
      // and used to size this exact opportunity's stopLoss/takeProfit
      // (see global_analyzer.py's _score_crypto/_score_multi_asset) --
      // kept on the decision so approveDecision() can reuse it as-is.
      atrAtEntry:  _pick(opp, 'atr'),
    });

    // Store regime history (Phase 18). aiDecisionId links this record back
    // to the AIDecision created just above -- see MarketRegimeHistory.js's
    // own comment: decisionTrackingJob.evaluateOpenDecisions() uses this
    // link to propagate that decision's eventual WIN/LOSS result here once
    // it resolves, which is what actually makes the "Regime WR last 6h" log
    // line in performanceAnalysisJob.js produce anything at all.
    if (opp.regime) {
      MarketRegimeHistory.create({
        asset:        opp.asset,
        regime:       opp.regime,
        action:       opp.action,
        confidence:   opp.confidence,
        fusedScore:   opp.fused_score,
        aiDecisionId: decision._id,
      }).catch(() => {});
    }

    // Same sizing math every other trade path uses (computeSpotSizeUsd —
    // riskPerTradePct × edge multiplier, hard-capped at MAX_POSITION_RISK_PCT)
    // so a diversified/single-asset allocation option can never risk more
    // than a normally-approved trade in that asset would.
    const { sizeUsd } = await computeSpotSizeUsd(opp.asset, portfolio, `${opp.asset} AI worker proposal`);

    candidates.push({
      asset: opp.asset, direction: opp.action, entryPrice, stopLoss, takeProfit,
      confidence: opp.confidence, fusedScore: _pick(opp, 'fused_score', 'fusedScore'),
      sizeUsd, aiDecisionId: decision._id,
    });

    openSet.add(opp.asset); // reserve the asset so we don't propose it twice in one cycle
    proposalsCreated++;

    logger.info(
      `[AIWorker] Proposal created (awaiting approval) — ${opp.asset} ${opp.action} @ ${entryPrice} ` +
      `| conf:${opp.confidence}% | SL:${stopLoss} | TP:${takeProfit} | decisionId:${decision._id}`
    );
  }

  // 7. Bundle every candidate from this cycle into ONE allocation proposal
  // with 2-4 choices (decision #14) — the single thing the main screen shows.
  let proposalId = null;
  if (candidates.length > 0) {
    const options = buildAllocationOptions(candidates);
    const proposal = await AllocationProposal.create({ options, status: 'PENDING_APPROVAL' });
    proposalId = proposal._id;
    logger.info(
      `[AIWorker] Allocation proposal ${proposalId} created — ${options.length} option(s) from ${candidates.length} candidate(s).`
    );
  }

  return {
    proposalsCreated,
    proposalId,
    openCount,
    balance: parseFloat(portfolio.currentBalance.toFixed(2)),
    scanned: scanResult.scanned,
  };
}

// ── Queries used by the controller ────────────────────────────────────────────

async function getLatestDecisions(limit = 20) {
  return AIDecision.find()
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();
}

// ── Human approval of a pending proposal (decision #11) ────────────────────────
// The single path that turns an AIDecision into a real (paper) VirtualTrade.
// Reuses approveSuggestion()'s existing sizing + safety-gate + circuit-breaker
// checks unchanged, so an AI-worker-approved trade can never bypass any limit
// a manually-approved Guide/RENO trade would also have to pass.
async function approveDecision(decisionId) {
  const decision = await AIDecision.findById(decisionId);
  if (!decision) throw new Error('Decision not found.');
  if (decision.status !== 'PENDING_APPROVAL') {
    throw new Error(`This decision is already ${decision.status.toLowerCase()} — nothing to approve.`);
  }
  if (!['BUY', 'SELL'].includes(decision.action)) {
    throw new Error('Only BUY/SELL decisions can be approved into a trade.');
  }

  let trade;
  try {
    trade = await approveSuggestion({
      asset:        decision.asset,
      direction:    decision.action,
      entryPrice:   decision.entryPrice,
      stopLoss:     decision.stopLoss,
      takeProfit:   decision.takeProfit,
      atrAtEntry:   decision.atrAtEntry,
      aiDecisionId: decision._id,
      origin:       'ai_worker_approved',
    });
  } catch (err) {
    // A safety-gate rejection at approval time (e.g. price moved enough
    // since the proposal that the stop-loss no longer complies) should be
    // visible on the decision record, not just thrown away in a 500.
    if (err.isSafetyGateRejection) {
      decision.safetyGateReasons = err.safetyGateReasons;
    }
    throw err;
  }

  decision.status       = 'APPROVED';
  decision.decidedAt    = new Date();
  decision.tradeCreated = true;
  decision.tradeId      = trade._id;
  await decision.save();

  logger.info(`[AIWorker] Decision ${decisionId} APPROVED by user — trade ${trade._id} opened.`);
  return trade;
}

async function rejectDecision(decisionId) {
  const decision = await AIDecision.findById(decisionId);
  if (!decision) throw new Error('Decision not found.');
  if (decision.status !== 'PENDING_APPROVAL') {
    throw new Error(`This decision is already ${decision.status.toLowerCase()} — nothing to reject.`);
  }
  decision.status    = 'REJECTED';
  decision.decidedAt = new Date();
  await decision.save();
  logger.info(`[AIWorker] Decision ${decisionId} REJECTED by user.`);
  return decision;
}

// Read-only — what the single main screen shows as "the one pending decision".
// Kept for per-asset history/back-compat; getPendingProposal() below is what
// the single-screen mobile UI actually polls (decision #14: it needs the
// full multi-option card, not one bare asset/action pair).
async function getPendingDecision() {
  return AIDecision.findOne({ status: 'PENDING_APPROVAL' }).sort({ createdAt: -1 }).lean();
}

// ── Allocation proposal approval (decisions #11 + #14) ──────────────────────────
// The single main screen's actual "yes/no" surface: one card, 2-4 options,
// exactly one flagged as the AI's recommendation, the user picks or declines.

async function getPendingProposal() {
  return AllocationProposal.findOne({ status: 'PENDING_APPROVAL' }).sort({ createdAt: -1 }).lean();
}

// All aiDecisionIds referenced anywhere in a proposal's options, deduped —
// used to close out every candidate this cycle produced, not just the ones
// in the chosen option.
function _allReferencedDecisionIds(proposal) {
  const ids = new Set();
  for (const opt of proposal.options) {
    for (const a of opt.allocations) ids.add(String(a.aiDecisionId));
  }
  return [...ids];
}

async function approveAllocationProposal(proposalId, optionKey) {
  // Bug fix (2026-09-04, overnight continuous-improvement pass): the
  // original version read proposal.status, checked PENDING_APPROVAL, then
  // did a long sequence of real async work (one approveSuggestion() call
  // per allocation, each hitting the DB) before ever writing
  // proposal.status back. Two concurrent approvals for the SAME proposal
  // -- a double-tap, or two different option buttons tapped before the
  // first response lands -- could both pass that check. Each individual
  // allocation is still protected from actually double-opening by
  // approveSuggestion's own per-asset dedup+lock, but the two calls raced
  // on proposal.save() (a lost update -- whichever call's write landed
  // last silently overwrote the other's chosenOptionKey/tradeIds, even
  // though both may have genuinely opened real paper trades) and, worse,
  // on AIDecision.updateOne(): a losing allocation's unconditional
  // `status: 'REJECTED'` write could land AFTER the other concurrent
  // call had already marked that same decision APPROVED with a real
  // tradeId moments earlier -- a self-contradictory record (REJECTED
  // status sitting next to tradeCreated: true and a live tradeId).
  //
  // Fixed with an atomic claim instead of a lock. A lock would deadlock
  // here: approveSuggestion() below already acquires the shared
  // portfolio mutex itself (see virtualTrackingService.js), and that
  // mutex is deliberately not reentrant. findOneAndUpdate's
  // check-and-modify is atomic at the database level with no in-process
  // coordination needed -- only the ONE concurrent call whose update
  // actually flips status away from PENDING_APPROVAL gets a non-null
  // result back and proceeds to run the allocation loop; every other
  // concurrent call for the same proposal gets null immediately and
  // throws before touching a single AIDecision record.
  const proposal = await AllocationProposal.findOneAndUpdate(
    { _id: proposalId, status: 'PENDING_APPROVAL' },
    { status: 'APPROVED', chosenOptionKey: optionKey, decidedAt: new Date() },
    { new: true }
  );
  if (!proposal) {
    const existing = await AllocationProposal.findById(proposalId);
    if (!existing) throw new Error('Proposal not found.');
    throw new Error(`This proposal is already ${existing.status.toLowerCase()} — nothing to approve.`);
  }
  const chosen = proposal.options.find(o => o.key === optionKey);
  if (!chosen) {
    // optionKey was invalid -- roll the atomic claim back so this doesn't
    // leave the proposal stuck "APPROVED" with no chosen option and no
    // trades.
    await AllocationProposal.updateOne(
      { _id: proposalId },
      { status: 'PENDING_APPROVAL', chosenOptionKey: null, decidedAt: null }
    );
    throw new Error(`"${optionKey}" is not one of this proposal's options.`);
  }

  const chosenDecisionIds = new Set(chosen.allocations.map(a => String(a.aiDecisionId)));
  const trades = [];
  const failures = [];

  for (const alloc of chosen.allocations) {
    try {
      const trade = await approveSuggestion({
        asset:        alloc.asset,
        direction:    alloc.direction,
        entryPrice:   alloc.entryPrice,
        stopLoss:     alloc.stopLoss,
        takeProfit:   alloc.takeProfit,
        aiDecisionId: alloc.aiDecisionId,
        origin:       'ai_worker_approved',
      });
      trades.push(trade);
      await AIDecision.updateOne({ _id: alloc.aiDecisionId }, {
        status: 'APPROVED', decidedAt: new Date(), tradeCreated: true, tradeId: trade._id,
      });
    } catch (err) {
      failures.push({ asset: alloc.asset, error: err.message });
      await AIDecision.updateOne({ _id: alloc.aiDecisionId }, {
        status: 'REJECTED', decidedAt: new Date(),
        safetyGateReasons: err.safetyGateReasons || [],
      });
      logger.warn(`[AIWorker] Allocation for ${alloc.asset} in proposal ${proposalId} failed at approval time: ${err.message}`);
    }
  }

  // Every candidate NOT part of the chosen option was implicitly declined by
  // the user's choice — close them out rather than leaving them dangling in
  // PENDING_APPROVAL forever.
  const otherDecisionIds = _allReferencedDecisionIds(proposal).filter(id => !chosenDecisionIds.has(id));
  if (otherDecisionIds.length > 0) {
    await AIDecision.updateMany(
      { _id: { $in: otherDecisionIds }, status: 'PENDING_APPROVAL' },
      { status: 'REJECTED', decidedAt: new Date() }
    );
  }

  if (trades.length === 0 && failures.length > 0) {
    // Nothing at all could be opened — surface this as a real failure rather
    // than a silent "success" with zero trades. Status was already
    // atomically claimed as APPROVED above; flip it to REJECTED now that
    // we know nothing actually opened. decidedAt stays at claim time (when
    // the user actually made the decision), not when this settled.
    await AllocationProposal.updateOne({ _id: proposalId }, { status: 'REJECTED' });
    proposal.status = 'REJECTED';
    const err = new Error(`Could not open any trade in "${optionKey}": ${failures.map(f => `${f.asset} (${f.error})`).join('; ')}`);
    err.failures = failures;
    throw err;
  }

  proposal.tradeIds = trades.map(t => t._id);
  await AllocationProposal.updateOne({ _id: proposalId }, { tradeIds: proposal.tradeIds });

  logger.info(`[AIWorker] Proposal ${proposalId} APPROVED — option "${optionKey}", ${trades.length} trade(s) opened${failures.length ? `, ${failures.length} failed` : ''}.`);
  return { proposal, trades, failures };
}

async function rejectAllocationProposal(proposalId) {
  const proposal = await AllocationProposal.findById(proposalId);
  if (!proposal) throw new Error('Proposal not found.');
  if (proposal.status !== 'PENDING_APPROVAL') {
    throw new Error(`This proposal is already ${proposal.status.toLowerCase()} — nothing to reject.`);
  }

  const decisionIds = _allReferencedDecisionIds(proposal);
  if (decisionIds.length > 0) {
    await AIDecision.updateMany(
      { _id: { $in: decisionIds }, status: 'PENDING_APPROVAL' },
      { status: 'REJECTED', decidedAt: new Date() }
    );
  }

  proposal.status = 'REJECTED';
  proposal.decidedAt = new Date();
  await proposal.save();
  logger.info(`[AIWorker] Proposal ${proposalId} REJECTED by user.`);
  return proposal;
}

async function getStats() {
  const [total, withTrade, buyCount, sellCount, holdCount] = await Promise.all([
    AIDecision.countDocuments(),
    AIDecision.countDocuments({ tradeCreated: true }),
    AIDecision.countDocuments({ action: 'BUY' }),
    AIDecision.countDocuments({ action: 'SELL' }),
    AIDecision.countDocuments({ action: 'HOLD' }),
  ]);

  const latest = await AIDecision.findOne().sort({ createdAt: -1 }).lean();

  return {
    total, withTrade, buyCount, sellCount, holdCount,
    latestAt: latest?.createdAt ?? null,
  };
}

module.exports = {
  runAIWorkerCycle, getLatestDecisions, getStats,
  approveDecision, rejectDecision, getPendingDecision,
  approveAllocationProposal, rejectAllocationProposal, getPendingProposal,
  expireStalePendingProposals,
};
