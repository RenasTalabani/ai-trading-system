# PRODUCTION_CHECKLIST.md

Do not declare this system "production ready" until every item below is actually checked against evidence — not assumed. Status reflects this audit (2026-08-18).

## Code Quality
- [x] Backend test suite passes (101/101, verified live — 63 original + 14 CORS + 13 input-validation + 11 Telegram webhook, all Priority 2 additions)
- [x] AI service test suite passes (105/105, verified live; unchanged this pass — no ai-service files touched)
- [ ] Mobile test suite exists and passes (currently placeholder only)
- [ ] CI runs both suites automatically on every push/PR
- [x] No high-severity findings from `npm audit` / `pip-audit`, or findings are triaged and accepted (Priority 1: backend 26→9 vulns, all remaining moderate/transitive; ai-service 16→0)

## Security
- [x] `.env` files gitignored and not tracked (verified)
- [x] No real secrets found committed to git (verified — `.env.railway` is a placeholder template)
- [x] JWT auth + role-based authorization present
- [x] Rate limiting + helmet security headers present
- [x] CORS policy: owner decided against wildcard — production now uses an explicit allowlist (empty until a real web origin exists), enforcement tested (14 tests)
- [x] Password hashing policy (bcrypt salt rounds) confirmed adequate — 12 rounds
- [x] Refresh-token flow confirmed unnecessary and removed (dead config deleted, reasoning documented in code)
- [x] Input validation coverage reviewed across all 27 route groups (risk-based); highest-risk gaps fixed and tested
- [x] Telegram webhook authenticity: secret-token verification implemented and tested (11 tests); **not yet live** — owner still needs to set `TELEGRAM_WEBHOOK_SECRET` in Railway and call Telegram's `setWebhook` with a matching `secret_token` (see `PROJECT_STATUS.md` for exact steps)

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
**Current overall status: NOT production-verified.** Code Quality and Security sections are now fully checked off (Priority 1 + Priority 2 complete, both with evidence and tests, both CORS and Telegram-webhook owner decisions actioned). Remaining work is Infrastructure (blocked on a Railway token), Documentation (API docs, log triage), and Operational Readiness (monitoring, rollback) — all tracked in `TASKS.md`. One operational note carried forward, not a checklist blocker: the Telegram webhook secret still needs to be set in Railway and registered with Telegram before it's live. Priority 3 (Railway) awaits the owner's review of this report before starting, per standing instruction.
