# PRODUCTION_CHECKLIST.md

Do not declare this system "production ready" until every item below is actually checked against evidence — not assumed. Status reflects this audit (2026-08-18).

## Code Quality
- [x] Backend test suite passes (63/63, verified live)
- [x] AI service test suite passes (105/105, verified live)
- [ ] Mobile test suite exists and passes (currently placeholder only)
- [ ] CI runs both suites automatically on every push/PR
- [ ] No high-severity findings from `npm audit` / `pip-audit`, or findings are triaged and accepted

## Security
- [x] `.env` files gitignored and not tracked (verified)
- [x] No real secrets found committed to git (verified — `.env.railway` is a placeholder template)
- [x] JWT auth + role-based authorization present
- [x] Rate limiting + helmet security headers present
- [ ] CORS policy (`ALLOWED_ORIGINS=*`) explicitly reviewed and signed off, not just inherited
- [ ] Password hashing policy (bcrypt salt rounds) confirmed adequate
- [ ] Refresh-token flow confirmed implemented and correct, or removed if unused
- [ ] Input validation coverage reviewed across all ~25 route groups

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
**Current overall status: NOT production-verified.** Roughly a third of this checklist is done; the rest is blocked on either a Railway token (infra items) or straightforward follow-up work already tracked in `TASKS.md`.
