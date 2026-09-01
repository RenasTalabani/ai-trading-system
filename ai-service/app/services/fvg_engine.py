"""
Fair Value Gap (FVG) / Imbalance Engine — Phase 4 of the Order Block
Intelligence Engine (2026-09-01, RENO Order Block deep-audit build-out).

Purpose: detect price imbalances (a 3-candle gap where no trading occurred
at all in a price band) and track whether/when price later returns to
"fill" that gap. Unlike BOS/CHoCH (Phase 1) or sweep/raid (Phase 2), FVG
has one widely-agreed, purely mechanical definition across SMC/ICT
educators, so this module states the rule once rather than trying and
rejecting alternatives the way Phase 1 documented for "external structure."

────────────────────────────────────────────────────────────────────────────
RULE 11 — Fair Value Gap detection (3-candle imbalance)
────────────────────────────────────────────────────────────────────────────
For three consecutive candles at indices i-1, i, i+1:

  - BULLISH FVG if low[i+1] > high[i-1] -- candle i+1 never traded back down
    into candle i-1's range, leaving an untouched gap
    [high[i-1], low[i+1]]. This is the real "no one traded here" test: at
    no point across these three candles did price occupy that band.
  - BEARISH FVG, symmetric: high[i+1] < low[i-1] -- gap
    [high[i+1], low[i-1]].

candle i (the middle candle) is conventionally the "displacement" candle
that created the imbalance, but this module does NOT additionally require
it to be an outsized/impulse candle (unlike order_block_engine.py's own
impulse-candle gate) -- the gap condition above is already a strict,
sufficient, purely mechanical test on its own, and adding an extra
magnitude filter would just be inventing an additional undocumented rule.
A caller that wants to filter small/noisy gaps can pass `min_gap_pct`
(default 0.0 -- no filtering): a gap is discarded if
(top - bottom) / close[i] < min_gap_pct. This keeps the filtering choice
explicit and caller-controlled rather than silently baked in.

────────────────────────────────────────────────────────────────────────────
RULE 12 — Fill tracking (wick-based, not close-based)
────────────────────────────────────────────────────────────────────────────
A FVG's zone is [bottom, top]. Starting from the first candle AFTER the
gap-defining triplet (index i+2 onward -- candle i+1 itself is part of the
triplet that created the gap and cannot also be the candle that fills it):

  - BULLISH FVG (a support-side gap below current price): a candle's `low`
    reaching into [bottom, top] fills it. `low <= bottom` -> fully FILLED
    (price traded all the way through the gap). `bottom < low <= top` ->
    PARTIALLY_FILLED (price entered the gap but not all the way).
  - BEARISH FVG, symmetric on `high`.

Fill is deliberately WICK-based, not close-based (the opposite choice from
Phase 1's BOS/CHoCH, which is deliberately close-based) -- these measure
different things. A structure break is "did the market's decisive price
(the close) move past a level," which close captures and a wick doesn't.
A gap fill is "did price actually trade back into this exact band at all,"
which is exactly what a wick captures directly -- a candle can wick into a
gap and reverse without ever closing there, and that IS a real, complete
fill of that price band; requiring a close there would systematically
under-report fills and misrepresent what a wick-based fill genuinely
means in this context.

Once FILLED, a gap's state does not change further (the imbalance has been
fully traded through and has no further significance). PARTIALLY_FILLED
can still progress to FILLED by a later candle. `first_fill_index` records
when PARTIALLY_FILLED or FILLED first occurred; `full_fill_index` records
when FILLED was first reached (`None` if never fully filled by the end of
the available data -- an open, still-unfilled band is reported as OPEN,
never guessed at).

────────────────────────────────────────────────────────────────────────────
RULE 13 — Edge cases
────────────────────────────────────────────────────────────────────────────
  - Fewer than 3 candles: no FVGs possible, returns an empty list (not an
    error -- a 3-candle minimum is a real, obvious constraint, not a
    'DATA-insufficient' judgment call the way Phase 1/2's larger fractal
    windows are).
  - NaN in any of the three OHLC values examined for a candidate triplet:
    that triplet is skipped (matches Phase 1's Rule 6 handling).
  - A FVG's own defining candles (i-1, i, i+1) are never treated as fill
    candles for that same FVG, even if their price would otherwise
    qualify -- the gap is defined as the space those three candles left
    OPEN; the fill check only starts once trading resumes past them.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Optional

import pandas as pd

logger = logging.getLogger("ai-service.fvg_engine")

DEFAULT_MIN_GAP_PCT = 0.0


@dataclass
class FairValueGap:
    index: int              # index of the middle (displacement) candle, i
    kind: str                # "bullish" | "bearish"
    top: float
    bottom: float
    status: str = "OPEN"     # "OPEN" | "PARTIALLY_FILLED" | "FILLED"
    first_fill_index: Optional[int] = None
    full_fill_index: Optional[int] = None

    def to_dict(self) -> dict:
        return {
            "index": self.index,
            "kind": self.kind,
            "top": round(float(self.top), 6),
            "bottom": round(float(self.bottom), 6),
            "status": self.status,
            "first_fill_index": self.first_fill_index,
            "full_fill_index": self.full_fill_index,
        }


def detect_fvgs(df: pd.DataFrame, min_gap_pct: float = DEFAULT_MIN_GAP_PCT) -> list:
    """Rule 11. Returns unfilled-status FairValueGap objects (fill status
    is computed separately by track_fill_status) in chronological order."""
    fvgs: list = []
    n = len(df)
    if n < 3:
        return fvgs

    high = df["high"].values
    low = df["low"].values
    close = df["close"].values

    for i in range(1, n - 1):
        h_prev, l_prev = high[i - 1], low[i - 1]
        h_next, l_next = high[i + 1], low[i + 1]
        c_mid = close[i]

        if pd.isna(h_prev) or pd.isna(l_prev) or pd.isna(h_next) or pd.isna(l_next) or pd.isna(c_mid):
            continue  # Rule 13: skip candidates with missing data

        if l_next > h_prev:
            top, bottom = float(l_next), float(h_prev)
            gap_pct = (top - bottom) / (abs(float(c_mid)) + 1e-9)
            if gap_pct < min_gap_pct:
                continue
            fvgs.append(FairValueGap(index=i, kind="bullish", top=top, bottom=bottom))

        elif h_next < l_prev:
            top, bottom = float(l_prev), float(h_next)
            gap_pct = (top - bottom) / (abs(float(c_mid)) + 1e-9)
            if gap_pct < min_gap_pct:
                continue
            fvgs.append(FairValueGap(index=i, kind="bearish", top=top, bottom=bottom))

    return fvgs


def track_fill_status(df: pd.DataFrame, fvgs: list) -> list:
    """Rule 12. Mutates each FairValueGap's status/first_fill_index/
    full_fill_index in place. Returns the same list."""
    n = len(df)
    high = df["high"].values
    low = df["low"].values

    for gap in fvgs:
        start = gap.index + 2  # first candle after the defining triplet
        for j in range(start, n):
            if gap.kind == "bullish":
                if low[j] <= gap.bottom:
                    if gap.first_fill_index is None:
                        gap.first_fill_index = j
                    gap.full_fill_index = j
                    gap.status = "FILLED"
                    break
                elif low[j] <= gap.top:
                    if gap.first_fill_index is None:
                        gap.first_fill_index = j
                    gap.status = "PARTIALLY_FILLED"
                    # keep scanning -- a later candle may fully fill it
            else:  # bearish
                if high[j] >= gap.top:
                    if gap.first_fill_index is None:
                        gap.first_fill_index = j
                    gap.full_fill_index = j
                    gap.status = "FILLED"
                    break
                elif high[j] >= gap.bottom:
                    if gap.first_fill_index is None:
                        gap.first_fill_index = j
                    gap.status = "PARTIALLY_FILLED"

    return fvgs


def analyze_fvgs(df: pd.DataFrame, min_gap_pct: float = DEFAULT_MIN_GAP_PCT) -> list:
    """Public entry point for Phase 4. Detects gaps (Rule 11) and tracks
    their fill status against the same df (Rule 12)."""
    fvgs = detect_fvgs(df, min_gap_pct=min_gap_pct)
    track_fill_status(df, fvgs)
    return fvgs
