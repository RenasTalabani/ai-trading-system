"""
Source reliability scoring.

Honesty note: this is a data-quality/consistency proxy, not verified
historical accuracy. True accuracy tracking would mean storing each
prediction with its target price/date, then coming back later to check
whether it actually happened -- a separate system of similar size to
feedback_loop.py's win-rate tracking for trading signals. That's a
deliberate, explicit scope cut for this pass (flagged to the user), not an
oversight. What this DOES do: blend a configured baseline (how much this
source is trusted going in) with two things we can measure immediately --
how often the source's content turns out to be promotional junk, and how
often its directional calls agree with the cross-source consensus.
"""

# "official" = structured API/government data (CoinGecko, FRED) -- never a
# social/community source, per the instruction to never treat social
# predictions as official facts.
BASELINE_SCORES = {
    "official": 0.95,
    "high":     0.8,
    "medium":   0.6,
    "low":      0.4,
}


def baseline_score(tier: str) -> float:
    return BASELINE_SCORES.get(tier, 0.5)


def compute_reliability(
    baseline_tier: str,
    promotional_ratio: float = 0.0,
    agreement_rate: float | None = None,
) -> float:
    """
    promotional_ratio: fraction (0-1) of this source's recent content that
        was filtered out as promotional -- pulls the score down.
    agreement_rate: fraction (0-1) of this source's directional calls that
        matched the cross-source consensus recently, or None if there
        isn't enough data yet to judge -- pulls the score up or down
        around a 0.5 (no signal) midpoint.
    """
    score = baseline_score(baseline_tier)
    score -= promotional_ratio * 0.3
    if agreement_rate is not None:
        score += (agreement_rate - 0.5) * 0.4
    return round(max(0.05, min(1.0, score)), 3)
