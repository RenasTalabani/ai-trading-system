# PROJECT_AUDIT.md — AI Trading System

Audit date: 2026-08-18
Auditor: Claude (acting technical lead)
Method: full repo inspection (source, tests, config, git history) via the connected device; backend Jest suite and ai-service pytest suite were actually executed (not just read) to verify current status.

## 1. Current Project Purpose

An AI-assisted crypto/market intelligence app, **not a live auto-trader**. It ingests market data (Binance), news, social (Twitter/Reddit/Telegram), and macro data; runs it through an ML/NLP signal-generation pipeline (LSTM/Transformer fusion, FinBERT sentiment, regime detection, RL-weighted signal engine); and surfaces signals, an "AI Brain" Q&A assistant, watchlists, alerts, and a **virtual (paper) portfolio** — including simulated futures/leverage trading with liquidation modeling — to users through a Flutter mobile app. No code path places real exchange orders. This was confirmed with the owner: the product is paper-trading / advisory only, by design, for now.

## 2. Architecture

Three-service architecture, monorepo, single git repo (`github.com/RenasTalabani/ai-trading-system`):

- **mobile/** — Flutter app (Riverpod, go_router, dio, Firebase Cloud Messaging, secure storage). ~30 feature screens (dashboard, signals, watchlist, scanner, brain/chat, DCA, backtest, trade journal, strategy, reports, guide, etc.). Android build configured; iOS not present. Already built as APKs pointed at a Railway backend URL.
- **backend/** (Node 18+/Express) — REST API + WebSocket server, MongoDB (Mongoose) persistence, JWT auth, cron jobs (`node-cron`) for market data collection, AI decision cycles, reports, alerts, DCA, tracker evaluation. Talks to `ai-service` over HTTP for model inference. ~25 route groups, 24 controllers, 16 scheduled jobs.
- **ai-service/** (Python 3.11, FastAPI) — model layer: LSTM/Transformer fusion model, FinBERT + VADER sentiment, technical indicators, regime detection, RL-weighted signal fusion, backtester, drift detector, online learner, news/social/telegram collectors, macro data (FRED/CoinGecko), an "intel" pipeline (multi-source classifier/cross-reference/reliability scoring). Talks to MongoDB directly via Motor/PyMongo.

Deployment target: **Railway** (Dockerfile + `railway.json` in both `backend/` and `ai-service/`, healthcheck paths configured), **MongoDB Atlas** for the database, Firebase for push notifications. `docker-compose.yml` exists for local multi-service runs.

## 3. Status By Area

### Frontend (Flutter mobile) — Functional, actively developed
30+ screens across dashboard, signals, watchlist/scanner, AI Brain chat, trade journal, DCA, backtest, reports, alerts, settings. Git history (last ~30 commits) shows steady feature delivery through "Phase 17." Only one test file (`test/widget_test.dart`, default counter-app placeholder) — **no real widget/unit test coverage**. No iOS project. No app store listing/signing config reviewed yet.

### Backend (Node/Express) — Functional, well-tested for a project this size
`npm test` executed live: **3 suites, 63 tests, all passing.** Sensible middleware stack already in place: `helmet`, `cors` (see security note below), `express-rate-limit` (global, 100 req/15min default), JWT auth with role-based `authorize()`, centralized error handler, Winston logging. 16 cron jobs cover the core automation loop (market data, AI decisions, reports, alerts, DCA, tracking).

### AI Service (Python/FastAPI) — Functional, well-tested
`pytest` executed live after installing `requirements.txt` fresh in an isolated venv: **105 tests, all passing.** Real ML stack (torch, transformers/FinBERT, scikit-learn), not stubs. Reasonably sophisticated: multi-timeframe analysis, regime detection, confidence calibration, drift detection, online learning, a dedicated "intel" pipeline for cross-referenced news reliability scoring.

### Database — MongoDB Atlas (connection string, not self-hosted)
`backend/config/db.js` and ai-service Motor client both point at the same `MONGODB_URI`. No migration/seed tooling observed. No indexes reviewed yet (potential performance gap — see Medium priority below).

### Authentication — JWT, present and reasonable
`backend/src/middleware/auth.js`: Bearer token, `jwt.verify`, active-user check, role-based `authorize()`. Password hashing via `bcryptjs` (present in `package.json`, not yet read line-by-line to confirm salt rounds — flagged for security review). No refresh-token rotation observed beyond `JWT_REFRESH_EXPIRES_IN` env var — unclear if actually implemented (routes/auth.js not yet read in full).

### APIs — Broad, not yet formally documented
~25 route groups mounted under `/api/v1/*`. No OpenAPI/Swagger spec, no Postman collection, no README describing the API surface. This is a real onboarding/maintenance gap for a project this size.

### Storage — Firebase (push), local `saved_models/` (ML artifacts, gitignored)
`ai-service/saved_models` (14MB currently) holds trained model artifacts, correctly gitignored (`.joblib`, `.h5`, `.pt`, `.onnx` excluded) — meaning **models are not reproducible from git alone**; there's no documented training/export pipeline for standing up a fresh environment from scratch. `trainer.py` exists but its inputs/outputs aren't documented.

### Infrastructure — Railway-shaped, partially proven
`railway.json` + `Dockerfile` present for both backend and ai-service; APKs already built pointing at a Railway URL, and logs (`backend.log`, `aiservice.log`, `backend-err.log`) on disk show the stack has run before, including recent errors (`ai-service-err.log` is 376KB — worth triaging). No infra-as-code beyond the two `railway.json` files; no staging environment referenced anywhere.

### Testing — Real, but with a critical blind spot
Backend and ai-service both have genuine, passing test suites (63 + 105 = **168 tests, currently green**). Mobile has effectively **zero** test coverage. No end-to-end/integration tests across the three services. No test run has ever been wired into CI (there is no CI at all — see below).

### CI/CD — **Does not exist**
No `.github/workflows/`, no other CI config found anywhere in the repo. Every commit today lands on `master` with zero automated verification. This is the single highest-leverage gap: 168 passing tests are currently only checked when a human remembers to run them locally.

### Security — Better than average for this stage, with real gaps
Good: helmet, rate limiting, JWT, gitignored `.env` files (verified: `.env` is NOT tracked in git; `backend/.env.railway` IS tracked but is a placeholder template — `JWT_SECRET=REPLACE_ME`-style, not a real secret — confirmed by direct inspection).
Gaps: `ALLOWED_ORIGINS` defaults to `*` in production per `.env.railway` comments ("Flutter mobile sends no Origin header") — acceptable for a mobile-only client but would allow any website to call the API from a browser; worth a deliberate decision, not an accident. No dependency vulnerability scanning (no `npm audit`/`pip-audit`/Dependabot config found). No documented input-validation coverage audit (express-validator is a dependency but usage wasn't verified across all 25 route groups). No secrets manager — Railway dashboard env vars are the only secret store, which is fine but should be explicit in DEPLOYMENT.md.

### Performance — Unreviewed
No load testing, no query/index review, no caching layer beyond an in-memory price cache in `binanceService.js`. Not a blocker at current scale, but undocumented.

### Deployment — Partially proven, not currently verified live
Config exists and looks production-shaped, and prior logs show it has run. **Not verified as currently live/healthy** in this audit (no deploy credentials available this session — Railway token to be provided separately, per owner decision). This is the first thing to verify once credentials are available.

## 4. Missing Features
- CI/CD pipeline (none exists).
- API documentation (OpenAPI/Swagger or equivalent).
- Mobile test coverage (currently a placeholder only).
- End-to-end tests across mobile → backend → ai-service.
- Documented model training/reproduction pipeline (models exist as gitignored binary artifacts only).
- Dependency vulnerability scanning.
- A staging environment separate from production.

## 5. Broken Features
None found in this pass — both automated test suites are 100% green today, and no crash-on-startup or obviously broken code paths were found during inspection. This should be re-verified against live Railway logs once deploy access is available; `ai-service-err.log` (376KB of historical errors) should be triaged for recurring runtime issues that don't show up in unit tests.

## 6. Incomplete Features
- iOS build (Android-only currently).
- Refresh-token flow (env vars present, implementation not yet confirmed end-to-end).
- `_positions_check.json` and several `off/`, `echo/`, `@echo/` directories under `mobile/` look like stray build/debug artifacts rather than intentional source — worth confirming with the owner whether they can be deleted.

## 7. Technical Debt
- No API docs → high onboarding cost, easy for backend/mobile contracts to drift.
- `ai-service-err.log` (376KB) never triaged.
- Two near-duplicate zipped snapshots of the dashboard (`ai-trading-dashboard.zip`, `ai-trading-dashboard (1).zip`) and a 1.5GB `ai-trading-system.zip` sitting in the project root — these bloat the folder and should be archived outside the working repo or removed once confirmed unneeded.
- `backend/.env.railway` duplicates `backend/.env.example` (both act as templates) — fine functionally, mildly confusing; consider consolidating.

## 8. Critical Blockers (must resolve before "production ready")
1. **No CI/CD** — nothing stops a broken commit from reaching `master` or Railway's auto-deploy.
2. **Live deployment status unverified** — cannot claim "online and working" until checked against real Railway services (blocked on credentials, per owner decision to provide a Railway token).
3. **No API documentation** — blocks confident review of the security/input-validation surface and blocks future maintenance.

## 9. Medium-Priority Issues
- Mobile test coverage.
- Database index review.
- CORS policy: confirm `ALLOWED_ORIGINS=*` is an intentional, documented decision.
- Dependency vulnerability scan (`npm audit`, `pip-audit`) and a plan for keeping dependencies current.
- Triage `ai-service-err.log`.
- Refresh-token flow verification.

## 10. Low-Priority Issues
- Repo hygiene: large zip files and stray build folders in project root.
- Consolidate `.env.example` vs `.env.railway`.
- iOS build support (only if the owner wants iOS distribution).

## 11. What This Audit Deliberately Did Not Do
- Did not read the contents of any real `.env` file (only `.env.example`/`.env.railway` templates), to avoid ever handling live secrets unnecessarily.
- Did not attempt to deploy or call the live Railway URL (no credentials yet).
- Did not modify any trading/signal logic — the paper-trading scope was confirmed with the owner before this audit was written.
