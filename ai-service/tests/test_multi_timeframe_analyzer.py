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
import math

import pandas as pd
import pytest

from app.services.multi_timeframe_analyzer import _compute_indicators, _score_timeframe, _risk_level


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


def _ohlcv(closes):
    n = len(closes)
    return pd.DataFrame({
        "open": closes, "high": [c + 0.5 for c in closes], "low": [c - 0.5 for c in closes],
        "close": closes, "volume": [1000.0] * n,
    })


class TestComputeIndicatorsRsiNeverStalesTheLatestCandle:
    """
    Regression guard for a real bug (2026-09-04, overnight
    continuous-improvement pass): `loss.replace(0, np.nan)` in the RSI
    calculation turned a completely ordinary event -- a sustained rally
    with zero red candles anywhere in the 14-period lookback -- into a NaN
    RSI on exactly the most recent candle. `_score_timeframe()` reads
    `df.dropna().iloc[-1]`, and `dropna()` drops a row on ANY NaN column,
    so a NaN RSI on only the latest row made this whole analyzer silently
    fall back to an OLDER, stale candle instead of the real latest one --
    with no error, no warning, nothing. This directly weakens the
    multi-timeframe confirmation leg of master_plan_v1.md decision #8's
    noise filter, and does so specifically during the sharp, sustained
    moves that gate exists to scrutinize.
    """

    def test_sustained_rally_produces_a_finite_rsi_not_nan(self):
        # 20 candles of ordinary chop (valid indicators once warmed up),
        # then 15 candles of a sustained rally with zero red candles --
        # >= the 14-period RSI window, so the latest candle's rolling loss
        # average is exactly zero under the old, buggy code.
        chop = [100 + 3 * math.sin(i / 2) for i in range(20)]
        rally = [chop[-1] + i + 1 for i in range(15)]
        df = _compute_indicators(_ohlcv(chop + rally))

        assert not pd.isna(df.iloc[-1]["rsi"]), (
            "a zero-loss window is a real, finite RSI approaching 100, not an undefined one"
        )
        assert df.iloc[-1]["rsi"] > 95  # extreme overbought, correctly reflecting the rally

    def test_sustained_rally_does_not_make_score_timeframe_use_a_stale_candle(self):
        chop = [100 + 3 * math.sin(i / 2) for i in range(20)]
        rally = [chop[-1] + i + 1 for i in range(15)]
        df = _compute_indicators(_ohlcv(chop + rally))

        real_latest_close = float(df.iloc[-1]["close"])
        # This is exactly what _score_timeframe() does internally.
        analyzed_close = float(df.dropna().iloc[-1]["close"])
        assert analyzed_close == real_latest_close, (
            "df.dropna().iloc[-1] silently fell back to an older candle instead of the real latest one"
        )

        result = _score_timeframe(df, atr_mult=1.5)
        assert result["current_price"] == round(real_latest_close, 6)

    def test_flat_bollinger_band_produces_a_finite_bb_pct_not_nan(self):
        # 25 perfectly flat candles -> bb_upper == bb_lower for the last
        # row (zero rolling std) -- same NaN-on-latest-row failure mode,
        # for bb_pct instead of rsi.
        df = _compute_indicators(_ohlcv([100.0] * 25))
        assert not pd.isna(df.iloc[-1]["bb_pct"])
