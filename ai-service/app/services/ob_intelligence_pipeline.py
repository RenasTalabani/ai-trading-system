"""
Order Block Intelligence Pipeline — Phase 12 (safe integration) of the
Order Block Intelligence Engine (2026-09-01, RENO Order Block deep-audit
build-out).

Purpose: the single glue point that composes Phases 1-9's already-built,
already-tested engines into ONE real per-Order-Block enrichment (quality
grade, life-cycle state, entry/SL/TP setup or an honest WAIT) -- so this
work can be wired into the live `order_block_engine.py` output as
PURELY ADDITIVE new fields, exactly the way Phase 3 already added
`structure_context`/`liquidity_context` without touching detection,
scoring, signal generation, or trade execution.

This module is read-only analysis. It fetches nothing, creates no
trades, and never touches the user's paper portfolio -- it only turns
data the caller already has (an already-detected order block, the same
df already fetched, Phase 1/2's already-computed structure/pools) into
richer, real numbers.

────────────────────────────────────────────────────────────────────────────
RULE 36 — Fair Value Gap confluence (a real, bounded overlap test)
────────────────────────────────────────────────────────────────────────────
An Order Block has FVG confluence when a Fair Value Gap of the SAME
direction (`gap.kind == ob["type"]` -- "bullish"/"bearish" naming already
matches between the two engines) whose [bottom, top] band OVERLAPS the
OB's own [zone_low, zone_high] band, formed AT OR BEFORE this OB's own
impulse candle (never a later FVG -- that would be look-ahead, the same
discipline Phase 3's liquidity-sweep-confluence window already applies).
This is always a real True/False, per quality_engine.py's Rule 23 (an
explicit "checked, none found" DOES count as evaluated evidence, unlike
liquidity confluence's absence) -- this module never returns None here
once FVGs have actually been computed for the same df.

────────────────────────────────────────────────────────────────────────────
RULE 37 — Premium/discount fit (direction-aware mapping, documented)
────────────────────────────────────────────────────────────────────────────
Phase 5's `analyze_premium_discount()` reports where CURRENT PRICE sits
(PREMIUM/DISCOUNT/EQUILIBRIUM) -- a single fact about the market, not
about any specific OB. Phase 7's quality_engine expects a direction-aware
verdict (FAVORABLE/UNFAVORABLE/EQUILIBRIUM), per quality_engine.py's own
documented Rule 21: "price in the FAVORABLE zone for this OB's direction
(discount for a bullish OB, premium for a bearish OB)". This module is
the one place that mapping actually happens:

  bullish OB + DISCOUNT -> FAVORABLE     bullish OB + PREMIUM -> UNFAVORABLE
  bearish OB + PREMIUM  -> FAVORABLE     bearish OB + DISCOUNT -> UNFAVORABLE
  either OB  + EQUILIBRIUM -> EQUILIBRIUM
  premium/discount analysis unavailable (status != OK) -> None (not evaluated)

────────────────────────────────────────────────────────────────────────────
RULE 38 — Composition: what this module does and does not do
────────────────────────────────────────────────────────────────────────────
`enrich_order_block()` takes ONE already-detected order block (an OB
dict exactly as order_block_engine.py's `analyze()` already produces it,
including Phase 3's `structure_context`/`liquidity_context` -- this
module reads those rather than recomputing them, so Phase 3's existing,
already-tested logic remains the single source of truth for structure/
liquidity evidence) plus already-computed Phase 4 FVGs, Phase 5 premium/
discount result, and Phase 8's OB state, and produces:

  - `quality`: Phase 7's full score_order_block_quality() result.
  - `state`: Phase 8's compute_ob_state() result (as a dict).
  - `setup`: Phase 9's generate_setup() result -- a real SETUP or an
    honest WAIT, never fabricated.

HTF alignment (Phase 6) is OPTIONAL and degrades gracefully: if the
caller does not supply `htf_biases` (which would require fetching and
analyzing OTHER timeframes -- real network calls this module does not
make itself), `htf_alignment` stays None/NOT_APPLICABLE rather than
guessed, and quality scoring proceeds with one fewer evaluated dimension
(quality_engine.py's own Rule 23 completeness accounting already handles
this correctly -- this module does nothing special for it).

This module NEVER: fetches market data, calls order_block_engine.py's
`analyze()` (the caller does that; this module only enriches its
already-detected order_blocks), creates or modifies a trade, touches the
paper portfolio, or changes `_generate_signal`/`_fuse`'s existing
BUY/SELL/HOLD logic in any way -- it produces purely additive, new,
read-only fields for a caller (an API route, Global Scan, RENO) to
optionally surface.

────────────────────────────────────────────────────────────────────────────
RULE 39 — Edge cases
────────────────────────────────────────────────────────────────────────────
  - Any Phase 1-9 dependency unavailable/failed (structure_result is
    None, premium/discount is INSUFFICIENT_DATA, etc.): the corresponding
    quality dimension is passed as None/not-evaluated, exactly per each
    phase's own established degrade-gracefully convention. This module
    never raises on missing upstream data -- Phase 7's quality scorer and
    Phase 9's setup generator are themselves already built to handle
    partial/missing evidence honestly.
  - `enrich_order_blocks()` (plural) is a thin loop over
    `enrich_order_block()` for a whole order_blocks list -- one bad OB
    (e.g. malformed dict missing an expected key) does not abort the
    whole batch: that OB's enrichment is skipped with a logged warning
    and an `{"status": "ERROR", ...}` placeholder, and every other OB in
    the list still gets a real result.
"""
from __future__ import annotations

import logging
from typing import Optional

from app.services.ob_state_machine import compute_ob_state
from app.services.quality_engine import score_order_block_quality
from app.services.setup_engine import generate_setup
from app.services.timeframe_hierarchy import check_htf_alignment

logger = logging.getLogger("ai-service.ob_intelligence_pipeline")


def compute_fvg_confluence(ob: dict, fvgs: list) -> bool:
    """Rule 36. `fvgs` is Phase 4's analyze_fvgs(df) result (a list of
    FairValueGap objects). Always a real True/False."""
    zone_low = ob["zone"]["low"]
    zone_high = ob["zone"]["high"]
    impulse_index = ob["impulse_index"]
    ob_type = ob["type"]

    for gap in fvgs:
        if gap.kind != ob_type:
            continue
        if gap.index > impulse_index:
            continue  # never a future FVG
        if gap.bottom <= zone_high and gap.top >= zone_low:
            return True
    return False


def map_premium_discount_fit(ob_type: str, premium_discount_result: Optional[dict]) -> Optional[str]:
    """Rule 37. `premium_discount_result` is Phase 5's
    analyze_premium_discount() return dict (or None/unavailable)."""
    if not premium_discount_result or premium_discount_result.get("status") != "OK":
        return None
    zone = premium_discount_result.get("zone")
    if zone == "EQUILIBRIUM":
        return "EQUILIBRIUM"
    if zone == "DISCOUNT":
        return "FAVORABLE" if ob_type == "bullish" else "UNFAVORABLE"
    if zone == "PREMIUM":
        return "FAVORABLE" if ob_type == "bearish" else "UNFAVORABLE"
    return None


def enrich_order_block(
    ob: dict,
    df,
    fvgs: list,
    premium_discount_result: Optional[dict],
    pools: Optional[list],
    timeframe: Optional[str] = None,
    structure_bias: Optional[str] = None,
    htf_biases: Optional[dict] = None,
    max_age_candles: int = 200,
) -> dict:
    """Rule 38. `ob` must already carry Phase 3's `structure_context` and
    `liquidity_context` (order_block_engine.py's analyze() already
    produces both). Read-only; creates no trades, touches no portfolio."""
    try:
        structure_context = ob.get("structure_context") or {}
        liquidity_context = ob.get("liquidity_context") or {}

        fvg_confluence = compute_fvg_confluence(ob, fvgs)
        pd_fit = map_premium_discount_fit(ob["type"], premium_discount_result)

        htf_alignment = None
        if timeframe is not None and structure_bias is not None and htf_biases:
            htf_alignment = check_htf_alignment(timeframe, structure_bias, htf_biases)["htf_alignment"]

        quality_result = score_order_block_quality(
            strength=ob.get("strength"),
            freshness=ob.get("freshness"),
            structure_aligned_with_bias=structure_context.get("aligned_with_bias"),
            liquidity_sweep_confluence=liquidity_context.get("swept_pool_before_formation"),
            fvg_confluence=fvg_confluence,
            premium_discount_fit=pd_fit,
            htf_alignment=htf_alignment,
        )

        state_result = compute_ob_state(
            df, ob["type"], ob["zone"]["low"], ob["zone"]["high"],
            formation_index=ob["impulse_index"], max_age_candles=max_age_candles,
        )

        setup_result = generate_setup(
            ob["type"], ob["zone"]["low"], ob["zone"]["high"],
            state_result.status, quality_result, pools=pools,
        )

        return {
            "quality": quality_result,
            "state": state_result.to_dict(),
            "setup": setup_result,
        }
    except Exception as e:
        logger.warning(f"Phase 12: order block enrichment failed for one OB, skipping it: {e}")
        return {
            "quality": {"status": "ERROR", "reason": str(e)},
            "state": {"status": "ERROR", "reason": str(e)},
            "setup": {"verdict": "WAIT", "reason": f"Enrichment error: {e}"},
        }


def enrich_order_blocks(
    order_blocks: list,
    df,
    fvgs: list,
    premium_discount_result: Optional[dict],
    pools: Optional[list],
    timeframe: Optional[str] = None,
    structure_bias: Optional[str] = None,
    htf_biases: Optional[dict] = None,
    max_age_candles: int = 200,
) -> list:
    """Rule 39. Thin loop over enrich_order_block() -- one bad OB never
    aborts the whole batch. Returns a new list of enrichment dicts,
    positionally aligned with `order_blocks` (does not mutate the
    input list)."""
    results = []
    for ob in order_blocks:
        results.append(enrich_order_block(
            ob, df, fvgs, premium_discount_result, pools,
            timeframe=timeframe, structure_bias=structure_bias,
            htf_biases=htf_biases, max_age_candles=max_age_candles,
        ))
    return results
