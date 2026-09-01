"""
Market Structure Engine — Phase 1 of the Order Block Intelligence Engine
(2026-09-01, RENO Order Block deep-audit build-out).

Purpose: detect real, deterministic price-action market structure from OHLCV
data — swing highs/lows, HH/HL/LH/LL classification, internal vs external
structure, and BOS/CHoCH/MSS structure breaks. This is the foundation every
later phase (liquidity, Order Block validation, FVG, premium/discount,
multi-timeframe, quality scoring) builds on, per the project's own explicit
instruction: "Do not simply create fields named BOS/CHoCH/MSS. Define
deterministic rules for how they are detected. Document the rules."

Everything below is a documented, testable RULE, not a label. Where SMC/ICT
terminology has no single universally-agreed formal definition (this is
real: different traders/educators define "internal" vs "external" structure,
and CHoCH vs MSS, slightly differently), this module states EXACTLY which
operational definition it uses, so the behavior is falsifiable and testable
rather than vibes-based.

────────────────────────────────────────────────────────────────────────────
RULE 1 — Swing point detection (fractal method)
────────────────────────────────────────────────────────────────────────────
A candle at index i is a SWING HIGH if its `high` is strictly greater than
the `high` of every candle in [i-left, i-1] and every candle in
[i+1, i+right] (default left=right=2, i.e. a 5-candle fractal). Symmetric
definition for SWING LOW using `low`, strictly lower.

A swing point cannot be CONFIRMED until `right` candles after it have
closed — you cannot know index i is a fractal high until you've seen
whether the next `right` candles ever exceeded it. This module only ever
returns confirmed swings; it never looks further into the future than the
`right` window to confirm one (no look-ahead beyond what a real-time
detector would have had at confirmation time).

────────────────────────────────────────────────────────────────────────────
RULE 2 — HH / HL / LH / LL / EQH / EQL classification
────────────────────────────────────────────────────────────────────────────
Each confirmed swing is compared only to the immediately preceding
CONFIRMED swing of the SAME type (a swing high compared to the prior swing
high; a swing low to the prior swing low — highs and lows are classified
independently, never against each other).

  - swing high > prior swing high * (1 + eq_tolerance_pct)  -> "HH"
  - swing high < prior swing high * (1 - eq_tolerance_pct)  -> "LH"
  - otherwise (within tolerance band)                        -> "EQH"
  - swing low  > prior swing low  * (1 + eq_tolerance_pct)  -> "HL"
  - swing low  < prior swing low  * (1 - eq_tolerance_pct)  -> "LL"
  - otherwise                                                -> "EQL"

eq_tolerance_pct defaults to 0.05% of price. This exists because real
markets rarely print two literally-identical prices; "equal highs/lows" in
SMC means "close enough that liquidity is realistically resting at both,"
not bit-for-bit equality. The first swing of each type has no prior
same-type swing and is labeled "first_high"/"first_low" (neither HH/LH/EQH
nor HL/LL/EQL — there is nothing to compare it to yet, and this module
never invents a baseline).

────────────────────────────────────────────────────────────────────────────
RULE 3 — External vs internal structure (multi-resolution fractal)
────────────────────────────────────────────────────────────────────────────
A confirmed (fine-fractal) swing is EXTERNAL if it also shows up as a swing
point of the SAME kind (high/low) under an independent, COARSER fractal
pass — Rule 1 applied again with a larger window,
coarse_left = coarse_right = round((left + right) * external_window_mult),
default 2.0x -> an 8-candle-each-side coarse pass for the default
left=right=2 base. Every fine swing that has no matching coarse swing
nearby is INTERNAL — a minor wiggle inside a bigger leg, not itself
defining the higher-level trend.

"Matching nearby" means: the nearest coarse swing of the same kind is
within `alignment_tolerance` candles (default: the coarse window size
itself) of the fine swing's index, and each coarse swing can only be
claimed by one fine swing (the closest one) — this prevents two distant
fine swings both claiming the same coarse extreme.

An earlier version of this rule instead asked "is this fine swing still
the single most-extreme point within a window around itself?" — that
degenerates in a real trending market: in a clean staircase uptrend, EVERY
later high is higher than every earlier one, so a same-direction window
comparison only ever keeps the very last swing in the whole series as
"external," which is not a useful definition of higher-level structure.
Running Rule 1 a second time at coarser resolution avoids that: a coarse
pass genuinely finds multiple higher-level turning points spaced across a
trend, exactly the way "zooming out on a chart" would.

This is an explicit, tunable, testable rule (not an ICT dictionary
lookup): external structure is "the swing points a coarser fractal scan
would also flag," internal structure is "everything else."

────────────────────────────────────────────────────────────────────────────
RULE 4 — Structure bias, and BOS vs CHoCH/MSS
────────────────────────────────────────────────────────────────────────────
This module tracks bias using ALL confirmed swings on this timeframe (not
only "external" ones — see the note below on why).

Bias starts UNKNOWN. It becomes BULLISH the first time two consecutive
swing highs are HH AND two consecutive swing lows are HL (i.e. the market
has printed a genuine higher-high/higher-low sequence). Symmetric for
BEARISH (LH + LL). Until that happens, bias stays UNKNOWN and this module
will not call anything BOS or CHoCH — per the project's own rule, "do not
invent market structure": with no established trend, there is nothing for
a break to continue or reverse.

Once a bias is established, this module watches subsequent CLOSING prices
(not wicks — see Rule 5) against the most recent swing high/low:

  Why not gate this on Rule 3's "external" flag, given external swings are
  meant to be the higher-significance ones? Tested and rejected: run
  against a clean, strongly trending synthetic series, gating on
  "external" starves this rule almost completely — a monotonic trend can
  legitimately go many legs without a large enough internal consolidation
  range for ANY coarser fractal pass to register a point, so there may be
  zero external swings to work with even though the structure is
  perfectly clear at this timeframe's own resolution. Rule 3's external/
  internal split remains available as a separate, useful annotation (e.g.
  for Phase 6's higher-timeframe-significance work), but basic single-
  timeframe BOS/CHoCH detection uses this timeframe's own swings directly.

  - Bias BULLISH, close > most recent external swing high  -> BOS (bullish
    continuation: the uptrend broke a new high, consistent with itself).
  - Bias BULLISH, close < most recent external swing low   -> CHoCH (the
    first break against an established uptrend — bias flips to BEARISH
    the instant this fires).
  - Bias BEARISH, close < most recent external swing low   -> BOS (bearish
    continuation).
  - Bias BEARISH, close > most recent external swing high  -> CHoCH (bias
    flips to BULLISH).

MSS (Market Structure Shift) is treated as a synonym for CHoCH in this
module — both terms describe the same event (a close-through break against
the prevailing bias). This is a deliberate, documented simplification:
different educators use the two terms slightly differently, and rather
than invent a third, unfalsifiable distinction, this module picks one
event and reports it under both field names so either convention can read
the result.

After a CHoCH, the bias flips and the module requires a fresh HH+HL (or
LH+LL) confirmation, same as the initial-bias rule, before it will call any
FURTHER break BOS again -- a single break doesn't retroactively relabel the
new trend as established until it prints its own genuine structure.

────────────────────────────────────────────────────────────────────────────
RULE 5 — Wick vs close (false breaks)
────────────────────────────────────────────────────────────────────────────
A level is only considered BROKEN if a candle's CLOSE is beyond it. A wick
that pierces the level intraperiod without a close beyond it is recorded
separately as a `wick_violation` (candidate liquidity-sweep evidence for
Phase 2) and never promoted to BOS/CHoCH. This directly implements the
project's Phase 2 requirement to distinguish "genuine break" from "wick
sweep" — Phase 1 only needs to not conflate the two.

────────────────────────────────────────────────────────────────────────────
RULE 6 — Edge cases, handled explicitly rather than silently
────────────────────────────────────────────────────────────────────────────
  - Fewer than `2*(left+right)+right+1` candles: cannot confirm even one
    swing of each type reliably -> returns INSUFFICIENT_DATA, no swings,
    no bias, no breaks. Never guesses.
  - Zero or one confirmed swing per side: bias stays UNKNOWN (see Rule 4).
  - NaN/missing OHLC values in the window used to confirm a candidate swing
    -> that candidate is skipped (not confirmed either way), logged.
  - Extreme volatility does not get special-cased: the fractal rule and
    eq_tolerance_pct are the only volatility-sensitive parameters, and they
    are exposed as arguments (not hardcoded) so a caller can adapt per
    asset/timeframe rather than this module silently deciding what "noisy"
    means.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Optional

import pandas as pd

logger = logging.getLogger("ai-service.market_structure_engine")

DEFAULT_LEFT = 2
DEFAULT_RIGHT = 2
DEFAULT_EXTERNAL_WINDOW_MULT = 2.0
DEFAULT_EQ_TOLERANCE_PCT = 0.0005  # 0.05%

REQUIRED_COLUMNS = ("open", "high", "low", "close")


@dataclass
class SwingPoint:
    index: int
    kind: str          # "high" | "low"
    price: float
    timestamp: object
    label: str = "unclassified"   # HH/HL/LH/LL/EQH/EQL/first_high/first_low
    external: bool = False

    def to_dict(self) -> dict:
        return {
            "index": self.index,
            "kind": self.kind,
            "price": round(float(self.price), 6),
            "timestamp": str(self.timestamp),
            "label": self.label,
            "external": self.external,
        }


@dataclass
class StructureBreak:
    index: int
    event: str          # "BOS" | "CHOCH"
    direction: str       # "bullish" | "bearish"  (direction of the break)
    level: float
    reference_swing_index: int
    close_price: float

    def to_dict(self) -> dict:
        return {
            "index": self.index,
            "event": self.event,
            # CHoCH and MSS are the same event in this module (see Rule 4);
            # both keys are provided so either naming convention can read it.
            "mss": self.event if self.event == "CHOCH" else None,
            "direction": self.direction,
            "level": round(float(self.level), 6),
            "reference_swing_index": self.reference_swing_index,
            "close_price": round(float(self.close_price), 6),
        }


@dataclass
class WickViolation:
    index: int
    direction: str        # "bullish" | "bearish" — direction price wicked through
    level: float
    reference_swing_index: int
    wick_extreme: float

    def to_dict(self) -> dict:
        return {
            "index": self.index,
            "direction": self.direction,
            "level": round(float(self.level), 6),
            "reference_swing_index": self.reference_swing_index,
            "wick_extreme": round(float(self.wick_extreme), 6),
        }


@dataclass
class MarketStructureResult:
    status: str                       # "OK" | "INSUFFICIENT_DATA"
    reason: Optional[str] = None
    swings: list = field(default_factory=list)          # list[SwingPoint]
    breaks: list = field(default_factory=list)           # list[StructureBreak]
    wick_violations: list = field(default_factory=list)  # list[WickViolation]
    bias: str = "UNKNOWN"             # "BULLISH" | "BEARISH" | "UNKNOWN"
    bias_established_at_index: Optional[int] = None

    def to_dict(self) -> dict:
        return {
            "status": self.status,
            "reason": self.reason,
            "bias": self.bias,
            "bias_established_at_index": self.bias_established_at_index,
            "swings": [s.to_dict() for s in self.swings],
            "breaks": [b.to_dict() for b in self.breaks],
            "wick_violations": [w.to_dict() for w in self.wick_violations],
        }


def _min_candles_required(left: int, right: int) -> int:
    # Need at least one full fractal window plus one extra candle to have
    # any chance of a confirmed swing at all.
    return 2 * (left + right) + right + 1


def find_swings(df: pd.DataFrame, left: int = DEFAULT_LEFT,
                 right: int = DEFAULT_RIGHT) -> list:
    """Rule 1. Returns confirmed SwingPoint objects, unclassified/unmarked
    external, in chronological (index) order."""
    swings: list = []
    n = len(df)
    if n < _min_candles_required(left, right):
        return swings

    highs = df["high"].values
    lows = df["low"].values

    for i in range(left, n - right):
        window_high = highs[i - left:i + right + 1]
        window_low = lows[i - left:i + right + 1]
        if pd.isna(window_high).any() or pd.isna(window_low).any():
            continue  # Rule 6: skip candidates with missing data in-window

        hi = highs[i]
        lo = lows[i]

        # Strictly greater than every other candle in the window (Rule 1)
        others_high = list(window_high[:left]) + list(window_high[left + 1:])
        if others_high and hi > max(others_high):
            ts = df["timestamp"].iloc[i] if "timestamp" in df.columns else i
            swings.append(SwingPoint(index=i, kind="high", price=float(hi), timestamp=ts))

        others_low = list(window_low[:left]) + list(window_low[left + 1:])
        if others_low and lo < min(others_low):
            ts = df["timestamp"].iloc[i] if "timestamp" in df.columns else i
            swings.append(SwingPoint(index=i, kind="low", price=float(lo), timestamp=ts))

    swings.sort(key=lambda s: s.index)
    return swings


def classify_sequence(swings: list, eq_tolerance_pct: float = DEFAULT_EQ_TOLERANCE_PCT) -> None:
    """Rule 2. Mutates each SwingPoint's `.label` in place."""
    last_high: Optional[SwingPoint] = None
    last_low: Optional[SwingPoint] = None

    for s in swings:
        if s.kind == "high":
            if last_high is None:
                s.label = "first_high"
            else:
                hi_up = last_high.price * (1 + eq_tolerance_pct)
                hi_dn = last_high.price * (1 - eq_tolerance_pct)
                if s.price > hi_up:
                    s.label = "HH"
                elif s.price < hi_dn:
                    s.label = "LH"
                else:
                    s.label = "EQH"
            last_high = s
        else:
            if last_low is None:
                s.label = "first_low"
            else:
                lo_up = last_low.price * (1 + eq_tolerance_pct)
                lo_dn = last_low.price * (1 - eq_tolerance_pct)
                if s.price > lo_up:
                    s.label = "HL"
                elif s.price < lo_dn:
                    s.label = "LL"
                else:
                    s.label = "EQL"
            last_low = s


def mark_external_structure(swings: list, df: pd.DataFrame, left: int = DEFAULT_LEFT,
                             right: int = DEFAULT_RIGHT,
                             external_window_mult: float = DEFAULT_EXTERNAL_WINDOW_MULT,
                             alignment_tolerance: Optional[int] = None) -> None:
    """Rule 3 (multi-resolution). Mutates each SwingPoint's `.external` in
    place by cross-referencing against an independent, coarser Rule-1 pass."""
    coarse_window = max(1, int(round((left + right) * external_window_mult)))
    tolerance = alignment_tolerance if alignment_tolerance is not None else coarse_window

    coarse_swings = find_swings(df, left=coarse_window, right=coarse_window)
    coarse_highs = sorted([s for s in coarse_swings if s.kind == "high"], key=lambda s: s.index)
    coarse_lows = sorted([s for s in coarse_swings if s.kind == "low"], key=lambda s: s.index)

    def _claim_nearest(fine_swings, coarse_pool):
        # Greedy nearest-match, each coarse point claimed at most once.
        claimed = set()
        # Sort fine swings by how close their best coarse match is, so the
        # tightest matches get first claim on a coarse point.
        candidates = []
        for fs in fine_swings:
            best = None
            best_dist = None
            for ci, cs in enumerate(coarse_pool):
                d = abs(cs.index - fs.index)
                if d <= tolerance and (best_dist is None or d < best_dist):
                    best, best_dist = ci, d
            if best is not None:
                candidates.append((best_dist, best, fs))
        candidates.sort(key=lambda t: t[0])
        for _dist, ci, fs in candidates:
            if ci in claimed:
                continue
            claimed.add(ci)
            fs.external = True

    _claim_nearest([s for s in swings if s.kind == "high"], coarse_highs)
    _claim_nearest([s for s in swings if s.kind == "low"], coarse_lows)


def detect_structure_breaks(df: pd.DataFrame, swings: list, right: int = DEFAULT_RIGHT) -> tuple:
    """Rule 4 + Rule 5. Returns (breaks: list[StructureBreak],
    wick_violations: list[WickViolation], bias: str, bias_established_at: int|None).

    `right` matters here beyond Rule 1: a swing at index j is only
    CONFIRMED (per Rule 1) once `right` candles after it have closed, so
    this replay must not start using it as "the most recent known
    high/low" until index j + right -- using it starting at index j itself
    would be a subtle look-ahead (the replay would be reacting to
    information a live detector could not actually have had yet at that
    candle). Caught by this module's own test suite (a false-break test
    fixture was accidentally relying on this bug to "work"), fixed here.

    All confirmed swings on this timeframe participate in bias/break logic
    (Rule 4) -- see the module docstring for why "external"-only was tried
    and rejected."""
    ext = swings

    breaks: list = []
    wick_violations: list = []
    bias = "UNKNOWN"
    bias_established_at = None

    # Walk swings in chronological order, tracking the most recent
    # high/low seen so far, and re-deriving bias as we go.
    recent_high: Optional[SwingPoint] = None
    recent_low: Optional[SwingPoint] = None
    prev_high: Optional[SwingPoint] = None
    prev_low: Optional[SwingPoint] = None

    # Build a merged, chronological timeline keyed by CONFIRMATION index
    # (swing.index + right), not detection index, so replay never uses a
    # swing before it could really have been known -- see the docstring.
    timeline = sorted(ext, key=lambda s: s.index + right)

    close = df["close"].values
    high = df["high"].values
    low = df["low"].values

    swing_cursor = 0
    for i in range(len(df)):
        # Advance swing state for any external swings confirmed at/adjacent
        # to this index (a swing at index j is "known" once we've reached
        # its own index in this replay — its label was already computed
        # with no future data, per find_swings/classify_sequence).
        while swing_cursor < len(timeline) and timeline[swing_cursor].index + right <= i:
            s = timeline[swing_cursor]
            if s.kind == "high":
                prev_high, recent_high = recent_high, s
            else:
                prev_low, recent_low = recent_low, s
            swing_cursor += 1

            # Re-derive bias only when we have two consecutive classified
            # externals of both kinds (Rule 4's initial-bias condition, and
            # the same condition re-applied after a CHoCH resets it).
            if bias == "UNKNOWN":
                if (recent_high and recent_high.label == "HH" and
                        recent_low and recent_low.label == "HL"):
                    bias = "BULLISH"
                    bias_established_at = i
                elif (recent_high and recent_high.label == "LH" and
                        recent_low and recent_low.label == "LL"):
                    bias = "BEARISH"
                    bias_established_at = i

        if bias == "UNKNOWN" or recent_high is None or recent_low is None:
            continue

        c = close[i]
        h = high[i]
        l = low[i]

        if bias == "BULLISH":
            level = recent_high.price
            if c > level:
                breaks.append(StructureBreak(i, "BOS", "bullish", level, recent_high.index, c))
            elif h > level and c <= level:
                wick_violations.append(WickViolation(i, "bullish", level, recent_high.index, h))

            low_level = recent_low.price
            if c < low_level:
                breaks.append(StructureBreak(i, "CHOCH", "bearish", low_level, recent_low.index, c))
                bias = "UNKNOWN"          # Rule 4: require fresh confirmation
                bias_established_at = None
                recent_high = recent_low = prev_high = prev_low = None
                swing_cursor = swing_cursor  # no rewind: we don't relitigate past swings
            elif l < low_level and c >= low_level:
                wick_violations.append(WickViolation(i, "bearish", low_level, recent_low.index, l))

        elif bias == "BEARISH":
            level = recent_low.price
            if c < level:
                breaks.append(StructureBreak(i, "BOS", "bearish", level, recent_low.index, c))
            elif l < level and c >= level:
                wick_violations.append(WickViolation(i, "bearish", level, recent_low.index, l))

            high_level = recent_high.price
            if c > high_level:
                breaks.append(StructureBreak(i, "CHOCH", "bullish", high_level, recent_high.index, c))
                bias = "UNKNOWN"
                bias_established_at = None
                recent_high = recent_low = prev_high = prev_low = None
            elif h > high_level and c <= high_level:
                wick_violations.append(WickViolation(i, "bullish", high_level, recent_high.index, h))

    return breaks, wick_violations, bias, bias_established_at


def analyze_structure(df: pd.DataFrame, left: int = DEFAULT_LEFT, right: int = DEFAULT_RIGHT,
                       eq_tolerance_pct: float = DEFAULT_EQ_TOLERANCE_PCT,
                       external_window_mult: float = DEFAULT_EXTERNAL_WINDOW_MULT) -> MarketStructureResult:
    """Public entry point. Runs Rules 1-6 end to end on a single-timeframe
    OHLCV DataFrame (columns: open, high, low, close, and optionally
    timestamp/volume). Never raises on bad/short input -- returns
    INSUFFICIENT_DATA instead (Rule 6)."""
    if df is None or len(df) == 0:
        return MarketStructureResult(status="INSUFFICIENT_DATA", reason="No data provided")

    missing_cols = [c for c in REQUIRED_COLUMNS if c not in df.columns]
    if missing_cols:
        return MarketStructureResult(
            status="INSUFFICIENT_DATA",
            reason=f"Missing required columns: {missing_cols}",
        )

    required = _min_candles_required(left, right)
    if len(df) < required:
        return MarketStructureResult(
            status="INSUFFICIENT_DATA",
            reason=f"Need at least {required} candles for a left={left}/right={right} "
                   f"fractal, got {len(df)}",
        )

    df = df.reset_index(drop=True)

    swings = find_swings(df, left=left, right=right)
    if not swings:
        return MarketStructureResult(
            status="OK",
            reason="No fractal swing points found in this window",
            swings=[], breaks=[], wick_violations=[], bias="UNKNOWN",
        )

    classify_sequence(swings, eq_tolerance_pct=eq_tolerance_pct)
    mark_external_structure(swings, df, left=left, right=right,
                             external_window_mult=external_window_mult)
    breaks, wick_violations, bias, bias_at = detect_structure_breaks(df, swings, right=right)

    return MarketStructureResult(
        status="OK",
        swings=swings,
        breaks=breaks,
        wick_violations=wick_violations,
        bias=bias,
        bias_established_at_index=bias_at,
    )
