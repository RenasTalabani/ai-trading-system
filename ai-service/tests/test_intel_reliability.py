"""
Tests for source reliability scoring. Documents explicitly what this is
(a data-quality/consistency proxy) and what it is not (verified historical
accuracy -- see reliability.py's module docstring for why that's out of
scope for this pass).
"""
from app.services.intel.reliability import compute_reliability, baseline_score, BASELINE_SCORES


class TestBaselineScores:
    def test_official_sources_score_highest(self):
        assert baseline_score("official") == max(BASELINE_SCORES.values())

    def test_official_beats_high_beats_medium_beats_low(self):
        assert baseline_score("official") > baseline_score("high") > baseline_score("medium") > baseline_score("low")

    def test_unknown_tier_falls_back_to_a_neutral_default(self):
        assert baseline_score("nonsense_tier") == 0.5


class TestComputeReliability:
    def test_no_adjustments_returns_the_baseline(self):
        score = compute_reliability("high", promotional_ratio=0.0, agreement_rate=None)
        assert score == baseline_score("high")

    def test_high_promotional_ratio_pulls_score_down(self):
        clean = compute_reliability("high", promotional_ratio=0.0)
        spammy = compute_reliability("high", promotional_ratio=0.8)
        assert spammy < clean

    def test_high_agreement_rate_pulls_score_up(self):
        neutral = compute_reliability("medium", agreement_rate=0.5)
        agrees_often = compute_reliability("medium", agreement_rate=1.0)
        assert agrees_often > neutral

    def test_low_agreement_rate_pulls_score_down(self):
        neutral = compute_reliability("medium", agreement_rate=0.5)
        conflicts_often = compute_reliability("medium", agreement_rate=0.0)
        assert conflicts_often < neutral

    def test_score_never_exceeds_1(self):
        score = compute_reliability("official", promotional_ratio=0.0, agreement_rate=1.0)
        assert score <= 1.0

    def test_score_never_drops_below_a_small_floor(self):
        score = compute_reliability("low", promotional_ratio=1.0, agreement_rate=0.0)
        assert score >= 0.05

    def test_official_source_with_no_promo_and_no_agreement_data_stays_near_baseline(self):
        # CoinGecko/FRED: never promotional, no directional "agreement" concept applies
        score = compute_reliability("official", promotional_ratio=0.0, agreement_rate=None)
        assert score == 0.95
