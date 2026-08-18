# Backend API Reference

Generated from source (`backend/src/routes/*.js`, `src/middleware/`, `src/app.js`) on 2026-08-18, for commit `d726540`. This documents the **backend** (Node/Express) — 27 route files, ~110 endpoints, all mounted under `/api/v1` (`API_VERSION` env var can change the version segment). See `ai-service/app/api/routes.py` for the separate Python AI service's ~50 endpoints — not covered in the same depth here; ask if that needs its own pass.

This is a maintained reference, not a generated spec — when a route changes, update its entry here in the same commit (matches the "docs must represent reality" rule in `CLAUDE.md`).

## Conventions

**Base URL**: `{AI_SERVICE_URL is separate}` — backend is `https://<host>/api/v1/<group>/<path>` (locally `http://localhost:5000/api/v1/...`).

**Auth header**: `Authorization: Bearer <JWT>` for every route marked 🔒. Missing/malformed header → `401 {"success":false,"message":"Not authorized. Token missing."}`. Invalid/expired token → `401 {"success":false,"message":"Invalid or expired token."}`. Deactivated account → `403 {"success":false,"message":"Account is deactivated."}`. (`backend/src/middleware/auth.js`)

**Role gates**: routes marked 🔐`role` additionally require `req.user.role` to be one of the listed roles (checked *after* `protect` succeeds) → `403 {"success":false,"message":"Role '<role>' is not authorized for this action."}`.

**Validation errors** (routes with explicit `express-validator` chains): `400 {"success":false,"message":"Validation failed","errors":[{"field":"...","message":"..."}]}` (`src/middleware/validate.js`).

**Unhandled/thrown errors**: caught by the global handler (`src/middleware/errorHandler.js`) — Mongoose `ValidationError` → 400 (joined field messages), `CastError` (bad ObjectId) → 400, duplicate-key (11000) → 409, everything else → the thrown status or 500. Response shape: `{"success":false,"message":"..."}` (`stack` included only when `NODE_ENV=development`).

**Success envelope**: not fully uniform across the codebase (organic growth across many controllers), but the large majority return `{"success": true, ...data fields}` — noted per-route below only where it deviates or is otherwise non-obvious.

**Rate limiting**: global `express-rate-limit` on all of `/api/` — 100 req/15min by default (`RATE_LIMIT_MAX_REQUESTS` / `RATE_LIMIT_WINDOW_MS`). Exceeding it → `429 {"success":false,"message":"Too many requests, please try again later."}`.

---

## `/api/v1/health` — Health check
No auth (public — used by Railway's healthcheck and uptime probes).

| Method | Path | Description |
|---|---|---|
| GET | `/` | Liveness/readiness snapshot: `{success, status:"operational", timestamp, services:{backend, database, aiService}, version, environment}`. `database` reads Mongoose's `connection.readyState` live (not cached). `aiService` does a live 3s-timeout `GET {AI_SERVICE_URL}/api/health` — reports `"unreachable"` on any failure/timeout rather than throwing. |

---

## `/api/v1/auth` — Registration & session
No router-level auth (register/login are necessarily public); `/me` and `/fcm-token` require 🔒.

| Method | Path | Auth | Body | Notes |
|---|---|---|---|---|
| POST | `/register` | — | `name` (non-empty string), `email` (valid, normalized), `password` (min 8 chars) | Creates account, returns JWT. Password hashed with `bcryptjs`, 12 salt rounds (`User.js`). |
| POST | `/login` | — | `email`, `password` (non-empty) | Returns JWT on success. |
| GET | `/me` | 🔒 | — | Current user profile. |
| PATCH | `/fcm-token` | 🔒 | (see `authController.updateFcmToken`) | Updates the Firebase Cloud Messaging push token for the logged-in user. |

No refresh-token endpoint exists — deliberate, see `User.js` comment above `generateAuthToken()` and `CLAUDE.md` Security Rules.

---

## `/api/v1/users` — Profile & admin user list
🔒 router-wide (`router.use(protect)`).

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/profile` | 🔒 | Current user's profile. |
| PATCH | `/preferences` | 🔒 | Updates preferences sub-document — schema-validated via `User.js`'s own `min`/`max`/enum constraints + `runValidators: true` (no route-level `express-validator`, intentionally — see `PROJECT_STATUS.md` Priority 2 input-validation entry). |
| GET | `/` | 🔐`admin` | Lists all users. |

---

## `/api/v1/signals` — Trading signals
🔒 router-wide.

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/` | 🔒 | List signals (filters/pagination handled in `signalController.getSignals`). |
| GET | `/latest` | 🔒 | Most recent signal(s). |
| GET | `/stats` | 🔒 | Aggregate signal stats. |
| GET | `/:id` | 🔒 | Single signal by Mongo ID — bad ID → `CastError` → 400 via global handler (no route-level ID validator). |
| POST | `/generate` | 🔐`admin`,`premium` | Manually trigger signal generation for one asset. |
| POST | `/scan` | 🔐`admin` | Scan all tracked assets, generate signals for each. |

---

## `/api/v1/market` — Market data & prices
🔒 router-wide.

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/assets` | 🔒 | List of supported/tracked assets. |
| GET | `/prices/live` | 🔒 | Live price snapshot, all tracked assets. |
| GET | `/price/:asset` | 🔒 | Live price, single asset. |
| GET | `/ticker/:asset` | 🔒 | Full ticker (24h stats etc.), single asset. |
| POST | `/tickers` | 🔒 | Batch ticker lookup — body is filtered against the `TRACKED_ASSETS` whitelist before hitting Binance (prevents arbitrary-symbol pass-through; see `PROJECT_STATUS.md` Priority 2). |
| GET | `/history/:asset` | 🔒 | Historical candles for an asset. |
| POST | `/train` | 🔐`admin` | Triggers backend-side model (re)training hook. |

---

## `/api/v1/news` — News feed & sentiment
🔒 router-wide.

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/` | 🔒 | Latest news items. |
| GET | `/high-impact` | 🔒 | High-impact-only subset. |
| GET | `/stats` | 🔒 | Aggregate news stats. |
| GET | `/asset/:asset` | 🔒 | News filtered to one asset. |
| POST | `/collect` | 🔐`admin` | Manually trigger a news-collection cycle (normally on `newsJob` cron). |

---

## `/api/v1/social` — Social sentiment (Twitter/Reddit/Telegram)
🔒 router-wide.

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/` | 🔒 | Social feed. |
| GET | `/alerts` | 🔒 | Pump/unusual-activity alerts. |
| GET | `/stats` | 🔒 | Aggregate social stats. |
| GET | `/asset/:asset` | 🔒 | Social sentiment for one asset. |

---

## `/api/v1/ai` — AI service status/backtest bridge
🔒 router-wide.

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/status` | 🔒 | AI service reachability/status summary. |
| GET | `/health` | 🔒 | Model health (drift, staleness etc. — distinct from `/api/v1/health`'s coarse `aiService: connected/unreachable`). |
| GET | `/feedback` | 🔒 | Model feedback/evaluation stats. |
| POST | `/backtest` | 🔐`admin`,`premium` | Runs a backtest via the AI service. |
| POST | `/feedback/run` | 🔐`admin` | Manually trigger a feedback-evaluation cycle. |

---

## `/api/v1/notifications` — In-app notifications & push tokens
🔒 router-wide.

| Method | Path | Auth | Body/Params | Notes |
|---|---|---|---|---|
| GET | `/` | 🔒 | — | List notifications for current user. |
| GET | `/unread-count` | 🔒 | — | Unread badge count. |
| PATCH | `/read-all` | 🔒 | — | Marks all read. |
| POST | `/test` | 🔒 | — | Sends a test notification to self. |
| POST | `/register-token` | 🔒 | `token` (non-empty) | Registers an FCM push token. |
| DELETE | `/register-token` | 🔒 | — | Unregisters the caller's FCM token. |
| PATCH | `/:id/read` | 🔒 | `:id` must be a Mongo ObjectId | Marks one notification read. |
| DELETE | `/:id` | 🔒 | `:id` must be a Mongo ObjectId | Deletes one notification. |
| GET | `/stats` | 🔐`admin` | — | Aggregate notification stats. |

---

## `/api/v1/telegram` — Telegram bot linkage & webhook
Mixed auth — **not** router-wide.

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/webhook` | webhook secret (not JWT) | Telegram calls this directly. Verified via `X-Telegram-Bot-Api-Secret-Token` against `TELEGRAM_WEBHOOK_SECRET`, constant-time comparison, **fails closed** if the secret isn't configured server-side (`src/middleware/telegramWebhookAuth.js`). Currently **not live** — see `PROJECT_STATUS.md` Priority 3 (no `TELEGRAM_WEBHOOK_SECRET` configured in Railway at all yet). |
| POST | `/generate-link` | 🔒 | Issues a short-lived random UUID token the user sends to the bot to link their Telegram account — linking still requires possessing that token even with the webhook open, per `PROJECT_STATUS.md`'s Priority 2 risk note. |
| DELETE | `/unlink` | 🔒 | Unlinks the caller's Telegram account. |

---

## `/api/v1/virtual` — Paper trading engine (largest route group)
🔒 router-wide. This group has the most explicit `express-validator` coverage in the codebase — validated inline per-route rather than via the shared `validate` middleware (returns the same `400 {success:false, errors:[...]}` shape via manual `validationResult(req)` checks).

| Method | Path | Query/Body params | Notes |
|---|---|---|---|
| GET | `/exposure` | — | Aggregate risk across open positions: total notional/margin, per-asset concentration, correlation/liquidation-proximity warnings. |
| GET | `/performance` | `range`: `7d`\|`30d`\|`all` (optional) | Portfolio performance summary. |
| GET | `/summary` | `range`: `7d`\|`30d`\|`all` (optional) | Alias of the same summary data as `/performance`. |
| GET | `/trades` | `page` (int ≥1), `limit` (int 1-100), `status`: `open`\|`closed_profit`\|`closed_loss`\|`cancelled`\|`closed`, `range` | Paginated trade list. `status=closed` is a convenience alias expanding to `{$in:['closed_profit','closed_loss']}`. |
| GET | `/trades/history` | `range`, `page`, `limit` | Paginated closed/cancelled trade history (`status: closed_profit\|closed_loss\|cancelled`, sorted by `closedAt`). |
| POST | `/reset` | `startingBalance` (float 10–1,000,000, opt.), `riskPerTradePct` (float 1–50, opt.) | Resets the paper portfolio. Defaults: $500 balance, 5% risk/trade. |
| POST | `/set-capital` | same as `/reset` | Updates capital settings without a full reset. |
| POST | `/trades/:signalId/open-futures` | `:signalId` (Mongo ID), `leverage` (int 1–20, opt., default 1) | Opens a simulated leveraged position from an existing signal — fully paper, includes a simulated liquidation price. |
| POST | `/trades/:tradeId/trailing-stop` | `:tradeId` (Mongo ID) | Enables a trailing stop on an open trade (only ever tightens toward current price). |
| GET | `/dca` | — | Lists DCA (dollar-cost-averaging) plans with summary stats. |
| POST | `/dca/start` | `asset` (string), `amountPerBuy` (float ≥1), `frequencyDays` (int 1–30) | Starts a recurring simulated buy plan. |
| POST | `/dca/:planId/stop` | `:planId` (Mongo ID) | Stops a DCA plan. |

---

## `/api/v1/strategy` — Strategy analysis
🔒 router-wide. Handlers are validator-array exports (`...ctrl.holding` etc.) — request shape enforced in `strategyController.js`, not shown in the route file itself.

| Method | Path | Notes |
|---|---|---|
| POST | `/holding` | HOLD/BUY/SELL recommendation for given asset(s). |
| POST | `/simulate` | Back-simulates a strategy's historical performance. |
| GET | `/history` | Caller's past strategy reports. |

---

## `/api/v1/pnl` — Daily P&L
| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/today` | 🔒 | Today's realized/unrealized P&L snapshot. |

---

## `/api/v1/order-blocks` — Order-block (market structure) analysis
| Method | Path | Auth | Query | Notes |
|---|---|---|---|---|
| GET | `/analyze` | 🔒 | `asset`, `timeframe` | Detects institutional order-block zones for the given asset/timeframe. |

---

## `/api/v1/unified` — Unified multi-source analysis
| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/analyze` | 🔒 | Combines technical + sentiment + AI signals into one unified read — the closest existing endpoint to the roadmap's "AI Trading Advisor" concept. |

---

## `/api/v1/global` — Global market scan
| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/latest` | 🔒 | Cached full-market scan result, refreshed every ~30 min by `globalScanJob`. |
| POST | `/scan` | 🔒 | On-demand full scan — noted in source as taking ~60s; no explicit timeout override seen in the route itself. |

---

## `/api/v1/budget` — Budget / capital-session tracking
| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/status` | 🔒 | Current budget-session status. |
| GET | `/report` | 🔒 | Budget report. |
| POST | `/start` | 🔒 | Starts a budget session. |
| POST | `/stop` | 🔒 | Stops the active budget session. |

---

## `/api/v1/ai-brain` — AI decision history
| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/latest` | 🔒 | Most recent AI decision. |
| GET | `/stats` | 🔒 | Aggregate AI-decision stats. |
| GET | `/decisions/:asset` | 🔒 | Decision history for one asset. |

---

## `/api/v1/advisor` — Advisor analysis
🔒 router-wide.

| Method | Path | Notes |
|---|---|---|
| POST | `/analyze` | Advisor-style combined read for a given asset/context. |
| GET | `/supported` | Lists assets the advisor currently supports. |

---

## `/api/v1/simulator` — Standalone simulator
🔒 router-wide.

| Method | Path | Notes |
|---|---|---|
| POST | `/run` | Runs a one-off simulation (distinct from `/virtual/*`'s persistent paper portfolio and `/strategy/simulate`'s strategy backtest — three related-but-separate simulation surfaces; not consolidated, noted here for future cleanup consideration). |

---

## `/api/v1/reports` — Scheduled reports (daily/weekly)
🔒 router-wide.

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/latest` | 🔒 | Most recent report. |
| GET | `/history` | 🔒 | Past reports. |
| GET | `/stats` | 🔒 | Report-generation stats. |
| POST | `/trigger` | 🔐`admin` | Manually triggers report generation (normally `dailyReportJob`/`weeklyReportJob` cron). |

---

## `/api/v1/tracker` — Decision tracking & accuracy
🔒 router-wide.

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/store` | 🔒 | Records a decision/prediction to track. |
| GET | `/history` | 🔒 | Tracked-decision history. |
| GET | `/accuracy` | 🔒 | Accuracy stats against tracked outcomes. |
| POST | `/evaluate` | 🔐`admin` | Manually trigger evaluation (normally `trackerEvalJob`/`decisionTrackingJob` cron). |

---

## `/api/v1/macro` — Macro market context
🔒 router-wide.

| Method | Path | Notes |
|---|---|---|
| GET | `/snapshot` | Combined macro snapshot. |
| GET | `/fear-greed` | Fear & Greed index. |
| GET | `/funding-rates` | Futures funding rates. |

---

## `/api/v1/core` — Core advice/status bundle
🔒 router-wide.

| Method | Path | Notes |
|---|---|---|
| GET | `/advice` | Core advice bundle. |
| GET | `/status` | Core service status. |
| GET | `/simulator` | (Note: routed to `coreSimulatorController`, a *different* controller from `/api/v1/simulator` above — another of the simulation-surface overlaps worth consolidating later.) |
| GET | `/decisions` | Core decision feed. |

---

## `/api/v1/price-alerts` — User price alerts
🔒 router-wide.

| Method | Path | Body/Params | Notes |
|---|---|---|---|
| GET | `/` | — | List caller's price alerts. |
| POST | `/` | `asset` (≤20 chars), `displayName` (opt., ≤50), `targetPrice` (float >0), `direction`: `above`\|`below`, `note` (opt., ≤280) | Creates an alert. `targetPrice > 0` is enforced specifically because the pre-fix handler used unbounded `parseFloat` — see `PROJECT_STATUS.md` Priority 2. |
| DELETE | `/:id` | `:id` (Mongo ID) | Deletes an alert. |
| PATCH | `/:id/toggle` | `:id` (Mongo ID) | Toggles an alert active/inactive. |

---

## `/api/v1/brain` — "AI Brain" Q&A, reports, and signal-following
🔒 router-wide.

| Method | Path | Body/Params | Notes |
|---|---|---|---|
| GET | `/report/action` | — | Action-oriented brain report. |
| GET | `/report/performance` | — | Performance-oriented brain report. |
| GET | `/stats` | — | Brain stats. |
| GET | `/analytics` | — | Brain analytics. |
| POST | `/ask` | (free-form question, see `brainController.askBrain`) | Natural-language Q&A against the AI Brain. |
| GET | `/follows/stats` | — | Stats on the user's followed signals. |
| GET | `/follows` | — | List followed signals. |
| POST | `/follows` | `asset` (≤20), `displayName` (opt.), `action`: `BUY`\|`SELL`\|`HOLD`, `confidence` (0-100), `entryPrice`/`stopLoss`/`takeProfit` (opt., >0), `timeframe` (opt., ≤10), `note` (opt., ≤280) | Follows a signal/call. |
| PATCH | `/follows/:id/close` | `:id` (Mongo ID), `outcome` (opt.): `OPEN`\|`WIN`\|`LOSS`\|`CANCELLED`, `exitPrice` (opt., >0), `profitPct` (opt., number), `note` (opt.) | Closes a followed call with an outcome. |
| DELETE | `/follows/:id` | `:id` (Mongo ID) | Removes a followed call. |

---

## `/api/v1/guide` — Position guidance ("what to do with this open trade")
🔒 router-wide.

| Method | Path | Body/Params | Notes |
|---|---|---|---|
| GET | `/suggestion` | — | Current guidance suggestion (hold/scale/exit, per open positions). |
| POST | `/suggestion/approve` | (see `guideController.approve`) | Approves/acts on a suggestion. |
| GET | `/positions` | — | Open positions with guidance context. |
| POST | `/positions/:tradeId/sell` | `:tradeId` (Mongo ID) | Sells (closes) a position now, per guidance. |

---

## Known cross-cutting notes for future work

- **No refresh tokens** — single long-lived JWT, deliberate (see `auth.js` entry above).
- **No per-user ownership filter on `VirtualTrade`** — this is a single shared paper portfolio by design (personal-use app), not a multi-tenant resource. Documented so it isn't later "fixed" as an IDOR that doesn't actually apply here.
- **Three overlapping simulation surfaces**: `/api/v1/virtual/*` (persistent paper portfolio), `/api/v1/strategy/simulate` (strategy backtest), `/api/v1/simulator/run` and `/api/v1/core/simulator` (two more, separate controllers). Not a bug, but worth a deliberate consolidation pass at some point — flagged here rather than silently merging them without owner input.
- **Success envelope isn't fully uniform** — most routes return `{success, ...}` but a handful of internal service calls return bare data; if writing a client, don't assume every 2xx has a `success` key without checking the specific controller.
- This document does not yet include full response body schemas (field-by-field) for every route — that would need reading every controller + Mongoose model in equal depth. What's here (method, path, auth, and request-side validation) already covers what the roadmap flagged as the immediate risk driver: knowing what's protected, what's admin-only, and what's validated. Response schemas can be added incrementally as routes are touched, or in a dedicated follow-up pass if the owner wants full OpenAPI-grade coverage.
