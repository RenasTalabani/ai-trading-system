# AI TRADING ADVISOR — NIGHT 2 EXTENDED VALIDATION LOG
Started 2026-08-29 ~21:31 UTC, per owner's request for continuous real-user testing until they wake up.
Continuation of tonight's earlier pass (T-065..T-070, all merged to master at 6bf86ca). This log covers the NEW, broader testing scope: full-lifecycle paper trading, all assets, load testing, notifications, DB consistency, and a real AI-performance analysis — not fabricated, every entry traces to an actual API response.

## 21:31 UTC — Merge status confirmed
`master` HEAD = `6bf86ca` (merge: fix/rl-weight-bounds T-069/T-070). Confirmed via `git log master -1`. Clean.

---

## 21:33-21:40 UTC — Cycle 1: Auth, Dashboard/Guide, all 14 assets, full paper-trade lifecycle, notifications, error handling

**Auth/permissions (real, live)**: register → 200 + token. Login correct password → 200. Login wrong password → 401 "Invalid email or password." No token on protected route → 401. Malformed/garbage token → 401. Regular user hitting an admin-only route (`/budget/start`) → 403. **All correct. WORKING.**

**Guide suggestion (dashboard's primary AI Advisor card)**: `GET /guide/suggestion` → 200, real BNBUSDT SELL suggestion with entry/SL/TP, riskLevel, confidenceWords, human-readable `why[]` reasons. This is the fallback path (GlobalAnalyzer's primary path is still 0/13, documented earlier tonight) — fallback confirmed working correctly, not silently broken.

**All 14 tracked assets, /predict, fired concurrently (also a real concurrency test)**: 14/14 returned 200 in 4.16s total, zero failures, zero hangs.
- Crypto (9): BTC/BNB/DOGE/AVAX/LINK/SOL → BUY, ADA → WAIT, ETH/XRP → **AVOID** (T-065 label correctly distinguishing "no edge" WAIT from "actively risky" AVOID — both real, differentiated reasoning, not copy-pasted).
- Forex (3, EURUSD/GBPUSD/USDJPY) and Metals (2, XAUUSD/XAGUSD): all return real WAIT/BUY decisions with technical (RF/TF) reasoning.
- **New honest finding, not previously documented**: forex/metals `reason` strings have no News/Social line at all (crypto assets do) — the news/social sentiment layer appears to only cover the 10 crypto `ASSET_KEYWORDS`, so forex/metals decisions currently run on technical signals only. Not necessarily wrong (there may be no crypto-style news feed for EURUSD), but it's an asymmetry worth the owner knowing about, not previously flagged in tonight's earlier report.
- Confidence still plateaus at 34.9 for most high-raw_confidence assets (previously noted, still true — UX observation, not confirmed bug).

**Paper trading — full real lifecycle, done live, not simulated**:
1. Pulled a real Guide suggestion (BNBUSDT SELL @ 693.42, SL 697.19, TP 687.13, $24.11).
2. Approved it via the exact endpoint the UI's Approve button calls → trade `6a935023c3e8682a2652de68` opened, status `open`, all fields populated correctly.
3. Balance/trade-count before manual close: balance $482.12, 149 total trades, 6 open.
4. Closed it manually via `POST /guide/positions/:tradeId/sell` → 200, exit 692.92, **pnl +$0.02 (+0.07%), result "win"**.
5. Balance/trade-count after: balance $482.14 (+$0.02, exactly matches), 150 total trades (+1), 5 open (-1). **Every number reconciles exactly. WORKING, verified end-to-end.**

**Notifications — BUG-004 now directly observed, not just code-reviewed**: this same test account (which existed before the open+close events, unlike my earlier failed check) shows both `trade_open` ("🟢 BNBUSDT SELL opened — Entry: $693.42 · Size: $24.11") and `trade_closed` ("✅ BNBUSDT SELL — MANUAL — P&L: +$0.02 (+0.07%) · Balance: $482.14") in `GET /api/v1/notifications`. **This closes the gap from earlier tonight where I could only confirm the code path, not the actual record. Confirmed WORKING with direct evidence.**

**Error handling / edge cases on /predict**: invalid asset name → 422 (clean, no crash). Missing required field → 422 with a proper field-level validation message. Malformed JSON body → 422, no crash, no 500, no stack trace leaked. **WORKING correctly.**

---

## 21:45 UTC — Real AI trading performance analysis (full 165-trade history, own independent computation, not copied from WINRATE_DIAGNOSIS.md)

Pulled all 165 trades (paginated, `limit=100` is the real server-enforced max — `limit=200` is rejected by validation, a minor API detail, not a bug). Computed independently client-side, methodology disclosed:

- Status breakdown: 107 closed_loss, 43 closed_profit, 15 cancelled → 150 closed + 15 cancelled = 165 total. Matches `/virtual/performance`'s reported 150 exactly (DATA-001's earlier explanation re-confirmed, still holds).
- **Strict win rate (pnl>0 only): 27.3% (41/150)** — very slightly below the app's own reported 28.2%, because the app's own "win" label counts a $0.00-P&L halted-close (MATICUSDT) as a win; I used a stricter pnl>0 definition. Flagging this discrepancy honestly rather than picking whichever number looks better — the owner explicitly asked not to redefine win rate to reach a target, so I'm showing my exact method.
- **Profit factor: 0.28** (grossProfit $6.98 / grossLoss $24.88) — losing ~3.6x what it wins.
- **Expectancy per trade: -$0.119** — real, negative expected value per trade at current position sizing.
- **Max drawdown: 3.15% ($15.59)** off peak balance — small in absolute terms only because position sizing is small; the underlying edge is negative.
- **By exit reason**: SL hit 91 times (0 wins, by definition) — TP hit 18 times (18 wins, by definition) — MANUAL close 40 times (23 wins, 57.5%). Manual closes have a dramatically better win rate than the automatic SL/TP outcomes — consistent with WINRATE_DIAGNOSIS.md's earlier flag that the 1.5×ATR stop may be too tight (still an open, unresolved question, data on ATR-at-entry still not stored on `VirtualTrade`).
- **By direction**: BUY 91 trades, 22 wins (24.2%), net -$8.30. SELL 59 trades, 19 wins (32.2%), net -$9.60. SELL wins more often but loses more per losing trade — net P&L is worse for SELL despite the better win rate.
- **By asset**: ETHUSDT best win rate (21/30 = 70%) but only ~breakeven net (-$0.30, many small losses offsetting). XAUUSD is the only net-positive asset (+$0.63, 7/16 = 43.8%). LINKUSDT is the clear worst performer (2/41 = 4.9%, net -$7.89). DOGEUSDT and XRPUSDT: 0 wins across their small samples.
- **Standing caveat, still true**: this entire dataset carries WINRATE_DIAGNOSIS.md's earlier finding that ~76% of trades are duplicate-fingerprint batches from this project's own prior validation sessions, not independent organic decisions. These new numbers are computed over the same contaminated dataset (now +2 trades from tonight's real test cycle) — they should be read with that same caveat, not as a clean signal either way.

## 21:36 UTC — Global Scan check #6 tonight
`passed_filter: 0, blocked: 13`, `macro_sentiment: mild_bull`, weights `{macro:0.45, technical:0.195, news:0.236, social:0.118}`. Consistent with every prior check tonight post-T-069. Macro correctly pinned at the new 0.45 ceiling, real (non-neutral) sentiment reading. Continuing to log this each cycle to build a real time series rather than one snapshot.

---
