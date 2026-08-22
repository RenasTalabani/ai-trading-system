"""
Tests for trade_quality_scorer (T-040, 2026-08-22 continuous-improvement pass).

Bug: `build_quality_inputs()`'s own docstring/module header promises "All
inputs are 0-100 scores", and `compute_quality_score()`'s final *output* is
clamped to [0, 100] -- but the individual `technical_strength` input was
not clamped before entering the weighted sum, even though the real value
flowing into it (GlobalAnalyzer's `adj_score = round(fs * modifier, 1)`,
via `unified_analyzer._score_to_action()`'s `confidence` capped at 95 and
`RegimeDetector.regime_score_modifier()`'s 1.10 multiplier for a
TRENDING-regime BUY) can reach up to 95 * 1.10 = 104.5 in production --
above the documented bound. Because this happens before the final clamp,
the weighted score can be silently inflated without ever being caught by
`compute_quality_score()`'s own `min(100.0, ...)` (e.g. technical=104.5,
sentiment=macro=volume=50 -> 71.8 instead of the correct 70.0), which is
enough to flip a trade across QUALITY_THRESHOLD=75 right at the boundary.

Fixed by clamping `technical_strength` and `sentiment_alignment` (the two
components built from externally-sourced, not-independently-bounded
inputs) to [0, 100] in `build_quality_inputs()` before they're returned.

Zero prior test coverage existed for this module before this pass.
"""
import pytest

from app.services.trade_quality_scorer import (
    compute_quality_score,
    build_quality_inputs,
    passes_quality_gate,
    QUALITY_THRESHOLD,
)


class TestComputeQualityScoreWeightingAndClamp:
    def test_all_components_at_100_yields_100(self):
        assert compute_quality_score(100, 100, 100, 100) == 100.0

    def test_all_components_at_0_yields_0(self):
        assert compute_quality_score(0, 0, 0, 0) == 0.0

    def test_weighted_average_matches_documented_weights(self):
        # technical=40% sentiment=25% macro=25% volume=10%
        score = compute_quality_score(
            technical_strength=80, sentiment_alignment=60,
            macro_alignment=60, volume_confirmation=40,
        )
        expected = round(80 * 0.40 + 60 * 0.25 + 60 * 0.25 + 40 * 0.10, 1)
        assert score == expected

    def test_output_is_clamped_even_if_a_caller_passes_out_of_range_inputs(self):
        # compute_quality_score() itself has always clamped its *output* --
        # this is a pre-existing guarantee, not part of the T-040 fix, and
        # is kept as a regression guard.
        assert compute_quality_score(500, 500, 500, 500) == 100.0
        assert compute_quality_score(-500, -500, -500, -500) == 0.0


class TestBuildQualityInputsClampsTechnicalStrength:
    def test_fused_score_above_100_is_clamped_to_100(self):
        # Regression guard for the T-040 bug: a TRENDING-regime BUY with
        # confidence 95 and modifier 1.10 produces adj_score = 104.5,
        # which GlobalAnalyzer passes straight through as "fused_score".
        opp = {"action": "BUY", "fused_score": 104.5, "news_score": 50, "vol_ratio": 1.0}
        inputs = build_quality_inputs(opp, "neutral")
        assert inputs["technical_strength"] == 100.0

    def test_fused_score_below_0_is_clamped_to_0(self):
        opp = {"action": "SELL", "fused_score": -12.0, "news_score": 50, "vol_ratio": 1.0}
        inputs = build_quality_inputs(opp, "neutral")
        assert inputs["technical_strength"] == 0.0

    def test_in_range_fused_score_is_unchanged(self):
        opp = {"action": "BUY", "fused_score": 82.3, "news_score": 50, "vol_ratio": 1.0}
        inputs = build_quality_inputs(opp, "neutral")
        assert inputs["technical_strength"] == 82.3

    def test_overflow_no_longer_silently_inflates_quality_score_past_correct_value(self):
        # This is the exact scenario from the bug analysis: with the
        # unclamped technical_strength=104.5 the weighted score would have
        # been 71.8 (still under 100, so the *output* clamp never caught
        # it). With the fix, technical_strength is clamped to 100 first,
        # producing the mathematically correct 70.0.
        # vol_ratio=1.25 -> vol_score=(1.25-0.5)/1.5*100=50.0, matching the
        # sentiment/macro=50 used here so the arithmetic below is exact.
        opp = {"action": "BUY", "fused_score": 104.5, "news_score": 50, "vol_ratio": 1.25}
        inputs = build_quality_inputs(opp, "neutral")
        score = compute_quality_score(**inputs)
        assert score == 70.0
        assert score != 71.8


class TestBuildQualityInputsClampsSentimentAlignment:
    def test_sell_with_negative_news_score_is_clamped(self):
        # sentiment = 100 - news_score; a news_score below 0 would push
        # sentiment above 100 without the clamp.
        opp = {"action": "SELL", "fused_score": 50, "news_score": -20, "vol_ratio": 1.0}
        inputs = build_quality_inputs(opp, "neutral")
        assert inputs["sentiment_alignment"] == 100.0

    def test_buy_with_news_score_above_100_is_clamped(self):
        opp = {"action": "BUY", "fused_score": 50, "news_score": 150, "vol_ratio": 1.0}
        inputs = build_quality_inputs(opp, "neutral")
        assert inputs["sentiment_alignment"] == 100.0

    def test_hold_action_sentiment_is_always_neutral_50(self):
        opp = {"action": "HOLD", "fused_score": 999, "news_score": 999, "vol_ratio": 1.0}
        inputs = build_quality_inputs(opp, "neutral")
        assert inputs["sentiment_alignment"] == 50.0
        assert inputs["macro_alignment"] == 50.0


class TestBuildQualityInputsMacroAndVolumeUnaffected:
    def test_macro_alignment_bull_buy(self):
        opp = {"action": "BUY", "fused_score": 50, "news_score": 50, "vol_ratio": 1.0}
        inputs = build_quality_inputs(opp, "strong_bull")
        assert inputs["macro_alignment"] == 90.0

    def test_macro_alignment_bear_sell(self):
        opp = {"action": "SELL", "fused_score": 50, "news_score": 50, "vol_ratio": 1.0}
        inputs = build_quality_inputs(opp, "strong_bear")
        assert inputs["macro_alignment"] == 90.0  # 100 - 10

    def test_volume_confirmation_already_clamped_stays_clamped(self):
        opp = {"action": "BUY", "fused_score": 50, "news_score": 50, "vol_ratio": 10.0}
        inputs = build_quality_inputs(opp, "neutral")
        assert inputs["volume_confirmation"] == 100.0


class TestPassesQualityGate:
    def test_score_at_threshold_passes(self):
        assert passes_quality_gate(QUALITY_THRESHOLD) is True

    def test_score_below_threshold_fails(self):
        assert passes_quality_gate(QUALITY_THRESHOLD - 0.1) is False
