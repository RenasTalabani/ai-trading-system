"""
Setup Generation Engine — Phase 9 of the Order Block Intelligence Engine
(2026-09-01, RENO Order Block deep-audit build-out).

Purpose: turn an Order Block's real state (Phase 8) and real quality
grade (Phase 7) into either a genuine, real-number entry/SL/TP setup, or
an honest WAIT -- never a setup manufactured just to produce output. Per
this build-out's explicit rule: "The objective is NOT to make RENO
produce more trades. The objective is to make RENO produce
BETTER-EVIDENCED analysis." A WAIT verdict with a clear reason is a
correct, complete answer, not a failure to produce one.

This module fetches nothing and detects nothing new -- it is the final
aggregation step over Phases 1-8's already-computed outputs, same
pattern as Phase 7.

────────────────────────────────────────────────────────────────────────────
RULE 27 — Which states are even eligible for a NEW setup
────────────────────────────────────────────────────────────────────────────
Only Phase 8's TESTED and APPROACHING states represent a genuine live
decision point:
  - TESTED: price just touched the zone and is presumably at/near it
    right now -- the classic real entry trigger.
  - APPROACHING: price is closing in on the zone -- a real "about to
    matter" moment.

Every other state is a WAIT, with a state-specific reason, never an
attempted setup:
  - FRESH: no price interaction at all yet -- nothing to act on now
    (it's a level to watch, not a trigger).
  - MITIGATED: watered down by 2+ touches -- real SMC practice treats a
    repeatedly-tested zone as weaker, not equally tradeable.
  - REACTED: the move already happened -- chasing an already-reacted OB
    is not a new opportunity.
  - INVALIDATED / EXPIRED: the zone is dead or stale.
  - Any unrecognized/INSUFFICIENT_DATA state: WAIT, defensively.

────────────────────────────────────────────────────────────────────────────
RULE 28 — Quality gate
────────────────────────────────────────────────────────────────────────────
Even in an eligible state, no setup is generated unless Phase 7's grade
is at least `min_grade` (default "B") AND evidence_completeness_pct is at
least `min_completeness_pct` (default 33.0, i.e. at least 2 of the 6
optional evidence dimensions were real, not just the mandatory strength
score). Both gates exist independently: a high score computed from almost
no real evidence should not drive a live setup any more than a
low-completeness-but-otherwise-fine score should.

────────────────────────────────────────────────────────────────────────────
RULE 29 — Take-profit: prefer a real liquidity target over a fixed ratio
────────────────────────────────────────────────────────────────────────────
If the caller supplies Phase 2's resting liquidity pools, this module
looks for the NEAREST still-RESTING pool on the OPPOSITE side, beyond the
entry price in the OB's favor (buy_side pool above entry for a bullish
setup, sell_side pool below entry for a bearish setup) -- a real,
specific piece of "there is genuine resting liquidity here" evidence,
not an arbitrary multiple.

If no such pool exists, OR the nearest one would give a risk:reward below
`min_acceptable_rr` (default 1.0 -- a real target that's barely better
than break-even isn't a useful setup target), this module falls back to
a FIXED risk:reward multiple (`fixed_rr_fallback`, default 2.0) from the
stop loss instead. Which method actually produced the TP is always
reported in `tp_method` ("LIQUIDITY_TARGET" or "FIXED_RR_FALLBACK") --
never presented as "found real liquidity" when it wasn't.

────────────────────────────────────────────────────────────────────────────
RULE 30 — Stop loss and Rule 31 — real risk:reward
────────────────────────────────────────────────────────────────────────────
Stop loss reuses the EXISTING engine's own convention exactly (0.5%
beyond the zone edge -- order_block_engine.py's `_generate_signal`),
rather than inventing a new buffer: `zone_low * (1 - sl_buffer_pct)` for
bullish, `zone_high * (1 + sl_buffer_pct)` for bearish.

`risk_reward` is ALWAYS computed for real from the actual entry
(zone midpoint), stop loss, and take-profit distances -- never the
hardcoded "1:2" string the Phase 0 audit found in the existing engine's
signal generator (that hardcoding wasn't actually wrong there, since its
TP was always constructed to be exactly 2x by formula -- but this
module's TP can now be a real liquidity level with a genuinely different
ratio, so the string must reflect the real computed number).
"""
from __future__ import annotations

from typing import Optional

DEFAULT_MIN_GRADE = "B"
DEFAULT_MIN_COMPLETENESS_PCT = 33.0
DEFAULT_SL_BUFFER_PCT = 0.005      # matches order_block_engine.py's own 0.5%
DEFAULT_FIXED_RR_FALLBACK = 2.0
DEFAULT_MIN_ACCEPTABLE_RR = 1.0

ACTIONABLE_STATES = ("TESTED", "APPROACHING")

GRADE_RANK = {"A+": 6, "A": 5, "B": 4, "C": 3, "D": 2, "F": 1}


def _grade_meets_bar(grade: Optional[str], min_grade: str) -> bool:
    if grade not in GRADE_RANK or min_grade not in GRADE_RANK:
        return False
    return GRADE_RANK[grade] >= GRADE_RANK[min_grade]


def _find_liquidity_target(ob_type: str, entry_price: float, pools: Optional[list]) -> Optional[float]:
    """Rule 29. Nearest still-RESTING opposite-side pool beyond entry, in
    the OB's favor. None if no pools supplied or none qualify."""
    if not pools:
        return None
    side = "buy_side" if ob_type == "bullish" else "sell_side"
    candidates = [
        p for p in pools
        if p.kind == side and p.status == "RESTING"
        and ((ob_type == "bullish" and p.level > entry_price) or
             (ob_type == "bearish" and p.level < entry_price))
    ]
    if not candidates:
        return None
    if ob_type == "bullish":
        return min(candidates, key=lambda p: p.level).level  # nearest above
    return max(candidates, key=lambda p: p.level).level        # nearest below


def generate_setup(
    ob_type: str,
    zone_low: float,
    zone_high: float,
    state_status: str,
    quality_result: dict,
    pools: Optional[list] = None,
    min_grade: str = DEFAULT_MIN_GRADE,
    min_completeness_pct: float = DEFAULT_MIN_COMPLETENESS_PCT,
    sl_buffer_pct: float = DEFAULT_SL_BUFFER_PCT,
    fixed_rr_fallback: float = DEFAULT_FIXED_RR_FALLBACK,
    min_acceptable_rr: float = DEFAULT_MIN_ACCEPTABLE_RR,
) -> dict:
    """Rules 27-31. Returns either a real setup (verdict="SETUP") or an
    honest WAIT (verdict="WAIT") with a specific reason -- never a
    fabricated setup to avoid returning WAIT."""
    if state_status not in ACTIONABLE_STATES:
        return {
            "verdict": "WAIT",
            "reason": f"State is {state_status}, not an actionable entry point "
                      f"(only TESTED or APPROACHING generate a setup)",
            "entry_zone": None, "stop_loss": None, "take_profit": None,
            "risk_reward": None, "tp_method": None,
        }

    grade = quality_result.get("grade") if quality_result else None
    completeness = quality_result.get("evidence_completeness_pct") if quality_result else None

    if quality_result is None or quality_result.get("status") != "OK":
        return {
            "verdict": "WAIT",
            "reason": "Quality could not be evaluated (no valid quality_result supplied)",
            "entry_zone": None, "stop_loss": None, "take_profit": None,
            "risk_reward": None, "tp_method": None,
        }

    if not _grade_meets_bar(grade, min_grade):
        return {
            "verdict": "WAIT",
            "reason": f"Grade {grade} is below the minimum bar ({min_grade})",
            "entry_zone": None, "stop_loss": None, "take_profit": None,
            "risk_reward": None, "tp_method": None,
        }

    if completeness is None or completeness < min_completeness_pct:
        return {
            "verdict": "WAIT",
            "reason": f"Evidence completeness {completeness}% is below the minimum "
                      f"({min_completeness_pct}%) -- too little real evidence to act on",
            "entry_zone": None, "stop_loss": None, "take_profit": None,
            "risk_reward": None, "tp_method": None,
        }

    entry_price = (zone_low + zone_high) / 2.0

    if ob_type == "bullish":
        sl = zone_low * (1 - sl_buffer_pct)
    else:
        sl = zone_high * (1 + sl_buffer_pct)

    liquidity_tp = _find_liquidity_target(ob_type, entry_price, pools)
    tp_method = None
    tp = None

    if liquidity_tp is not None:
        candidate_rr = abs(liquidity_tp - entry_price) / (abs(entry_price - sl) + 1e-9)
        if candidate_rr >= min_acceptable_rr:
            tp = liquidity_tp
            tp_method = "LIQUIDITY_TARGET"

    if tp is None:
        risk = abs(entry_price - sl)
        tp = entry_price + fixed_rr_fallback * risk if ob_type == "bullish" else entry_price - fixed_rr_fallback * risk
        tp_method = "FIXED_RR_FALLBACK"

    risk_dist = abs(entry_price - sl)
    reward_dist = abs(tp - entry_price)
    rr_ratio = reward_dist / (risk_dist + 1e-9)

    return {
        "verdict": "SETUP",
        "reason": f"{state_status} state, grade {grade}, {completeness}% evidence completeness",
        "entry_zone": {"low": round(zone_low, 6), "high": round(zone_high, 6)},
        "stop_loss": round(sl, 6),
        "take_profit": round(tp, 6),
        "risk_reward": f"1:{round(rr_ratio, 2)}",
        "tp_method": tp_method,
    }
