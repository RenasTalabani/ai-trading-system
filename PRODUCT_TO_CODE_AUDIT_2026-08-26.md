# AI Trading System — Product-to-Code Audit

**Date:** 2026-08-26
**Requested by:** Owner, in response to the "AI Trading Intelligence System" specification, with the explicit instruction: *"Do NOT start changing code immediately. Perform a complete product-to-code audit against this specification. Do not make major changes until this audit is completed and presented."*
**Method:** Fresh snapshot pulled directly from the working tree on the owner's machine (not a stale cached copy), traced by seven independent read-only investigations following actual runtime call chains — imports, call sites, and code paths reachable from real API routes and cron schedules — not inferred from file names, class names, comments, or documentation claims. No code was changed. Zero commits were made during this audit.

This report follows the exact 16-item structure requested.

---

## 1. What the system was intended to be

Per the specification: a 24/7 autonomous AI Trading Advisor — not a signal app — that continuously monitors BTC/ETH/major crypto plus gold/silver/forex/other assets; fuses technical, multi-timeframe, regime, news, social, and macro evidence together with ML predictions into **one** central "AI Brain" decision layer; outputs BUY/SELL/WAIT/AVOID with full explainability (why, evidence, conflicting evidence, confidence, risk, entry/SL/target, risk-reward, invalidation condition, what changed); teaches the user about markets; drives paper trading that strictly follows AI decisions and never invents its own; and notifies the user only on meaningful change, not on every cron tick.

## 2. What it actually is today

A working, tested, partially-deployed monorepo (Node/Express backend + Python/FastAPI ai-service + Flutter mobile) with a genuinely sophisticated ML/fusion pipeline underneath — but **three separate, independently-scheduled decision-generating pipelines** instead of one, each writing to its own or a shared collection on its own schedule, surfaced through two different controllers that both claim to be "the AI Brain." The individual pieces (ML ensemble, news/social/macro fusion, regime detection, risk management, paper-trade execution, per-user notification gating) are each real and mostly well-built. What's missing is a single reconciling layer that makes them behave as *one* brain rather than three concurrent opinions.

## 3. What already works correctly

- A genuine multi-model ML ensemble (RandomForest + Transformer/LSTM fallback + GBM fusion meta-learner + isotonic confidence calibration) that is actually invoked per-request and actually drives the returned direction/confidence in the `/api/predict` path — not decorative.
- News sentiment, social sentiment, and macro data all have **real, non-zero, traceable weight** in the crypto decision-fusion formula (`unified_analyzer.py`'s 40/35/15/10 split and `global_analyzer.py`'s RL-adaptive 45/20/10/25 split), including a hard macro bull/bear contradiction block that actually removes candidate trades, and a social-manipulation/pump gate that neutralizes a compromised signal rather than trusting it.
- The `Signal` model pipeline (`signalJob.js` → `notificationService.js`) has real, working anti-repetition logic: a 4-hour same-asset+direction cooldown before a new `Signal` is even created, plus a separate 2-hour per-user duplicate check and an hourly cap before a notification is sent. A user will not get spammed on that path.
- `globalScanJob.js`'s "Brain Update" push is genuinely change-gated — it only fires when the top-ranked asset or action actually changes from the previous scan.
- The paper-trading ledger (`VirtualTrade`) never invents a trade. Every path that opens one requires a prior AI-sourced `Signal` or `AIDecision` — confirmed across all four trade-creation code paths, with no route reachable by the mobile app that lets a client force an arbitrary trade.
- Balance mutations are protected by an in-process mutex (prior work, T-023), and the test suite (105+ tests, most passing) covers a meaningful slice of the analysis layer.
- The project's own documentation (`CLAUDE.md`, `PROJECT_AUDIT.md`, `PROJECT_STATUS.md`) is unusually honest about its own gaps — it already self-reports the Railway outage and the un-reproducible model-artifact delivery problem, which independently corroborates this audit rather than contradicting it.

## 4. What is genuinely AI-driven

The `/api/predict` pipeline (`signal_engine.py`) is real ML end-to-end: `market_model.py` (RandomForest), `transformer_model.py` with `lstm_model.py` fallback, `fusion_model.py` (GBM meta-learner combining them), and `confidence_calibrator.py` (isotonic calibration of the final confidence) are all imported, instantiated once, and actually called on every request, with their outputs actually flowing into the returned decision — confirmed by tracing every call site, not by trusting the file names. `news_sentiment.py` and `social_sentiment.py` are likewise live, feeding both `signal_engine.py` and the `unified_analyzer.py`/`global_analyzer.py` fusion chain. `online_learner.py` runs as a real background loop (started at FastAPI startup) that fine-tunes the live transformer and calibrator from realized outcomes every 30 minutes — a genuine (if slow) feedback loop, not a stub.

Notably: none of these eight ML files have any dedicated unit test coverage, and cross-checking that gap confirmed it is a real coverage hole in decision-critical code, not evidence they're unused — they are wired in and live.

## 5. What is rule-based

`strategy_engine.py` is pure hand-rolled EMA/RSI technical analysis with **no ML model import at all** — it powers the `/strategy/*` endpoints and feeds a 35% weight into `unified_analyzer.py`'s fusion, but on its own produces a rule-based BUY/SELL/HOLD. `ai-service/app/services/smart_simulator.py` and `strategy_simulator.py` are both hardcoded EMA-crossover/RSI rule engines with zero AI involvement. `hourlyReportJob.js`, `dailyReportJob.js`, and `weeklyReportJob.js` are unconditional digest sends — "did anything happen in this window" rather than "did the AI's actual recommendation change," which is a rule-based notification policy, not an AI-driven one.

## 6. What is simulated

The live paper-trading ledger (`VirtualTrade`/`VirtualPortfolio` in the Node backend) is the real, AI-gated simulation the product is meant to run on. Separately, `ai-service`'s `smart_simulator.py`, `strategy_simulator.py`, and `backtester.py` are what-if/backtest engines that compute a hypothetical result and return it as JSON for display — they write nothing to any database and have zero code linkage to `VirtualTrade` (confirmed by a codebase-wide grep for `VirtualTrade` inside `ai-service`, which returned no matches). These are legitimate backtesting tools, but they are a completely separate system from live paper trading, and it would be easy for a future feature to be built assuming they're the same thing when they aren't.

## 7. What is disconnected/unused

- `ai-service/app/services/intel/` (the `classifier.py`/`cross_reference.py`/`reliability.py`/`pipeline.py`/`store.py` insight subsystem) is a fully self-contained side pipeline exposed only through its own `/intel/*` read endpoints. Nothing in the decision-fusion chain (`strategy_engine`, `global_analyzer`, `unified_analyzer`, `signal_engine`) imports anything from it. It collects and stores cross-referenced market insights that never reach a trading decision.
- `model_registry.py` and `trainer.py` are legitimately admin/training-only (registry bookkeeping and `/train` endpoint), not wired into the live decision path — this is by design and not a bug, but worth naming so nobody mistakes registry state for decision-influencing state.
- For non-crypto assets (forex/commodities/metals), the "social" weight in `global_analyzer._score_multi_asset` is silently repurposed onto the technical score, because no social data is collected for those asset classes at all — a real signal the spec calls for (social intelligence across "major crypto plus gold/silver/forex/other assets") that doesn't actually exist outside crypto.

## 8. Why repetitive BUY/SELL/WAIT behavior occurs

Two separate root causes, confirmed in code:

1. **The `AIDecision`/"AI Brain" path's dedup window is too short relative to its own run cadence.** `decisionTrackingJob.storeGlobalDecision()` only skips writing a new `AIDecision` if the *exact same* asset+action pair was already written within the last 15 minutes. Because `globalScanJob` (every 30 min) and `aiDecisionJob` (which just re-triggers the same scan, offset at :15/:45) together cause an effective scan roughly every 15 minutes, the window barely outlasts the cadence — so a fresh `AIDecision` row gets written on almost every cycle even when nothing about the market actually changed. There is no confidence-delta, price-delta, or content-hash comparison anywhere in this path — only "was it the identical asset+action label in the last quarter hour."
2. **`hourlyReportJob.js` has no change-gate at all.** It sends a push to every eligible user every hour whenever any signal existed in the trailing hour, with no comparison to what was reported the previous hour. This is a second, independent source of what feels like "the AI keeps repeating itself," on top of #1.

The underlying analysis code itself (`strategy_engine.py`, `signal_engine.py`) is fully stateless by design — it recomputes a fresh answer from current inputs on every call with no memory of what it said last time. That's not a bug in itself (a genuinely new market read every 15-30 minutes is reasonable), but it means the *only* thing standing between "genuinely new information" and "repetitive noise" is the persistence-layer dedup described above — and that layer is currently too thin to do the job the spec expects ("Do not repeat the same decision every cycle without new data").

## 9. Whether multiple jobs are making duplicate decisions

**Yes — confirmed, not suspected.** There are three independently-scheduled, independently-persisting decision pipelines that can each produce a different answer for the same asset at the same moment, because none of them share a decision object, a cache, or a lock:

1. **Global-scan path**: `globalScanJob.js` (every 30 min) + `aiDecisionJob.js` (offset re-trigger, :15/:45) → ai-service `GlobalAnalyzer.scan_all()` → writes one `AIDecision` for the single best-ranked asset via `decisionTrackingJob.storeGlobalDecision()`. Surfaced to clients via `brainController.js`.
2. **AI-worker path**: `aiWorkerJob.js` (every 5 min) → `aiWorkerService.runAIWorkerCycle()` → makes its **own independent** HTTP call to the same `/api/global/scan` endpoint (not reusing pipeline #1's cache) → writes its own `AIDecision` rows for *every* qualifying opportunity above threshold, and opens `VirtualTrade`s directly. Surfaced to clients via `aiBrainController.js`.
3. **Signal-engine path**: `signalJob.js` (every 15 min) → `/api/predict` (`SignalEngine`, a disjoint model stack that never calls or is called by pipeline #1/#2's analyzers) → writes to the separate `Signal` collection. Surfaced via `signalController.js`.

Because `/api/global/scan` is not deterministic/cached server-side (live prices, live RL weights, live macro all vary call to call), pipelines #1 and #2 can legitimately return different results for the same asset within the same few minutes, and both get persisted as an `AIDecision`. This is the direct, code-level explanation for what the spec's audit request suspected.

## 10. Whether the AI Brain actually controls the final decision

**No — there is no single reconciled source of truth.** `aiBrainController.js` (the AI-worker path's data) and `brainController.js` (the global-scan cache's data) both present themselves as "the AI Brain" API, but they read from two different underlying computations that can disagree. Which one a given screen/notification treats as authoritative depends entirely on which route happened to be wired to it — there is no code anywhere that reconciles pipeline #1 and pipeline #2 into one answer, or that treats pipeline #3 (`Signal`) as subordinate to or consistent with either of them.

## 11. Whether the simulator independently creates trades

**No, for the live paper-trading ledger** — every one of the four `VirtualTrade`-creation code paths (`pickupNewSignals`, `approveSuggestion`, `openFuturesTrade`, and the AI-worker's direct write) requires a pre-existing AI-sourced `Signal` or `AIDecision`; none can be triggered by price alone, a bare cron tick, or a client-supplied arbitrary trade. **Yes, for a separate subsystem that is not live** — `smart_simulator.py` and `strategy_simulator.py` do independently invent BUY/SELL entries from a hardcoded EMA-crossover rule with no AI involvement at all, but they are confirmed dead-ended with respect to the real ledger: no `VirtualTrade` write, no database persistence, reachable only via distinct "what-if" endpoints. One traceability gap worth noting: trades opened via the Guide-approval flow (`approveSuggestion`) are correctly AI-sourced at approval time (server-side, not client-controlled) but the resulting `VirtualTrade` doesn't persist a back-reference to the `Signal`/scan pick that justified it — a schema/audit-trail gap, not an independence violation.

## 12. Whether the system can realistically operate 24/7

**Not currently, and not purely for code reasons.** The project's own documentation (`CLAUDE.md`, `PROJECT_AUDIT.md`, `PROJECT_STATUS.md`) confirms, with direct Railway CLI evidence dated 2026-08-18, that both Railway deployments are `FAILED` — zero active instances, 404 at the edge, the backend's last successful deploy 48 commits behind current `master`. As of today's code, this system is **not running anywhere continuously**; it is only capable of running locally/on-demand. Independent of the outage, the architecture has real gaps that would need closing before genuine unattended 24/7 operation: trained model artifacts (`saved_models/`) are gitignored with no reproducible delivery path into a fresh deploy; there is no external monitoring/alerting (self-documented gap); balance-mutation locking and job scheduling both assume exactly one long-lived process with no distributed-lock story if ever scaled; and `keepAliveJob.js`'s self-ping only prevents an *already-running* service from idling to sleep — it cannot revive a currently-`FAILED` deployment. `keepAliveJob.js`'s own existence is itself evidence the target hosting tier sleeps idle services, which is a hosting-tier/funding question, not a code defect.

## 13. What needs to change

- Collapse the three independent decision-generating pipelines (global-scan/`AIDecision`, AI-worker/`AIDecision`, signal-engine/`Signal`) into one reconciled decision authority, or explicitly redefine their roles (e.g., one produces the "current recommendation," the others become inputs to it or are retired) so `aiBrainController.js` and `brainController.js` stop being able to disagree.
- Replace the 15-minute same-label dedup window in `decisionTrackingJob.storeGlobalDecision()` with real state-change detection: a confidence-delta threshold, a price-move threshold, and/or a content hash of the decision's actual reasoning/evidence — not just "was the label identical in the last quarter hour."
- Add a change-gate to `hourlyReportJob.js` (and consider the same for `dailyReportJob.js`/`weeklyReportJob.js`) so a digest only pushes when something in it is actually new versus the prior report.
- Resolve the model-artifact delivery problem for `saved_models/` (already flagged as the standing "requires a report to the owner before any unilateral choice" item from prior sessions — still applies, not yet actioned).
- Decide, explicitly with the owner, what to do about Railway: it is currently down and the standing instruction has been "postponed/unfunded, do not repeatedly attempt deployment" — see the funding question raised in §16 below.
- Persist a back-reference from Guide-approved `VirtualTrade`s to the `Signal`/scan pick that justified them, closing the one traceability gap found in the simulator audit.
- Either wire real social-intelligence collection for forex/commodities/metals, or stop silently repurposing the "social" weight onto the technical score for those assets in `global_analyzer._score_multi_asset` — as written it's a misleading weight label, not a missing feature per se.
- Add external monitoring/alerting for the 16 cron jobs, so a silently-stopped job is noticed rather than discovered by its absence.

## 14. What should NOT be changed

- The `Signal`-path anti-repetition logic (`isDuplicateSignal`'s 4h cooldown, `shouldNotifyUser`'s 2h per-user dedup + hourly cap) — this already works and matches the spec's intent; it should be the model other paths get pulled toward, not replaced.
- The live ML ensemble in `signal_engine.py` (RandomForest + Transformer/LSTM + GBM fusion + calibration) and the news/social/macro fusion weights in `unified_analyzer.py`/`global_analyzer.py` — these are genuinely working AI, not "fake AI dressed up," and rebuilding them from scratch would throw away real, functioning work for no reason.
- The requirement that every `VirtualTrade` trace back to an AI-sourced `Signal`/`AIDecision` — this already holds; changes here should only *add* traceability (the Guide-approval gap in §13), never loosen the gate.
- The in-process balance mutex and the existing test suite (105+ tests) — both represent real prior correctness work (T-023 and this session's T-055/T-056/T-057, among others) that should be preserved, not rewritten, per the owner's standing instruction.
- `smart_simulator.py`/`strategy_simulator.py`/`backtester.py` as backtesting tools in their own right — they are fine and useful *as backtest/what-if engines*; the fix needed is documentation/naming clarity that they are not the live paper-trading system, not a rewrite of their logic.

## 15. Recommended final architecture

Consolidate around the existing global-scan fusion chain (`GlobalAnalyzer` ⊃ `UnifiedAnalyzer` ⊃ `StrategyEngine` + `OrderBlockEngine` + news + social, further adjusted by `RegimeDetector`/`RiskManager`/`RLWeightEngine`/`TradeQualityScorer`) as the single canonical "AI Brain," since it already does the most complete fusion of the three paths (technical + order-block + news + social + macro + regime + risk + quality). Concretely:

- Make `aiWorkerService.runAIWorkerCycle()` consume the *same* cached scan result `globalScanJob.js` already produces instead of independently re-calling `/api/global/scan` — this alone eliminates the two-different-answers-for-the-same-asset problem in §9 without touching the ML/fusion internals at all.
- Decide the relationship between the `/api/predict` (`SignalEngine`) path and the global-scan path deliberately: either fold `SignalEngine`'s ensemble output in as an additional weighted input to `UnifiedAnalyzer`'s fusion (making it genuinely "one brain"), or keep it as a clearly-labeled secondary/experimental signal source that explicitly does not claim to be "the AI Brain" in any UI/notification copy. Either is defensible; leaving it ambiguous (today's state) is not.
- Pick one controller (`brainController.js` or `aiBrainController.js`) as the sole authoritative read surface for "the current AI decision," and have the other either proxy to it or be retired/renamed to something that doesn't claim brain-ownership.
- Add a lightweight decision-state table (or fields on `AIDecision`) recording a content hash / confidence-and-price snapshot of the last emitted decision per asset, and gate both new-decision creation and notification sends on a real delta against that snapshot rather than a bare time window — this directly satisfies the spec's "anti-repetition" and "state awareness" requirements.
- Keep `Signal`'s existing cooldown/dedup design as the template for this — it already does the right thing, it just needs to be applied to the `AIDecision`/global-scan path too.

## 16. Prioritized implementation roadmap

Following the standing priority order (security > critical bugs > data integrity > core trading/paper-trading correctness > AI reliability > market-data reliability > backend reliability > mobile > Telegram > external integrations > monitoring > performance > UX > documentation > nice-to-have):

1. **Correctness/reliability (do first):** Fix `decisionTrackingJob`'s dedup window to be a real change-detector, not a time window; fix `hourlyReportJob.js`'s missing change-gate. These directly cause the "repetitive decisions/notifications" problem the spec flagged as its top concern.
2. **AI reliability:** Make `aiWorkerService` reuse `globalScanJob`'s cached scan instead of independently re-querying; pick and document the single authoritative "AI Brain" controller. This removes the duplicate-decision-generation root cause at its source.
3. **Data integrity/traceability:** Add the missing `Signal`/`AIDecision` back-reference on Guide-approved `VirtualTrade`s.
4. **Owner-decision item, unresolved from prior sessions, now more urgent given the new spec:** the ML model artifact (`saved_models/`) delivery problem — still requires the report-first process already agreed with the owner, not a unilateral fix.
5. **Infrastructure, pending an explicit owner decision (see below):** resolving the Railway outage, or choosing an alternative always-on host, is a prerequisite for *any* of this being genuinely 24/7 rather than local/on-demand.
6. **Monitoring:** add external alerting for the 16 cron jobs once the hosting question above is settled — monitoring a system that isn't reliably deployed yet is lower value than fixing the deployment itself.
7. **Documentation/UX:** update `PROJECT_AUDIT.md`/`MASTER_ROADMAP.md` to reflect this audit's findings once acted on; clarify in-app/docs that `smart_simulator`/`strategy_simulator`/`backtester` are backtest tools, not the live paper-trading engine.

**One thing this audit needs to surface explicitly rather than assume:** the new specification states the owner has "already accepted that reliable infrastructure may require payment." The long-standing instruction across this entire engagement has been that Railway is postponed/unfunded and not to repeatedly attempt deployment. Those two things are in real tension, and this audit is not treating the spec's framing as authorization to spend money or redeploy — that's flagged here as a question for the owner to answer explicitly (yes, fund and redeploy now / not yet, keep auditing and fixing code first / something in between), not a decision made on the owner's behalf.

---

*No code was changed, no commits were made, and the outstanding T-057 fix (uncommitted, on-disk, tests passing) was deliberately left as-is pending this audit's delivery, per the owner's explicit instruction not to make changes until the audit was presented.*
