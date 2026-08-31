"""
AISERVICE-001 (2026-08-31): generate_signal() awaited news_analyzer.refresh()
and social_analyzer.refresh() sequentially with no timeout guard of its
own -- unlike unified_analyzer.py's analyze() (the global-scan pipeline),
which already wraps its equivalent calls in asyncio.wait_for() via its
_safe() helper (T-086). A hung refresh() (the exact failure mode T-086
found and fixed the root cause of -- FinBERT CPU oversubscription) could
hold up /predict indefinitely, bounded only by whatever timeout the
caller happened to have (backend's aiService.js: 30s).

Fixed by mirroring the same asyncio.wait_for() + neutral-fallback pattern
here, and running the two calls concurrently instead of sequentially --
they're independent, unrelated data sources.

These tests prove: (1) a refresh() that raises/times out falls back to
the existing neutral defaults instead of propagating, exactly as a
normal exception from either already did before this change: (2) the two
calls actually run concurrently now, not sequentially.
"""
import asyncio
import time

import numpy as np
import pandas as pd
import pytest

from app.services.signal_engine import SignalEngine


def _fake_candles(n=250):
    rng = np.random.default_rng(7)
    returns = rng.normal(0, 0.01, n)
    close = 100.0 * np.cumprod(1 + returns)
    return pd.DataFrame({
        "close": close, "open": close, "high": close * 1.001, "low": close * 0.999,
        "volume": np.full(n, 1000.0),
        "atr": np.full(n, 1.0), "rsi": np.full(n, 50.0),
        "macd_hist": np.full(n, 0.0), "ema20": close, "ema50": close, "ema200": close,
        "vol_ratio": np.full(n, 1.0),
    })


class _FakeBuyMarketModel:
    def predict(self, candles):
        return {"direction": "BUY", "confidence": 90, "probabilities": {"BUY": 90, "SELL": 5, "HOLD": 5}}


class _FakeNewsModel:
    def analyze(self, headlines):
        return {"overall_sentiment": "neutral", "score": 0.0, "market_score": 50,
                "impact": 0, "count": len(headlines), "results": [], "breakdown": {},
                "detected_events": []}


class _FakeSocialModel:
    def analyze(self, posts):
        return {"overall": "neutral", "score": 0.0, "market_score": 50, "hype_level": 0.0,
                "spam_ratio": 0.0, "manipulation_detected": False, "pump_detected": False,
                "influencer_count": 0, "breakdown": {}}


@pytest.fixture(autouse=True)
def _neutral_mtf(monkeypatch):
    from app.services import signal_engine as se_module

    class _NeutralMtf:
        async def analyze(self, asset, timeframes):
            return {"trend_alignment": "neutral"}

    monkeypatch.setattr(se_module, "_mtf_analyzer", _NeutralMtf())


def _engine():
    return SignalEngine(
        market_model=_FakeBuyMarketModel(),
        news_model=_FakeNewsModel(),
        social_model=_FakeSocialModel(),
    )


class TestNewsSocialFailuresFallBackToNeutral:
    async def test_a_raising_news_refresh_does_not_propagate_and_falls_back_to_neutral(self, monkeypatch):
        engine = _engine()

        async def _raises():
            raise RuntimeError("simulated news collector failure")

        monkeypatch.setattr(engine.news_analyzer, "refresh", _raises)
        # Social must return a real dict shape (its refresh() isn't the one under test here).
        async def _social_ok():
            return {"by_asset": {}, "global": {}, "top_headlines": []}
        monkeypatch.setattr(engine.social_analyzer, "refresh", _social_ok)

        result = await engine.generate_signal("SOLUSDT", _fake_candles())

        assert result["direction"] in ("BUY", "SELL", "HOLD")  # pipeline completed, didn't raise
        assert result["sources"]["news"]["score"] == 50

    async def test_a_timed_out_social_refresh_does_not_propagate_and_falls_back_to_neutral(self, monkeypatch):
        engine = _engine()

        async def _news_ok():
            return {"by_asset": {}, "global": {}, "top_headlines": []}
        monkeypatch.setattr(engine.news_analyzer, "refresh", _news_ok)

        async def _times_out():
            raise asyncio.TimeoutError()
        monkeypatch.setattr(engine.social_analyzer, "refresh", _times_out)

        result = await engine.generate_signal("SOLUSDT", _fake_candles())

        assert result["direction"] in ("BUY", "SELL", "HOLD")  # pipeline completed, didn't raise
        assert result["sources"]["social"]["score"] == 50


class TestNewsAndSocialRunConcurrentlyNotSequentially:
    async def test_wall_clock_time_is_close_to_one_delay_not_the_sum_of_both(self, monkeypatch):
        engine = _engine()

        async def _slow_news():
            await asyncio.sleep(0.15)
            return {"by_asset": {}, "global": {}, "top_headlines": []}

        async def _slow_social():
            await asyncio.sleep(0.15)
            return {"by_asset": {}, "global": {}, "top_headlines": []}

        monkeypatch.setattr(engine.news_analyzer, "refresh", _slow_news)
        monkeypatch.setattr(engine.social_analyzer, "refresh", _slow_social)

        started = time.monotonic()
        await engine.generate_signal("SOLUSDT", _fake_candles())
        elapsed = time.monotonic() - started

        # Sequential would take >= 0.30s; concurrent should land close to ~0.15s.
        # Generous upper bound to avoid CI flakiness while still clearly
        # distinguishing "concurrent" from "sequential".
        assert elapsed < 0.28, (
            f"expected news+social to run concurrently, took {elapsed:.2f}s "
            f"(sequential would be >= 0.30s)"
        )
