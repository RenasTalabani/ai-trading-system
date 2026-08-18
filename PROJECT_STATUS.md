# PROJECT_STATUS.md

Last updated: 2026-08-18, by Claude (technical lead session — Priority 2 complete, incl. CORS allowlist + Telegram webhook follow-up)

## CHECKLIST DISCIPLINE (per owner instruction)
Every item below carries STATUS / EVIDENCE / DATE — nothing is marked PASS without evidence.

---

### PRIORITY 1 — GitHub / CI

**Local commits (audited, tested, correctly authored)**
STATUS: PASS
EVIDENCE: 6 commits on local `master`, all authored `Claude <noreply@anthropic.com>` (re-authored after a repo hook flagged the first 3 as carrying the owner's identity): `97a7a5e` (audit docs), `f53d967` (CI workflow), `f42178a` (status update), `e95bec9` (tracks previously-uncommitted tests/intel/guide/mobile-web — see finding below), `a1864b5` (companion implementation for those tests — also previously uncommitted), `67d9018` (dependency security patch).
DEPLOYMENT: not deployed — local commits only.
DATE: 2026-08-18

**Push to GitHub**
STATUS: RESOLVED — pushed successfully
EVIDENCE: This session's own sandbox still cannot push (no network / repo not authorized for this session's git proxy — confirmed, unchanged, not fixable from here). The owner pushed from their own machine as planned. `origin/master` (last confirmed via this session's local git remote-tracking ref, this session still cannot `git fetch`) is at `b201322`, matching the local repo's history exactly through that point.
RESOLUTION: no longer blocking. Future pushes still require the owner's machine or the terminal ("Claude Code") session — this session remains push-incapable by design, not by bug.
DATE: 2026-08-18

**IMPORTANT FINDING — uncommitted work discovered during CI setup**
STATUS: FIXED and pushed
EVIDENCE: When first wiring the CI workflow, `backend/__tests__/` and `ai-service/tests/` — the very test suites this audit verified as 63/63 and 105/105 passing — turned out to have **never been committed to git**. Neither had the `ai-service/app/services/intel/` subsystem, `translation_service.py`, the `guide` feature (backend controller/route + mobile screen/providers), or `mobile/web/`. Additionally, ~20 tracked files (job schedulers, `virtualTrackingService.js`, `aiWorkerService.js`, ai-service routes/config, mobile screens) had local uncommitted edits that the new tests depend on (`capToMaxRisk`, `getEdgeMultiplier`, `approveSuggestion` didn't exist in the last real commit — confirmed by first committing tests alone and watching 27 of them fail, then finding and committing the paired implementation, then re-verifying 63/63 green). All of this is now committed and pushed — no longer machine-local-only.
DATE: 2026-08-18

**GitHub Actions actually running / green**
STATUS: CONFIRMED LIVE AND GREEN (verified via GitHub's own Actions page, not assumed from local test runs)
EVIDENCE: Checked GitHub Actions directly (`github.com/RenasTalabani/ai-trading-system/actions`). The CI workflow (`ci.yml`) has run automatically on every push to `master` and passed every time, including the 3 most recent runs as of this check — commits `edc6412`, `a41d3fc`, `b201322`, each conclusion "Success". Drilled into `b201322` specifically: its Backend/Jest check individually shows passed, completed in 17s. This closes T-002 (was REVIEW pending exactly this confirmation, now DONE).
DATE: 2026-08-18

**Dependency audits**
STATUS: PASS (backend + ai-service both improved and verified)
EVIDENCE:
- Backend `npm audit`: 26 vulnerabilities (1 critical, 8 high, 14 moderate, 3 low) → 9 (all moderate) after `npm audit fix`. Critical (`websocket-driver`) and all high (`ws`, the library backing this app's own WebSocket server) are resolved. Remaining 9 moderate are all transitively behind `firebase-admin`'s pinned `uuid` version — fixing requires a breaking `firebase-admin` major bump, deferred since there's no test coverage for push notifications in this repo to safely verify against. Verified: 63/63 backend tests pass after the fix.
- ai-service `pip-audit`: 16 known vulnerabilities in 3 packages → 0 in app dependencies. `torch` was pinned `<2.9.0` (8 CVEs, several deserialization/RCE-class); bumped to `>=2.9.1,<2.14.0` (installs 2.13.0, 0 known vulnerabilities). Dockerfile now also upgrades `pip`/`setuptools` at build time to clear their advisories. Verified: 105/105 ai-service tests pass on the new torch version.
DATE: 2026-08-18

---

### PRIORITY 2 — Security — COMPLETE (2026-08-18)

**bcrypt password hashing**
STATUS: PASS
EVIDENCE: `backend/src/models/User.js` — `bcrypt.hash(this.password, 12)`. 12 salt rounds is solid (industry-typical range is 10–12).
DATE: 2026-08-18
COMMIT: — (no change needed)
REMAINING RISK: none.

**Refresh-token flow**
STATUS: FIXED (removed dead config, decision documented)
EVIDENCE: Investigated the full auth flow end to end: `User.js`/`authController.js` (single JWT, no refresh logic anywhere), mobile `auth_provider.dart` (auto-creates a local guest account on first launch; real login only reached if a session is explicitly cleared), `api_service.dart` (401 → immediate logout, no refresh attempt), `router.dart`. Conclusion: refresh-token rotation would add real complexity (secure storage, a revocation store, new endpoints) with no corresponding security need — no real-money/exchange-custody data sits behind the token, and expiry is already handled gracefully. Removed the dead `JWT_REFRESH_EXPIRES_IN` from `backend/.env.example` and documented the reasoning in a comment above `generateAuthToken()` in `User.js`, so this isn't mistaken for an oversight later.
DATE: 2026-08-18
COMMIT: `dbb81c3`
REMAINING RISK: low. Revisit only if the product ever adds real user accounts holding real financial data (noted in the code comment).

**CORS — explicit production allowlist (owner decision: no wildcard)**
STATUS: DONE
EVIDENCE: Owner reviewed the mechanism-verification pass and decided against `*` in production even given the lower risk (Bearer-token auth, no cookies). `buildCorsOptions()` (`backend/src/config/corsConfig.js`) no longer defaults unset/empty `ALLOWED_ORIGINS` to `*` — it now defaults to an empty allowlist, which denies all browser-based cross-origin requests. `*` is still supported but must be explicitly set (kept only for local dev flexibility). Investigated the actual project for real web origins before writing the production config, per owner instruction not to invent domains: confirmed there is no deployed web frontend today — `mobile/web/` is unused, never-customized `flutter create` scaffolding (generic "A new Flutter project" title, default icons, no hosting config anywhere: no `firebase.json`/`vercel.json`/`netlify.toml`, no custom domain referenced in `DEPLOYMENT.md`). `backend/.env.railway`'s `ALLOWED_ORIGINS` is therefore a documented empty placeholder with an inline example of the expected format, ready to fill in once a real origin exists. `backend/.env.example` (local dev) keeps its existing `http://localhost:3000,http://localhost:8080`. Flutter mobile is unaffected either way — it sends no `Origin` header. `cors.test.js` expanded from 8 to 14 tests, covering all four owner-required cases: allowed origin, disallowed origin, no-Origin-header, and authenticated (Bearer token) request behavior from both an allowed and a disallowed origin — plus the new empty-default-denies case and wildcard now exercised as an explicit opt-in.
DATE: 2026-08-18
COMMIT: `a164aa4`
REMAINING RISK: none for the code path (verified, fails closed by default). Operationally: if a real web frontend is ever deployed, its origin must be added to `ALLOWED_ORIGINS` in the Railway dashboard or it will be silently blocked by CORS — noted here so that's not a surprise later.

**Input validation coverage**
STATUS: RISK-BASED FIXES APPLIED (not all 24 files — by design, see rationale)
EVIDENCE: Audited all 24 previously-unvalidated route files (of 27 total; `auth.js`/`notifications.js`/`virtual.js` already had `express-validator`) against the owner's explicit risk criteria: DB writes, account/permission changes, trading/portfolio data, financial parameters, user-controlled identifiers, external API interaction. Findings:
  - **Fixed** — `priceAlerts.js` (create/delete/toggle): old handler did `parseFloat(targetPrice)` with no bound, so non-numeric/negative/zero values could be silently stored and would then never (or incorrectly) fire in the alert-checking job. Now validates `targetPrice` as a positive float, `direction` as an enum, string field lengths, and `:id` as a Mongo ObjectId.
  - **Fixed** — `brain.js` (`POST /follows`, `PATCH /follows/:id/close`, `DELETE /follows/:id`): validates `action`/`outcome` enums, `confidence` range (0–100), price fields as positive numbers, `:id` as a Mongo ObjectId.
  - **Fixed** — `guide.js` (`POST /positions/:tradeId/sell`): validates `:tradeId` as a Mongo ObjectId (previously relied entirely on Mongoose's `CastError` bubbling to the global error handler — functionally correct, since `errorHandler.js` does translate `CastError`/`ValidationError` to 400, but with no route-level guard). Also checked `VirtualTrade` for a missing per-user ownership filter (a real IDOR pattern in other apps) — confirmed the model has no `userId` field anywhere; this is a single shared paper portfolio by design, not a multi-tenant resource, consistent with `CLAUDE.md`'s "single-user personal app" framing. Not a bug, no fix needed.
  - **Reviewed, no fix needed** — `users.js` preferences: already schema-backstopped with explicit `min`/`max`/enum on every field (`User.js` preferences sub-schema), plus `runValidators: true` on the update call. `market.js` batch tickers: already whitelist-filters against `TRACKED_ASSETS` before forwarding to Binance, so unvalidated input can't reach the external call. `ai.js`/`signals.js`/`news.js` trigger endpoints: admin/premium-role-gated already, lower exposure. The ~9 remaining files (`budget`, `global`, `reports`, `simulator`, `strategy`, `tracker`, `unified`, `advisor`, `orderBlocks`) already validate in their controllers (confirmed via `grep -l express-validator` on the controllers directory), even though the route files themselves don't import it directly.
  - **Fixed in a follow-up pass (owner approved)** — `telegram.js` `POST /webhook`'s missing authenticity check is now closed; see the dedicated Telegram webhook entry below. Originally documented here as T-020 for owner decision; owner approved implementing it on 2026-08-18.
DATE: 2026-08-18
COMMIT: `1cf84e9`
REMAINING RISK: low for the fixed routes (verified by 13 new tests). Low-medium for the telegram webhook until T-020 is actioned — realistic impact is bot-abuse-as-spam-relay, not account takeover (linking a Telegram account still requires a correct, short-lived, random UUID token).

**Rate limiting / security headers / error exposure**
STATUS: PASS
EVIDENCE: `helmet()`, global `express-rate-limit` (100 req/15min default), and `errorHandler.js` only includes stack traces when `NODE_ENV=development` — confirmed by reading the actual code, not assumed. `errorHandler.js` also correctly translates Mongoose `ValidationError` → 400 (per-field messages) and `CastError` → 400, which several of the routes above rely on as a backstop.
DATE: 2026-08-18
COMMIT: — (no change needed)
REMAINING RISK: none identified.

**Telegram webhook authenticity (T-020)**
STATUS: CODE DONE — NOT YET LIVE (needs 2 manual owner steps outside this session's reach)
EVIDENCE: Implemented `X-Telegram-Bot-Api-Secret-Token` verification per Telegram's documented `setWebhook` `secret_token` mechanism. New middleware `backend/src/middleware/telegramWebhookAuth.js` compares the incoming header against `TELEGRAM_WEBHOOK_SECRET` using `crypto.timingSafeEqual` (constant-time, avoids leaking the secret via response-timing), and **fails closed**: if the server has no secret configured, every webhook call is rejected (403) rather than silently accepted, because there's nothing safe to verify against. Wired ahead of the existing `handleWebhook` controller in `routes/telegram.js`, which is otherwise unchanged. Added `TELEGRAM_WEBHOOK_SECRET` to both `.env.railway` and `.env.example` as a placeholder with generation guidance (`openssl rand -hex 32`) — no real value written, committed, or logged anywhere. 11 new tests cover all four owner-specified cases (correct secret → accepted; missing secret → rejected; incorrect secret → rejected; a well-formed Telegram-shaped payload sent without the secret → rejected) plus the fail-closed unconfigured-server case and a check that the configured secret never appears in a rejection response body.
DATE: 2026-08-18
COMMIT: `a164aa4`
REMAINING RISK: **the fix is not active in production until the owner does two things I cannot do from here** (no bot token available in this session, and I was instructed not to touch Telegram's live webhook config without it): (1) set `TELEGRAM_WEBHOOK_SECRET` to a strong random value in Railway's dashboard for the backend service — e.g. generate with `openssl rand -hex 32`; (2) call Telegram's `setWebhook` API with a matching `secret_token` param, e.g. `curl "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook?url=<your-backend-url>/api/v1/telegram/webhook&secret_token=<same-value-as-step-1>"`. Until both are done, real Telegram messages will stop reaching the bot the moment this code deploys — that's the fail-closed design working as intended, not a bug, but it will look like "Telegram broke" if the two steps above aren't done in the same deploy window.

**Security testing**
STATUS: PASS
EVIDENCE: No lint/type-check/build script exists for the backend (`package.json` scripts are `start`/`dev`/`test` only) — it's plain CommonJS Node with no TypeScript or ESLint configured, so there's nothing applicable to run beyond the test suite; noting this so it doesn't read as a skipped step. Full backend test suite run after all Priority 2 changes (including this follow-up pass): **101/101 passing** (84 prior + 6 new CORS tests + 11 new Telegram webhook tests). ai-service was not touched this pass (all changes are backend-only), so its 105/105 baseline stands unchanged from Priority 1.
DATE: 2026-08-18
COMMIT: `dbb81c3`, `1cf84e9`, `bac9af8`, `a164aa4`
REMAINING RISK: none — all four commits are covered by passing tests, not just written.

---

### PRIORITY 3 — Railway infrastructure audit
STATUS: AUDITED, READ-ONLY — production found DOWN on both target services, not merely unverified
EVIDENCE: Logged into Railway CLI as `renastalabani@gmail.com`. Project `distinguished-empathy` (id `bdaec7e5-29ad-4504-91aa-d58fe103c73f`) hosts this app's two services alongside two unrelated ones (`smt-catalog-api`, `distinguished-empathy` itself) and a `Postgres` service that belongs to `smt-catalog-api` (Prisma-based, not this app — this app uses MongoDB Atlas per `MONGODB_URI`). None of the unrelated services were modified.
- **Backend (`ai-trading-system` service)**: latest deployment `33bbbbef` created 2026-05-04, `status: FAILED`, `deploymentStopped: true`, 0 active instances. Deployed commit was `fa202b5` ("notification tap nav, brain countdown, exit price dialog") — **48 commits behind current HEAD** (`d12679e`), i.e. none of Priority 1 or Priority 2's work has ever reached production. `GET https://ai-trading-system-production-24d7.up.railway.app/api/v1/health` → `HTTP 404 {"message":"Application not found"}` (Railway's edge, confirming no live app behind the domain — verified directly with curl, not inferred from dashboard state).
- **AI service**: latest deployment `fcc98d20` created 2026-04-26, `status: FAILED`, reason `"Waiting for build slot"` — it appears to have never successfully built at all. `GET https://ai-service-production-0626.up.railway.app/health` → same `404 Application not found`.
- **Build/deploy logs**: unavailable for both (`railway logs --build`/`--deployment` returned empty) — deployments are 3+ months old and past Railway's log retention window. No production evidence of cron execution, DB connectivity, or model loading exists or can exist until a fresh deploy runs.
- **Environment variables** (names only, no values read into this session beyond confirming presence): backend has `MONGODB_URI`, `JWT_SECRET`, `AI_SERVICE_URL`, `ALLOWED_ORIGINS` configured — but **no `TELEGRAM_WEBHOOK_SECRET`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHANNEL_ID`, `TELEGRAM_BOT_USERNAME`, Firebase, Twitter, or Reddit vars exist at all**. ai-service has `MONGODB_URI`, `MODEL_PATH`, `BINANCE_BASE_URL`, `CONFIDENCE_THRESHOLD` etc. configured, same absence of collector/notification keys. This matches "degrades gracefully" for optional features but confirms Telegram is not just "not activated," it's not configured at all yet.
- **Model artifacts**: `ai-service/saved_models/` exists locally (gitignored, ~13MB of `.joblib`/`.pt` files, newest dated 2026-08-15) but is **not in git and not copied by the Dockerfile** (`Dockerfile` only does `mkdir -p saved_models` — an empty directory). No Railway volume is attached to the ai-service service (only `Postgres`, for the unrelated `smt-catalog-api`, has one). Conclusion: **if ai-service were redeployed as-is today, it would boot with zero trained models** — `trainer.py`'s output has no path from this laptop into production. This needs a decision (bake models into the image, attach a volume and upload them, or add a fetch-on-boot step) before Priority 3 can call AI predictions "verified," not just "code deployed."
- **Cron jobs**: 17 jobs registered in `backend/server.js` (`marketDataJob`, `signalJob`, `newsJob`, `socialJob`, `notificationRetryJob`, `virtualTrackingJob`, `dailyReportJob`, `weeklyReportJob`, `globalScanJob`, `aiWorkerJob`, `hourlyReportJob`, `trackerEvalJob`, `keepAliveJob`, `priceAlertJob`, `decisionTrackingJob`, `aiDecisionJob`, `performanceAnalysisJob`, `dcaJob` — confirmed from source, matches the owner's "~16"). **Zero production evidence possible** for any of them — nothing has run since May.
DATE: 2026-08-18
COMMIT: n/a (read-only infrastructure audit, no code changed)
REMAINING RISK: Production is fully down, not degraded — this is a bigger gap than "unverified," and redeploying is a production-infrastructure action requiring explicit owner sign-off per this file's own Deployment Rules (not taken in this pass). The model-artifact delivery path is undefined and must be decided before a redeploy is assumed to make AI predictions actually work. Do not deploy, and do not treat CI green as production-ready — they are unrelated facts right now.

### PRIORITY 6 (partial) — `ai-service-err.log` triage (T-006)
STATUS: DONE
EVIDENCE: Read the full 4828-line log. It's a single local dev session (`uvicorn --reload`, machine path `C:\Users\Karwan Store\...` — a different machine/user than this one, not a Railway log), spanning 2026-04-27 21:07 to 2026-04-28 23:45 (~26h). Breakdown: 2 `[WARNING]` lines (both transient Reddit subreddit timeouts — normal network blips, not a code issue), and every error-level line reduces to **one single recurring bug**, repeated 70 times with an identical signature: FastAPI's `jsonable_encoder` fails while serializing an endpoint's response — `dict(obj)` raises `ValueError: dictionary update sequence element #0 has length 13; 2 is required`, its fallback `vars(obj)` then raises `TypeError: vars() argument must have __dict__ attribute`, and FastAPI surfaces both as a combined `ValueError`. This pattern (`dict()` on an iterable of length-13 items) is the classic signature of a pandas `Series`/row or similar tabular object being nested in a response instead of converted to a plain dict — but the traceback frames available stop at Starlette/FastAPI internals and don't show which endpoint's handler produced the object, and the log predates 48 commits of substantial AI/ML rework (multi-timeframe gating, per-asset Transformers, regime wiring) that plausibly already touched the responsible code path. Checked current `app/api/routes.py`: every route handler I found builds an explicit plain `dict` for its response (including the two `candles.iloc[-1]` usages in `/indicators/{asset}` and `/regime/{asset}`, which already convert each field via `round(float(...))` before returning — not the cause). No route currently returns a raw DataFrame/Series. Filed as **T-021** (Low priority) rather than guessing at a fix — needs live reproduction first.
DATE: 2026-08-18
COMMIT: `[pending]` (docs only)
REMAINING RISK: low — this is a 3.5-month-old single-session dev log, not a current production signal (production has no logs at all right now — see Priority 3). If it recurs during local dev or after a future Railway redeploy, T-021 has enough evidence to start from immediately (exact error signature, both suspect-but-cleared endpoints, dict/vars() fallback mechanism explained).

### PRIORITY 6 (partial 2) — API documentation (T-007)
STATUS: DONE
EVIDENCE: Read all 27 `backend/src/routes/*.js` files in full (not skimmed), plus `middleware/auth.js`, `middleware/validate.js`, `middleware/errorHandler.js` to document the auth/validation/error conventions precisely rather than guessing. Wrote `backend/API.md` — every one of the ~110 endpoints across the 27 route groups has method, full path, auth requirement (🔒 JWT / 🔐 role-gate / webhook-secret / public), and request validation rules where they exist (many routes, especially `virtual.js` and `brain.js`, have explicit inline `express-validator` chains that give exact field constraints). Response body schemas are intentionally *not* fully enumerated field-by-field for every route (would require reading every controller + Mongoose model to matching depth) — documented as a known scope limit with a path to close it incrementally. Three pre-existing design overlaps surfaced during the read-through and documented rather than silently changed: (1) three separate simulation endpoints (`/virtual/*`, `/strategy/simulate`, `/simulator/run` + `/core/simulator`) that could be consolidated later; (2) `VirtualTrade` has no per-user ownership filter — confirmed intentional (single shared paper portfolio, not multi-tenant) via the model, not assumed.
DATE: 2026-08-18
COMMIT: `[pending]`
REMAINING RISK: low. This is now a maintained reference, not a generated spec — the biggest risk is docs drifting from code on future route changes; `API.md`'s own header says to update it in the same commit as any route change. Full response-schema coverage remains a nice-to-have follow-up, not filed as a separate ticket since it's low-value without a concrete consumer (no public API clients besides the first-party Flutter app) — revisit if that changes.

### PRIORITY 5 (started) — Flutter test coverage (T-012)
STATUS: IN_PROGRESS — first real model-layer coverage added, 0% → meaningful, not yet comprehensive
EVIDENCE: `mobile/test/` previously had exactly one test: a literal `expect(true, isTrue)` placeholder. Added 46 real unit tests across 3 of the ~10 files in `mobile/lib/core/models/`: `signal_model_test.dart` (18 tests — `SignalPrice`/`SignalSources`/`SignalModel`, covering `fromJson` parsing, null/missing-field defaults, and derived getters `riskRewardRatio`/`confidenceBar`/`baseAsset`/`isBuy`/`isSell`), `virtual_portfolio_model_test.dart` (18 tests — `BalancePoint`/`TradeSnapshot`/`VirtualPerformanceModel`/`VirtualTradeModel`, covering nested-object parsing, `isProfitable`/`returnPct`/`durationLabel`/`isLiquidated`/`isFutures`), `user_model_test.dart` (10 tests — `UserPreferences`/`UserModel`, covering `fromJson`/`toJson` round-trip, `copyWith`, `isAdmin`/`isPremium`). `flutter test` — 47/47 passing (verified, not assumed).
**Found and fixed one real bug via this work**: `UserPreferences.fromJson({})` returned `assets: []`, silently contradicting the constructor's own documented default of `['BTCUSDT', 'ETHUSDT']` shown three lines above it in the same file — `fromJson` built an explicit named-parameter value that bypassed the constructor default entirely. A user with no saved `preferences.assets` would have landed on an empty watchlist instead of the intended BTC+ETH starter set. Fixed in `mobile/lib/core/models/user_model.dart` (one added conditional), confirmed no other call site in `mobile/lib/` reads `preferences.assets` in a way the fix could break (`grep` confirmed zero other references). Test added specifically to catch this regressing again.
Investigated but deliberately did **not** change: `SignalModel.baseAsset`'s slash-branch is effectively dead for symbols that also end in `USDT`/`USD` (e.g. `'BTC/USDT'` hits the earlier `endsWith` check first and returns `'BTC/'`, not `'BTC'`) — no evidence this format is ever actually produced by the backend (`TRACKED_ASSETS` uses concatenated Binance-style symbols, no slash), so this is speculative dead-code behavior, not a confirmed bug; documented in the test comment rather than "fixed" on a guess. Also checked whether `durationMinutes`/`avgDurationMinutes`'s `as int` casts in `virtual_portfolio_model.dart` were a latent crash risk (JSON numbers with a fractional part would throw on that cast) — confirmed safe by reading `backend/src/services/virtualTrackingService.js:417,557,644`, which always `Math.round()`s these before sending, so left unchanged (not broken, no fix needed).
DATE: 2026-08-18
COMMIT: `[pending]`
REMAINING RISK: medium-low. Coverage is real but partial — 3 of ~10 model files, 0 of ~28 providers, 0 widget tests. `mobile` is still the least-tested part of the stack relative to backend (101 tests) and ai-service (105 tests). Continuing this incrementally rather than in one giant pass, per the owner's "no need to rush, quality over speed" instruction — next slice would be the remaining models, then the highest-value providers (likely `virtual_portfolio_provider.dart`, `signals_provider.dart`), then a small number of widget tests for the dashboard/signals screens.

### PRIORITY 1 (continuous) — ai-service CORS misconfiguration (T-022)
STATUS: DONE
EVIDENCE: Found during a PM-directed continuous-improvement pass (security is priority #1 per owner's standing instruction). `ai-service/app/main.py`'s `CORSMiddleware` was configured with `allow_origins=["*"]` and `allow_credentials=True` simultaneously — the same anti-pattern the backend's `ALLOWED_ORIGINS` hardening addressed earlier (2026-08-18): wildcard + credentials either gets rejected outright by browsers or gets silently made spec-compliant by echoing back the request `Origin` instead of a literal `*`, which is more permissive than the config reads at a glance. Confirmed via `grep` that this service has zero cookie-based auth anywhere — it's called exclusively server-to-server by the backend (`aiService.js`, `aiWorkerService.js`, `socialService.js`) — so `allow_credentials=True` was dead, incorrect config, not a deliberate choice (unlike the backend's original wildcard, which had a documented rationale). Fixed to `allow_credentials=False`. Added `ai-service/tests/test_cors_config.py` (3 tests: middleware is registered, the dangerous combination is never present, and the fixed state is pinned against regression). Verified in a clean cloud venv (torch 2.13.0, fastapi 0.141.1): full ai-service suite **108/108 passing** (105 prior + 3 new).
Also attempted a live reproduction of the T-021 `jsonable_encoder` crash via `social_analyzer.refresh()` directly in the same venv — did not reproduce, though inconclusively (no real collector credentials available, FinBERT unreachable so VADER fallback engaged). Added as supplementary evidence to T-021's TASKS.md entry; T-021 itself stays TODO, not resolved by this note.
DATE: 2026-08-18
COMMIT: `25d25e3`
REMAINING RISK: none identified for this fix. General note: ai-service's CORS posture (origin still `*`, just no longer credentialed) has not been hardened to an explicit allowlist the way the backend's was — deliberately left as-is since ai-service has no browser clients at all (internal service only) and no owner decision has been requested for this scope; revisit only if that assumption changes (e.g. a future direct-browser integration).

### Not yet started (blocked or queued)
- PRIORITY 3 continuation — awaiting owner decision on (a) whether/when to trigger a redeploy of backend + ai-service, and (b) how trained models reach the ai-service container (see above). Once redeployed: repeat health/DB/model/cron verification against a live instance, since none of that could be observed this pass.
- PRIORITY 4 (model artifacts) — partially answered above (delivery path gap found); full resolution still open.
- PRIORITY 5 (mobile inspection) — started (T-012, see above), partial coverage.
- PRIORITY 6 (API docs, `ai-service-err.log` triage) — done (T-006, T-007, see above).
- PRIORITY 7/8 (monitoring, rollback) — not yet started.
- T-020 (Telegram webhook authenticity check) — code complete and tested; confirmed **not configured at all** in Railway (no `TELEGRAM_WEBHOOK_SECRET` var exists yet), on top of not being live. Needs the owner to set it in Railway and call Telegram's `setWebhook` with a matching `secret_token` (see the dedicated entry above for exact commands) — and this should happen in the same window as a redeploy, not before or after, per the fail-closed design.

## CURRENT PHASE
Phase 1 (CI/CD) is live and green on GitHub Actions. Phase 4 (Security / Priority 2) is complete and pushed. **Phase 5 (Priority 3 / Railway) is audited but blocked**: production is down on both services (pre-dates this engagement — last live deploy attempts were 2026-04-26/05-04), and bringing it back up is a deploy decision that needs explicit owner sign-off, not an audit action.

## OVERALL PRODUCTION READINESS
**Still NOT production-verified — and now confirmed NOT production-running.** GitHub-side work (CI, security fixes, tests) is solid and evidenced. But "the code is good" and "the system is online" are separate facts: right now there is no live backend or ai-service behind either Railway domain, both health endpoints 404 at the edge, and production is 48 commits stale even before accounting for the fact it never successfully ran the current codebase at all. Next real milestone is not "more code" — it's an owner decision to redeploy, plus a decision on how trained ML models actually get into the ai-service container, followed by genuine (not assumed) health/DB/model/cron verification against a live instance.
