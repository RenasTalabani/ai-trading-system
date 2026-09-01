"""
Quality Engine — Phase 7 of the Order Block Intelligence Engine
(2026-09-01, RENO Order Block deep-audit build-out).

Purpose: turn the REAL evidence produced by Phases 1-6 (structure bias
alignment, a genuine liquidity sweep before formation, a nearby Fair
Value Gap, premium/discount positioning, higher-timeframe agreement) plus
the existing engine's own strength score into ONE documented, weighted
quality grade -- the thing the user's original template asked for
("QUALITY A+") but built from real, falsifiable inputs instead of a
field name with nothing behind it.

This module does no detection of its own and fetches nothing -- it is a
pure aggregator over whatever evidence the caller already has. Not every
caller will have every piece of evidence available yet (Phases 4/5/6 are
not wired into order_block_engine.py's live output as of this phase --
that wiring is Phase 12's job); this module is built to handle partial
evidence honestly rather than assuming full evidence will always be
present.

────────────────────────────────────────────────────────────────────────────
RULE 20 — Required input, everything else optional
────────────────────────────────────────────────────────────────────────────
The ONLY required input is `strength` (0-100), the existing engine's own
impulse/volume/wick/EMA-alignment score (order_block_engine.py's
_strength_score). Without it there is no real order block to grade at
all, so this module returns INSUFFICIENT_DATA rather than scoring a gap.

Every other input is optional and defaults to "not evaluated" (None /
"UNKNOWN"), NOT to a neutral-but-silently-assumed value -- a caller that
hasn't computed Phase 4/5/6 evidence yet gets an honest lower
`evidence_completeness_pct`, never a score that quietly pretends missing
evidence was neutral.

────────────────────────────────────────────────────────────────────────────
RULE 21 — Weighted scoring (every weight documented, not implicit)
────────────────────────────────────────────────────────────────────────────
Base: `strength` contributes up to 40 points, scaled linearly from its own
0-100 range: `strength * 0.40`.

Each of the following contributes points ONLY when real evidence exists
for it either way (agreeing OR conflicting evidence both count as real
evidence; only "not evaluated" scores zero):

  - freshness:            fresh -> +10, mitigated -> +0
  - structure alignment:  aligned_with_bias True -> +15,
                           aligned_with_bias False -> -15 (a real conflict
                           with current bias is negative evidence, not
                           neutral -- an OB fighting the prevailing trend
                           is genuinely lower quality, not "no signal"),
                           None (bias UNKNOWN or unavailable) -> +0
  - liquidity confluence:  a genuine swept_pool_before_formation present
                           -> +15, absent/unavailable -> +0 (absence of a
                           sweep is not NEGATIVE evidence -- plenty of
                           real OBs form without one -- so this is the one
                           dimension that is asymmetric: only a confirmed
                           presence adds points, never a penalty for
                           absence)
  - FVG confluence:        a same-direction Fair Value Gap near this OB's
                           zone -> +10, absent/unavailable -> +0
                           (asymmetric, same reasoning as liquidity above)
  - premium/discount fit:  price in the FAVORABLE zone for this OB's
                           direction (discount for a bullish OB, premium
                           for a bearish OB) -> +10; UNFAVORABLE zone
                           (premium for bullish, discount for bearish)
                           -> -10; EQUILIBRIUM or unavailable -> +0
  - HTF alignment:         ALIGNED -> +10, CONFLICTING -> -15 (weighted
                           heavier than a favorable alignment bonus,
                           deliberately -- a higher timeframe actively
                           disagreeing is a stronger warning than a
                           same-direction HTF is a confirmation),
                           UNKNOWN/NOT_APPLICABLE -> +0

Raw total is clamped to [0, 100] (a maximally-conflicting OB could
otherwise score below zero, which is not a meaningful "quality").

────────────────────────────────────────────────────────────────────────────
RULE 22 — Letter grade thresholds (documented, not implicit)
────────────────────────────────────────────────────────────────────────────
  score >= 90 -> "A+"     70 <= score < 90 -> "A"    55 <= score < 70 -> "B"
  40 <= score < 55 -> "C"  25 <= score < 40 -> "D"    score < 25 -> "F"

These thresholds are a documented, tunable choice (not a formula derived
from historical outcomes -- that validation is Phase 10's job, not this
phase's). Phase 10's historical validation is the intended future check
on whether these grade bands actually correlate with real outcomes;
until that exists, this grade is a structured evidence summary, not a
back-tested prediction of anything.

────────────────────────────────────────────────────────────────────────────
RULE 23 — Evidence completeness (never hide how much was actually known)
────────────────────────────────────────────────────────────────────────────
`evidence_completeness_pct` = (number of the 6 optional dimensions that
were REAL evidence, i.e. not None/UNKNOWN/NOT_APPLICABLE) / 6. A grade
computed from 1 of 6 available dimensions is real (Rule 21's math is the
same either way) but is reported alongside this completeness figure so a
caller/UI is never left presenting a confident-looking "A+" as if it
came from full evidence when most inputs were actually unavailable.
"""
from __future__ import annotations

from typing import Optional

STRENGTH_WEIGHT = 0.40

FRESHNESS_POINTS = {"fresh": 10, "mitigated": 0}
STRUCTURE_ALIGNED_POINTS = 15
STRUCTURE_CONFLICT_POINTS = -15
LIQUIDITY_CONFLUENCE_POINTS = 15
FVG_CONFLUENCE_POINTS = 10
PREMIUM_DISCOUNT_FAVORABLE_POINTS = 10
PREMIUM_DISCOUNT_UNFAVORABLE_POINTS = -10
HTF_ALIGNED_POINTS = 10
HTF_CONFLICTING_POINTS = -15

GRADE_THRESHOLDS = [
    (90, "A+"), (70, "A"), (55, "B"), (40, "C"), (25, "D"), (0, "F"),
]


def _grade_for_score(score: float) -> str:
    for threshold, grade in GRADE_THRESHOLDS:
        if score >= threshold:
            return grade
    return "F"


def score_order_block_quality(
    strength: Optional[float],
    freshness: Optional[str] = None,
    structure_aligned_with_bias: Optional[bool] = None,
    liquidity_sweep_confluence: Optional[dict] = None,
    fvg_confluence: Optional[bool] = None,
    premium_discount_fit: Optional[str] = None,   # "FAVORABLE" | "UNFAVORABLE" | "EQUILIBRIUM" | None
    htf_alignment: Optional[str] = None,           # "ALIGNED" | "CONFLICTING" | "UNKNOWN" | "NOT_APPLICABLE" | None
) -> dict:
    """Rules 20-23. `strength` is the only required input; everything else
    defaults to "not evaluated" and contributes 0 points plus lowers
    evidence_completeness_pct, never silently assumed neutral-but-real."""
    if strength is None:
        return {
            "status": "INSUFFICIENT_DATA",
            "reason": "No base strength score provided -- nothing to grade",
            "score": None, "grade": None, "evidence_completeness_pct": None,
            "breakdown": None,
        }

    breakdown = {"strength": round(strength * STRENGTH_WEIGHT, 2)}
    evaluated = 0  # out of 6 optional dimensions

    if freshness in FRESHNESS_POINTS:
        breakdown["freshness"] = FRESHNESS_POINTS[freshness]
        evaluated += 1
    else:
        breakdown["freshness"] = 0

    if structure_aligned_with_bias is True:
        breakdown["structure_alignment"] = STRUCTURE_ALIGNED_POINTS
        evaluated += 1
    elif structure_aligned_with_bias is False:
        breakdown["structure_alignment"] = STRUCTURE_CONFLICT_POINTS
        evaluated += 1
    else:
        breakdown["structure_alignment"] = 0

    if liquidity_sweep_confluence:
        breakdown["liquidity_confluence"] = LIQUIDITY_CONFLUENCE_POINTS
        evaluated += 1
    else:
        breakdown["liquidity_confluence"] = 0
        # Rule 21: absence is not itself "evaluated evidence" in the sense
        # of contributing to completeness -- the caller may simply not
        # have computed Phase 2 liquidity data at all. Only a genuine
        # confirmed sweep (a dict, not None/{}) counts as evaluated.

    if fvg_confluence is True:
        breakdown["fvg_confluence"] = FVG_CONFLUENCE_POINTS
        evaluated += 1
    elif fvg_confluence is False:
        breakdown["fvg_confluence"] = 0
        evaluated += 1  # a real "checked, none found" is still evaluated evidence
    else:
        breakdown["fvg_confluence"] = 0

    if premium_discount_fit == "FAVORABLE":
        breakdown["premium_discount_fit"] = PREMIUM_DISCOUNT_FAVORABLE_POINTS
        evaluated += 1
    elif premium_discount_fit == "UNFAVORABLE":
        breakdown["premium_discount_fit"] = PREMIUM_DISCOUNT_UNFAVORABLE_POINTS
        evaluated += 1
    elif premium_discount_fit == "EQUILIBRIUM":
        breakdown["premium_discount_fit"] = 0
        evaluated += 1
    else:
        breakdown["premium_discount_fit"] = 0

    if htf_alignment == "ALIGNED":
        breakdown["htf_alignment"] = HTF_ALIGNED_POINTS
        evaluated += 1
    elif htf_alignment == "CONFLICTING":
        breakdown["htf_alignment"] = HTF_CONFLICTING_POINTS
        evaluated += 1
    else:
        breakdown["htf_alignment"] = 0
        # "UNKNOWN"/"NOT_APPLICABLE"/None all count as not-evaluated

    raw_score = sum(breakdown.values())
    score = max(0.0, min(100.0, raw_score))
    grade = _grade_for_score(score)
    completeness_pct = round(evaluated / 6 * 100, 1)

    return {
        "status": "OK",
        "reason": None,
        "score": round(score, 2),
        "grade": grade,
        "evidence_completeness_pct": completeness_pct,
        "breakdown": breakdown,
    }
