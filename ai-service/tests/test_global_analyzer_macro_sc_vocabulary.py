"""
Regression test for T-068 (2026-08-29) — found while independently
re-verifying whether the overnight-validation BUG-002 fix actually
resolved /global/scan's persistent 0/13-qualifying-assets result (it
didn't; that fix was correct but unrelated to this).

Bug: MacroDataService._macro_bias() (see macro_data_service.py, T-034)
produces a real 5-state vocabulary: strong_bull/mild_bull/neutral/
mild_bear/strong_bear. GlobalAnalyzer's macro_sc calculation (both
_score_crypto and _score_multi_asset) only matched "bullish"/"strong_bull"
(bull) and "bearish"/"strong_bear" (bear) -- "bullish"/"bearish" never
actually occur (they're not part of _macro_bias()'s vocabulary at all),
and "mild_bull"/"mild_bear" -- 2 of the 5 real states -- always fell
through to the neutral default (50), regardless of which way the macro
backdrop actually leaned.

Live impact, confirmed against the real running app: with the RL-adaptive
macro weight having drifted to ~72% of the fused-score formula (a
separate, already-documented, deliberately-not-fixed issue -- T-041's
floor/ceiling gap) and macro_sentiment reading "mild_bull" at the time,
macro_sc was pinned at 50 and consumed ~36 of the 65-point MIN_FUSED_SCORE
threshold on its own, leaving only the ~28%-weighted technical+news+social
terms to cover the remaining ~29 points out of a maximum possible ~28.3 --
mathematically impossible to pass regardless of real market conditions.
This is very likely why /global/scan's own "best": null / 0-passing
result persisted across every check throughout this project's overnight
validation, independent of BUG-002 (which was real, and correctly fixed,
but was never the cause of this specific symptom).

Fixed by mapping the full real 5-state vocabulary with a graduated scale
using the existing 70/30 anchor values. Does NOT touch the RL weight
drift itself (T-041 remains an explicit, separate owner decision).
"""
from app.services.global_analyzer import GlobalAnalyzer, _macro_sc_from_bias


class TestMacroScCoversTheRealFiveStateVocabulary:
    def test_strong_bull_is_bullish(self):
        assert _macro_sc_from_bias("strong_bull") == 70

    def test_mild_bull_is_moderately_bullish_not_neutral(self):
        # Regression: this used to silently collapse to 50 (neutral).
        assert _macro_sc_from_bias("mild_bull") == 60

    def test_neutral_stays_neutral(self):
        assert _macro_sc_from_bias("neutral") == 50

    def test_mild_bear_is_moderately_bearish_not_neutral(self):
        # Regression: this used to silently collapse to 50 (neutral).
        assert _macro_sc_from_bias("mild_bear") == 40

    def test_strong_bear_is_bearish(self):
        assert _macro_sc_from_bias("strong_bear") == 30

    def test_an_unrecognized_value_defaults_safely_to_neutral(self):
        assert _macro_sc_from_bias("something_unexpected") == 50


class TestFusedScoreNoLongerMathematicallyPinnedToNeutralUnderMildBias:
    """Reproduces the exact live scenario: heavily macro-weighted RL
    weights (matching the real observed drift toward T-041's gap) plus a
    "mild_bull" macro backdrop. Before the fix, macro_sc was pinned at 50
    regardless -- this proves it now actually varies with the real bias,
    which is the concrete, measurable effect of the fix."""

    async def test_score_multi_asset_fused_score_differs_between_mild_bull_and_neutral(self, monkeypatch):
        async def _fake_fetch_asset_data(symbol):
            return None  # forces the no-data HOLD-shaped default path

        monkeypatch.setattr(
            "app.services.global_analyzer.fetch_asset_data",
            _fake_fetch_asset_data,
        )

        class FixedRlWeights:
            @staticmethod
            def get_weights():
                # Matches the real observed live drift toward macro-
                # dominance (T-041) -- this test isn't about that drift,
                # it's about macro_sc actually responding to the real
                # macro_sentiment value it's given instead of always
                # landing on 50.
                return {"technical": 0.05, "news": 0.05, "social": 0.18, "macro": 0.72}

        monkeypatch.setattr("app.services.global_analyzer._rl_engine", FixedRlWeights())

        analyzer = GlobalAnalyzer(None, None, None)
        result_neutral   = await analyzer._score_multi_asset("XAUUSD", 500.0, "neutral")
        result_mild_bull = await analyzer._score_multi_asset("XAUUSD", 500.0, "mild_bull")
        result_mild_bear = await analyzer._score_multi_asset("XAUUSD", 500.0, "mild_bear")

        # Regression: before the fix, all three would have produced the
        # exact same fused_score (macro_sc pinned at 50 in every case).
        assert result_mild_bull["fused_score"] > result_neutral["fused_score"]
        assert result_mild_bear["fused_score"] < result_neutral["fused_score"]
