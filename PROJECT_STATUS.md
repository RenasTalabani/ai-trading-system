# PROJECT_STATUS.md

Last updated: 2026-08-18, by Claude (technical lead session — Priority 2 complete)

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
STATUS: BLOCKED — not a credential problem, a session network-policy block
EVIDENCE: `git push` from the device's sandboxed shell fails (no network access at all — "403 from proxy after CONNECT"). Pushing from Claude's cloud workspace (which does have network) using the GitHub token the owner provided fails with: `access denied by the git proxy: RenasTalabani/ai-trading-system is not in this session's authorized repository set`. A follow-up read-only API check (`GET api.github.com/repos/RenasTalabani/ai-trading-system`) fails the same way: `GitHub access to this repository is not enabled for this session`. This is a deliberate allowlist on Claude's sandboxed network proxy, not fixable by supplying a different or more-privileged token.
RESOLUTION: the owner needs to run `git push origin master` themselves from their own machine (their local git already has working push credentials — confirmed by prior successful pushes in history), OR authorize this repo for the session through whatever mechanism Anthropic's environment exposes for that (unclear if one is user-facing in Cowork). The local `master` branch is fully ready — 6 commits, fast-forward only, all tests verified green.
DATE: 2026-08-18

**IMPORTANT FINDING — uncommitted work discovered during CI setup**
STATUS: FIXED (locally; not yet pushed)
EVIDENCE: When first wiring the CI workflow, `backend/__tests__/` and `ai-service/tests/` — the very test suites this audit verified as 63/63 and 105/105 passing — turned out to have **never been committed to git**. Neither had the `ai-service/app/services/intel/` subsystem, `translation_service.py`, the `guide` feature (backend controller/route + mobile screen/providers), or `mobile/web/`. Additionally, ~20 tracked files (job schedulers, `virtualTrackingService.js`, `aiWorkerService.js`, ai-service routes/config, mobile screens) had local uncommitted edits that the new tests depend on (`capToMaxRisk`, `getEdgeMultiplier`, `approveSuggestion` didn't exist in the last real commit — confirmed by first committing tests alone and watching 27 of them fail, then finding and committing the paired implementation, then re-verifying 63/63 green). All of this is now committed locally. **This means a meaningful amount of real feature work existed only on this one machine with no backup in git history until today.**
DATE: 2026-08-18

**GitHub Actions actually running / green**
STATUS: NOT YET POSSIBLE — depends on the push above
EVIDENCE: n/a
DATE: —

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

**CORS (`ALLOWED_ORIGINS=*`)**
STATUS: MECHANISM VERIFIED; POLICY STILL NEEDS OWNER SIGN-OFF
EVIDENCE: Extracted the origin-resolution logic from `app.js` into `backend/src/config/corsConfig.js` (`buildCorsOptions`) with no behavior change, then wrote 8 tests (5 unit tests against the pure function, 3 HTTP integration tests via supertest against a minimal Express app) proving: wildcard allows any origin with no credentials; an explicit comma-separated allowlist accepts listed origins and rejects unlisted ones; requests with no `Origin` header (native mobile clients) are always allowed regardless of the list. All 8 pass. The `*` default itself remains intentional and documented in `DEPLOYMENT.md` (mobile sends no Origin header; auth uses Bearer tokens, not cookies, so there's no ambient credential a wildcard origin could ride on) — but it would also let any website call this API directly from a browser, so it's still flagged for an explicit owner decision, not silently left as-is or silently changed.
DATE: 2026-08-18
COMMIT: `dbb81c3`
REMAINING RISK: low-medium, pending owner decision. No credential-theft path identified (Bearer-token auth, no cookies), but open to any-origin browser calls until/unless the owner locks in an explicit allowlist.

**Input validation coverage**
STATUS: RISK-BASED FIXES APPLIED (not all 24 files — by design, see rationale)
EVIDENCE: Audited all 24 previously-unvalidated route files (of 27 total; `auth.js`/`notifications.js`/`virtual.js` already had `express-validator`) against the owner's explicit risk criteria: DB writes, account/permission changes, trading/portfolio data, financial parameters, user-controlled identifiers, external API interaction. Findings:
  - **Fixed** — `priceAlerts.js` (create/delete/toggle): old handler did `parseFloat(targetPrice)` with no bound, so non-numeric/negative/zero values could be silently stored and would then never (or incorrectly) fire in the alert-checking job. Now validates `targetPrice` as a positive float, `direction` as an enum, string field lengths, and `:id` as a Mongo ObjectId.
  - **Fixed** — `brain.js` (`POST /follows`, `PATCH /follows/:id/close`, `DELETE /follows/:id`): validates `action`/`outcome` enums, `confidence` range (0–100), price fields as positive numbers, `:id` as a Mongo ObjectId.
  - **Fixed** — `guide.js` (`POST /positions/:tradeId/sell`): validates `:tradeId` as a Mongo ObjectId (previously relied entirely on Mongoose's `CastError` bubbling to the global error handler — functionally correct, since `errorHandler.js` does translate `CastError`/`ValidationError` to 400, but with no route-level guard). Also checked `VirtualTrade` for a missing per-user ownership filter (a real IDOR pattern in other apps) — confirmed the model has no `userId` field anywhere; this is a single shared paper portfolio by design, not a multi-tenant resource, consistent with `CLAUDE.md`'s "single-user personal app" framing. Not a bug, no fix needed.
  - **Reviewed, no fix needed** — `users.js` preferences: already schema-backstopped with explicit `min`/`max`/enum on every field (`User.js` preferences sub-schema), plus `runValidators: true` on the update call. `market.js` batch tickers: already whitelist-filters against `TRACKED_ASSETS` before forwarding to Binance, so unvalidated input can't reach the external call. `ai.js`/`signals.js`/`news.js` trigger endpoints: admin/premium-role-gated already, lower exposure. The ~9 remaining files (`budget`, `global`, `reports`, `simulator`, `strategy`, `tracker`, `unified`, `advisor`, `orderBlocks`) already validate in their controllers (confirmed via `grep -l express-validator` on the controllers directory), even though the route files themselves don't import it directly.
  - **Documented, not fixed — flagged for owner decision** — `telegram.js` `POST /webhook` has no authenticity check (no secret-token verification against Telegram), so any caller can POST a payload shaped like a Telegram update; a forged payload could make the bot relay a message to an arbitrary chat ID. This isn't an input-*validation* gap (the handler already defensively checks shape) — it's a missing authentication step for an external-API-facing endpoint, and fixing it means adding a new env var and configuring Telegram's `setWebhook` with a secret token, which is an external-configuration change, not a code-only fix. Tracked as `TASKS.md` T-020.
DATE: 2026-08-18
COMMIT: `1cf84e9`
REMAINING RISK: low for the fixed routes (verified by 13 new tests). Low-medium for the telegram webhook until T-020 is actioned — realistic impact is bot-abuse-as-spam-relay, not account takeover (linking a Telegram account still requires a correct, short-lived, random UUID token).

**Rate limiting / security headers / error exposure**
STATUS: PASS
EVIDENCE: `helmet()`, global `express-rate-limit` (100 req/15min default), and `errorHandler.js` only includes stack traces when `NODE_ENV=development` — confirmed by reading the actual code, not assumed. `errorHandler.js` also correctly translates Mongoose `ValidationError` → 400 (per-field messages) and `CastError` → 400, which several of the routes above rely on as a backstop.
DATE: 2026-08-18
COMMIT: — (no change needed)
REMAINING RISK: none identified.

**Security testing**
STATUS: PASS
EVIDENCE: No lint/type-check/build script exists for the backend (`package.json` scripts are `start`/`dev`/`test` only) — it's plain CommonJS Node with no TypeScript or ESLint configured, so there's nothing applicable to run beyond the test suite; noting this so it doesn't read as a skipped step. Full backend test suite run after all Priority 2 changes: **84/84 passing** (71 pre-existing + CORS, plus 13 new input-validation tests). ai-service was not touched this pass (refresh-token/CORS/input-validation changes are backend-only), so its 105/105 baseline stands unchanged from Priority 1.
DATE: 2026-08-18
COMMIT: `dbb81c3`, `1cf84e9`
REMAINING RISK: none — both new commits are covered by passing tests, not just written.

---

### Not yet started (blocked or queued)
- PRIORITY 3 (Railway verification) — blocked on Railway token, not requested yet per owner's plan. **Not starting without explicit owner review of this security report first, per owner instruction.**
- PRIORITY 4 (model artifacts) — open question, not yet investigated this pass.
- PRIORITY 5 (mobile inspection) — not yet started.
- PRIORITY 6 (API docs, `ai-service-err.log` triage) — not yet started.
- PRIORITY 7/8 (monitoring, rollback) — not yet started.
- T-020 (Telegram webhook authenticity check) — queued, needs owner decision on adding a webhook secret.

## CURRENT PHASE
Phase 1 (CI/CD) is code-complete and verified locally; blocked on push. **Phase 4 (Security / Priority 2) is now complete** — every item from the owner's checklist is either fixed-and-tested, confirmed-already-adequate-with-evidence, or explicitly documented as an owner decision (CORS policy choice, Telegram webhook secret). Stopping here per owner instruction to review before Priority 3 (Railway) begins.

## OVERALL PRODUCTION READINESS
**Still NOT production-verified.** Real progress this pass: dependency vulnerabilities fixed and verified (Priority 1), refresh-token dead config removed and CORS enforcement test-covered, and the highest-risk input-validation gaps closed with tests — all backed by evidence, not assumption. Two items now sit explicitly with the owner (CORS wildcard policy, Telegram webhook secret) rather than being silently decided. The single biggest open item remains mechanical, not architectural: get these 8 commits onto GitHub (6 from Priority 1 + `dbb81c3` + `1cf84e9` from Priority 2).
