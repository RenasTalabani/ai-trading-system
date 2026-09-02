"""
Historical Validation Engine — Phase 10 of the Order Block Intelligence
Engine (2026-09-01, RENO Order Block deep-audit build-out).

Purpose: measure how Order Blocks detected by order_block_engine.py's own
impulse/OB-candle rules ACTUALLY performed historically -- real outcomes
from real subsequent price action, never fabricated, never assumed. This
is analysis/reporting only: it reads OHLCV data and produces a report. It
never creates trades, never touches the user's paper portfolio, and is
not wired into any live endpoint (that remains Phase 12's job).

────────────────────────────────────────────────────────────────────────────
RULE 32 — Detection-time vs outcome-time separation (no look-ahead)
────────────────────────────────────────────────────────────────────────────
An Order Block's DETECTION uses only data at or before its own impulse
candle index `i`:
  - avg_body/avg_volume (order_block_engine.py's own rolling(20) windows)
    end at i, never look past it.
  - the OB candle itself is found scanning strictly BACKWARD from i-1.
  - strength score is computed from the impulse candle and the OB candle
    only -- no future data.

`detect_order_blocks_for_backtest()` below re-runs EXACTLY this
detection logic. It does NOT import order_block_engine.py directly --
that module imports `DataProcessor` (a live exchange client) at module
level, which would drag a live network dependency into what should be a
pure, offline, testable analysis module purely to reach four constants
and one small formula. Instead, following the SAME precedent
setup_engine.py already set for its stop-loss buffer (a fresh constant
that matches order_block_engine.py's own convention rather than
importing it), the impulse/lookback/avg-window constants and the
strength-score formula are duplicated here, byte-for-byte identical at
the time of writing. `TestConstantsMatchProductionEngine` in this
module's test file guards against silent drift: it reads
order_block_engine.py's own SOURCE TEXT (not a live import) and asserts
the constant values and formula text still match -- so a future edit to
one file without the other fails a real test rather than silently
diverging. It exists as a separate function only because
order_block_engine.py's own `analyze()` fetches LIVE data via
DataProcessor (an exchange API call), which is unusable for historical
replay -- this module needs to run the identical math over a
caller-supplied historical DataFrame instead.

Running detection once over a full historical df produces IDENTICAL
per-candle results to what a live detector would have found day by day,
because every quantity used at index i is already computed only from
data <= i. This is the same "walk-forward-safe by construction" property
market_structure_engine.py's Rule 4 documents and relies on -- Phase 1's
own docstring notes this exact property was verified by a prior test
fixture bug (a false swing-confirmation-timing bug) being caught by its
test suite, not assumed.

Each OB's OUTCOME is then measured using Phase 8's `compute_ob_state()`
run against the SAME full df -- which is legitimate, not look-ahead: an
outcome is BY DEFINITION what happened after detection, using real
history that actually occurred. Look-ahead bias would mean using this
future data to help DETECT or SCORE the OB at formation time; this
module never does that -- detection (Rule 32 above) and outcome (Rule 34
below) are two separate passes over two separate index ranges
([0, i] vs (i, end]), and every returned record carries both
`detected_at_index` and the outcome fields so the separation is explicit
and auditable, not merely implicit in code structure.

────────────────────────────────────────────────────────────────────────────
RULE 33 — v1 scope: strength-only, fixed-RR outcomes (documented
simplification, not a hidden shortcut)
────────────────────────────────────────────────────────────────────────────
Phase 9's setup_engine.py prefers a real liquidity-pool take-profit
target over a fixed R:R fallback, and Phase 7's quality_engine.py scores
across 6 evidence dimensions (structure, liquidity, FVG, premium/
discount, HTF, freshness). Reconstructing all of that AT EACH OB's OWN
formation index (re-running Phase 1/2 truncated to df[:i+1] for
potentially hundreds of OBs in a long backtest) is real, valuable future
work but out of scope for this pass. This module uses ONLY the OB's own
`strength` score (already >=30, required by detection) and the SAME
stop-loss convention as Phase 9 (0.5% beyond the zone edge) against a
FIXED 2:1 reward:risk target -- never a liquidity-aware one.
`tp_method` on every outcome record is always the literal string
"FIXED_RR_V1" so nothing this module returns can be mistaken for a
liquidity-validated Phase 9 setup.

────────────────────────────────────────────────────────────────────────────
RULE 34 — Outcome classification (mutually exclusive, precedence order)
────────────────────────────────────────────────────────────────────────────
Uses Phase 8's compute_ob_state() to find the OB's terminal life-cycle
state over the available future data (up to max_age_candles, same
default 200 as Phase 8), then classifies each OB's `outcome` as exactly
one of:

  1. NEVER_TRIGGERED -- Phase 8 status is FRESH, APPROACHING, or EXPIRED
     with zero touches. No entry ever happened; no target/stop outcome
     to measure. MFE/MAE are still reported (real price excursion from
     entry price even without a real entry, for reference) but flagged
     `triggered: False`.
  2. INVALIDATED_BEFORE_ENTRY -- Phase 8 status is INVALIDATED and the
     invalidation index is at or before the first touch index (or there
     was no touch at all before invalidation). The zone broke before a
     real entry trigger existed. `triggered: False`.
  3. TARGET_HIT / STOP_HIT / NO_HIT_WITHIN_WINDOW -- Phase 8 status shows
     at least one real touch (TESTED, MITIGATED, REACTED, or
     INVALIDATED-after-a-touch). `triggered: True`. This module then
     walks forward from the first touch index using real subsequent
     wicks (high/low, matching Phase 8's own touch/reaction convention,
     not close) to find whichever the price reaches FIRST: the fixed
     2:1 target level, the 0.5%-beyond-zone stop level, or neither
     within max_age_candles of the formation index.

MFE (Maximum Favorable Excursion) and MAE (Maximum Adverse Excursion),
for triggered OBs, are measured from the entry price (zone midpoint)
across the window from first touch to whichever comes first among
target/stop/window-end, using the real high/low extremes reached in the
OB's favor and against it respectively -- expressed as a percent of
entry price. Both are always >= 0 by definition (excursion magnitude,
not signed P&L).

────────────────────────────────────────────────────────────────────────────
RULE 35 — Edge cases and the censoring rule
────────────────────────────────────────────────────────────────────────────
  - Fewer candles than order_block_engine.py's own minimum (50): returns
    an empty result, status INSUFFICIENT_DATA, never a fabricated 0%.
  - An OB whose formation index is within max_age_candles of the end of
    the supplied df has an INCOMPLETE observation window -- its true
    outcome may not have happened yet within the data available. This
    module marks it `censored: True` (survival-analysis terminology) and
    EXCLUDES it from the aggregate rate calculations in
    `summarize_backtest()` by default, rather than silently counting an
    unknown outcome as a specific one. `include_censored=True` opts back
    in, for transparency, but the default keeps published rates honest.
  - Zero non-censored, triggered OBs: aggregate target/stop-hit rates
    return None (not 0.0 -- "no evidence available" is a real, different
    answer from "0% target-hit rate on real evidence").
"""
from __future__ import annotations

from typing import Optional

import pandas as pd

from app.services.ob_state_machine import compute_ob_state

# Duplicated from order_block_engine.py, byte-for-byte at time of
# writing -- see Rule 32 above for why this isn't a live import, and
# this module's test file's TestConstantsMatchProductionEngine for the
# drift guard.
_AVG_WINDOW = 20
_IMPULSE_MULTIPLIER = 2.5
_LOOKBACK = 10           # candles to look back for OB before impulse

_MIN_STRENGTH = 30
_MIN_CANDLES = 50
_SL_BUFFER_PCT = 0.005      # matches order_block_engine.py / setup_engine.py's own convention
_FIXED_RR = 2.0
_DEFAULT_MAX_AGE_CANDLES = 200


def _strength_score(impulse_ratio: float, volume_ratio: float,
                     wick_ratio: float, ema_aligned: bool) -> int:
    """Duplicated verbatim from order_block_engine.py -- see module
    docstring Rule 32 for why, and the drift-guard test that pins this
    to the production formula's source text."""
    imp_score = min(40, int((impulse_ratio - _IMPULSE_MULTIPLIER) /
                             (_IMPULSE_MULTIPLIER * 2) * 40))
    imp_score = max(0, imp_score)

    vol_score = min(20, int((volume_ratio - 1.0) / 2.0 * 20))
    vol_score = max(0, vol_score)

    clean_score = int((1 - min(wick_ratio, 1.0)) * 20)

    ema_score = 20 if ema_aligned else 0

    return min(100, imp_score + vol_score + clean_score + ema_score)


def detect_order_blocks_for_backtest(df: pd.DataFrame) -> list:
    """Rule 32. Pure re-run of order_block_engine.py's own impulse/OB-
    candle detection loop over a caller-supplied historical DataFrame
    (columns: open, high, low, close, volume, timestamp). No live
    exchange call, no EMA-trend/RSI/signal/sentiment machinery from the
    live engine -- those are irrelevant to detection itself and are
    Phase 6/7/9's job, not this one's."""
    if df is None or len(df) < _MIN_CANDLES:
        return []

    df = df.copy().reset_index(drop=True)
    df["body"] = (df["close"] - df["open"]).abs()
    df["range"] = df["high"] - df["low"]
    df["avg_body"] = df["body"].rolling(_AVG_WINDOW, min_periods=5).mean()
    df["avg_volume"] = df["volume"].rolling(_AVG_WINDOW, min_periods=5).mean()

    order_blocks = []
    for i in range(_AVG_WINDOW + 1, len(df)):
        avg_b = float(df["avg_body"].iloc[i])
        avg_v = float(df["avg_volume"].iloc[i])
        if avg_b <= 0:
            continue

        body = float(df["body"].iloc[i])
        volume = float(df["volume"].iloc[i])
        if body < _IMPULSE_MULTIPLIER * avg_b:
            continue

        is_bull_impulse = df["close"].iloc[i] > df["open"].iloc[i]
        volume_ratio = volume / (avg_v + 1e-9)
        if is_bull_impulse:
            wick = df["high"].iloc[i] - df["close"].iloc[i]
        else:
            wick = df["open"].iloc[i] - df["low"].iloc[i]
        wick_ratio = wick / (float(df["range"].iloc[i]) + 1e-9)
        imp_ratio = body / (avg_b + 1e-9)

        ob_candle = None
        for j in range(i - 1, max(i - _LOOKBACK, 0) - 1, -1):
            c_open = float(df["open"].iloc[j])
            c_close = float(df["close"].iloc[j])
            c_high = float(df["high"].iloc[j])
            c_low = float(df["low"].iloc[j])
            is_bearish_c = c_close < c_open
            is_bullish_c = c_close > c_open

            if is_bull_impulse and is_bearish_c:
                ob_candle = (j, "bullish", c_low, c_open)
                break
            if not is_bull_impulse and is_bullish_c:
                ob_candle = (j, "bearish", c_open, c_high)
                break

        if ob_candle is None:
            continue

        j, ob_type, z_low, z_high = ob_candle
        # No EMA-trend gating here (that needs the live engine's full
        # trend context) -- strength is still computed with ema_aligned
        # held neutral/False, a documented v1 scope narrowing consistent
        # with Rule 33: this module never claims EMA-aligned strength it
        # did not actually check.
        strength = _strength_score(imp_ratio, volume_ratio, wick_ratio, False)
        if strength < _MIN_STRENGTH:
            continue

        order_blocks.append({
            "type": ob_type,
            "zone_low": round(z_low, 6),
            "zone_high": round(z_high, 6),
            "strength": strength,
            "ob_index": j,
            "detected_at_index": i,
        })

    return order_blocks


def _classify_outcome(df: pd.DataFrame, ob: dict, max_age_candles: int) -> dict:
    """Rules 33-35. `ob` must have type/zone_low/zone_high/detected_at_index."""
    ob_type = ob["type"]
    zone_low = ob["zone_low"]
    zone_high = ob["zone_high"]
    formation_index = ob["detected_at_index"]

    state = compute_ob_state(
        df, ob_type, zone_low, zone_high, formation_index,
        max_age_candles=max_age_candles,
    )

    n = len(df)
    last_index = n - 1
    censored = (last_index - formation_index) < max_age_candles and state.status not in (
        "INVALIDATED", "REACTED",
    )

    result = {
        "detected_at_index": formation_index,
        "type": ob_type,
        "zone_low": zone_low,
        "zone_high": zone_high,
        "strength": ob["strength"],
        "state_status": state.status,
        "touch_count": state.touch_count,
        "first_touch_index": state.first_touch_index,
        "censored": censored,
        "triggered": False,
        "outcome": None,
        "tp_method": None,
        "target_price": None,
        "stop_price": None,
        "mfe_pct": None,
        "mae_pct": None,
    }

    if state.status == "INSUFFICIENT_DATA":
        result["outcome"] = "INSUFFICIENT_DATA"
        return result

    # Must be checked BEFORE the "never touched" check below: Phase 8's
    # compute_ob_state() breaks out of its scan the instant a candle
    # CLOSES through the zone (invalidation), even when that SAME candle
    # also wicked into the zone -- so it never gets counted as a touch,
    # and first_touch_index stays None even though real price action did
    # reach the zone before invalidating. That is still, correctly, an
    # invalidation-before-entry (Rule 34: "or there was no touch at all
    # before invalidation"), not a NEVER_TRIGGERED -- there IS a real
    # invalidation event, just no separate prior touch event.
    if state.status == "INVALIDATED" and (
        state.first_touch_index is None
        or (state.invalidated_index is not None and state.invalidated_index <= state.first_touch_index)
    ):
        result["outcome"] = "INVALIDATED_BEFORE_ENTRY"
        return result

    if state.first_touch_index is None:
        # Never touched at all, and never invalidated either.
        result["outcome"] = "NEVER_TRIGGERED"
        return result

    # A real touch happened -- this is a triggered entry.
    result["triggered"] = True
    entry_price = (zone_low + zone_high) / 2.0
    if ob_type == "bullish":
        sl = zone_low * (1 - _SL_BUFFER_PCT)
    else:
        sl = zone_high * (1 + _SL_BUFFER_PCT)
    risk = abs(entry_price - sl)
    tp = entry_price + _FIXED_RR * risk if ob_type == "bullish" else entry_price - _FIXED_RR * risk

    result["tp_method"] = "FIXED_RR_V1"
    result["target_price"] = round(tp, 6)
    result["stop_price"] = round(sl, 6)

    window_end = min(formation_index + max_age_candles, last_index)
    high = df["high"].values
    low = df["low"].values

    outcome = "NO_HIT_WITHIN_WINDOW"
    mfe = 0.0
    mae = 0.0
    for k in range(state.first_touch_index, window_end + 1):
        if ob_type == "bullish":
            favorable = (high[k] - entry_price) / entry_price
            adverse = (entry_price - low[k]) / entry_price
        else:
            favorable = (entry_price - low[k]) / entry_price
            adverse = (high[k] - entry_price) / entry_price
        mfe = max(mfe, favorable)
        mae = max(mae, adverse)

        if ob_type == "bullish":
            hit_target = high[k] >= tp
            hit_stop = low[k] <= sl
        else:
            hit_target = low[k] <= tp
            hit_stop = high[k] >= sl

        # Same-candle ambiguity: if both trigger on the same candle, this
        # is a real, common backtesting ambiguity (which happened first
        # intraperiod is unknowable from OHLC alone) -- resolved
        # conservatively by counting the STOP first (assume the worse
        # outcome when order is unknown, never assume the better one).
        if hit_stop:
            outcome = "STOP_HIT"
            break
        if hit_target:
            outcome = "TARGET_HIT"
            break

    result["outcome"] = outcome
    result["mfe_pct"] = round(mfe * 100, 4)
    result["mae_pct"] = round(mae * 100, 4)
    return result


def run_backtest(df: pd.DataFrame, max_age_candles: int = _DEFAULT_MAX_AGE_CANDLES) -> dict:
    """Public entry point: detect OBs (Rule 32) and classify each one's
    real historical outcome (Rules 33-35). Read-only; never touches any
    trade or portfolio data."""
    if df is None or len(df) < _MIN_CANDLES:
        return {"status": "INSUFFICIENT_DATA", "reason": "Not enough candles", "results": []}

    obs = detect_order_blocks_for_backtest(df)
    results = [_classify_outcome(df, ob, max_age_candles) for ob in obs]
    return {"status": "OK", "reason": None, "results": results}


def summarize_backtest(results: list, include_censored: bool = False) -> dict:
    """Rule 35. Aggregate metrics: reaction_rate, invalidation_rate,
    target_hit_rate, stop_hit_rate, avg_mfe_pct, avg_mae_pct. Each is
    None (not 0.0) when there is no real evidence to compute it from."""
    pool = [r for r in results if include_censored or not r.get("censored")]
    pool = [r for r in pool if r.get("outcome") != "INSUFFICIENT_DATA"]

    total = len(pool)
    if total == 0:
        return {
            "total_obs": 0, "reaction_rate": None, "invalidation_rate": None,
            "target_hit_rate": None, "stop_hit_rate": None,
            "avg_mfe_pct": None, "avg_mae_pct": None,
        }

    reacted = sum(1 for r in pool if r["state_status"] == "REACTED")
    invalidated = sum(1 for r in pool if r["state_status"] == "INVALIDATED")

    triggered = [r for r in pool if r["triggered"]]
    target_hits = sum(1 for r in triggered if r["outcome"] == "TARGET_HIT")
    stop_hits = sum(1 for r in triggered if r["outcome"] == "STOP_HIT")

    mfe_vals = [r["mfe_pct"] for r in triggered if r["mfe_pct"] is not None]
    mae_vals = [r["mae_pct"] for r in triggered if r["mae_pct"] is not None]

    return {
        "total_obs": total,
        "reaction_rate": round(reacted / total * 100, 2),
        "invalidation_rate": round(invalidated / total * 100, 2),
        "target_hit_rate": round(target_hits / len(triggered) * 100, 2) if triggered else None,
        "stop_hit_rate": round(stop_hits / len(triggered) * 100, 2) if triggered else None,
        "avg_mfe_pct": round(sum(mfe_vals) / len(mfe_vals), 4) if mfe_vals else None,
        "avg_mae_pct": round(sum(mae_vals) / len(mae_vals), 4) if mae_vals else None,
        "triggered_count": len(triggered),
        "censored_excluded": sum(1 for r in results if r.get("censored")) if not include_censored else 0,
    }
