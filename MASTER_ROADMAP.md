# MASTER_ROADMAP.md — AI Trading System

Single source of truth for phased delivery. Adapted from the standard template to this project's actual shape (three-service monorepo, already ~80% built, no CI, unverified live deploy). Phases 0–2 are largely already done by prior work; this roadmap starts real effort where the audit found real gaps.

Scope guardrail (owner-confirmed): **paper trading / signals only**. No phase in this roadmap adds real exchange order execution.

## PHASE 0 — Discovery ✅ DONE (2026-08-18)
Full repo audit completed. See `PROJECT_AUDIT.md`. Both test suites verified green (168 tests total).

## PHASE 1 — Safety Net (CI/CD) — DONE (2026-08-18)
Goal: make it impossible for a broken commit to go unnoticed.
- Added `.github/workflows/ci.yml`: runs backend Jest + ai-service pytest on every push/PR to `master`.
- Added dependency audit step (`npm audit --audit-level=high`, `pip-audit`) as a non-blocking warning.
- Verified the workflow actually runs green on `master` — confirmed live on GitHub Actions (not just locally), 3 consecutive successful runs through commit `b201322`. See `PROJECT_STATUS.md` / `TASKS.md` T-002 for evidence.

## PHASE 2 — Live Deployment Verification — AUDITED, THEN POSTPONED (owner decision, 2026-08-18)
Goal: confirm what's already built is actually online and healthy, not just configured.
- Audit completed with real Railway CLI access (not blocked on a token as originally assumed): both backend and ai-service are **down** in production (last deploy attempts 2026-04-26 / 05-04, both `FAILED`, both health endpoints 404 at the edge). Full findings in `PROJECT_STATUS.md` Priority 3 section.
- A real redeploy is **intentionally not being attempted** — Railway is currently unfunded by the owner. This phase stays paused (not blocked on missing access) until the owner funds/authorizes it. Do not repeatedly retry deployment in the meantime.
- Two concrete gaps found during the audit that a future redeploy will need to resolve first: (1) trained ML model artifacts have no path into the ai-service container (not in git, Dockerfile doesn't copy them, no volume attached); (2) Telegram is not configured in Railway at all yet (no secret, no bot vars).

## PHASE 3 — API Documentation — DONE (2026-08-18)
Goal: make the ~25 route groups reviewable and maintainable.
- Wrote `backend/API.md` covering all 27 route groups (~110 endpoints): method, path, auth requirement, and request validation rules. See T-007.
- Full response-schema-per-field coverage intentionally deferred as a low-value nice-to-have (no external API consumers besides the first-party Flutter app).

## PHASE 4 — Security Hardening — DONE (2026-08-18)
- Confirmed `bcryptjs` — 12 salt rounds.
- Confirmed refresh-token flow was unnecessary for this app's threat model; removed dead config, documented why.
- CORS: owner decided against `*` in production — implemented an explicit allowlist (empty-by-default, deny-all-browsers until a real web origin exists) in the backend, and separately found + fixed an invalid `allow_origins="*"` + `allow_credentials=True` combination in the ai-service (T-022, found during PM continuous-improvement pass, unrelated to the backend decision above).
- Ran `npm audit` / `pip-audit`; backend 26→9 vulns (all critical/high resolved), ai-service 16→0 vulns.
- Risk-based `express-validator` audit of all 24 previously-unvalidated route files; fixed the 3 genuinely under-protected ones, confirmed the rest were already backstopped.
- Bonus (owner-approved scope add): Telegram webhook authenticity check (`secret_token` verification) — code done, awaiting 2 manual owner steps to go live (see T-020).

## PHASE 5 — Test Coverage Expansion
- Add real widget/unit tests to `mobile/` (currently placeholder-only).
- Add integration tests that exercise backend ↔ ai-service calls (currently only unit-level, per-service).
- Keep backend/ai-service unit suites green as a hard CI gate (Phase 1 makes this enforceable).

## PHASE 6 — Performance & Reliability
- Review MongoDB indexes against actual query patterns (signals, market data, virtual trades — these are the hottest collections).
- Triage `ai-service-err.log` for recurring runtime errors.
- Load-test the health-check-critical paths (signal generation, dashboard load) at a level appropriate for current user count.

## PHASE 7 — Repo Hygiene & Housekeeping
- Move or delete the 1.5GB `ai-trading-system.zip` and duplicate dashboard zips from the working repo (confirm with owner before deleting anything).
- Confirm the stray `mobile/off/`, `mobile/echo/`, `mobile/@echo/` folders and `_positions_check.json` are safe to remove.
- Consolidate `backend/.env.railway` and `backend/.env.example` into one clearly-labeled template if both are still needed.

## PHASE 8 — Production Checklist & Launch Verification
- Walk `PRODUCTION_CHECKLIST.md` end to end against the live Railway deployment.
- Confirm mobile APK points at the correct production backend URL and is signed appropriately for distribution.
- Declare production-ready only when every checklist item is actually verified — not assumed.

## PHASE 9 — Post-Launch Monitoring & Maintenance
- Stand up basic uptime/error monitoring beyond Railway's own dashboard if the owner wants alerting.
- Establish the recurring daily/weekly scheduled-task cadence described in `CLAUDE.md` (owner to approve after reviewing this first audit).

---

## Explicitly Deferred / Out of Scope Unless Requested
- Real exchange order execution (owner confirmed: paper trading only).
- iOS build/distribution (Android-only today; add only if requested).
- New product features beyond what already exists — this roadmap is about finishing and hardening, not expanding scope.
