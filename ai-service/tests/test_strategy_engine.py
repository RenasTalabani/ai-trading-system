"""
Regression test for StrategyEngine.analyze()'s "expected move" calculation.

Bug: `expected_move_percent` is documented as the per-candle return stddev
"annualised to timeframe" (sqrt-of-time scaling), but the implementation
multiplied by `len(df) ** 0.5` instead of `limit ** 0.5`. `limit` is the
_TIMEFRAME_MAP value that actually encodes "how many `interval`-candles
make up one period of this timeframe" (e.g. 24 hourly candles = 1 day;
this is the correct sqrt-of-time scaling factor, textbook
sigma(T) = sigma(1) * sqrt(T)). `len(df)` is unrelated to the timeframe at
all -- `fetch_market_data` is always called with
`limit=max(limit + 50, 100)`, which floors out at exactly 100 for every
one of the three timeframes in _TIMEFRAME_MAP ("1d": limit=24, "7d":
limit=42, "30d": limit=30 -- all produce max(x+50, 100) == 100). So
`len(df)` was ~100 for every timeframe, making the "annualised to
timeframe" scaling factor silently constant regardless of which timeframe
was actually requested -- a real, user-facing bug, since
`expected_move_percent` is displayed directly on the mobile Strategy
screen (`mobile/lib/core/models/strategy_model.dart`) and feeds
`expected_profit`/`expected_loss` in `/unified/analyze` responses.

This test proves the fix by requesting two different timeframes against
the *same* underlying synthetic price series (the fake fetch ignores the
requested `limit` and always returns the same data, so `len(df)` is
identical for both calls) -- under the old bug, both would have produced
the *same* expected_move_percent; after the fix, they must differ by
exactly sqrt(42/24), the ratio of the two timeframes' real scaling
factors from _TIMEFRAME_MAP.
"""
import numpy as np
import pandas as pd
import pytest

from app.services.strategy_engine import StrategyEngine


def _synthetic_ohlcv(n=150, seed=42):
    rng = np.random.default_rng(seed)
    returns = rng.normal(0, 0.01, n)
    closes = 100.0 * np.cumprod(1 + returns)
    return pd.DataFrame({
        "timestamp": pd.date_range("2026-01-01", periods=n, freq="h"),
        "open":  closes, "high": closes * 1.001, "low": closes * 0.999,
        "close": closes, "volume": np.full(n, 1000.0),
    })


class TestExpectedMoveScalesWithRealTimeframeNotFetchedRowCount:
    async def test_1d_and_7d_produce_different_expected_move_from_identical_underlying_data(self, monkeypatch):
        df = _synthetic_ohlcv()

        async def _fake_fetch_market_data(self, asset, interval="1h", limit=500):
            # Deliberately ignores `limit` -- always returns the same data,
            # so len(df) is identical for every call regardless of timeframe.
            return df

        monkeypatch.setattr(
            "app.services.data_processor.DataProcessor.fetch_market_data",
            _fake_fetch_market_data,
        )

        engine = StrategyEngine()
        result_1d = await engine.analyze("BTCUSDT", "1d")   # _TIMEFRAME_MAP limit=24
        result_7d = await engine.analyze("BTCUSDT", "7d")   # _TIMEFRAME_MAP limit=42

        move_1d = result_1d["expected_move_percent"]
        move_7d = result_7d["expected_move_percent"]

        assert move_1d > 0 and move_7d > 0
        # Regression: under the old len(df)-based bug, these would be equal
        # (both calls fetch identically-shaped `df`).
        assert move_1d != move_7d
        # Both derive from the exact same returns.std() (same underlying
        # data) -- so their ratio must match sqrt(42/24), proving the real
        # _TIMEFRAME_MAP `limit` values are what's driving the scaling.
        # (rel=1e-2, not tighter -- each side is independently rounded to
        # 2 decimals by the code under test, which the exact-formula test
        # below already covers precisely for a single timeframe.)
        assert move_7d / move_1d == pytest.approx((42 / 24) ** 0.5, rel=1e-2)

    async def test_expected_move_matches_the_documented_sqrt_of_time_formula_exactly(self, monkeypatch):
        df = _synthetic_ohlcv()

        async def _fake_fetch_market_data(self, asset, interval="1h", limit=500):
            return df

        monkeypatch.setattr(
            "app.services.data_processor.DataProcessor.fetch_market_data",
            _fake_fetch_market_data,
        )

        engine = StrategyEngine()
        result = await engine.analyze("BTCUSDT", "30d")   # _TIMEFRAME_MAP limit=30

        expected = float(df["close"].pct_change().dropna().std() * 100 * (30 ** 0.5))
        assert result["expected_move_percent"] == pytest.approx(round(min(expected, 50.0), 2), rel=1e-6)
