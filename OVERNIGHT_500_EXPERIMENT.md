# OVERNIGHT $500 PAPER-TRADING EXPERIMENT — separate from the 165-trade historical database

**Starting balance: $500.00**
**Start time: 2026-08-29 21:46 UTC**
**Status: RUNNING**

## Why this is a separate ledger, not a separate account inside the app — read this first

I checked before starting: this app's paper-trading portfolio (`VirtualTrade`/`VirtualPortfolio`) is a **single global singleton**, not per-user and not multi-account. There is a `/virtual/reset` endpoint, but it resets/destroys the *one* existing shared portfolio — the same one holding the 165-trade history you explicitly told me not to touch. There is no code path to spin up a second, isolated $500 paper account without either resetting that shared one or a real code change to make the portfolio multi-account (a real feature, not a quick toggle — out of scope for tonight).

So, per your own fallback instruction: **I'm keeping a separate tracking ledger (this file) instead.** Here's exactly what that means, so you know precisely what you're reading:

- Every trade below is a **real AI decision** — the actual live output of `/guide/suggestion` (the same "one best suggestion" a real user sees on the Guide screen) at the moment it's logged. Nothing is invented, cherry-picked, or hypothetical.
- Entry price, stop-loss, take-profit, position size, and confidence are **exactly what the AI actually output**, unedited.
- I am **not** routing these through the real Approve endpoint (that would open them in the shared 165-trade account, mixing the data you explicitly asked me to keep separate). Instead, I log the open here, then track the real live market price each monitoring cycle and close the ledger trade the moment price crosses the AI's own stop-loss or take-profit — the same rule the real engine uses, applied by me against real prices.
- Since the Guide screen only ever surfaces one "best" suggestion at a time (that's how a real user actually experiences this app — one recommendation, not a menu to pick from), one ledger trade per suggestion is the realistic equivalent of "letting the AI decide," not a limitation I'm introducing.
- Every other asset's decision each cycle (WAIT/AVOID/BUY/SELL-not-chosen) is logged too, in the "Considered, not opened" table, so nothing is hidden.
- I will not resize positions, skip a bad-looking suggestion, or otherwise interfere. If the AI's next suggestion is something you wouldn't have picked yourself, it still goes in the ledger exactly as given.

---

## OPEN / CLOSED TRADES

| # | Time (UTC) | Asset | Dir | Entry | SL | TP | Size $ | Confidence | Status | Exit | P&L |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 21:46 | BTCUSDT | BUY | 78098.96 | 77689.088086 | 78782.079856 | $19.05 | very confident | **OPEN** | — | — |

---

## Considered, not opened (other assets' decisions at each cycle, real, from the 14-asset sweep)

**Cycle 1 snapshot (21:36 UTC, ~10 min before ledger start — closest real data available)**: BTC/BNB/DOGE/AVAX/LINK/SOL → BUY (BTC became the ledger's #1 pick once it became the Guide's top suggestion). ADA → WAIT. ETH, XRP → **AVOID**. EUR/USD, GBP/USD → WAIT. USD/JPY → BUY (not chosen by Guide — technical-only signal, not the top-ranked one). XAU/XAG → WAIT.

---

## Running totals (updates each cycle)

- Trades opened: 1
- Wins: 0 · Losses: 0 · Open: 1
- Realized P&L: $0.00
- Unrealized P&L: $0.00 (BTCUSDT still at entry as of ledger start)
- Equity: $500.00

*This file updates every monitoring cycle through the night. Final tally and the full comparison (BUY vs SELL, best/worst asset, confidence usefulness, SL/TP correctness, any bugs affecting a trade, sample-size caveat) will be in the morning report.*
