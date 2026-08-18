# CLAUDE.md — Project Memory for AI Trading System

Read this file first in every work session on this project, along with `MASTER_ROADMAP.md`, `TASKS.md`, and `PROJECT_STATUS.md`.

## Project Purpose
An AI-assisted crypto/market intelligence app: signals, an "AI Brain" assistant, watchlists/alerts, and a **virtual (paper) portfolio** with simulated futures/leverage. **Not** a live auto-trader — no code path places real exchange orders, and that is an intentional, owner-confirmed product decision, not a limitation to "fix."

## Architecture
Three services, one git repo (`github.com/RenasTalabani/ai-trading-system`):
- `mobile/` — Flutter (Riverpod, go_router, dio). Android build only.
- `backend/` — Node 18+/Express, MongoDB (Mongoose), JWT auth, `node-cron` jobs, WebSocket server. Talks to `ai-service` over HTTP.
- `ai-service/` — Python 3.11/FastAPI. ML/NLP: LSTM/Transformer fusion, FinBERT sentiment, regime detection, RL-weighted signal fusion, backtester, "intel" multi-source pipeline. Talks to MongoDB directly.

Deploy target: Railway (Dockerfile + `railway.json` per service) + MongoDB Atlas + Firebase (push).

## Important Commands
```bash
# Backend
cd backend && npm install && npm run dev      # local dev
cd backend && npm test                        # Jest — 63 tests as of 2026-08-18

# AI service
cd ai-service && python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt -r requirements-dev.txt
python -m pytest -q                           # 105 tests as of 2026-08-18

# Full stack locally
docker-compose up --build

# Mobile
cd mobile && flutter pub get && flutter run
```
Note: `ai-service/.venv` in the repo is a Windows-created venv (`Lib`/`Scripts` layout) — not usable from a Linux shell. Create a fresh venv there instead of trying to activate the committed one.

## Development Rules
- This is paper-trading/advisory software. Do not add real exchange order execution without an explicit, separate go-ahead from the owner — that's a money/security-tier decision, not a normal feature add.
- Preserve existing working functionality. This is an ~80%-built, actively-developed project (30+ commits of real feature work) — audit before rewriting, never assume existing code is wrong.
- Never mark a task DONE without actually running the relevant verification (tests, build, or manual confirmation).

## Testing Rules
- Backend: `npm test` (Jest) must stay green — 63/63 as of last verified run.
- AI service: `python -m pytest -q` must stay green — 105/105 as of last verified run.
- Mobile: no real test coverage yet (Phase 5 in the roadmap) — be extra careful with manual verification of UI changes until this exists.
- CI (once T-002 lands): every push/PR should run both suites automatically — treat a red CI run as a hard blocker, not a suggestion.

## Deployment Rules
- Railway, connected to this repo. `backend/railway.json` and `ai-service/railway.json` define build/start/healthcheck.
- Do not deploy without owner sign-off on what's being deployed — this is production infrastructure serving a real (if paper-trading) product.
- Never commit real secrets. `.env` files are correctly gitignored; `backend/.env.railway` is a placeholder template (`JWT_SECRET=REPLACE_ME`-style), not real credentials — keep it that way.

## Environment Rules
- Real secrets live only in the Railway dashboard and local `.env` files (gitignored). `.env.example` files document required variable names without values.
- Required backend vars: `MONGODB_URI`, `JWT_SECRET`, `AI_SERVICE_URL`, plus optional Binance/Firebase/Telegram/Twitter/Reddit keys (features degrade gracefully without most of these — verify before assuming a hard dependency).
- Required ai-service vars: `MONGODB_URI`, plus the same optional collector keys.

## Security Rules
- `ALLOWED_ORIGINS=*` in production is intentional (mobile app sends no Origin header) — do not silently "fix" this without confirming it doesn't break anything; document any change in `DEPLOYMENT.md`.
- JWT auth via `backend/src/middleware/auth.js`; role-based `authorize()` exists — use it for any new privileged route.
- Run `npm audit` / `pip-audit` before adding new dependencies where reasonably practical.

## Coding Conventions
- Backend: CommonJS, Express router-per-resource under `src/routes/`, controller logic in `src/controllers/`, business logic in `src/services/`, Mongoose models in `src/models/`. Cron jobs in `src/jobs/`.
- AI service: FastAPI routes in `app/api/routes.py`, models in `app/models/`, business logic in `app/services/` (collectors, fusion, backtest, intel as sub-packages).
- Mobile: feature-first structure under `lib/features/<feature>/`, shared state in `lib/core/providers/` (Riverpod), models in `lib/core/models/`.

## Important Directories
- `backend/src/jobs/` — the automation heartbeat (market data, AI decisions, reports, alerts, DCA, tracking). Sixteen jobs; changing scheduling here affects the whole product's behavior.
- `ai-service/app/services/intel/` — newest subsystem (multi-source news reliability pipeline), still evolving per recent commits.
- `ai-service/saved_models/` — gitignored ML artifacts; not reproducible from git alone yet (see `trainer.py` for the training entry point, currently undocumented).

## Known Limitations
- No CI/CD yet (Phase 1, in progress).
- No API documentation.
- Mobile has no real test coverage.
- Live Railway deployment status not yet re-verified this engagement (blocked on Railway token).
- `ai-service-err.log` (376KB locally) not yet triaged for recurring runtime issues.

## Current Project Status
See `PROJECT_STATUS.md` for the live snapshot — update that file, not this section, as work progresses.

## Current Roadmap Phase
Phase 1 — Safety Net (CI/CD). See `MASTER_ROADMAP.md`.
