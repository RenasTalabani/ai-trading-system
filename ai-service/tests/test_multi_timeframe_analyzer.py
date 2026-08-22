"""
Tests for MultiTimeframeAnalyzer (T-039, 2026-08-22 PM continuous-improvement pass).

Bug: `_score_timeframe()` computed `prev` (the prior candle's row) but never
actually used it anywhere -- the MACD "reason" text unconditionally claimed
a "crossover" whenever the current MACD histogram was merely nonzero (true
on almost every real candle), regardless of whether a sign change from the
previous candle had actually just happened. That reason string is returned
directly by the `/advisor/analyze` API endpoint (read by the mobile Advisor
screen), so it was claiming a "crossover" event on nearly every scored
asset/timeframe when it was really just restating the current MACD sign.

These tests construct minimal 2-row DataFrames with precomputed indicator
columns (bypassing `_compute_indicators`, whose only job is producing those
columns from raw OHLCV) so the previous vs current MACD histogram values
can be controlled exactly.

Zero prior test coverage existed for this module before this pass.
"""
import pandas as pd
import pytest

from app.services.multi_timeframe_analyzer import _score_timeframe, _risk_level


def _make_df(prev_macd_hist: float, curr_macd_hist: float, **overrides) -> pd.DataFrame:
    base = {
        "close": 100.0, "ema20": 100.0, "ema50": 100.0, "ema200": 100.0,
        "rsi": 50.0, "macd_hist": curr_macd_hist, "atr": 1.0, "bb_pct": 0.5,
        "volume": 100.0, "vol_ma": 100.0,
    }
    base.update(overrides)
    prev_row = {**base, "macd_hist": prev_macd_hist}
    curr_row = dict(base)
    return pd.DataFrame([prev_row, curr_row])


class TestMacdReasonOnlyClaimsCrossoverOnActualSignChange:
    def test_negative_to_positive_is_labeled_bullish_crossover(self):
        df = _make_df(prev_macd_hist=-0.5, curr_macd_hist=0.5)
        result = _score_timeframe(df, atr_mult=1.5)
        assert "MACD bullish crossover" in result["reason"]
        assert "momentum" not in result["reason"]

    def test_positive_to_negative_is_labeled_bearish_crossover(self):
        df = _make_df(prev_macd_hist=0.5, curr_macd_hist=-0.5)
        result = _score_timeframe(df, atr_mult=1.5)
        assert "MACD bearish crossover" in result["reason"]
        assert "momentum" not in result["reason"]

    def test_positive_staying_positive_is_momentum_not_crossover(self):
        # Regression guard: the old bug would have called this a
        # "crossover" too, since it only checked `abs(macd_h) > 0`.
        df = _make_df(prev_macd_hist=0.4, curr_macd_hist=0.6)
        result = _score_timeframe(df, atr_mult=1.5)
        assert "MACD bullish momentum" in result["reason"]
        assert "crossover" not in result["reason"]

    def test_negative_staying_negative_is_momentum_not_crossover(self):
        df = _make_df(prev_macd_hist=-0.6, curr_macd_hist=-0.4)
        result = _score_timeframe(df, atr_mult=1.5)
        assert "MACD bearish momentum" in result["reason"]
        assert "crossover" not in result["reason"]

    def test_single_available_row_never_falsely_claims_a_crossover(self):
        # _score_timeframe falls back to prev=row when df.dropna() has only
        # one row -- prev_macd_h == macd_h in that case, so no crossover
        # can ever be (falsely) detected.
        df = _make_df(prev_macd_hist=0.5, curr_macd_hist=0.5).iloc[[-1]]
        result = _score_timeframe(df, atr_mult=1.5)
        assert "crossover" not in result["reason"]
        assert "MACD bullish momentum" in result["reason"]

    def test_zero_macd_hist_produces_no_macd_reason(self):
        df = _make_df(prev_macd_hist=0.0, curr_macd_hist=0.0)
        result = _score_timeframe(df, atr_mult=1.5)
        assert "MACD" not in result["reason"]
        assert "Consolidation" in result["reason"]


class TestRiskLevelBucketing:
    def test_confidence_below_40_is_low_risk(self):
        assert _risk_level(35) == "low"

    def test_confidence_between_40_and_65_is_medium_risk(self):
        assert _risk_level(50) == "medium"

    def test_confidence_65_and_above_is_high_risk(self):
        assert _risk_level(80) == "high"
