# Overnight Validation Log — 2026-08-28/29

Running log for the overnight end-to-end validation task. Appended to
throughout the night by this Cowork session. This is a working log, not
the final report -- the final report gets compiled separately in the
morning from everything in here.

## 21:39–21:41 UTC — First E2E pass (native Claude Code terminal session, real evidence)

Confirmed via this session's own git log (commit 56c2db6) and the pasted
transcript this session received. Summary of what was proven live at
that time, with real evidence (not re-verified independently by this
Cowork session, but the evidence shown was concrete: exact price matches
vs live Binance, real DB before/after states, real log timestamps):

- Market data: backend `/market/prices/live` matched real Binance to the
  cent for BTCUSDT ($77,527.51) and ETHUSDT ($2,431.09).
- AI analysis: `/predict` (ETHUSDT) and `/unified/analyze` (SOLUSDT) both
  returned real, live-computed output with the new `decision` field
  (T-065/T-066) correctly present -- both returned WAIT (HOLD, no risk
  flags) on real live data.
- Guide: `/guide/positions` P&L recalculated correctly against a live
  price matching Binance exactly.
- Virtual trading: closed a REAL open position (ADAUSDT) via the actual
  `/guide/positions/:id/sell` endpoint a user tap would hit. API
  response, and independently-checked DB state, agreed exactly:
  `balanceBefore 482.42 -> balanceAfter 482.30`, matching the reported
  -$0.12 / -0.50% P&L.
- Notifications: trade-close push path executed (logged
  "Firebase credentials not configured" at the exact close timestamp --
  expected in local dev, not a bug). Confirmed separately that signal
  notifications fan out one document per real distinct user (7 real
  userIds on one historical BUY signal), not duplicates.
- Real, non-code findings surfaced (not fixed, per instruction not to
  silently change behavior): Binance has suspended MATICUSDT trading
  (`status: "BREAK"`, likely the MATIC->POL migration) -- the app's
  existing MATIC paper position correctly refuses to close rather than
  fake a price, but is now stuck until Binance resumes or the app adds a
  fallback. This is an external-world fact, not a bug in this codebase.
- Design observation flagged, not assumed to be a bug: trade-close
  notifications only go through push/Telegram -- no in-app Notification
  document gets created for them (unlike signal notifications), so an
  automatic TP/SL close would be silent in-app with push/Telegram off.

Git state at that point: 9 commits ahead pushed to origin/master
(6a5f188..56c2db6), CI green on both Backend/Jest and AI Service/pytest
per that session's report.

## 22:03–22:10 UTC — This Cowork session picks up, hits a hard blocker

Connected via the device bridge (mcp__remote-devices__*), confirmed git
log matches the above (56c2db6 head). Opened the REAL running web app in
the REAL Chrome browser on the user's own machine (via the browser-pane
tools proxied over the device bridge -- not a cloud/sandboxed browser),
navigated to http://localhost:5173, and it auto-logged into an existing
session (no credentials entered by this session).

Guide screen loaded and immediately showed:
  "Couldn't reach the AI — check your connection and try again."

Investigated for real rather than assuming a UI glitch:
  - Retried via the UI's own "Pull down to check again" -- same failure,
    twice, ~10s apart.
  - Ran a raw `fetch()` from INSIDE the real browser page (real machine,
    real network stack, not this session's own sandboxed VM) against
    `http://localhost:5000/api/v1/health` and `http://localhost:8000/health`
    directly: both returned `TypeError: Failed to fetch` -- not an HTTP
    error, a connection failure (nothing listening / connection refused).
  - Ruled out a general network problem (like the earlier DNS blip this
    session's predecessor already saw and recovered from): the SAME
    browser, SAME machine, successfully reached
    `https://api.binance.com/api/v3/ping` (200 OK) and
    `http://localhost:5173` (the frontend itself) at the same time.

CONCLUSION: the backend (port 5000) and ai-service (port 8000) processes
are no longer running / not listening, as of 22:10 UTC. This is NOT a
network issue, NOT a CORS issue, NOT an auth issue -- the ports are
simply not answering. Most likely explanation: closing the terminal
windows that were running `npm start` / `uvicorn` (or the machine
sleeping) when the owner went to bed killed the foreground processes.
This Cowork session's own device-bridge sandbox (mcp__remote-devices__
device_bash) cannot independently confirm process state on the Windows
host (it's an isolated Linux VM with its own separate network namespace
-- confirmed earlier this session it cannot reach localhost:5000/8000 OR
MongoDB Atlas directly, only the real browser on the real machine can).

WHY THIS SESSION CANNOT SIMPLY RESTART THEM: attempted the legitimate
path -- computer-use access to a terminal (Windows Terminal / PowerShell
/ Command Prompt / VS Code) on the real desktop. The device's own
policy grants terminals and IDEs "click" tier ONLY (can see and
left-click, cannot type or press keys) specifically because typing into
a terminal is high-trust. This is a deliberate safety boundary, not a
bug -- so this session cannot type `npm start`/`uvicorn ...` into a
terminal even with computer-use access. No double-click-a-shortcut
alternative exists either (`run-app.bat` at the repo root is a stale
script for an entirely different, no-longer-valid path
`C:\Users\Karwan Store\ai-trading-system\mobile` and launches an Android
build, not the three dev servers -- did not run it).

STATUS: blocked on the owner restarting the three local services
(ai-service, backend, Flutter Web) per the exact commands already
established earlier this session. Everything else in tonight's test
plan needs a live app to execute honestly, so per the owner's own
explicit instruction ("If something cannot be tested, tell me why" /
"I prefer an honest failure over a fake successful test"), this session
will NOT fabricate further live-testing evidence while blocked.

PLAN WHILE BLOCKED: re-check reachability periodically through the
night (lightweight, no wasted effort) via the same real-browser fetch
method above. The instant the servers respond again, resume the full
test plan (multi-asset decision testing, Gold/Forex support check, full
UI walkthrough, the AI-driven paper-trading experiment, repetition
testing, notification/DB verification, bug hunting) exactly as
instructed. A message was sent to the owner now in case they check their
phone, since this blocks the core ask.

---

### Recheck — 2026-08-28T22:15:47Z (session resumed after context compaction, not yet the scheduled trigger)

Ran the same reachability check again via the real browser (`Claude_Browser__javascript_tool`, fetch from origin http://localhost:5173):

| Target | Result |
|---|---|
| `http://localhost:5000/api/health` | FAILED — `TypeError: Failed to fetch` |
| `http://localhost:5000/` | FAILED — `TypeError: Failed to fetch` |
| `http://localhost:8000/` | FAILED — `TypeError: Failed to fetch` |
| `http://localhost:8000/docs` | FAILED — `TypeError: Failed to fetch` |
| `https://api.binance.com/api/v3/ping` (control) | OK — 200, 529ms |

Still down. Control check confirms this is not a general network issue — the real browser reaches the public internet fine, only the local backend (5000) and ai-service (8000) are unreachable.

One new observation: the Chrome tab at `http://localhost:5173` is still alive and titled "AI Trader" — the Flutter Web frontend dev server itself is still up/serving. Only the backend and ai-service processes appear to be down (or the machine went to sleep and they didn't survive/reconnect — can't tell which from here).

No action taken beyond logging. The existing scheduled recheck (trig_01Y8NcYyYEh3BWXtZ1rtJt9g, fires ~22:42 UTC) is still pending and will pick this back up; not re-notifying the user since it has been under an hour since the initial heads-up message.

---

### Recheck — 2026-08-28T22:42:41Z (scheduled trigger fired: "Overnight trading app reachability recheck")

| Target | Result |
|---|---|
| `http://localhost:5000/api/health` | FAILED — `TypeError: Failed to fetch` |
| `http://localhost:5000/` | FAILED — `TypeError: Failed to fetch` |
| `http://localhost:8000/` | FAILED — `TypeError: Failed to fetch` |
| `http://localhost:8000/docs` | FAILED — `TypeError: Failed to fetch` |
| `https://api.binance.com/api/v3/ping` (control) | OK — 200, 399ms |

Still down, same signature as the last two checks. Control ping confirms it's still isolated to the local backend/ai-service processes, not a network issue. Flutter Web dev server tab (localhost:5173) is still alive.

Elapsed since first "servers down" finding tonight (~22:10 UTC): ~32 min. Under the 2-hour threshold for re-pinging the user, so not sending another message. Scheduling another recheck in ~30 min via send_later.

---

### Recheck — 2026-08-28T23:14:27Z (scheduled trigger fired)

| Target | Result |
|---|---|
| `http://localhost:5000/api/health` | FAILED — `TypeError: Failed to fetch` |
| `http://localhost:5000/` | FAILED — `TypeError: Failed to fetch` |
| `http://localhost:8000/` | FAILED — `TypeError: Failed to fetch` |
| `http://localhost:8000/docs` | FAILED — `TypeError: Failed to fetch` |
| `https://api.binance.com/api/v3/ping` (control) | OK — 200, 403ms |

Still down, unchanged signature (4th consecutive check with identical result). Elapsed since first "servers down" finding (~22:10 UTC): ~64 min. Still under the 2-hour re-ping threshold. Scheduling another recheck in ~30 min via send_later.

---

### Device bridge reconnected — 2026-08-29T04:34Z

The link to the machine dropped at ~23:45Z and stayed down for ~4h49min (through several scheduled rechecks that could not reach the device at all). It reconnected by ~04:34Z — likely the computer coming back from sleep or the desktop app reopening; exact cause unknown from this side.

Immediately re-checked backend/ai-service reachability now that the device is back:

| Target | Result |
|---|---|
| `http://localhost:5000/api/health` | FAILED — `TypeError: Failed to fetch` |
| `http://localhost:5000/` | FAILED — `TypeError: Failed to fetch` |
| `http://localhost:8000/` | FAILED — `TypeError: Failed to fetch` |
| `http://localhost:8000/docs` | FAILED — `TypeError: Failed to fetch` |
| `https://api.binance.com/api/v3/ping` (control) | OK — 200, 712ms |

So: the device link is back, but the backend (5000) and ai-service (8000) processes are still not running — same signature as every check before the device dropped. The Flutter Web dev server (localhost:5173) is still alive throughout. Total confirmed "servers down" duration so far: from ~22:10Z to at least 04:34Z, i.e. 6h20min+.

Continuing the reachability-only check loop (servers still down); will resume the full overnight test plan the moment 5000/8000 respond.

---

## PHASE 2 — Real testing resumes (2026-08-29, ~04:34Z onward)

User restarted all three services and confirmed: "its back online on local host http://localhost:52507/". Flutter Web this run started on port 52507 (not the usual 5173).

### Pre-flight verification (real, via direct navigation — see methodology note below)

- `GET http://localhost:5000/api/v1/health` → `{"success":true,"status":"operational","services":{"backend":"online","database":"connected","aiService":"connected"}}` — **backend UP, MongoDB Atlas CONNECTED, ai-service reachable from backend.**
- `GET http://localhost:8000/api/health` → all model flags true: random_forest, transformer, lstm_fallback, fusion, calibrator, news_nlp, social_nlp. `phase8.drift.drift_level: "none"`, `retrain_needed: false`. **AI service fully operational, all models loaded.**

### IMPORTANT METHODOLOGY NOTE — a real tooling constraint, not a product bug

The Flutter Web app (running at http://localhost:52507) could not reach the backend when driven through this session's browser-automation pane (Claude_Browser): every XHR/fetch call from the app's own origin (52507) to the backend (5000) or ai-service (8000) failed client-side with `net::ERR_BLOCKED_BY_CLIENT`, confirmed in the browser console (Dio logs: "This request is not a CORS 'simple request'..." followed immediately by ERR_BLOCKED_BY_CLIENT). This reproduced even after granting the automation pane explicit site access to localhost:5000/8000. This is a client-side block specific to this remote testing session's browser-automation layer — the backend's own CORS config (`ALLOWED_ORIGINS=*`) is actually permissive, and the server responded correctly to direct top-level navigation every time.

Practical effect: I could NOT drive the actual Flutter UI end-to-end with real button clicks and see live data render on-screen in this session — every data screen in the real UI (Guide, Market, Signals, Virtual Portfolio) shows "Couldn't reach the AI" / equivalent, purely because of this automation-layer network block, not because the backend/AI are unhealthy (they are healthy, per above).

**Workaround used instead, to still get 100% REAL data (no fabrication):** top-level browser *navigation* is not subject to this block (it's not an XHR/fetch), so:
1. GET-only, unauthenticated endpoints were read by navigating directly to them (backend health, ai-service health/status).
2. For POST/authenticated endpoints, I navigated a tab directly to the target origin (e.g. `http://localhost:8000`) and ran `fetch()` from *within that same-origin page* — same-origin requests are not subject to the block that stopped cross-origin ones, and this reproduced consistently. All data below came back from the live, running backend/ai-service exactly as they'd answer any real client.
3. To read authenticated backend data, I self-registered a disposable test account via the public `/api/v1/auth/register` endpoint (email `overnight.validation.<timestamp>@example.com`, role `user` — same as any real signup, no privilege escalation) and used its JWT. Because paper-trading state (`BudgetSession`/`VirtualPortfolio`) is a global singleton, not per-user (known architecture, T-0xx), this test account sees the *exact same real shared data* as the owner's real account — nothing fabricated, nothing isolated to a sandboxed test user.

This means: everything below is real, live data pulled directly from the running app — but I have NOT yet been able to visually confirm the Flutter UI renders it correctly on-screen (that specific check is blocked by the tooling issue above, not by the app). I'll keep trying to find a way around this; if I can't, I'll say so plainly in the final report rather than claim UI-level verification I didn't actually get.

### REAL starting snapshot (as requested)

From `GET /api/v1/virtual/performance` (live, authenticated, real data):

| Metric | Value |
|---|---|
| Starting balance | $500.00 (started 2026-08-09T13:18:49Z) |
| Current balance | $482.30 |
| Peak balance | $500.00 |
| Net P&L | -$17.74 (-3.54%) |
| Total profit (wins) | $6.96 |
| Total loss (losses) | $24.70 |
| Total closed trades | 147 (win 41 / loss 106) |
| Win rate | 27.9% |
| Max drawdown | $4.11 |
| Avg trade duration | 1152 min (~19.2 hours) |
| Open positions | 2 |
| Best trade | ADAUSDT SELL, +$0.82 |
| Worst trade | XRPUSDT SELL, -$0.79 |

Note: `GET /api/v1/virtual/trades` (paginated trade list) reports `total: 164`, not 147 — 17 more than the closed-trade count in `/performance`. Likely explanation: `/trades` includes still-open (2) and cancelled/expired trades (status `cancelled`, e.g. a LINKUSDT and a BTCUSDT trade both closed with `exitReason: "EXPIRED"`, `pnl: 0`) that `/performance`'s totalTrades doesn't count. Flagging as a reconciliation item to confirm, not yet calling it a bug — 147 (closed win/loss) + 2 (open) + ~15 (cancelled/expired) ≈ 164 is consistent.

### Open positions right now (real, from `GET /api/v1/guide/positions`)

1. **ADAUSDT SELL** — entry $0.2004, current $0.2011, P&L -0.35% (-$0.08ish), opened 2026-08-28T21:56Z, recommendation: HOLD, reason: "Nothing has changed since you opened this."
2. **MATICUSDT BUY** — entry $0.3794, current $0.3794, P&L **exactly 0%**, opened **2026-08-10T07:27:48Z — almost 19 days ago**. This is the same MATICUSDT position flagged in the prior session's audit as stuck because `MATICUSDT` has Binance `status: "BREAK"` (trading suspended, MATIC→POL migration). **CONFIRMED STILL BROKEN, 19 days later — currentPrice is frozen exactly at entryPrice, meaning live price lookups are still failing/falling back for this symbol and the position is still unclosable via normal means.** This is a real, reproducible, ongoing bug — not fixed by anything since the last audit.

### Live AI decisions — real `/predict` calls (ai-service, same-origin, 2026-08-29 ~04:56Z), all 9 requested assets

| Asset | Direction | Decision | Confidence | Raw Conf | Entry | SL | TP | RSI | MACD hist | EMA20 | Regime | News (score/count) | Social (score/sentiment/manip) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| BTCUSDT | HOLD | **WAIT** | 34.9 | 100 | 77649.31 | – | – | 36.06 | -7.17 | 78167.39 | SIDEWAYS | 49.6 / 155 art. neutral | 52.1 neutral, no manip |
| ETHUSDT | HOLD | **WAIT** | 34.9 | 100 | 2440.32 | – | – | 39.57 | -0.20 | 2454.69 | SIDEWAYS | 45.9 / 122 art. negative | 56.7 bullish, no manip |
| SOLUSDT | HOLD | **WAIT** | 34.9 | 100 | 103.91 | – | – | 43.15 | -0.07 | 104.55 | SIDEWAYS | 60.5 / 24 art. positive | 64.3 bullish, no manip |
| BNBUSDT | HOLD | **WAIT** | 34.9 | 99.1 | 690.09 | – | – | 35.33 | -0.03 | 694.46 | SIDEWAYS | 59.2 / 3 art. positive | 52.5 bullish, no manip |
| XRPUSDT | SELL | **AVOID** | 33.4 | 77.0 | 1.384 | 1.4054 | 1.3484 | 40.02 | 0.0003 | 1.394 | SIDEWAYS | 48.9 / 14 art. neutral | 57.4 bullish, no manip |
| DOGEUSDT | HOLD | **WAIT** | 29.7 | 60.9 | 0.08512 | – | – | 40.87 | 0 | 0.0857 | SIDEWAYS | no data / 0 art. | 52.5 bullish, no manip |
| ADAUSDT | SELL | **SELL** | 34.9 | 93.5 | 0.2011 | 0.204456 | 0.195507 | 35.19 | 0 | 0.204 | DOWNTREND | 52.7 / 13 art. positive | 52.5 bullish, no manip |
| AVAXUSDT | HOLD | **WAIT** | 34.7 | 82.2 | 7.304 | – | – | 44.41 | 0.0013 | 7.3242 | SIDEWAYS | 50.0 / 4 art. neutral | 52.5 bullish, no manip |
| LINKUSDT | HOLD | **WAIT** | 34.9 | 99.8 | 11.36 | – | – | 38.13 | -0.0082 | 11.4881 | SIDEWAYS | 51.6 / 13 art. neutral | 52.5 bullish, no manip |

Decision-type coverage so far: 7× WAIT, 1× SELL (actionable), 1× AVOID. No BUY seen yet in this pass — will keep sampling over the next hours to try to catch one.

**AVOID case worth noting (XRPUSDT):** `direction: SELL` but `decision: AVOID`. `sources.market.trend_alignment: "bullish"` while direction is SELL — i.e. the multi-timeframe trend is fighting the short-term lean, which is exactly the "mtf_fights" AVOID trigger from the T-065 design the owner approved. `manipulation_detected: false` and no funding-rate data available (`funding_rate: null` on every asset — worth investigating why; possibly not wired into the predict response even though it's used internally for the contrarian-bias adjustment). This is a real, correctly-labeled AVOID example, not fabricated.

**SELL case (ADAUSDT):** no risk flags (manipulation false, trend_alignment neutral) → decision correctly equals direction (SELL = SELL), confirming the derived-label design doesn't relabel a clean signal.

### Real live "what should I do" recommendation (guide pipeline, separate from signal_engine.py above)

`GET /api/v1/guide/suggestion` (2026-08-29T04:47:54Z, live): **DOGEUSDT SELL**, confidence "fairly confident", entry $0.085, SL $0.086146, TP $0.08309, risk Medium, reasoning: "Price momentum has been building — a common early sign of a falling move" + "Social media chatter about it right now is mostly bullish." — `decision` field here also reads "SELL" (not WAIT/AVOID); will keep sampling this endpoint over time to see if it ever surfaces WAIT/AVOID, since it only returns a single best-scored candidate per call (this is the unified_analyzer/global_analyzer pipeline behind the Guide screen, architecturally separate from signal_engine.py's /predict tested above).

### Gold/Forex support — confirmed from real trade history

Found a real, already-closed **XAUUSD (Gold) BUY** trade in the trade history: opened 2026-08-28T17:14:30Z, entry $4674.80, exit $4649.34 (stop-loss hit 6 minutes later), P&L -$0.14 (-0.54%). **XAUUSD is SUPPORTED** — confirmed by an actual executed paper trade, not just a code check. Will still test Forex pairs (EURUSD etc.) directly against /predict to check support there.

### Repetition-test raw material found in existing trade history (not yet analyzed in depth)

Trade history shows a cluster of ~10 ETHUSDT SELL trades all opened/closed within about an hour on 2026-08-26 (12:43–13:34Z), all at the *exact same* entry price (2465.31) and same SL/TP (2494.10 / 2417.32), each held 0–6 minutes, exitReason "MANUAL" each time, tiny alternating P&L (+$0.06 to +$0.21). This pre-dates tonight's session — it's leftover history, not something I generated. Flagging for the report as a pattern worth explaining (looks like earlier rapid manual testing, not the AI creating fake activity, since exitReason is MANUAL not an AI-driven trigger) rather than drawing a conclusion prematurely.

Continuing: Forex support check, funding-rate/macro endpoints, notifications check, more /predict sampling to catch a BUY example and test decision-repetition over a real time gap, and a controlled trade experiment via the same authenticated-API method (since literal UI clicks are blocked in this session) — will document that substitution explicitly if used.

## Forex / Metals / Macro support check (2026-08-29 ~05:00 UTC)

Tested `/api/predict` (ai-service, live model inference) against non-crypto assets to determine SUPPORTED/PARTIALLY SUPPORTED/NOT SUPPORTED status:

| Asset | Result |
|---|---|
| EURUSD | Live prediction returned — WAIT decision. **SUPPORTED** |
| GBPUSD | Live prediction returned — WAIT decision. **SUPPORTED** |
| USDJPY | Live prediction returned — SELL decision. **SUPPORTED** |
| XAGUSD (Silver) | Live prediction returned — WAIT decision. **SUPPORTED** |
| XAUUSD (Gold) | Live prediction returned — WAIT decision. **SUPPORTED** (also independently confirmed earlier via a real closed Gold trade in trade history) |

Conclusion: Forex majors and metals are genuinely supported by the same `/predict` pipeline as crypto, not crypto-only as I initially assumed I'd need to check. This is real, not inferred from code reading.

### Macro data endpoints

- `GET /api/macro/snapshot` → returned real data, `macro_sentiment: "bullish"`.
- `GET /api/macro/funding-rates` → returned real funding-rate data across pairs.
- `GET /api/macro/fear-greed` → returned a real Fear & Greed index value.
- `POST /api/global/scan` (same approx timestamp) → returned `macro_sentiment: "neutral"`.

**Discrepancy flagged, not yet root-caused**: `/api/macro/snapshot` said "bullish" while `/api/global/scan` said "neutral" within the same short window. Two possible explanations not yet distinguished: (a) different sentiment computation/aggregation logic in the two code paths, or (b) different cache/refresh timing. Needs source-level comparison before the final report can state a cause — flagging as-is rather than guessing.

### Global scan result

`POST /api/global/scan` (capital=500, timeframe=1h, top_n=5): **13 assets scanned, 13 blocked by the quality filter (MIN_CONFIDENCE / MIN_FUSED_SCORE), 0 passed, best candidate: null.**

This means the Guide screen's *primary* suggestion source (GlobalAnalyzer) found nothing worth recommending across the whole scanned universe at this moment — consistent with the earlier live `guide/suggestion` result falling back to the signal_engine.py stored-Signal path (DOGEUSDT SELL) rather than the primary GlobalAnalyzer path. This fallback behavior is real and working as designed, not a bug — but it's worth noting in the report that the "smarter"/higher-bar analyzer is rarely if ever the one actually driving real suggestions in current market conditions.

## Real paper trade opened via the actual "Approve" code path (2026-08-29 04:58:26 UTC)

Followed the AI's live recommendation with no manual cherry-picking, via `POST /api/v1/guide/suggestion/approve` — this hits the exact same server-side handler the UI's "Approve" button calls (confirmed by reading `guideController.js::approve`, which re-resolves the suggestion server-side rather than trusting client input).

- Asset: **DOGEUSDT**, direction **SELL**
- Entry: $0.085 | Stop Loss: $0.086146 | Take Profit: $0.08309
- Position size: $24.11 USD
- Trade `_id`: `6a9266f2db63d12a8112f88d`
- Source `signalId`: `6a92647adb63d12a8112f7bc`
- Status at open: `open` (not yet closed — will check back for outcome: win/loss/SL-hit/TP-hit)

## Notification system — real architecture findings (2026-08-29 ~05:00 UTC)

Traced actual code (`notificationService.js`, `virtualTrackingService.js`) and confirmed with live calls against the test account:

- `GET /api/v1/notifications?limit=10` → `{"data":[],"total":0}` — empty, but expected since this is a brand-new test account with no signal history under its own user id (notifications are user-scoped even though the portfolio itself is a shared global singleton).
- `POST /api/v1/notifications/test` → `{"success":false,"reason":"no_token"}` — expected: no FCM token registered for this account, consistent with the already-known "Firebase push can't work in local dev" limitation. This is a **pre-existing, disclosed limitation**, not a new bug.
- **Architecture finding**: `persistNotification()` in `notificationService.js` only writes to the in-app `Notification` collection (the one the UI's notification bell would read from) for `type: 'signal'`. `sendTradeClosedNotification()` (fired when a trade closes) is **push/Telegram-only** — it never persists to the in-app notification list. Grepping `virtualTrackingService.js` found **no notification-creation code at all for trade-OPEN events** — opening a trade currently produces no notification of any kind, in-app or push.
- **Implication for the report**: a user who only looks at the in-app notification bell (not push, not Telegram) will see signal notifications but will never see "your trade opened" or "your trade closed" notifications there — those only reach push/Telegram, which don't work in this local environment. This is worth flagging as a real product gap under "Things That Need Improvement," separate from the Firebase-credentials limitation itself.

## DOGEUSDT trade check-in + real trade-count reconciliation (2026-08-29 05:05 UTC)

`GET /api/v1/guide/positions` (real, live): 3 open positions —
- DOGEUSDT SELL, entry $0.085, current $0.0853, **-0.35% unrealized**, opened 04:58 UTC (the trade opened earlier this session, still open, moving slightly against us so far — honest, not cherry-picked)
- ADAUSDT SELL, entry $0.2004, current $0.2014, -0.5% unrealized
- MATICUSDT BUY, entry $0.3794, current $0.3794, **0% — still the same frozen price, still stuck** (MATICUSDT remains status `BREAK` on Binance; this bug is still present, now confirmed stuck for 19+ days)

`GET /api/v1/virtual/performance` (real): startingBalance $500, currentBalance $482.30, netProfit -$17.70 (-3.54%), totalTrades **147** (closed only), winCount 41, lossCount 106, winRate 27.9%, openTrades 3, maxDrawdown $4.11 — unchanged from the earlier snapshot, confirming these are stable, real numbers, not placeholders.

`GET /api/v1/virtual/trades/history?limit=5` (real): total **162**.

**Trade-count reconciliation, still not fully resolved**: 147 closed + 3 open = 150, but `trades/history` reports total **162**. That leaves 12 trades unaccounted for by simple addition. Not guessing at a cause — flagging as an unresolved data-consistency question for the report rather than inventing an explanation.

**Real BUY examples found** (addresses the earlier gap — no live `/predict` BUY had been observed yet, but trade history proves the AI does produce BUY decisions and they get taken): from the same history page —
- SOLUSDT BUY @ $99.13 → closed_profit via TP, +$0.64 (+2.78%), held 8 minutes (2026-08-28)
- BTCUSDT BUY @ $78,865.34 → closed_loss via SL, -$0.18 (-0.92%), held 6 minutes (2026-08-28)
- LINKUSDT BUY @ $11.496 → closed_loss via SL, -$0.23 (-1.67%), held 92 minutes (2026-08-28)
- XAUUSD BUY @ $4,674.80 (Gold) → closed_loss via SL, -$0.14 (-0.54%), held 6 minutes (2026-08-28)

So BUY decisions are real and do get executed — they just weren't present in the narrow live sampling window checked earlier tonight. Worth noting: 3 of these 4 recent BUY trades lost, only 1 won — small sample, but consistent with the overall 27.9% win rate.

## Repetition-test "BEFORE" snapshot — live `/predict` re-sampled (2026-08-29 05:05:03 UTC)

Same 9 crypto assets, sampled fresh (not the same cached call as the earlier XRP AVOID observation). Captured for a genuine before/after comparison after a real elapsed time gap:

| Asset | Decision | Direction | Confidence | Raw Conf | Regime | Reason (RF/TF/News) |
|---|---|---|---|---|---|---|
| BTCUSDT | WAIT | HOLD | 34.9 | 100 | SIDEWAYS | RF:SELL[73%] TF:HOLD[44%] News:neutral(155 articles) |
| ETHUSDT | WAIT | HOLD | 34.9 | 96.1 | SIDEWAYS | RF:SELL[83%] TF:HOLD[44%] News:negative(122 articles) |
| SOLUSDT | WAIT | HOLD | 34.9 | 100 | SIDEWAYS | RF:SELL[57%] TF:SELL[37%] News:positive(24 articles) |
| BNBUSDT | WAIT | HOLD | 34.9 | 100 | SIDEWAYS | RF:SELL[60%] TF:HOLD[41%] News:positive(3 articles) |
| XRPUSDT | WAIT | HOLD | 29.7 | 61.1 | SIDEWAYS | RF:BUY[59%] TF:SELL[47%] News:neutral(14 articles) |
| DOGEUSDT | WAIT | HOLD | 34.9 | 95.3 | SIDEWAYS | RF:BUY[81%] TF:SELL[48%] |
| ADAUSDT | **SELL** | SELL | 34.9 | 88.2 | DOWNTREND | RF:BUY[72%] TF:SELL[42%] News:positive(13 articles) |
| AVAXUSDT | WAIT | HOLD | 34.9 | 97.3 | SIDEWAYS | RF:BUY[55%] TF:SELL[39%] |
| LINKUSDT | WAIT | HOLD | 34.9 | 100 | SIDEWAYS | RF:BUY[48%] TF:HOLD[63%] |

**Already-visible change vs the earlier session**: XRPUSDT was AVOID (mtf_fights triggered) in the first sampling pass tonight; it is now plain WAIT with no risk flag. That's a genuine decision change across real elapsed time — good evidence against "the AI just repeats the same frozen output."

**New observation flagged for the Bugs/Improvements section, not yet explained**: final `confidence` is **exactly 34.9** for 7 of the 9 assets (everything except XRPUSDT at 29.7), despite `raw_confidence` varying widely per-asset (61.1 to 100) and each asset having a completely different RF/TF/news mix. This looks like the post-calibration confidence for WAIT/HOLD-type outputs may be collapsing to a near-constant value rather than genuinely reflecting per-asset uncertainty. Need to re-check after the AFTER-snapshot and, if it reproduces identically at 34.9 again next round, treat as a real product finding (isotonic calibration possibly over-flattening HOLD-class outputs) rather than coincidence.

This snapshot is saved as the repetition-test BEFORE baseline. An AFTER re-sample will follow after a genuine time gap to complete the repetition test the user specifically asked for.

## Repetition test — "AFTER" snapshot + comparison (2026-08-29 05:45-05:50 UTC, ~40-45 min after BEFORE)

| Asset | BEFORE decision (conf) | AFTER decision (conf) | Changed? |
|---|---|---|---|
| BTCUSDT | WAIT (34.9) | WAIT (34.9) | No — but see BUG-001 below (huge latency this cycle) |
| ETHUSDT | WAIT (34.9) | WAIT (34.9) | No |
| SOLUSDT | WAIT (34.9) | WAIT (34.9) | No |
| BNBUSDT | WAIT (34.9) | WAIT (34.9) | No |
| XRPUSDT | WAIT (29.7) | **SELL (34.9)** | **YES — direction flipped HOLD→SELL** |
| DOGEUSDT | WAIT (34.9, raw 95.3) | WAIT (30.2, raw 63.4) | Same decision, confidence genuinely moved |
| ADAUSDT | SELL (34.9, raw 88.2) | SELL (34.9, raw 98.5) | Same decision, raw confidence moved |
| AVAXUSDT | WAIT (34.9, raw 97.3) | WAIT (34.9, raw 91.4) | Same decision, raw confidence moved |
| LINKUSDT | WAIT (34.9, raw 100) | WAIT (34.9, raw 100) | No — identical both times |

**Conclusion on the user's biggest concern (fake/repeated activity)**: this is genuine evidence against blind repetition. Across a real ~45-minute gap, most assets held steady (expected — market didn't move much), but XRPUSDT's decision **actually flipped from WAIT to SELL** as conditions changed, and DOGEUSDT/ADAUSDT/AVAXUSDT confidence values genuinely shifted with fresh data even where the final decision label stayed the same. LINKUSDT alone was byte-for-byte identical both times — worth another check next cycle to see if it ever moves, but one static asset out of nine over 45 minutes in a sideways market is not evidence of systemic fakery.

**Revised note on the "flat 34.9" observation**: no longer looks like a hard-coded constant — DOGEUSDT showed 30.2 this round (vs 34.9 last round) and the original XRPUSDT WAIT showed 29.7. Working theory now: the isotonic calibrator appears to plateau/saturate around ~34.9 for a wide band of high raw_confidence inputs (85-100%), while clearly differentiating lower raw_confidence inputs (60s) into distinctly lower final numbers (~29-30). This looks like plausible calibration curve behavior, not a bug — flagging as a UX observation rather than a defect: a user watching multiple assets sit at "34.9% confidence" repeatedly may reasonably wonder if the number is meaningful, even though the underlying reasoning genuinely differs per asset.

## BUG-001 (real, reproduced): BTCUSDT `/predict` occasionally hangs ~5 minutes

**Severity**: HIGH (would look like a frozen app to a real user).

**Repro**: Fired a `POST /api/predict {"asset":"BTCUSDT","interval":"1h"}` at ~05:44:38 UTC. It did not resolve until somewhere between 05:49:13 and 05:49:53 UTC — approximately **4.5 to 5 minutes**, versus ETHUSDT/SOLUSDT/etc. resolving in single-digit seconds under the same conditions moments earlier and later. `GET /api/health` on ai-service remained responsive (`success:true`) the entire time BTC's request was hanging, so the whole service was not down — this was isolated to that one in-flight request.

**Result once it finally returned**: valid data, same WAIT/HOLD decision as before the hang, confidence still 34.9 — so the hang did not corrupt the result, it just took far too long.

**Likely cause (not confirmed, not guessed as fact)**: BTCUSDT's news component pulled 155 articles (the largest of any asset tested tonight) — a slow or retrying external news/data fetch is a plausible cause, but this needs a source-level check (timeouts/retry logic around the news fetch or Binance candle fetch) to confirm. Not fixed tonight — this is a latency anomaly discovered during passive testing, not something safe to patch blind without seeing the actual slow call.

**Retest**: Re-ran BTCUSDT status differently is scheduled for a later cycle to see if this reproduces again or was a one-off (e.g., a transient upstream rate-limit).

## BUG-002 (real, reproduced): concurrent `/predict` calls fail with false "Insufficient market data" while another request is stuck

**Severity**: HIGH — directly relevant to `/api/global/scan`'s earlier "13 scanned, 13 blocked, 0 passed" result, which likely scans multiple assets concurrently.

**Repro**: While the BTCUSDT hang above was still in flight (unresolved), fired 7 more `/predict` calls concurrently (SOLUSDT, BNBUSDT, XRPUSDT, DOGEUSDT, ADAUSDT, AVAXUSDT, LINKUSDT — all kicked off in the same tick, not awaited sequentially). **All 7 immediately failed** with `{"detail":"Insufficient market data for <ASSET>"}` (HTTP 422) — despite every one of those same assets returning valid, complete data moments earlier and moments later when called sequentially.

**Isolation test**: Ran 2 clean concurrent calls (SOLUSDT + BNBUSDT) with nothing else in flight — both succeeded normally. This means concurrency alone isn't the trigger; it's concurrency **while another request (BTCUSDT) was already stuck/hung** that caused the pile of failures.

**Likely cause (not confirmed)**: some shared resource — a connection pool, a rate limiter, a single-slot cache/lock around candle fetching — appears to get starved or corrupted while one request is stuck, causing sibling concurrent requests to fail fast with a misleading "insufficient data" message (this is presumably the fallback error path for ANY data-fetch failure, not literally "too few candles returned"). This would directly explain why `/api/global/scan` (which likely fans out concurrently across its full asset universe) returned 13/13 blocked with best=null earlier tonight — if one asset's fetch stalls, it may cascade into false rejections across the whole scan, masking real signal quality with a data-plumbing bug.

**Product impact if confirmed**: this would mean the Guide screen's "smarter" primary suggestion engine (GlobalAnalyzer) could be silently failing far more often than its confidence-filter design would suggest — not because the market lacks good setups, but because of a concurrency bug in the data layer. This is a strong candidate for the most important backend bug found tonight and needs source-level confirmation (checking `data_processor.get_candles()` and whatever underlying HTTP client/session it shares across concurrent requests).

## Other real observations this cycle (05:45-05:50 UTC)

- `GET /api/v1/health` briefly reported `"database":"disconnected"` at 05:47:49 UTC, then `"connected"` again by 05:48:26 UTC (~37 seconds later) — a real, observed transient MongoDB reconnect blip. The `guide/positions` read that happened at the same moment still returned correct, complete data, so this did not visibly break anything user-facing this time. Noting it as an observed transient event, not a sustained outage.
- DOGEUSDT open position: entry $0.085, price moved from $0.0853 → $0.08516, unrealized P&L improved from -0.35% to -0.19%. Still open.
- ADAUSDT open position: entry $0.2004, price moved from $0.2014 → $0.2017, unrealized P&L worsened from -0.5% to -0.65%. Still open.
- MATICUSDT: still frozen at exactly $0.3794 / 0% P&L — still stuck (confirms the exchange-halt bug persists).

## Root cause found for BUG-001 and BUG-002 (code-level, read-only investigation, 2026-08-29 06:27-06:29 UTC)

Traced the actual code path (no edits made, per standing "no blind changes" constraint):

- `ai-service/app/services/data_processor.py::fetch_market_data()` opens a **fresh `aiohttp.ClientSession()` per request** to Binance, with a hard 10s timeout. On any non-200 response it just returns `None` (logged as a warning), which `routes.py`'s `/predict` handler turns into the generic `"Insufficient market data for {asset}"` 422 — so that message doesn't necessarily mean literally too little historical data; it also fires on ANY Binance fetch failure, including a rate-limit response. Firing 7 `/predict` calls at the same instant means 7 near-simultaneous fresh Binance kline requests from the same process — a very plausible way to trip Binance's own per-IP rate limiting and get several "insufficient data" 422s that are actually rate-limit responses in disguise.
- More significantly: `ai-service/app/services/news_analyzer.py`'s `NewsAnalyzer` is instantiated **once** as part of the module-level `signal_engine` singleton (`app/services/signal_engine.py` line 124) and reused for every request — its `refresh()` method has a 30-minute in-memory cache (`self._cache`) with **no lock/single-flight guard**. When the cache is cold, `refresh()`: (1) fetches all news concurrently (fine, ~8s worst case), then (2) runs one FinBERT sentiment pass over the global headline set, **then loops sequentially over all 10 entries in `ASSET_KEYWORDS`** (BTCUSDT, ETHUSDT, BNBUSDT, SOLUSDT, XRPUSDT, ADAUSDT, DOGEUSDT, AVAXUSDT, LINKUSDT, MATICUSDT) doing **one more full FinBERT `analyze()` call per asset, awaited one at a time** (`await loop.run_in_executor(None, self.model.analyze, relevant)` inside a `for` loop — not batched, not parallelized). That's 11 sequential CPU-bound sentiment-model passes on every cache-refresh cycle. On this dev machine (also running MongoDB, the Flutter build, and the backend simultaneously), 11 sequential passes at a plausible ~25-30s each lines up almost exactly with the observed ~5-minute BTCUSDT hang — BTC's request most likely landed exactly when the 30-minute cache had just expired and had to wait through the entire 10-asset sequential sweep before its own prediction could complete. `SocialAnalyzer` (`social_analyzer.py`) has the identical no-lock cache pattern and is a very plausible second contributor.
- **This also plausibly explains BUG-002 directly**: while that sequential sweep is running, `self._cache` stays `None`/stale, so any OTHER concurrent `/predict` call for a different asset also sees a cache miss and can trigger its own redundant concurrent `collect_all_news()` + sentiment sweep, or simply queues behind the first one's executor-thread usage — combined with the per-request fresh-Binance-session pattern above, this is a strong, code-supported explanation for why firing several asset predictions around the same moment produced a wave of failures.

**Conclusion for the report**: this is a real architectural gap, not a one-off fluke — no caching lock around an expensive shared resource, plus a sequential (not batched/parallel) per-asset sentiment loop that blocks the very request that happened to trigger it. Severity: HIGH. This directly threatens the "does the AI actually respond in real time" experience a real user would have, and is a strong candidate explanation for the earlier `/api/global/scan` result (13 scanned, 13 blocked, 0 passed) if that scan fans out concurrently across assets and hits this same cold-cache stampede. Recommended fix (not applied tonight, per standing "no unilateral architecture changes" constraint): add an `asyncio.Lock` around `refresh()` so concurrent callers await one in-flight refresh instead of each starting their own, and either batch the per-asset FinBERT calls or run the whole refresh in a background task decoupled from the request that happens to trigger it.

## Position check-in (2026-08-29 06:29 UTC)

- DOGEUSDT SELL: entry $0.085 → now $0.08429, unrealized **+0.84%** (still open, now the best-performing open position — up from -0.35% at 05:05 UTC and -0.19% at 05:47 UTC. Real, continuous movement, not static.)
- ADAUSDT SELL: entry $0.2004 → now $0.1999, unrealized **+0.25%** (flipped from -0.5%/-0.65% earlier to positive now)
- MATICUSDT: still frozen at $0.3794 / 0% — still stuck (confirmed again, 3rd consecutive check)
- Backend health: database back to "connected" (the 05:47 transient disconnect self-healed and has not recurred)
- Performance snapshot unchanged: balance $482.30, totalTrades 147, winRate 27.9% — stable, no new closes yet this cycle

Enough real evidence has now accumulated across multiple testing dimensions (multi-asset AI decisions incl. Forex/Gold, real trade history with wins/losses, a genuine repetition test across two real time gaps, two reproduced + root-caused backend bugs, the MATICUSDT stuck-position bug, notification architecture, an unreconciled trade-count discrepancy, and a transient DB blip) to begin compiling the final report. Continuing to monitor in the background while drafting.

## Cycle 4 (2026-08-29 07:18-07:20 UTC) — BUG-002 broadened, positions still open, global/scan re-confirmed

**New finding — "Insufficient market data" reproduces WITHOUT concurrency too.** Fired isolated, sequential (not concurrent) `/predict` calls: BTCUSDT alone failed after 10.5-11.3s with `"Insufficient market data for BTCUSDT"`; ETHUSDT (called right after, also alone) failed the same way after 11.0s; SOLUSDT (called right after that) succeeded normally in 9.3s. The ~10-11s failure timing lines up almost exactly with the hard-coded `aiohttp.ClientTimeout(total=10)` on the Binance kline fetch in `fetch_market_data()` — meaning the Binance HTTP call itself is timing out, not a downstream cache/lock issue. After waiting 15 seconds and retrying BTCUSDT alone, it succeeded in 2.9s.

**Revised understanding of BUG-002**: this is broader than "only fails under deliberate concurrency" — it's better described as **intermittent Binance connectivity/rate-limiting from this environment**, which concurrency makes worse (more simultaneous requests = more likely to trip it) but which also happens sporadically on isolated, sequential calls. Combined with the earlier finding that `fetch_market_data()` opens a brand-new `aiohttp.ClientSession()` per request with no shared rate-limiting or retry/backoff, this is consistent with hitting Binance's per-IP rate limits after a lot of rapid-fire testing tonight (much of it from this session). A real user making occasional, spaced-out requests would likely hit this far less often than I did tonight — but a real user with multiple screens open, or the Guide's own periodic scan, could still hit it. Severity unchanged (HIGH), but reframing: this is a resilience/retry-logic gap in the Binance client, not purely a request-ordering race.

**`/api/global/scan` re-checked**: still `scanned:13, passed_filter:0, blocked:13, best:null` — identical shape to the ~05:00 UTC check, ~2 hours apart. `macro_sentiment` this time reads `"mild_bear"` (a third distinct value seen tonight, after "bullish" and "neutral") — `signal_weights` shows macro is weighted heaviest (0.4635) in the fusion formula. Being honest about the uncertainty here: two consistent 13/13-blocked reads 2 hours apart could mean (a) the concurrency/timeout bug from BUG-002 is silently killing every candidate before scoring, OR (b) genuinely mixed/bearish market conditions tonight mean nothing clears the quality bar, OR both. I cannot fully separate these two explanations with the evidence gathered tonight — flagging as still-open rather than asserting the bug is the sole cause.

**Positions**: DOGEUSDT SELL now **+0.67%** unrealized, ADAUSDT SELL now **+0.05%** unrealized (both still open, both still positive, no closes yet). MATICUSDT still frozen at 0%. Backend health fully green (backend online, database connected, aiService connected).

**Report update**: revising BUG-002's description in OVERNIGHT_VALIDATION_REPORT.md to reflect the broader "intermittent Binance timeout, not concurrency-only" finding, and softening the global/scan causal claim to reflect genuine uncertainty between a bug explanation and a real market-conditions explanation.

## Cycle 5 (2026-08-29 08:13-08:14 UTC) — stable, no material changes

- Backend health: all green (backend online, database connected, aiService connected).
- DOGEUSDT SELL: +0.81% unrealized (still open, still improving). ADAUSDT SELL: +0.50% unrealized (still open, still improving). MATICUSDT: still frozen at 0%.
- Performance snapshot unchanged: balance $482.30, totalTrades 147, winRate 27.9%, openTrades 3 — no new closes yet.
- Quick BTCUSDT `/predict` spot-check: 1.0s, 200 OK, WAIT — healthy this cycle, consistent with BUG-001/002 being intermittent rather than constant.

No material change vs the last report update — not re-sending the report this cycle, just logging confirmation per the monitoring-phase instructions.

## Cycle 6 (2026-08-29 09:10-09:12 UTC) — BUG-001 reproduced a 3rd time, positions still stable

- Backend health: all green.
- DOGEUSDT SELL: +0.74% unrealized (still open). ADAUSDT SELL: +0.30% unrealized (still open). MATICUSDT: still frozen at 0%. No closes yet — both trades have now been open for 4+ hours without hitting SL/TP, oscillating positive.
- Performance snapshot unchanged: balance $482.30, totalTrades 147, winRate 27.9%.
- BTCUSDT `/predict` spot-check: hung again past the 45s check window (3rd time reproduced tonight, following the ~05:44 and now this one) — confirms BUG-001 is a real, recurring issue, not a one-off. Not waiting out the full multi-minute resolution this cycle since the pattern is already well-documented; noting the reproduction and moving on.
- Also observed in the tab's accumulated network log: a cluster of `422 Unprocessable Entity` responses on `/predict` interleaved with 200s across earlier calls this session — consistent with BUG-002's intermittent-failure pattern, no new isolation test needed, already well-documented.

No change to the report's conclusions — findings already covered. Not re-sending the report this cycle.

## Cycle 7 (2026-08-29 10:08-10:09 UTC) — stable, no material changes

- Backend health: all green.
- DOGEUSDT SELL: +0.79% unrealized (still open, ~5h now). ADAUSDT SELL: +0.40% unrealized (still open). MATICUSDT: still frozen at 0%.
- Performance snapshot unchanged: balance $482.30, totalTrades 147, winRate 27.9%.

No material change. Not re-sending the report this cycle.

## Cycle 8 (2026-08-29 11:06-11:07 UTC) — stable, no material changes

- Backend health: all green.
- DOGEUSDT SELL: +0.62% unrealized (still open, ~6h now, pulled back slightly from +0.79% last cycle but still positive). ADAUSDT SELL: +0.15% unrealized (still open, pulled back from +0.40%). MATICUSDT: still frozen at 0%.
- Performance snapshot unchanged: balance $482.30, totalTrades 147, winRate 27.9%.

No material change. Not re-sending the report this cycle.

## User returned — real "last 24 hours" pull requested (2026-08-29 16:29-16:30 UTC)

User explicitly asked for CURRENT numbers, not the all-time snapshot, and asked for a % success verdict. Pulled fresh data:

- Backend health: all green. DOGEUSDT still open (-0.26% now, dipped negative), ADAUSDT still open (0.00%, flat), MATICUSDT still frozen at 0%. **Neither DOGEUSDT nor ADAUSDT has closed since this morning** — both still open, unresolved.
- `/virtual/performance` totalTrades still 147 — UNCHANGED since ~05:05 UTC this morning (11+ hours), confirming no new trade has closed all day.
- Pulled `/virtual/trades/history?limit=30` and filtered to the real last-24-hour window (2026-08-28T16:29:57Z → 2026-08-29T16:29:57Z): **14 trades have a closedAt in that window, but the most recent closedAt is 2026-08-28T21:41:04Z — nothing has closed in the last ~18.8 hours.** Of those 14: 2 wins (SOLUSDT +$0.64 TP, ADAUSDT +$0.82 TP), 7 losses (ADAUSDT -$0.12 manual, LINKUSDT -$0.23 SL, XAUUSD -$0.14 SL, BTCUSDT -$0.18 SL, SOLUSDT counted above, BNBUSDT -$0.24 SL, ETHUSDT -$0.29 SL, BNBUSDT -$0.24 SL — 7 total losses), 5 cancelled/EXPIRED (0 pnl, not wins or losses: LINKUSDT, BTCUSDT, XRPUSDT, DOGEUSDT, AVAXUSDT). **Real last-24h decided win rate: 2/9 = 22.2%, loss rate: 7/9 = 77.8%** — worse than the 27.9% all-time figure. IMPORTANT CAVEAT noted for honesty: 12 of these 14 trades closed within the same ~30-minute window yesterday afternoon (17:10-18:45 UTC on 08-28) in rapid batch-like succession (multiple exact-same-second closedAt timestamps), consistent with the earlier native/terminal session's rapid E2E validation batch rather than organic trades spread across the day — so this is a small, batch-heavy, not-fully-independent sample, not 14 separate real-time trading decisions across 24 hours.
- Re-checked BTCUSDT `/predict`: healthy, 2.7s, WAIT. Re-checked `/api/global/scan`: still `scanned:13, passed:0, blocked:13`, now macro_sentiment="neutral" — this is the **3rd consecutive check across ~11.5 hours (05:00, 07:20, 16:30) all showing 0/13 passing**, strengthening the case that this is a persistent, systemic issue in the scan path rather than a one-off market condition or transient Binance flakiness.

Reporting this real, current data directly to the user now, with an honest caveat about the batch-clustering in the "last 24h" sample.
