"""
Cross-source agreement/conflict detection.

Compares a new insight against other recent insights for the same asset(s)
to detect whether sources are agreeing or conflicting -- per instruction,
a repeated claim is never treated as automatically true just because
multiple sources said it; this only records the agreement/conflict
relationship so it's visible, not a truth judgment.
"""
from typing import List, Optional


def find_agreements_and_conflicts(target: dict, candidates: List[dict]) -> dict:
    """
    target: the new insight (dict form) being cross-referenced.
    candidates: other recent insights for the same asset, target excluded.
    Returns agreement/conflict id lists and an agreement_rate (None if
    there's no directional claim to compare, e.g. a pure fact with no
    BUY/SELL direction).
    """
    target_direction = target.get("direction")
    directional_candidates = [c for c in candidates if c.get("direction")]

    if not target_direction or not directional_candidates:
        return {"agree_with": [], "conflict_with": [], "agreement_rate": None}

    agree_with = [c["_id"] for c in directional_candidates if c["direction"] == target_direction]
    conflict_with = [c["_id"] for c in directional_candidates if c["direction"] != target_direction]
    agreement_rate = len(agree_with) / len(directional_candidates)

    return {
        "agree_with": agree_with,
        "conflict_with": conflict_with,
        "agreement_rate": round(agreement_rate, 3),
    }


def source_agreement_rate(source: str, insights: List[dict]) -> Optional[float]:
    """
    Across a batch of insights, what fraction of `source`'s directional
    calls agreed with the majority direction among ALL OTHER sources
    active on the same asset at the same time? None if there's not enough
    cross-source data yet to judge fairly.
    """
    own = [i for i in insights if i.get("source") == source and i.get("direction")]
    if not own:
        return None

    agreements = 0
    judged = 0
    for insight in own:
        others = [
            i for i in insights
            if i.get("source") != source
            and i.get("direction")
            and set(i.get("related_assets", [])) & set(insight.get("related_assets", []))
        ]
        if not others:
            continue
        judged += 1
        buy_count  = sum(1 for o in others if o["direction"] == "BUY")
        sell_count = sum(1 for o in others if o["direction"] == "SELL")
        majority = "BUY" if buy_count >= sell_count else "SELL"
        if insight["direction"] == majority:
            agreements += 1

    if judged == 0:
        return None
    return round(agreements / judged, 3)
