# Win-Rate Diagnosis — findings, not speculation

**Task**: WINRATE-DIAGNOSIS (overnight validation task list, 2026-08-29). Analysis only — no model retraining, no strategy changes. Every number below traces to a real query against the live MongoDB `VirtualTrade` collection, run on 2026-08-29.

## 1. The headline number, and why it's misleading as-is

`/virtual/performance` reports **147 closed trades, 41 wins, 106 losses, 27.9% win rate, net P&L -$17.74**. The overnight report treated this as a clean sample of 147 independent AI decisions. **It is not.**

Grouping all 147 closed trades by exact fingerprint (`asset` + `entryPrice` + `stopLoss`, to floating-point precision — this level of exact match cannot happen by coincidence from independent live price fetches) finds:

- **112 of 147 trades (76.2%) belong to 14 duplicate-fingerprint batches** — the same asset opened multiple times at the *exact same* entry price and stop-loss, sometimes minutes apart, sometimes **days** apart (e.g. `LINKUSDT @ 10.585` spans 2026-08-20 23:00 → 2026-08-22 11:59, ~37 hours).
- These batches appear on **four separate dates spread across the account's full 18-day history** (2026-08-10, 08-20, 08-22, 08-26) — not one isolated incident.
- Only **35 of 147 trades (23.8%) are genuinely unique** decisions.

**Root cause of the duplication, confirmed by code, not guessed**: every `source: 'guide'` trade (all 147 of them — `aiWorkerService.js`'s autonomous path tags trades `source: 'ai'` and has never produced a single closed trade in this dataset) is opened by `POST /guide/suggestion/approve` — the exact endpoint this project's own testing/validation sessions have repeatedly called directly to exercise the live system (the overnight report itself did this: *"opened one real trade by calling the exact same server-side handler the UI's 'Approve' button calls"*). This project has had numerous overnight audit/validation passes across its history (documented extensively in `TASKS.md`/`PROJECT_STATUS.md`). Each one calling `approve()` against a suggestion that hadn't refreshed yet (the global-scan cache refreshes every 30 min, the Signal fallback has its own window) reproduces exactly this fingerprint-duplicate pattern. Separately, the **2026-08-10 batch specifically matches a known, already-fixed bug** (a mobile UI double-tap issue on "Yes, do it" that created the original "11 duplicate SOLUSDT trades" the owner explicitly chose to leave in the database rather than clean up).

**This means the shared paper-trading account has been used as a live testing sandbox by many separate validation sessions over 18 days, and a majority of its trade history is a mix of repeated test-approvals and one fixed UI bug — not 147 independent, organic AI trading decisions.** Any win-rate conclusion drawn from this account without accounting for that is measuring test activity, not model quality.

## 2. What the number looks like once you can't hide behind duplicates

Excluding the 112 duplicate-batch trades and looking only at the 35 unique decisions:

| | All 147 | Unique 35 |
|---|---|---|
| Win rate | 27.9% | **14.3%** (5 wins) |
| Net P&L | -$17.74 | -$7.71 |
| SL-hit rate | 61.2% (90/147) | **80.0%** (28/35) |

**Excluding the duplicates makes the win rate worse, not better** — the opposite of what "duplicates are inflating a bad number" would predict. The 112 duplicate trades themselves have a 32.1% win rate (36 wins), actually *higher* than the unique trades' 14.3%. So this is not a story of "remove the noise and the AI looks fine" — it's a story of "the dataset is too contaminated by repeated test activity to draw a confident conclusion about the model's real accuracy either way," and what little clean signal exists (35 trades) is not encouraging.

**Recommendation, not a decision I'm making unilaterally**: this dataset cannot answer "is the model actually good" reliably. Getting a trustworthy answer needs either (a) a `virtual/reset` to a clean account and a genuine fresh observation period with test/validation sessions explicitly avoiding the approve endpoint, or (b) tagging test-originated trades distinctly from real usage going forward so they can be filtered out of performance stats. Both are product/process decisions for the owner, not something this pass changed.

## 3. Stop-loss vs. take-profit — the clearest real pattern in the data

Across **all** 147 trades, by exit reason:

| Exit reason | Count | Win rate | Net P&L |
|---|---|---|---|
| Stop-loss | 90 (61.2%) | 0% (by definition) | -$21.66 |
| Take-profit | 18 (12.2%) | 100% (by definition) | +$5.01 |
| Manual close | 39 (26.5%) | 59.0% | -$1.09 |

`signal_engine.py`'s `_compute_stop_take()` uses a fixed **1.5×ATR stop / 2.5×ATR target** (1:1.67 risk:reward) for every trade, regardless of asset or regime. A position needs to move 1.67× as far in its favor as against it to hit target before stop. Hitting stop-loss **5× more often** than take-profit (90 vs 18) means price is moving against these entries, past the stop distance, far more often than it's moving in their favor past the (further) target — consistent with either (a) the directional call itself not having much edge at entry, or (b) a 1.5×ATR stop being tight enough that ordinary noise clears it before a real move develops. **This pass could not distinguish between those two explanations** — that would need per-trade ATR-at-entry data (not currently stored on `VirtualTrade`) compared against the actual price path after entry, which is a real follow-up analysis, not something guessable from the fields available today.

## 4. Per-asset variance is large and consistent, even excluding duplicates

| Asset | All trades WR | Unique-only WR |
|---|---|---|
| ETHUSDT | 70.0% (21/30) | — (all 3 unique ETH trades in the sample were wins/mixed, too few to trust alone) |
| XAUUSD (Gold) | 43.8% (7/16) | — |
| LINKUSDT | 4.9% (2/41) | worst-performing across both cuts |
| SOLUSDT, AVAXUSDT | 12.5% each | — |
| XRPUSDT, DOGEUSDT | 0% (0/6, 0/4) | — |

ETHUSDT and Gold are the only two assets with a positive-looking track record; every other tracked crypto asset is well below the 37.5% breakeven threshold this system's 1:1.67 R:R requires. Per-asset sample sizes are too small individually to be statistically conclusive (especially post-duplicate-removal), but the *direction* of the pattern — some assets consistently better than others — is consistent across both the contaminated and clean cuts, which is more evidence than a single reading would give.

## 5. What this pass did NOT change

Per the standing constraints: no model retraining, no recalibration, no strategy/SL-TP-ratio changes, no database cleanup or trade deletion. This is a findings report only. The three real, actionable follow-ups it surfaces — (1) get a clean win-rate reading by excluding or preventing test-generated trades, (2) investigate whether 1.5×ATR stops are systematically too tight vs. genuine directional edge, (3) treat non-ETH/Gold crypto assets' current track record as unproven at best — are owner decisions, not something this pass acted on unilaterally.
