"""
Liquidity Engine — Phase 2 of the Order Block Intelligence Engine
(2026-09-01, RENO Order Block deep-audit build-out).

Purpose: identify where technically meaningful liquidity rests (buy-side
above swing highs, sell-side below swing lows), and classify what happens
when price interacts with it -- a genuine liquidity sweep/raid versus a
plain structural break versus a failed sweep versus not-enough-evidence-
yet. Builds directly on market_structure_engine.py's Phase 1 output
(swings, EQH/EQL labels) rather than re-detecting structure from scratch.

Per the project's own instruction: "Do not label something a liquidity
sweep merely because price moved through a level." Every classification
below has an explicit, falsifiable rule.

────────────────────────────────────────────────────────────────────────────
RULE 7 — Liquidity pools
────────────────────────────────────────────────────────────────────────────
Every confirmed swing point from Phase 1 (market_structure_engine) is a
liquidity pool:
  - a swing HIGH is BUY-SIDE liquidity (resting sell-stops of prior longs
    below it are irrelevant here; what rests ABOVE a swing high is
    breakout-buy orders and the stop-losses of anyone short from below it
    -- conventional SMC usage, "buy-side liquidity sits above highs").
  - a swing LOW is SELL-SIDE liquidity (symmetric, below lows).

A pool is REINFORCED if its swing carries an EQH/EQL label from Phase 1
(i.e., it sits at essentially the same price as a prior swing of the same
kind) -- more than one untested level at the same price is a larger,
more realistic liquidity concentration than a single isolated swing, which
is the actual basis for "equal highs/lows" mattering in SMC at all.

A pool's status is RESTING until price interacts with it (Rule 8), then
becomes SWEPT or BROKEN depending on how.

────────────────────────────────────────────────────────────────────────────
RULE 8 — Sweep / raid classification
────────────────────────────────────────────────────────────────────────────
For a buy-side pool (swing high) at level L, watch each subsequent candle:

  - WICK_SWEEP: a candle's `high` > L, but that same candle's `close` <=
    L. Price traded through the resting liquidity and came back --
    the actual definition of a "sweep" in SMC (grab liquidity, reverse),
    not just "price moved through the level."
  - CLOSE_THROUGH_BREAK: a candle's `close` > L. This is a genuine
    structural break, not a sweep (see Rule 4 in market_structure_engine
    -- this is the same close-through-break condition that drives
    BOS/CHoCH there; Rule 8 does not re-invent it, it cross-references it
    so a level is never simultaneously called a "sweep" and a "break").
  - No interaction: neither condition met, pool stays RESTING.

Sell-side pools (swing lows) are the exact mirror using `low` < L / `close`
>= L.

A WICK_SWEEP is provisionally recorded, then re-evaluated over the next
`confirm_window` candles (default 3):
  - FAILED_SWEEP: if any of those following candles CLOSES beyond L in the
    same direction as the original wick, the "sweep" did not actually hold
    as a reversal signal -- price came back and broke through for real
    shortly after. Downgraded from WICK_SWEEP to FAILED_SWEEP.
  - CONFIRMED_SWEEP: if `confirm_window` candles pass with no close-through
    in that direction, the wick sweep is confirmed as a genuine
    liquidity-grab-and-reversal.
  - AMBIGUOUS (insufficient evidence): if the data ends before
    `confirm_window` candles have passed since the wick, this module
    returns AMBIGUOUS rather than guessing at CONFIRMED or FAILED -- per
    the project's own rule to prefer "insufficient evidence" over a
    manufactured answer.

A pool can only be swept/broken once; after either event, it is removed
from the RESTING pool list for pool-density purposes (Rule 9) -- the
liquidity there has been consumed.

────────────────────────────────────────────────────────────────────────────
RULE 9 — Liquidity pool density near a price
────────────────────────────────────────────────────────────────────────────
A simple, deterministic count: given a price and a direction, how many
still-RESTING pools of the relevant side exist within `proximity_pct` of
that price (default 1.5%). This is exposed for Phase 3 (Order Block
validation) to answer "is there real target liquidity near this OB's
take-profit," rather than that later phase re-implementing pool scanning
itself.

────────────────────────────────────────────────────────────────────────────
RULE 10 — Previous session highs/lows
────────────────────────────────────────────────────────────────────────────
NOT implemented in this pass, and deliberately not faked. The Order Block
engine's only real data source today (Phase 0 audit) is Binance spot
klines for crypto pairs -- a 24/7 market with no exchange-defined session
open/close. "Previous session high/low" is a meaningful, well-defined
concept for markets with real session boundaries (forex, futures) but
inventing an arbitrary UTC time window and calling it a "session" for a
market that never closes would be exactly the kind of manufactured
precision this project has explicitly ruled out. This module exposes a
`session_high_low()` function that takes explicit session boundaries as an
argument and returns REAL computed highs/lows for whatever window it's
given -- callers with real session-aware data (e.g. a future forex/
commodity path) can use it correctly; nothing here guesses session
boundaries on crypto's behalf.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Optional

import pandas as pd

from app.services.market_structure_engine import SwingPoint

logger = logging.getLogger("ai-service.liquidity_engine")

DEFAULT_CONFIRM_WINDOW = 3
DEFAULT_PROXIMITY_PCT = 0.015  # 1.5%


@dataclass
class LiquidityPool:
    index: int              # index of the source swing
    kind: str                # "buy_side" | "sell_side"
    level: float
    reinforced: bool         # True if the source swing was EQH/EQL
    status: str = "RESTING"  # "RESTING" | "SWEPT" | "BROKEN"
    interaction_index: Optional[int] = None
    sweep_classification: Optional[str] = None  # set only when status == "SWEPT"

    def to_dict(self) -> dict:
        return {
            "index": self.index,
            "kind": self.kind,
            "level": round(float(self.level), 6),
            "reinforced": self.reinforced,
            "status": self.status,
            "interaction_index": self.interaction_index,
            "sweep_classification": self.sweep_classification,
        }


def build_pools(swings: list) -> list:
    """Rule 7. `swings` is the output of
    market_structure_engine.find_swings() + classify_sequence()."""
    pools = []
    for s in swings:
        kind = "buy_side" if s.kind == "high" else "sell_side"
        reinforced = s.label in ("EQH", "EQL")
        pools.append(LiquidityPool(index=s.index, kind=kind, level=s.price, reinforced=reinforced))
    return pools


def _classify_wick_outcome(df: pd.DataFrame, wick_index: int, level: float,
                            direction: str, confirm_window: int) -> str:
    """Rule 8's second stage: FAILED_SWEEP / CONFIRMED_SWEEP / AMBIGUOUS."""
    n = len(df)
    end = min(n, wick_index + 1 + confirm_window)
    if end < wick_index + 1 + confirm_window and end == n:
        # Not enough trailing candles yet to reach a confident verdict.
        insufficient = True
    else:
        insufficient = False

    closes = df["close"].values
    for j in range(wick_index + 1, end):
        c = closes[j]
        if direction == "bullish" and c > level:
            return "FAILED_SWEEP"
        if direction == "bearish" and c < level:
            return "FAILED_SWEEP"

    if insufficient:
        return "AMBIGUOUS"
    return "CONFIRMED_SWEEP"


def detect_sweeps(df: pd.DataFrame, pools: list,
                   confirm_window: int = DEFAULT_CONFIRM_WINDOW) -> list:
    """Rule 8. Mutates each LiquidityPool's status/interaction_index/
    sweep_classification in place (first interaction only -- a pool that's
    already SWEPT or BROKEN is not re-evaluated). Returns the same list."""
    n = len(df)
    highs = df["high"].values
    lows = df["low"].values
    closes = df["close"].values

    for pool in pools:
        if pool.status != "RESTING":
            continue
        L = pool.level
        start = pool.index + 1
        for i in range(start, n):
            if pool.kind == "buy_side":
                if closes[i] > L:
                    pool.status = "BROKEN"
                    pool.interaction_index = i
                    break
                if highs[i] > L:
                    verdict = _classify_wick_outcome(df, i, L, "bullish", confirm_window)
                    pool.status = "SWEPT"
                    pool.interaction_index = i
                    pool.sweep_classification = verdict
                    break
            else:  # sell_side
                if closes[i] < L:
                    pool.status = "BROKEN"
                    pool.interaction_index = i
                    break
                if lows[i] < L:
                    verdict = _classify_wick_outcome(df, i, L, "bearish", confirm_window)
                    pool.status = "SWEPT"
                    pool.interaction_index = i
                    pool.sweep_classification = verdict
                    break
    return pools


def resting_pool_density(pools: list, price: float, side: str,
                          proximity_pct: float = DEFAULT_PROXIMITY_PCT) -> dict:
    """Rule 9. `side`: "buy_side" or "sell_side". Returns a dict with the
    count and the pool levels considered, so a caller can see exactly
    which pools contributed rather than trusting an opaque count."""
    lo = price * (1 - proximity_pct)
    hi = price * (1 + proximity_pct)
    matched = [
        p for p in pools
        if p.kind == side and p.status == "RESTING" and lo <= p.level <= hi
    ]
    return {
        "count": len(matched),
        "levels": sorted(round(p.level, 6) for p in matched),
        "proximity_pct": proximity_pct,
    }


def session_high_low(df: pd.DataFrame, session_start_index: int, session_end_index: int) -> Optional[dict]:
    """Rule 10. Explicit, caller-provided session boundaries only -- this
    function never guesses what a "session" means for the calling asset.
    Returns None if the requested window is out of range or empty."""
    if session_start_index < 0 or session_end_index > len(df) or session_start_index >= session_end_index:
        return None
    window = df.iloc[session_start_index:session_end_index]
    if window.empty:
        return None
    return {
        "high": round(float(window["high"].max()), 6),
        "low": round(float(window["low"].min()), 6),
        "start_index": session_start_index,
        "end_index": session_end_index,
    }


def analyze_liquidity(df: pd.DataFrame, swings: list,
                       confirm_window: int = DEFAULT_CONFIRM_WINDOW) -> list:
    """Public entry point for Phase 2. Takes Phase 1's classified swings
    (after classify_sequence() has set .label) and returns fully-evaluated
    LiquidityPool objects."""
    pools = build_pools(swings)
    detect_sweeps(df, pools, confirm_window=confirm_window)
    return pools
