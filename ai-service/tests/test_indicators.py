"""
Regression suite for the pure-pandas indicator math in app/services/indicators.py,
which replaced the `ta` library after it broke on pandas >= 2.2
(`fillna(method=...)` was removed). Pure functions, deterministic, no mocking.
"""
import numpy as np
import pandas as pd
import pytest

from app.services.indicators import ema, rsi, macd, bollinger_bands, atr


def rising_series(n=60, start=100, step=1):
    return pd.Series([start + i * step for i in range(n)], dtype=float)


def falling_series(n=60, start=100, step=1):
    return pd.Series([start - i * step for i in range(n)], dtype=float)


class TestEma:
    def test_length_matches_input(self):
        s = rising_series(30)
        assert len(ema(s, 10)) == len(s)

    def test_converges_toward_a_flat_series_value(self):
        s = pd.Series([50.0] * 40)
        result = ema(s, 10)
        assert result.iloc[-1] == pytest.approx(50.0, abs=1e-6)


class TestRsi:
    def test_bounded_between_0_and_100(self):
        s = pd.Series(np.random.RandomState(42).normal(100, 5, 200).cumsum())
        r = rsi(s, 14).dropna()
        assert (r >= 0).all() and (r <= 100).all()

    def test_strictly_rising_series_pushes_rsi_high(self):
        r = rsi(rising_series(60), 14).dropna()
        assert r.iloc[-1] > 90

    def test_strictly_falling_series_pushes_rsi_low(self):
        r = rsi(falling_series(60), 14).dropna()
        assert r.iloc[-1] < 10


class TestMacd:
    def test_returns_three_equal_length_series(self):
        s = rising_series(60)
        macd_line, signal_line, hist = macd(s)
        assert len(macd_line) == len(signal_line) == len(hist) == len(s)

    def test_histogram_equals_macd_minus_signal(self):
        s = pd.Series(np.random.RandomState(1).normal(100, 3, 80).cumsum())
        macd_line, signal_line, hist = macd(s)
        pd.testing.assert_series_equal(hist, macd_line - signal_line, check_names=False)


class TestBollingerBands:
    def test_upper_always_at_or_above_mid_at_or_above_lower(self):
        s = pd.Series(np.random.RandomState(7).normal(100, 10, 100).cumsum())
        upper, lower, mid = bollinger_bands(s, window=20)
        valid = mid.notna()
        assert (upper[valid] >= mid[valid]).all()
        assert (mid[valid] >= lower[valid]).all()

    def test_zero_volatility_collapses_bands_to_the_mean(self):
        s = pd.Series([100.0] * 30)
        upper, lower, mid = bollinger_bands(s, window=10)
        valid = mid.notna()
        assert (upper[valid] == mid[valid]).all()
        assert (lower[valid] == mid[valid]).all()


class TestAtr:
    def test_always_non_negative(self):
        rs = np.random.RandomState(3)
        close = pd.Series(100 + rs.normal(0, 2, 100).cumsum())
        high = close + rs.uniform(0, 2, 100)
        low = close - rs.uniform(0, 2, 100)
        result = atr(high, low, close, window=14).dropna()
        assert (result >= 0).all()

    def test_flat_series_gives_zero_atr(self):
        close = pd.Series([100.0] * 30)
        high = pd.Series([100.0] * 30)
        low = pd.Series([100.0] * 30)
        result = atr(high, low, close, window=14).dropna()
        assert (result == 0).all()
