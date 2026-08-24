"""
Tests for OrderBlockEngine (T-042, 2026-08-24 continuous-improvement pass).

Bug: `_generate_signal()` wrote `ob["_dist"] = dist` into every order-block
dict it scanned, mutating the SAME dict objects that `analyze()` returns
(as `order_blocks[:10]`) directly in the live `/order-blocks/analyze` API
response. The leading underscore signals "internal", but nothing ever
stripped it back out, and the route (`POST /order-blocks/analyze` in
routes.py) declares no `response_model`, so FastAPI serializes the raw
dict as-is -- meaning every real API consumer (including the mobile app)
received this undocumented, unintentional `_dist` field on every order
block. `dist` is only ever needed as a local value for the BUY/SELL
threshold checks, so the fix removes the dict mutation entirely.

Zero prior test coverage existed for this module before this pass.
"""
import pytest

from app.services.order_block_engine import (
    OrderBlockEngine,
    _deduplicate,
    _strength_score,
    _ema,
    _rsi,
)


def _ob(ob_type="bullish", low=100.0, high=102.0, strength=80,
        freshness="fresh", timeframe="1h", ts="2026-01-01T00:00:00", idx=0):
    return {
        "type":      ob_type,
        "zone":      {"low": low, "high": high},
        "strength":  strength,
        "freshness": freshness,
        "timeframe": timeframe,
        "timestamp": ts,
        "ob_index":  idx,
        "impulse_index": idx + 1,
    }


class TestGenerateSignalNoLongerLeaksDistIntoObDicts:
    """Direct regression guard for the T-042 fix."""

    def test_dist_key_not_written_on_buy_path(self):
        engine = OrderBlockEngine()
        obs = [_ob("bullish", low=99.0, high=101.0, strength=80)]
        price = 100.0
        engine._generate_signal(price, obs, bull_trend=True, bear_trend=False, rsi=50.0)
        assert "_dist" not in obs[0]

    def test_dist_key_not_written_on_sell_path(self):
        engine = OrderBlockEngine()
        obs = [_ob("bearish", low=99.0, high=101.0, strength=80)]
        price = 100.0
        engine._generate_signal(price, obs, bull_trend=False, bear_trend=True, rsi=50.0)
        assert "_dist" not in obs[0]

    def test_dist_key_not_written_on_hold_path(self):
        engine = OrderBlockEngine()
        # far from price -> HOLD, but the dict is still scanned by the loop
        obs = [_ob("bullish", low=200.0, high=202.0, strength=80)]
        price = 100.0
        engine._generate_signal(price, obs, bull_trend=True, bear_trend=False, rsi=50.0)
        assert "_dist" not in obs[0]

    def test_dist_key_not_written_across_multiple_obs(self):
        engine = OrderBlockEngine()
        obs = [
            _ob("bullish", low=99.0, high=101.0, strength=80),
            _ob("bearish", low=150.0, high=152.0, strength=90),
            _ob("bullish", low=300.0, high=302.0, strength=70),
        ]
        engine._generate_signal(100.0, obs, bull_trend=True, bear_trend=False, rsi=50.0)
        for ob in obs:
            assert "_dist" not in ob

    def test_returned_signal_shape_unaffected_by_the_fix(self):
        # Same scenario as test_dist_key_not_written_on_buy_path -- confirms
        # removing the dict mutation didn't change the actual signal output.
        engine = OrderBlockEngine()
        obs = [_ob("bullish", low=99.0, high=101.0, strength=80)]
        signal = engine._generate_signal(100.0, obs, bull_trend=True, bear_trend=False, rsi=50.0)
        assert signal["action"] == "BUY"
        assert signal["entry_zone"] == "99.0 – 101.0"


class TestGenerateSignalNoObs:
    def test_empty_obs_returns_hold(self):
        engine = OrderBlockEngine()
        signal = engine._generate_signal(100.0, [], bull_trend=True, bear_trend=False, rsi=50.0)
        assert signal["action"] == "HOLD"
        assert signal["confidence"] == 50
        assert signal["entry_zone"] is None
        assert "No valid order blocks detected" in signal["reason"]


class TestGenerateSignalBuyPath:
    def test_valid_bullish_ob_near_price_with_trend_and_rsi_gives_buy(self):
        engine = OrderBlockEngine()
        obs = [_ob("bullish", low=99.0, high=101.0, strength=80)]
        signal = engine._generate_signal(100.0, obs, bull_trend=True, bear_trend=False, rsi=50.0)
        assert signal["action"] == "BUY"
        assert signal["risk_reward"] == "1:2"
        assert signal["stop_loss"] < 99.0
        assert signal["take_profit"] > 100.0

    def test_buy_gated_off_when_trend_not_bullish(self):
        engine = OrderBlockEngine()
        obs = [_ob("bullish", low=99.0, high=101.0, strength=80)]
        signal = engine._generate_signal(100.0, obs, bull_trend=False, bear_trend=False, rsi=50.0)
        assert signal["action"] == "HOLD"

    def test_buy_gated_off_when_rsi_overbought(self):
        engine = OrderBlockEngine()
        obs = [_ob("bullish", low=99.0, high=101.0, strength=80)]
        signal = engine._generate_signal(100.0, obs, bull_trend=True, bear_trend=False, rsi=75.0)
        assert signal["action"] == "HOLD"

    def test_buy_confidence_gets_rsi_boost_when_rsi_below_50(self):
        engine = OrderBlockEngine()
        obs = [_ob("bullish", low=99.0, high=101.0, strength=80)]
        low_rsi_signal = engine._generate_signal(100.0, obs, bull_trend=True, bear_trend=False, rsi=40.0)
        obs2 = [_ob("bullish", low=99.0, high=101.0, strength=80)]
        high_rsi_signal = engine._generate_signal(100.0, obs2, bull_trend=True, bear_trend=False, rsi=60.0)
        assert low_rsi_signal["confidence"] > high_rsi_signal["confidence"]

    def test_buy_confidence_clamped_at_95(self):
        engine = OrderBlockEngine()
        obs = [_ob("bullish", low=99.0, high=101.0, strength=95)]
        signal = engine._generate_signal(100.0, obs, bull_trend=True, bear_trend=False, rsi=40.0)
        assert signal["confidence"] <= 95


class TestGenerateSignalSellPath:
    def test_valid_bearish_ob_near_price_with_trend_and_rsi_gives_sell(self):
        engine = OrderBlockEngine()
        obs = [_ob("bearish", low=99.0, high=101.0, strength=80)]
        signal = engine._generate_signal(100.0, obs, bull_trend=False, bear_trend=True, rsi=50.0)
        assert signal["action"] == "SELL"
        assert signal["risk_reward"] == "1:2"
        assert signal["stop_loss"] > 101.0
        assert signal["take_profit"] < 100.0

    def test_sell_gated_off_when_trend_not_bearish(self):
        engine = OrderBlockEngine()
        obs = [_ob("bearish", low=99.0, high=101.0, strength=80)]
        signal = engine._generate_signal(100.0, obs, bull_trend=False, bear_trend=False, rsi=50.0)
        assert signal["action"] == "HOLD"

    def test_sell_gated_off_when_rsi_oversold(self):
        engine = OrderBlockEngine()
        obs = [_ob("bearish", low=99.0, high=101.0, strength=80)]
        signal = engine._generate_signal(100.0, obs, bull_trend=False, bear_trend=True, rsi=25.0)
        assert signal["action"] == "HOLD"


class TestGenerateSignalFiltering:
    def test_strength_below_60_excluded(self):
        engine = OrderBlockEngine()
        obs = [_ob("bullish", low=99.0, high=101.0, strength=59)]
        signal = engine._generate_signal(100.0, obs, bull_trend=True, bear_trend=False, rsi=50.0)
        assert signal["action"] == "HOLD"

    def test_strength_at_exactly_60_included(self):
        engine = OrderBlockEngine()
        obs = [_ob("bullish", low=99.0, high=101.0, strength=60)]
        signal = engine._generate_signal(100.0, obs, bull_trend=True, bear_trend=False, rsi=50.0)
        assert signal["action"] == "BUY"

    def test_distance_at_or_beyond_5pct_excluded(self):
        engine = OrderBlockEngine()
        # mid = 110, price = 100 -> dist = 10/100 = 0.10 >= 0.05
        obs = [_ob("bullish", low=109.0, high=111.0, strength=80)]
        signal = engine._generate_signal(100.0, obs, bull_trend=True, bear_trend=False, rsi=50.0)
        assert signal["action"] == "HOLD"

    def test_strongest_among_qualifying_obs_is_selected(self):
        engine = OrderBlockEngine()
        obs = [
            _ob("bullish", low=99.0, high=101.0, strength=65),
            _ob("bullish", low=99.5, high=100.5, strength=90),
        ]
        signal = engine._generate_signal(100.0, obs, bull_trend=True, bear_trend=False, rsi=50.0)
        assert signal["action"] == "BUY"
        assert signal["confidence"] >= 90


class TestHoldAndFallbackShapes:
    def test_hold_signal_shape(self):
        signal = OrderBlockEngine._hold_signal("some reason")
        assert signal == {
            "action": "HOLD", "confidence": 50, "entry_zone": None,
            "stop_loss": None, "take_profit": None, "risk_reward": None,
            "reason": "some reason",
        }

    def test_fallback_shape(self):
        result = OrderBlockEngine._fallback("BTCUSDT", "1h", "Insufficient market data")
        assert result["success"] is False
        assert result["asset"] == "BTCUSDT"
        assert result["timeframe"] == "1h"
        assert result["order_blocks"] == []
        assert result["signal"]["action"] == "HOLD"
        assert result["signal"]["reason"] == "Insufficient market data"
        assert result["error"] == "Insufficient market data"
        assert result["news_analysis"]["combined_score"] == 50


class TestStrengthScore:
    def test_zero_impulse_volume_and_full_wick_and_no_alignment_is_low(self):
        score = _strength_score(impulse_ratio=2.5, volume_ratio=1.0, wick_ratio=1.0, ema_aligned=False)
        assert score == 0

    def test_strong_impulse_volume_clean_wick_and_alignment_is_high(self):
        score = _strength_score(impulse_ratio=7.5, volume_ratio=3.0, wick_ratio=0.0, ema_aligned=True)
        assert score == 100

    def test_score_never_exceeds_100(self):
        score = _strength_score(impulse_ratio=50.0, volume_ratio=50.0, wick_ratio=0.0, ema_aligned=True)
        assert score <= 100

    def test_ema_alignment_adds_20_points(self):
        base = _strength_score(impulse_ratio=2.5, volume_ratio=1.0, wick_ratio=1.0, ema_aligned=False)
        aligned = _strength_score(impulse_ratio=2.5, volume_ratio=1.0, wick_ratio=1.0, ema_aligned=True)
        assert aligned - base == 20


class TestDeduplicate:
    def test_same_type_high_overlap_keeps_only_stronger(self):
        obs = [
            _ob("bullish", low=100.0, high=110.0, strength=80),
            _ob("bullish", low=100.5, high=109.5, strength=60),  # ~95% inside the first
        ]
        result = _deduplicate(obs)
        assert len(result) == 1
        assert result[0]["strength"] == 80

    def test_different_type_overlap_never_dedups(self):
        obs = [
            _ob("bullish", low=100.0, high=110.0, strength=80),
            _ob("bearish", low=100.0, high=110.0, strength=60),
        ]
        result = _deduplicate(obs)
        assert len(result) == 2

    def test_non_overlapping_same_type_both_kept(self):
        obs = [
            _ob("bullish", low=100.0, high=110.0, strength=80),
            _ob("bullish", low=200.0, high=210.0, strength=60),
        ]
        result = _deduplicate(obs)
        assert len(result) == 2

    def test_empty_list_returns_empty(self):
        assert _deduplicate([]) == []


class TestFuse:
    def test_hold_signal_passes_through_unfused(self):
        signal = OrderBlockEngine._hold_signal("no setup")
        sent = {"combined_score": 80, "news_score": 80, "social_score": 80,
                "sentiment": "bullish", "impact": 0.5, "top_events": [], "article_count": 3}
        fused_signal, analysis = OrderBlockEngine._fuse(signal, sent)
        assert fused_signal == signal
        assert analysis["aligned"] is False
        assert analysis["confidence_boost"] == 0
        assert analysis["technical_confidence"] == 50

    def test_buy_boosted_by_bullish_sentiment(self):
        signal = {"action": "BUY", "confidence": 70}
        sent = {"combined_score": 90, "news_score": 90, "social_score": 90,
                "sentiment": "bullish", "impact": 0.5, "top_events": [], "article_count": 3}
        fused_signal, analysis = OrderBlockEngine._fuse(signal, sent)
        # 70*0.6 + 90*0.4 = 78
        assert fused_signal["confidence"] == 78
        assert analysis["aligned"] is True
        assert analysis["confidence_boost"] == 8

    def test_sell_boosted_by_bearish_sentiment(self):
        signal = {"action": "SELL", "confidence": 70}
        sent = {"combined_score": 10, "news_score": 10, "social_score": 10,
                "sentiment": "bearish", "impact": 0.5, "top_events": [], "article_count": 3}
        fused_signal, analysis = OrderBlockEngine._fuse(signal, sent)
        # aligned_score = 100 - 10 = 90; 70*0.6 + 90*0.4 = 78
        assert fused_signal["confidence"] == 78
        assert analysis["aligned"] is True

    def test_fused_confidence_clamped_between_10_and_95(self):
        signal = {"action": "BUY", "confidence": 10}
        sent = {"combined_score": 0, "news_score": 0, "social_score": 0,
                "sentiment": "bearish", "impact": 0.0, "top_events": [], "article_count": 0}
        fused_signal, _ = OrderBlockEngine._fuse(signal, sent)
        assert fused_signal["confidence"] >= 10

        signal2 = {"action": "BUY", "confidence": 95}
        sent2 = {"combined_score": 100, "news_score": 100, "social_score": 100,
                 "sentiment": "bullish", "impact": 1.0, "top_events": [], "article_count": 10}
        fused_signal2, _ = OrderBlockEngine._fuse(signal2, sent2)
        assert fused_signal2["confidence"] <= 95


class TestEmaAndRsiHelpers:
    def test_ema_of_constant_series_equals_the_constant(self):
        import pandas as pd
        series = pd.Series([100.0] * 30)
        result = _ema(series, span=10)
        assert abs(result.iloc[-1] - 100.0) < 1e-9

    def test_rsi_of_strictly_increasing_series_is_100(self):
        import pandas as pd
        series = pd.Series([float(i) for i in range(1, 31)])
        result = _rsi(series, period=14)
        assert result == pytest.approx(100.0, abs=0.5)

    def test_rsi_of_strictly_decreasing_series_is_near_0(self):
        import pandas as pd
        series = pd.Series([float(i) for i in range(30, 0, -1)])
        result = _rsi(series, period=14)
        assert result == pytest.approx(0.0, abs=0.5)
