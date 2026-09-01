"""
Premium/Discount (Dealing Range) Engine — Phase 5 of the Order Block
Intelligence Engine (2026-09-01, RENO Order Block deep-audit build-out).

Purpose: classify where current price sits within the "dealing range" --
the SMC/ICT idea that price alternates between an expensive (premium) and
cheap (discount) half of its recent trading range, with buy-side setups
preferred in discount and sell-side setups preferred in premium.

────────────────────────────────────────────────────────────────────────────
RULE 14 — Dealing range anchor (documented choice, alternatives noted)
────────────────────────────────────────────────────────────────────────────
Different SMC educators anchor the dealing range differently: some use the
specific impulse leg that created the currently-active bias (Phase 1's
BOS/CHoCH), others use the full visible swing range on the chart. This
module uses the SIMPLER, more universally-taught version: the range
between the MOST RECENT confirmed swing high and the MOST RECENT confirmed
swing low from Phase 1's swing list (market_structure_engine),
independently of which one is more recent than the other, and
independently of the active bias. This is what a trader means by "draw
the range from the last visible top and bottom" -- it needs no bias state
and refreshes automatically as new swings confirm. The impulse-leg-only
alternative was considered and rejected for this phase: it would require
picking a specific leg boundary from Phase 1's break list, which is a
real design decision better deferred to Phase 6 (multi-timeframe) once
there is a concrete reason (a specific HTF leg) to anchor on, rather than
picked arbitrarily here.

range_high = the most recent confirmed swing HIGH's price.
range_low  = the most recent confirmed swing LOW's price.

If range_high <= range_low (a genuinely possible degenerate case -- e.g.
the most recent high is chronologically older and lower than a low that
has since printed in a strong downtrend, or only one swing of each kind
exists and they're not sensibly ordered), this module does NOT invent a
range. It returns INSUFFICIENT_DATA rather than a misleading inverted
range.

────────────────────────────────────────────────────────────────────────────
RULE 15 — Premium / Discount / Equilibrium classification
────────────────────────────────────────────────────────────────────────────
position_pct = (price - range_low) / (range_high - range_low)
  -- 0.0 = at range_low, 1.0 = at range_high, 0.5 = the exact midpoint
  ("equilibrium" in SMC terms).

  - position_pct > 0.5 + eq_tolerance_pct  -> PREMIUM  (upper half; the
    conventional zone to look for sell-side/bearish setups)
  - position_pct < 0.5 - eq_tolerance_pct  -> DISCOUNT (lower half; the
    conventional zone to look for buy-side/bullish setups)
  - otherwise                               -> EQUILIBRIUM (too close to
    the midpoint to call either way)

eq_tolerance_pct defaults to 0.05 (5% of the range's own width, not 5% of
price) -- a real band around the midpoint, not literal-only equality
(matching the spirit of Phase 1's eq_tolerance_pct for EQH/EQL, applied
here to range position instead of price).

`position_pct` is NOT clamped to [0, 1]: a price that has since traded
beyond either end of the dealing range (the range is stale relative to
current price) still gets a real position_pct outside that interval, and
`outside_range` is set True so a caller can see this explicitly rather
than silently receiving a clamped, misleading value. An outside-range
price is still classified PREMIUM/DISCOUNT by the same rule (an even more
extreme premium/discount reading is meaningful, not an error).

────────────────────────────────────────────────────────────────────────────
RULE 16 — Edge cases
────────────────────────────────────────────────────────────────────────────
  - No swings at all, or no swing of one kind (all highs, no lows, or vice
    versa): INSUFFICIENT_DATA -- there is no dealing range to compute.
  - range_high <= range_low: INSUFFICIENT_DATA (Rule 14).
  - NaN/invalid price input: INSUFFICIENT_DATA, never silently coerced.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

DEFAULT_EQ_TOLERANCE_PCT = 0.05  # 5% of the range's own width


@dataclass
class DealingRange:
    range_high: float
    range_low: float
    high_swing_index: int
    low_swing_index: int

    def to_dict(self) -> dict:
        return {
            "range_high": round(float(self.range_high), 6),
            "range_low": round(float(self.range_low), 6),
            "high_swing_index": self.high_swing_index,
            "low_swing_index": self.low_swing_index,
        }


def compute_dealing_range(swings: list) -> Optional[DealingRange]:
    """Rule 14. `swings` is Phase 1's confirmed swing list. Returns None
    (INSUFFICIENT_DATA territory) if no valid range can be formed."""
    highs = [s for s in swings if s.kind == "high"]
    lows = [s for s in swings if s.kind == "low"]
    if not highs or not lows:
        return None

    most_recent_high = max(highs, key=lambda s: s.index)
    most_recent_low = max(lows, key=lambda s: s.index)

    if most_recent_high.price <= most_recent_low.price:
        return None  # degenerate/inverted -- never invent a range

    return DealingRange(
        range_high=most_recent_high.price,
        range_low=most_recent_low.price,
        high_swing_index=most_recent_high.index,
        low_swing_index=most_recent_low.index,
    )


def classify_price_in_range(price: float, dealing_range: DealingRange,
                             eq_tolerance_pct: float = DEFAULT_EQ_TOLERANCE_PCT) -> dict:
    """Rule 15. Returns zone/position_pct/outside_range for `price` within
    `dealing_range`."""
    width = dealing_range.range_high - dealing_range.range_low
    position_pct = (price - dealing_range.range_low) / width

    if position_pct > 0.5 + eq_tolerance_pct:
        zone = "PREMIUM"
    elif position_pct < 0.5 - eq_tolerance_pct:
        zone = "DISCOUNT"
    else:
        zone = "EQUILIBRIUM"

    return {
        "zone": zone,
        "position_pct": round(position_pct, 6),
        "outside_range": bool(position_pct < 0.0 or position_pct > 1.0),
    }


def analyze_premium_discount(swings: list, price: float,
                              eq_tolerance_pct: float = DEFAULT_EQ_TOLERANCE_PCT) -> dict:
    """Public entry point for Phase 5. Never guesses: returns
    INSUFFICIENT_DATA when no real dealing range can be formed, or when
    `price` is not a usable finite number."""
    try:
        price_f = float(price)
        if price_f != price_f:  # NaN check without importing math
            raise ValueError("NaN price")
    except (TypeError, ValueError):
        return {"status": "INSUFFICIENT_DATA", "reason": "Invalid price input",
                "dealing_range": None, "zone": None, "position_pct": None,
                "outside_range": None}

    dealing_range = compute_dealing_range(swings)
    if dealing_range is None:
        return {"status": "INSUFFICIENT_DATA",
                "reason": "No valid dealing range (need at least one confirmed swing "
                          "high and one confirmed swing low, with high > low)",
                "dealing_range": None, "zone": None, "position_pct": None,
                "outside_range": None}

    classification = classify_price_in_range(price_f, dealing_range, eq_tolerance_pct)
    return {
        "status": "OK",
        "reason": None,
        "dealing_range": dealing_range.to_dict(),
        **classification,
    }
