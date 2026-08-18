# TASKS.md — Task Tracker

Statuses: TODO · IN_PROGRESS · BLOCKED · REVIEW · DONE
A task is only DONE when it has actually been verified (tests run, build passes, or manually confirmed) — never because code was merely written.

| ID | Phase | Priority | Description | Status | Dependencies | Files Affected | Verification Method | Completed |
|----|-------|----------|-------------|--------|---------------|-----------------|----------------------|-----------|
| T-001 | 0 | Critical | Full repo audit | DONE | — | — | Read every major dir; ran backend Jest (63/63 pass) and ai-service pytest (105/105 pass) live | 2026-08-18 |
| T-002 | 1 | Critical | Add GitHub Actions CI (backend Jest + ai-service pytest) | REVIEW | T-001 | `.github/workflows/ci.yml` | YAML validated + commands verified locally; blocked on push to actually run on GitHub | — |
| T-003 | 1 | Medium | Add `npm audit` / `pip-audit` as non-blocking CI step | DONE | T-002 | `.github/workflows/ci.yml` | Steps included in the workflow | 2026-08-18 |
| T-004 | 2 | Critical | Verify live Railway deploy health (backend + ai-service) | BLOCKED | Railway token from owner | — | Hit `/api/v1/health` and `/health` against production URLs | — |
| T-005 | 2 | High | Confirm MongoDB Atlas connectivity in production | BLOCKED | T-004 | — | Health endpoint reports `database: connected` | — |
| T-006 | 2 | Medium | Triage `ai-service-err.log` (376KB local history) | TODO | — | `ai-service/ai-service-err.log` | Categorize recurring error types, file follow-up tasks | — |
| T-007 | 3 | High | Write API documentation for all ~25 route groups | TODO | — | new `API.md` or OpenAPI spec | Every route in `backend/src/routes/*.js` has a documented entry | — |
| T-008 | 4 | High | Confirm bcrypt salt rounds + password policy | DONE | — | `backend/src/models/User.js`, `authController.js` | Read source: `bcrypt.hash(password, 12)` — 12 rounds confirmed | 2026-08-18 |
| T-009 | 4 | High | Verify or remove refresh-token flow | REVIEW | T-007 | `backend/src/routes/auth.js`, `authController.js` | Confirmed NOT implemented — only a single access token exists; `JWT_REFRESH_EXPIRES_IN` is dead config. Needs owner decision: implement or remove. | 2026-08-18 |
| T-010 | 4 | Medium | Document/confirm `ALLOWED_ORIGINS=*` decision | REVIEW | — | `DEPLOYMENT.md` | Documented as intentional; awaiting explicit owner sign-off | 2026-08-18 |
| T-011 | 4 | Medium | Run `npm audit` and `pip-audit`, triage findings | DONE | T-003 | `backend/package-lock.json`, `ai-service/requirements.txt`, `ai-service/Dockerfile` | backend: 26→9 vulns (critical+high resolved), 63/63 tests pass after fix. ai-service: 16→0 vulns (torch bumped past CVEs), 105/105 tests pass after fix. | 2026-08-18 |
| T-019 | 4 | High | Add input validation to the 24 route files with none (only 3/27 use express-validator) | TODO | T-007 | `backend/src/routes/*.js` | Add route-level tests first, then validation, verify no regressions | — |
| T-012 | 5 | Medium | Add real Flutter widget/unit tests | TODO | — | `mobile/test/` | `flutter test` passes | — |
| T-013 | 5 | Medium | Add backend↔ai-service integration tests | TODO | T-007 | new integration test dir | Test run passes in CI | — |
| T-014 | 6 | Low | Review MongoDB indexes for hot collections (signals, market data, virtual trades) | TODO | T-004 | ai-service/backend models | Query plans reviewed against real usage | — |
| T-015 | 7 | Low | Remove/relocate large zips and stray `mobile/off`, `mobile/echo`, `mobile/@echo` dirs | TODO | Owner confirmation | project root, `mobile/` | Owner approves deletions; repo size checked after | — |
| T-016 | 7 | Low | Consolidate `backend/.env.railway` vs `backend/.env.example` | TODO | — | `backend/.env.railway`, `backend/.env.example` | Single clear template remains | — |
| T-017 | 8 | Critical | Walk full `PRODUCTION_CHECKLIST.md` against live deploy | BLOCKED | T-004 | — | Every checklist item checked off with evidence | — |
| T-018 | 9 | Medium | Set up recurring daily/weekly scheduled task (Cowork) | TODO | Owner approval (deferred until after this audit review) | — | Scheduled task created and first run reviewed | — |

## Notes
- BLOCKED tasks (T-004, T-005, T-017) need the Railway API token the owner said they'll provide.
- T-018 is intentionally not yet scheduled — owner asked to review this first audit before turning on unattended recurring runs.
