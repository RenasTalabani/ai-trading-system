# PROJECT_STATUS.md

Last updated: 2026-08-18, by Claude (technical lead session — Priority 1/2 execution pass)

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

### PRIORITY 2 — Security (findings so far; fixes applied where safe and verifiable)

**bcrypt password hashing**
STATUS: PASS
EVIDENCE: `backend/src/models/User.js` — `bcrypt.hash(this.password, 12)`. 12 salt rounds is solid (industry-typical range is 10–12).
DATE: 2026-08-18

**Refresh-token flow**
STATUS: FAIL (not implemented — dead config)
EVIDENCE: `authController.js`/`User.js` only implement a single access token (`generateAuthToken`, JWT, default 7-day expiry). `JWT_REFRESH_EXPIRES_IN` exists in `.env.example`/`.env.railway` but is never read anywhere in the codebase — it's unused, misleading configuration.
RECOMMENDATION: either implement real refresh-token rotation, or remove the unused env var so the config doesn't imply a security feature that isn't there. This is a product-shape decision, not just a bug fix — flagging for owner input rather than silently picking one.
DATE: 2026-08-18

**Input validation coverage**
STATUS: FAIL (much narrower than it looks)
EVIDENCE: Only 3 of 27 backend route files (`auth.js`, `users.js`, `virtual.js`) import `express-validator`. The other 24 — including routes that create data (`priceAlerts` create/toggle, `budget`, DCA via `virtual.js`'s non-validated handlers, `strategy`, `tracker`) — have no request-body validation at the route layer. Mongoose schema validation and the global `errorHandler`'s `CastError`/`ValidationError` handling provide a partial backstop (malformed data mostly won't crash the app), but bad/unexpected types can still reach the database unvalidated.
RECOMMENDATION: not fixed this pass — 24 files is a large, mechanical-but-risky change to make without dedicated route-level tests to verify against (none exist yet). Queued as TASKS.md T-019, prioritized by which routes write data.
DATE: 2026-08-18

**CORS (`ALLOWED_ORIGINS=*`)**
STATUS: NEEDS OWNER SIGN-OFF (not a bug, a decision)
EVIDENCE: Documented in `DEPLOYMENT.md` as intentional (mobile app sends no Origin header). Still open: does the owner want this explicitly confirmed/locked in, given it would also allow any website to call the API directly from a browser?
DATE: 2026-08-18

**Rate limiting / security headers / error exposure**
STATUS: PASS
EVIDENCE: `helmet()`, global `express-rate-limit` (100 req/15min default), and `errorHandler.js` only includes stack traces when `NODE_ENV=development` — confirmed by reading the actual code, not assumed.
DATE: 2026-08-18

---

### Not yet started (blocked or queued)
- PRIORITY 3 (Railway verification) — blocked on Railway token, not requested yet per owner's plan.
- PRIORITY 4 (model artifacts) — open question, not yet investigated this pass.
- PRIORITY 5 (mobile inspection) — not yet started.
- PRIORITY 6 (API docs, `ai-service-err.log` triage) — not yet started.
- PRIORITY 7/8 (monitoring, rollback) — not yet started.

## CURRENT PHASE
Phase 1 (CI/CD) is code-complete and verified locally; blocked on push. Phase 4 (Security) is partially complete — 4 of 6 items resolved or clearly documented, 2 queued as explicit follow-ups.

## OVERALL PRODUCTION READINESS
**Still NOT production-verified.** Real progress this pass: dependency vulnerabilities fixed and verified, a meaningful amount of previously-unbacked-up work is now safely committed, and security posture is now backed by evidence instead of assumption. The single biggest open item is mechanical, not architectural: get these 6 commits onto GitHub.
