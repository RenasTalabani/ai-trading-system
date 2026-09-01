"""
Order Block State Machine — Phase 8 of the Order Block Intelligence Engine
(2026-09-01, RENO Order Block deep-audit build-out).

Purpose: replace the existing engine's single ad-hoc "fresh"/"mitigated"
freshness field (a simple touch-count check baked into the detection
loop) with a richer, explicitly-defined life-cycle state, computed as a
separate pass over the same OHLCV data -- so an Order Block's current
status is one of exactly seven well-defined, mutually-exclusive states,
each with a real trigger condition, not a vibe.

────────────────────────────────────────────────────────────────────────────
The seven states
────────────────────────────────────────────────────────────────────────────
  FRESH        -- formed, never touched again, not old enough to expire.
  APPROACHING  -- never touched, but CURRENT price is close to the zone
                  (a live "watch this" status -- inherently about the most
                  recent candle, not history).
  EXPIRED      -- never touched, and too much time has passed since
                  formation for it to still be considered live/relevant.
  TESTED       -- touched exactly once, never invalidated, hasn't reacted
                  away yet.
  MITIGATED    -- touched two or more times, never invalidated, hasn't
                  reacted away yet (matches the existing engine's own
                  "mitigated" vocabulary: watered down by repeated
                  touches, but not yet discarded).
  REACTED      -- touched at least once, and price later moved away from
                  the zone by a real, defined distance in the OB's favor
                  -- the zone "worked."
  INVALIDATED  -- a candle CLOSED all the way through the zone in the
                  adverse direction (the same close-only-break rule as
                  Phase 1's Rule 5 -- a wick alone never invalidates).

────────────────────────────────────────────────────────────────────────────
RULE 24 — Touch, reaction, and invalidation triggers
────────────────────────────────────────────────────────────────────────────
Scanning starts the candle AFTER the OB's own IMPULSE candle (matching
order_block_engine.py's existing freshness check, which uses
`df.iloc[impulse_index + 1:]` -- kept consistent rather than inventing a
different starting point).

For a BULLISH OB (zone = [zone_low, zone_high], support-style):
  - TOUCH: a candle's `low` <= zone_high (price wicked back into the zone).
  - INVALIDATION: a candle's `close` < zone_low (structurally broke the
    zone's own low -- close-only, per Rule 5's precedent).
  - REACTION: AT OR AFTER the first touch (the same candle can both
    touch and react -- a sharp V-shaped reversal candle is a real, valid
    reaction, not a case this module treats specially), a candle's `high`
    reaches zone_high + reaction_multiplier * (zone_high - zone_low) --
    price moved away by a full zone-height (default multiplier 1.0,
    documented and tunable) in the bullish direction.

BEARISH OB is the exact mirror (zone_low/zone_high roles swapped, `high`/
`low`/`close` comparisons flipped).

────────────────────────────────────────────────────────────────────────────
RULE 25 — State precedence (final status is not just "the last event")
────────────────────────────────────────────────────────────────────────────
Evaluated in this exact order, first match wins -- deliberately NOT just
"whatever happened most recently," because some outcomes are more
decisive than others regardless of ordering:

  1. INVALIDATED if it ever happened, anywhere in the scanned history --
     even after a prior REACTED. A later full close-through means the
     zone is structurally broken now; a past reaction does not un-break
     it.
  2. REACTED if it happened (and no invalidation ever occurred) -- the
     zone did its job at least once.
  3. MITIGATED if touched 2+ times (no invalidation, no reaction yet).
  4. TESTED if touched exactly once (no invalidation, no reaction yet).
  5. EXPIRED if never touched AND `age_candles` (distance from formation
     to the last available candle) exceeds `max_age_candles` (default
     200 -- a documented, tunable default; Phase 10's historical
     validation is the intended future check on whether 200 is actually a
     good cutoff, not this phase's job).
  6. APPROACHING if never touched, not expired, and the CURRENT (last)
     candle's close is within `approach_pct` (default 1%) of the nearest
     zone edge.
  7. FRESH otherwise (never touched, not expired, not currently close).

────────────────────────────────────────────────────────────────────────────
RULE 26 — Edge cases
────────────────────────────────────────────────────────────────────────────
  - formation_index at or after the last available candle (nothing to
    scan yet): INSUFFICIENT_DATA rather than guessing FRESH.
  - Empty/too-short df, or a formation_index out of range: INSUFFICIENT_DATA.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

import pandas as pd

DEFAULT_REACTION_MULTIPLIER = 1.0
DEFAULT_MAX_AGE_CANDLES = 200
DEFAULT_APPROACH_PCT = 0.01  # 1%


@dataclass
class OBStateResult:
    status: str                                  # one of the 7 states, or INSUFFICIENT_DATA
    reason: Optional[str] = None
    touch_count: int = 0
    first_touch_index: Optional[int] = None
    reacted_index: Optional[int] = None
    invalidated_index: Optional[int] = None
    age_candles: Optional[int] = None

    def to_dict(self) -> dict:
        return {
            "status": self.status,
            "reason": self.reason,
            "touch_count": self.touch_count,
            "first_touch_index": self.first_touch_index,
            "reacted_index": self.reacted_index,
            "invalidated_index": self.invalidated_index,
            "age_candles": self.age_candles,
        }


def compute_ob_state(df: pd.DataFrame, ob_type: str, zone_low: float, zone_high: float,
                      formation_index: int,
                      reaction_multiplier: float = DEFAULT_REACTION_MULTIPLIER,
                      max_age_candles: int = DEFAULT_MAX_AGE_CANDLES,
                      approach_pct: float = DEFAULT_APPROACH_PCT) -> OBStateResult:
    """Rules 24-26. `formation_index` is the OB's impulse candle index
    (matches order_block_engine.py's own freshness-check convention)."""
    n = len(df)
    if n == 0 or formation_index is None or formation_index >= n - 1:
        return OBStateResult(status="INSUFFICIENT_DATA",
                              reason="No candles available after formation to evaluate state")

    zone_height = zone_high - zone_low
    high = df["high"].values
    low = df["low"].values
    close = df["close"].values

    touch_count = 0
    first_touch_index = None
    reacted_index = None
    invalidated_index = None

    for j in range(formation_index + 1, n):
        if ob_type == "bullish":
            if close[j] < zone_low:
                invalidated_index = j
                # Keep scanning is unnecessary for correctness (Rule 25
                # gives INVALIDATED absolute priority regardless of what
                # else happened), but recording only the FIRST
                # invalidation is the meaningful, real event -- stop here.
                break
            if low[j] <= zone_high:
                if first_touch_index is None:
                    first_touch_index = j
                touch_count += 1
                if reacted_index is None and high[j] >= zone_high + reaction_multiplier * zone_height:
                    reacted_index = j
            elif first_touch_index is not None and reacted_index is None:
                if high[j] >= zone_high + reaction_multiplier * zone_height:
                    reacted_index = j
        else:  # bearish
            if close[j] > zone_high:
                invalidated_index = j
                break
            if high[j] >= zone_low:
                if first_touch_index is None:
                    first_touch_index = j
                touch_count += 1
                if reacted_index is None and low[j] <= zone_low - reaction_multiplier * zone_height:
                    reacted_index = j
            elif first_touch_index is not None and reacted_index is None:
                if low[j] <= zone_low - reaction_multiplier * zone_height:
                    reacted_index = j

    last_index = n - 1
    age_candles = last_index - formation_index

    if invalidated_index is not None:
        status = "INVALIDATED"
    elif reacted_index is not None:
        status = "REACTED"
    elif touch_count >= 2:
        status = "MITIGATED"
    elif touch_count == 1:
        status = "TESTED"
    elif age_candles > max_age_candles:
        status = "EXPIRED"
    else:
        current_price = float(close[last_index])
        dist_to_high = abs(current_price - zone_high) / (abs(current_price) + 1e-9)
        dist_to_low = abs(current_price - zone_low) / (abs(current_price) + 1e-9)
        if min(dist_to_high, dist_to_low) <= approach_pct:
            status = "APPROACHING"
        else:
            status = "FRESH"

    return OBStateResult(
        status=status, reason=None, touch_count=touch_count,
        first_touch_index=first_touch_index, reacted_index=reacted_index,
        invalidated_index=invalidated_index, age_candles=age_candles,
    )
