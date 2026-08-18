# DEPLOYMENT.md — AI Trading System

This documents the deployment architecture as configured in the repo. **No secrets are included in this file** — see "Environment Variables" for where real values live.

## Production Architecture
- **Backend** — Node/Express service deployed to Railway from `backend/` (Dockerfile-based build, per `backend/railway.json`). Start command: `node server.js`. Healthcheck: `GET /api/v1/health`.
- **AI Service** — Python/FastAPI service deployed to Railway from `ai-service/` (Dockerfile-based build, per `ai-service/railway.json`). Start command: `python run.py`. Healthcheck: `GET /health`.
- **Database** — MongoDB Atlas (connection string via `MONGODB_URI`), shared by both services.
- **Push notifications** — Firebase Cloud Messaging, credentials via `FIREBASE_*` env vars.
- **Mobile** — Flutter app built as an Android APK, configured to call the Railway backend URL (`mobile/lib/core/constants/api_constants.dart`). Not distributed through an app store as of this audit.

## Services
| Service | Platform | Build | Port | Health Check |
|---|---|---|---|---|
| backend | Railway | Dockerfile (`node:20-alpine`) | 5000 | `/api/v1/health` |
| ai-service | Railway | Dockerfile (`python:3.11-slim`) | 8000 | `/health` |
| database | MongoDB Atlas | managed | — | — |

`backend` calls `ai-service` via `AI_SERVICE_URL` — on Railway this must be set to the ai-service's public Railway URL (or internal network URL if using Railway's private networking).

## Environment Variables
Full variable lists are in `backend/.env.example` and `ai-service/.env.example` (names only, no real values, safe to read). Real values live in:
1. Local `.env` files (gitignored, never committed) for local dev.
2. The Railway dashboard's environment variable settings for production — this is the only production secret store currently in use; there is no separate secrets manager.

**Required for backend to start:** `MONGODB_URI`, `JWT_SECRET`, `AI_SERVICE_URL`.
**Required for ai-service to start:** `MONGODB_URI`.
**Optional (features degrade gracefully without them, not yet individually verified):** `BINANCE_API_KEY`/`BINANCE_SECRET_KEY` (public market data doesn't require keys), `FIREBASE_*` (push notifications), `TELEGRAM_BOT_TOKEN`, `TWITTER_BEARER_TOKEN`, `REDDIT_CLIENT_ID`/`SECRET`, `ALPHA_VANTAGE_API_KEY` (Gold/Oil/Forex data), `FRED_API_KEY`.

`backend/.env.railway` is a **template** (placeholder values like `JWT_SECRET=REPLACE_ME`) meant to be copied into the Railway dashboard, not a real secret file — confirmed safe to keep in git as-is.

## Backend Deployment
Railway auto-builds from `backend/Dockerfile` on push to the connected branch (per `backend/railway.json`: `ON_FAILURE` restart policy, 3 max retries, 30s healthcheck timeout). No manual build steps required beyond having the env vars set in the Railway dashboard.

## AI Service Deployment
Railway auto-builds from `ai-service/Dockerfile`. Note the Dockerfile installs the **CPU-only** PyTorch wheel explicitly (`--index-url https://download.pytorch.org/whl/cpu`) to keep the image size down — do not "simplify" this to a plain `pip install torch` or the image will balloon with unnecessary CUDA packages. 60s healthcheck timeout (longer than backend's, presumably because model loading takes longer than an Express boot).

## Storage
- ML model artifacts (`ai-service/saved_models/`) are gitignored and currently **not reproducible from a fresh deploy** — they must either be baked into the Docker image some other way, mounted as a volume, or regenerated via `trainer.py` post-deploy. **This is unverified — needs to be checked against how the live Railway service currently gets its models.** Flagging as a real open question, not assuming an answer.
- No object storage (S3-equivalent) in use; no user-uploaded files in the product.

## Domain & SSL
Railway provides HTTPS termination and a `*.up.railway.app` domain by default; a custom domain has not been observed configured anywhere in this repo. Confirm with the owner whether a custom domain is desired.

## Monitoring & Logs
No external monitoring/alerting configured in-repo (no Sentry, Datadog, etc. found in dependencies). Current visibility is: Railway's own dashboard logs, plus local Winston/Python logging that also writes to `*.log` files when run locally. This is a real gap for a service meant to run 24/7 (16 cron jobs) — recommend at minimum Railway's built-in alerting on crash/restart once live status is confirmed.

## Rollback Strategy
Railway supports redeploying a previous build from its dashboard/CLI. No documented rollback runbook exists yet beyond that platform default — worth writing one once live access is confirmed and the team knows what a "bad deploy" looks like in practice for this app.

## Open Questions For Owner (do not assume answers)
1. How do trained models actually reach the live ai-service today — baked into the image, a volume, or trained fresh on each deploy?
2. Is a custom domain wanted, or is the default Railway subdomain fine?
3. Is Railway's built-in logging/alerting sufficient, or is dedicated monitoring wanted?
