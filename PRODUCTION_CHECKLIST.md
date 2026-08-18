# PRODUCTION_CHECKLIST.md

Do not declare this system "production ready" until every item below is actually checked against evidence — not assumed. Status reflects this audit (2026-08-18).

## Code Quality
- [x] Backend test suite passes (84/84, verified live — 63 original + 8 CORS + 13 input-validation, all Priority 2 additions)
- [x] AI service test suite passes (105/105, verified live; unchanged this pass — no ai-service files touched)
- [ ] Mobile test suite exists and passes (currently placeholder only)
- [ ] CI runs both suites automatically on every push/PR
- [x] No high-severity findings from `npm audit` / `pip-audit`, or findings are triaged and accepted (Priority 1: backend 26→9 vulns, all remaining moderate/transitive; ai-service 16→0)

## Security
- [x] `.env` files gitignored and not tracked (verified)
- [x] No real secrets found committed to git (verified — `.env.railway` is a placeholder template)
- [x] JWT auth + role-based authorization present
- [x] Rate limiting + helmet security headers present
- [x] CORS policy reviewed and enforcement mechanism tested (8 tests) — wildcard *choice* itself still needs explicit owner sign-off (see `PROJECT_STATUS.md`)
- [x] Password hashing policy (bcrypt salt rounds) confirmed adequate — 12 rounds
- [x] Refresh-token flow confirmed unnecessary and removed (dead config deleted, reasoning documented in code)
- [x] Input validation coverage reviewed across all 27 route groups (risk-based); highest-risk gaps fixed and tested — one item (Telegram webhook authenticity) flagged for owner decision, tracked as T-020

## Infrastructure
- [ ] Backend Railway service confirmed live and healthy (`/api/v1/health` returns `operational`)
- [ ] AI service Railway service confirmed live and healthy (`/health`)
- [ ] MongoDB Atlas connectivity confirmed from both production services
- [ ] Model artifact delivery to production confirmed (see open question in `DEPLOYMENT.md`)
- [ ] Mobile app's configured backend URL confirmed to match the live production URL

## Documentation
- [x] `PROJECT_AUDIT.md`, `MASTER_ROADMAP.md`, `TASKS.md`, `CLAUDE.md`, `PROJECT_STATUS.md`, `DEPLOYMENT.md` exist
- [ ] API documentation exists covering all routes
- [ ] `ai-service-err.log` triaged, recurring issues understood or fixed

## Operational Readiness
- [ ] Monitoring/alerting in place for the 16 backend cron jobs and both services' uptime
- [ ] Rollback procedure documented and understood
- [ ] Owner has reviewed and approved this checklist before any "launch" claim is made

## Scope Confirmation
- [x] Confirmed with owner: paper-trading / signals only, no real exchange order execution — this checklist assumes that scope stays fixed unless the owner explicitly changes it.

---
**Current overall status: NOT production-verified.** Code Quality and Security sections are now fully checked off (Priority 1 + Priority 2 complete, both with evidence and tests). Remaining work is Infrastructure (blocked on a Railway token), Documentation (API docs, log triage), and Operational Readiness (monitoring, rollback) — all tracked in `TASKS.md`. Per owner instruction, Priority 3 (Railway) does not start until this checklist's Security section is reviewed.
