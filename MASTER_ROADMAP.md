# MASTER_ROADMAP.md — AI Trading System

Single source of truth for phased delivery. Adapted from the standard template to this project's actual shape (three-service monorepo, already ~80% built, no CI, unverified live deploy). Phases 0–2 are largely already done by prior work; this roadmap starts real effort where the audit found real gaps.

Scope guardrail (owner-confirmed): **paper trading / signals only**. No phase in this roadmap adds real exchange order execution.

## PHASE 0 — Discovery ✅ DONE (2026-08-18)
Full repo audit completed. See `PROJECT_AUDIT.md`. Both test suites verified green (168 tests total).

## PHASE 1 — Safety Net (CI/CD) — IN PROGRESS
Goal: make it impossible for a broken commit to go unnoticed.
- Add `.github/workflows/ci.yml`: run backend Jest + ai-service pytest on every push/PR to `master`.
- Add dependency audit step (`npm audit --audit-level=high`, `pip-audit`) as a non-blocking warning initially.
- Verify the workflow actually runs green on the current `master`.

## PHASE 2 — Live Deployment Verification — BLOCKED (needs Railway token)
Goal: confirm what's already built is actually online and healthy, not just configured.
- Verify Railway services are live: hit `backend` `/api/v1/health` and `ai-service` `/health`.
- Confirm MongoDB Atlas connectivity from both services in production.
- Check current Railway logs for the errors implied by the local 376KB `ai-service-err.log`.
- Confirm the mobile app's configured API base URL matches the live backend URL.
- Document actual findings in `PROJECT_STATUS.md` and `DEPLOYMENT.md`.

## PHASE 3 — API Documentation
Goal: make the ~25 route groups reviewable and maintainable.
- Generate/write an OpenAPI spec (or a well-organized `API.md`) covering every route, auth requirement, and request/response shape.
- This directly de-risks Phase 5 (security review) and Phase 9 (testing) below.

## PHASE 4 — Security Hardening
- Confirm `bcryptjs` salt rounds and password policy.
- Confirm/document refresh-token flow end-to-end, or remove the unused env vars if it isn't implemented.
- Make the `ALLOWED_ORIGINS=*` CORS decision explicit and documented (acceptable for mobile-only traffic; flag if a web client is ever added).
- Run `npm audit` / `pip-audit`, triage findings.
- Spot-check `express-validator` usage coverage across route handlers, prioritizing any route that writes to the DB.

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
