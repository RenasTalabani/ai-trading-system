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
cd backend && npm test                        # Jest — 101 tests as of 2026-08-18

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
- Backend: `npm test` (Jest) must stay green — 101/101 as of last verified run.
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
- `ALLOWED_ORIGINS` is an **explicit allowlist** in production, not a wildcard (owner decision, 2026-08-18) — `backend/.env.railway` ships it empty with a documented placeholder until a real web frontend exists; do not set it to `*` in production. Enforcement logic lives in `backend/src/config/corsConfig.js` (tested — see `backend/__tests__/cors.test.js`, 14 tests). `*` remains supported for local dev only (`backend/.env.example`). Flutter mobile is unaffected either way — it sends no Origin header.
- JWT auth via `backend/src/middleware/auth.js`; role-based `authorize()` exists — use it for any new privileged route. No refresh-token flow, and that's deliberate — see the comment above `generateAuthToken()` in `User.js` before "fixing" this.
- Telegram webhook (`POST /telegram/webhook`) requires a valid `X-Telegram-Bot-Api-Secret-Token` header, verified in `backend/src/middleware/telegramWebhookAuth.js` against `TELEGRAM_WEBHOOK_SECRET`. Fails closed if that env var isn't set. The secret must also be registered with Telegram via `setWebhook`'s `secret_token` param — that's a manual step outside this repo (see `PROJECT_STATUS.md` for exact commands), not something a code change alone can activate.
- Input validation: `auth.js`, `notifications.js`, `virtual.js`, `priceAlerts.js`, `brain.js`, `guide.js` use `express-validator` + the shared `validate` middleware (`backend/src/middleware/validate.js`) — follow that pattern for new routes that write data, accept financial parameters, or take user-controlled IDs. Not every route needs it: several controllers (`advisor`, `budget`, `global`, `orderBlocks`, `reports`, `simulator`, `strategy`, `tracker`, `unified`) already validate inline, and `users.js` preferences relies on `User.js` schema `min`/`max`/enum constraints plus `runValidators: true` — check before assuming a gap.
- The global `errorHandler.js` already translates Mongoose `ValidationError` → 400 (per-field messages) and `CastError` (bad ObjectId) → 400 — routes that skip route-level validation and instead let Mongoose reject bad data get a reasonable backstop automatically, as long as the controller calls `next(err)` rather than swallowing the error into a generic 500.
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
- Live Railway deployment: **confirmed LIVE and current** (re-audited 2026-09-01, via Railway CLI, T-092). The 2026-08-18 "confirmed DOWN" finding was real but described a Railway project (`distinguished-empathy`) that has since been abandoned (now has zero services) — the actual production project is **`generous-vision`** (created 2026-08-30). Both `backend` and `ai-service` are `RUNNING`, health-checked directly, deployed at the exact current `master` HEAD commit (Railway auto-deploys on push). See `PROJECT_STATUS.md`'s T-092 entries for full evidence. **Two real, open, owner-decision items found this same audit**: (1) backend's Railway region (`us-east4`, US) gets HTTP 451 from Binance on every code path (WS stream, REST poll, historical candles) while ai-service's region (`europe-west4`, EU) does not — this is the confirmed root cause of backend's Binance connectivity trouble, fixable only by changing backend's Railway region, not by code; (2) `ANTHROPIC_API_KEY` is unset, so RENO chat degrades honestly rather than functioning.
- ai-service model artifacts (`saved_models/`, gitignored) have no delivery path into the Docker image or a Railway volume — a fresh deploy would boot with no trained models. Needs a decision before Priority 3 can be closed. **Not re-verified against the now-confirmed-live instance as of 2026-09-01** — worth checking directly now that a real target exists.
- `ai-service-err.log` (376KB locally) not yet triaged for recurring runtime issues.
- `POST /telegram/webhook` authenticity check is implemented and tested (`TASKS.md` T-020) but **not yet live** — needs the owner to set `TELEGRAM_WEBHOOK_SECRET` in Railway and call Telegram's `setWebhook` with a matching `secret_token`.

## Current Project Status
See `PROJECT_STATUS.md` for the live snapshot — update that file, not this section, as work progresses.

## Current Roadmap Phase
Phase 1 — Safety Net (CI/CD). See `MASTER_ROADMAP.md`.
