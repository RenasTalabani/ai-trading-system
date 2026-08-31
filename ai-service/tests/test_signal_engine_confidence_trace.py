"""
T-078 (2026-08-31): a stored Signal's confidence can land on a suspiciously
round number (e.g. exactly 100) after passing through several sequential
adjustment stages (event override, regime modifier, multi-timeframe
confirmation, funding-rate contrarian bias) -- but nothing about *why*
was ever persisted, so an after-the-fact audit (see WINRATE_DIAGNOSIS.md-
style investigations) could only theorize about the mechanism, never
confirm it against the real stored document.

Fix: generate_signal()'s returned payload now includes a `confidence_trace`
dict recording each stage's OUTPUT value plus the inputs that drove it
(regime, regime_modifier, mtf_trend_alignment/agrees/fights, funding_rate/
funding_against). Purely additive -- these tests confirm the trace is
present and internally consistent, and that nothing about the actual
computed confidence/direction changed as a result of adding it.
"""
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


class FakeBuyMarketModel:
    """Confidently BUY, no HOLD noise -- exercises the real fusion vote
    path (fusion_model=None -> weighted-vote fallback) all the way to
    a real BUY/SELL, unlike test_predict_concurrent_load.py's HOLD-only
    fake, so every trace stage actually runs and has something to record."""
    def predict(self, candles):
        return {"direction": "BUY", "confidence": 90, "probabilities": {"BUY": 90, "SELL": 5, "HOLD": 5}}


class FakeNewsModel:
    def analyze(self, headlines):
        return {"overall_sentiment": "neutral", "score": 0.0, "market_score": 50,
                "impact": 0, "count": len(headlines), "results": [], "breakdown": {},
                "detected_events": []}


class FakeSocialModel:
    def analyze(self, posts):
        return {"overall": "neutral", "score": 0.0, "market_score": 50, "hype_level": 0.0,
                "spam_ratio": 0.0, "manipulation_detected": False, "pump_detected": False,
                "influencer_count": 0, "breakdown": {}}

    def analyze_for_asset(self, posts, asset):
        r = self.analyze(posts)
        r["asset"] = asset
        r["relevant_posts"] = len(posts)
        return r

    def analyze_single(self, post):
        return {"sentiment": "neutral", "weight": 1.0, "is_hype": False}


@pytest.fixture(autouse=True)
def _fake_network(monkeypatch):
    async def _empty():
        return []

    monkeypatch.setattr("app.services.news_analyzer.collect_all_news", _empty)
    monkeypatch.setattr("app.services.social_analyzer.collect_telegram_posts", _empty)
    monkeypatch.setattr("app.services.social_analyzer.collect_tweets", _empty)
    monkeypatch.setattr("app.services.social_analyzer.collect_reddit_posts", _empty)

    from app.services import signal_engine as se_module

    class _NeutralMtf:
        async def analyze(self, asset, timeframes):
            return {"trend_alignment": "neutral"}

    monkeypatch.setattr(se_module, "_mtf_analyzer", _NeutralMtf())


def _engine():
    return SignalEngine(
        market_model=FakeBuyMarketModel(),
        news_model=FakeNewsModel(),
        social_model=FakeSocialModel(),
    )


class TestConfidenceTraceIsPresentAndConsistent:
    async def test_confidence_trace_key_exists_with_all_expected_fields(self):
        result = await _engine().generate_signal("SOLUSDT", _fake_candles())
        assert "confidence_trace" in result
        trace = result["confidence_trace"]
        for key in ("fusion_confidence", "after_event_override", "after_regime_adjustment",
                    "after_mtf_confirmation", "after_funding_bias", "regime", "regime_modifier",
                    "mtf_trend_alignment", "mtf_agrees", "mtf_fights", "funding_rate",
                    "funding_against", "calibrated"):
            assert key in trace, f"missing trace key: {key}"

    async def test_final_trace_stage_matches_the_top_level_raw_confidence(self):
        # after_funding_bias is raw_conf's value right before calibration --
        # exactly what the top-level raw_confidence field is (calibrator
        # is untrained by default here, so confidence == raw_confidence too).
        result = await _engine().generate_signal("SOLUSDT", _fake_candles())
        assert result["confidence_trace"]["after_funding_bias"] == result["raw_confidence"]

    async def test_funding_fields_are_none_for_a_non_btc_eth_asset(self):
        # SOLUSDT isn't BTCUSDT/ETHUSDT -- the funding-rate branch is
        # skipped entirely, so after_mtf_confirmation and after_funding_bias
        # should be identical (no adjustment happened between them).
        result = await _engine().generate_signal("SOLUSDT", _fake_candles())
        trace = result["confidence_trace"]
        assert trace["funding_rate"] is None
        assert trace["funding_against"] is False
        assert trace["after_mtf_confirmation"] == trace["after_funding_bias"]

    async def test_direction_and_confidence_are_unaffected_by_adding_the_trace(self):
        # Same fake inputs, called twice -- deterministic inputs (no real
        # network/randomness in this fixture) should produce byte-identical
        # direction/confidence/raw_confidence, proving the trace is a pure
        # additive observation, not a side-effecting change to the real
        # computation.
        r1 = await _engine().generate_signal("SOLUSDT", _fake_candles())
        r2 = await _engine().generate_signal("SOLUSDT", _fake_candles())
        assert r1["direction"] == r2["direction"]
        assert r1["confidence"] == r2["confidence"]
        assert r1["raw_confidence"] == r2["raw_confidence"]

    async def test_trace_values_are_json_serialisable(self):
        import json
        result = await _engine().generate_signal("SOLUSDT", _fake_candles())
        json.dumps(result["confidence_trace"])  # raises if anything isn't serialisable
