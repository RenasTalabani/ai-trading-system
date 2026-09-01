"""
Timeframe Hierarchy Engine — Phase 6 of the Order Block Intelligence
Engine (2026-09-01, RENO Order Block deep-audit build-out).

Purpose: compare a timeframe's market structure bias (Phase 1) against
higher-timeframe bias, to answer "does this Order Block agree with the
bigger picture" -- without fabricating a timeframe set that doesn't
actually exist in this codebase.

────────────────────────────────────────────────────────────────────────────
RULE 17 — Which timeframe set is real (inspected, not assumed)
────────────────────────────────────────────────────────────────────────────
This codebase has TWO different things that both use timeframe-shaped
string keys, and they are NOT the same concept -- inspected directly
(app/services/order_block_engine.py and
app/services/multi_timeframe_analyzer.py) rather than assumed, per this
build-out's own explicit instruction to check before building Phase 6:

  - order_block_engine.py's `_TIMEFRAME_MAP` = {"15m": ("15m", 300),
    "1h": ("1h", 300), "4h": ("4h", 200), "1d": ("1d", 100)}. Each key IS
    its own real Binance kline interval -- this is a genuine CHART
    timeframe: "the 4h chart" fetches actual 4-hour candles. This is what
    Order Blocks are drawn on, and the only timeframe concept this phase
    uses.

  - multi_timeframe_analyzer.py's `TIMEFRAME_CONFIG` uses keys that LOOK
    the same ("1h", "4h", "1d", plus "7d"/"30d") but mean something else
    entirely: each is a forward-looking PREDICTION HORIZON, and every one
    of them fetches a DIFFERENT, usually much shorter, underlying candle
    interval (its "1h" horizon key fetches 5-MINUTE candles; its "4h" key
    fetches 15-minute candles). Treating that module's "1h"/"4h"/"1d" as
    the same thing as an Order Block's chart timeframe would silently
    compare two unrelated things under the same label. This module does
    NOT use or reference that system at all.

TIMEFRAME_ORDER below is exactly order_block_engine.py's own supported
set, ordered by real duration. If that module's supported set ever
changes, this list should be updated to match it -- it is deliberately
NOT re-derived automatically (no import of order_block_engine.py here,
to keep this module dependency-free like Phases 1-5), so a future editor
must keep the two in sync by hand; documented here so that requirement is
visible.

────────────────────────────────────────────────────────────────────────────
RULE 18 — Higher-timeframe alignment
────────────────────────────────────────────────────────────────────────────
Given the CURRENT timeframe's bias (from Phase 1's analyze_structure, run
independently per timeframe -- this module does no data fetching itself)
and a caller-supplied dict of {timeframe: bias} for zero or more OTHER
timeframes, this module only ever looks at timeframes strictly HIGHER
than the current one (never lower -- a lower timeframe's bias says
nothing about "the bigger picture").

  - If the current timeframe's own bias is UNKNOWN: `htf_alignment` =
    NOT_APPLICABLE. There is no bias to check alignment of.
  - Else, among the higher timeframes actually supplied:
      - none supplied at all (empty dict, or none of the keys are
        actually higher than the current timeframe) -> UNKNOWN (no HTF
        data available to check against -- never assumed aligned by
        default).
      - all supplied higher timeframes have bias UNKNOWN -> UNKNOWN.
      - at least one supplied higher timeframe has a KNOWN bias that
        DISAGREES with the current bias -> CONFLICTING (even if others
        agree -- a real conflict at any higher timeframe is meaningful
        and must not be hidden by averaging).
      - at least one KNOWN higher-timeframe bias, and every KNOWN one
        agrees -> ALIGNED.

Every higher timeframe examined is also returned individually, split into
`aligned_htfs` / `conflicting_htfs` / `unknown_htfs`, so a caller can see
exactly which timeframe(s) drove the verdict rather than trusting an
opaque label.

────────────────────────────────────────────────────────────────────────────
RULE 19 — Edge cases
────────────────────────────────────────────────────────────────────────────
  - An unrecognized timeframe key (not in TIMEFRAME_ORDER) passed as the
    *current* timeframe: higher_timeframes_of() returns an empty list for
    anything not recognized (never guesses an ordering for it), so
    check_htf_alignment() degrades to UNKNOWN rather than raising.
  - "1d" (the highest timeframe this codebase actually supports for Order
    Blocks) has no higher timeframe at all -- higher_timeframes_of("1d")
    is genuinely empty, and check_htf_alignment for "1d" is always
    UNKNOWN unless the caller is checking something against an even
    higher, not-yet-supported timeframe (a caller CAN still pass e.g. a
    "1w" entry and it will be honored if it's ever added to
    TIMEFRAME_ORDER -- but nothing here fabricates a "1w" that doesn't
    exist in this codebase yet).
"""
from __future__ import annotations

from typing import Optional

# Rule 17: exactly order_block_engine.py's own _TIMEFRAME_MAP keys,
# ordered by real duration (shortest to longest).
TIMEFRAME_ORDER = ["15m", "1h", "4h", "1d"]


def higher_timeframes_of(timeframe: str) -> list:
    """Rule 19. Returns every timeframe in TIMEFRAME_ORDER strictly higher
    than `timeframe`, in ascending order. Empty list if `timeframe` is
    unrecognized or is already the highest supported timeframe."""
    if timeframe not in TIMEFRAME_ORDER:
        return []
    idx = TIMEFRAME_ORDER.index(timeframe)
    return TIMEFRAME_ORDER[idx + 1:]


def check_htf_alignment(timeframe: str, bias: str, htf_biases: dict) -> dict:
    """Rule 18. `htf_biases` is a caller-supplied {timeframe: bias} dict
    for whichever other timeframes the caller has already analyzed
    (this module fetches nothing itself). Only timeframes strictly higher
    than `timeframe` are considered."""
    higher = higher_timeframes_of(timeframe)
    relevant = {tf: htf_biases[tf] for tf in higher if tf in htf_biases}

    if bias == "UNKNOWN":
        return {
            "htf_alignment": "NOT_APPLICABLE",
            "reason": "Current timeframe's own bias is UNKNOWN",
            "aligned_htfs": [], "conflicting_htfs": [], "unknown_htfs": list(relevant.keys()),
        }

    aligned = [tf for tf, b in relevant.items() if b == bias]
    conflicting = [tf for tf, b in relevant.items() if b in ("BULLISH", "BEARISH") and b != bias]
    unknown = [tf for tf, b in relevant.items() if b == "UNKNOWN"]

    if not relevant:
        alignment = "UNKNOWN"
        reason = "No higher-timeframe data supplied"
    elif conflicting:
        alignment = "CONFLICTING"
        reason = f"{len(conflicting)} higher timeframe(s) disagree with the current bias"
    elif aligned:
        alignment = "ALIGNED"
        reason = f"{len(aligned)} higher timeframe(s) agree with the current bias"
    else:
        alignment = "UNKNOWN"
        reason = "All supplied higher timeframes have UNKNOWN bias"

    return {
        "htf_alignment": alignment,
        "reason": reason,
        "aligned_htfs": aligned,
        "conflicting_htfs": conflicting,
        "unknown_htfs": unknown,
    }
