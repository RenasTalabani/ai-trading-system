"""
Regression test for T-028 (2026-08-18, PM continuous-improvement pass).

Bug: GlobalAnalyzer._score_crypto() derived `regime` via
`result.get("regime", "TRENDING")`, but UnifiedAnalyzer.analyze()'s
response never actually contains a "regime" key -- so every crypto
asset, every scan, silently used the TRENDING regime's SL/TP width and
score modifier regardless of real market structure. This test drives
_score_crypto() with a fake UnifiedAnalyzer whose technical data
describes a clear downtrend and confirms the *real* regime (DOWNTREND)
is now used, not a hardcoded TRENDING default.
"""
import pytest

from app.services.global_analyzer import GlobalAnalyzer


class FakeUnifiedAnalyzer:
    """Returns a canned analyze() response with no 'regime' key at all --
    matching the real UnifiedAnalyzer.analyze(), which never sets one."""

    def __init__(self, technical, action="SELL", confidence=80):
        self._technical = technical
        self._action = action
        self._confidence = confidence

    async def analyze(self, asset, timeframe, capital):
        return {
            "success": True,
            "signal": {
                "action": self._action,
                "confidence": self._confidence,
                "entry_zone": None,
                "stop_loss": None,
                "take_profit": None,
                "risk_reward": None,
                "reason": "fake",
            },
            "technical": self._technical,
            "sentiment": {"news_score": 50, "social_score": 50},
        }


DOWNTREND_TECHNICAL = {
    "current_price": 90.0,
    "ema50":         95.0,
    "ema200":        100.0,
    "atr":           0.45,   # atr/price = 0.5% -> well under the volatile threshold
    "rsi":           30,
    "trend":         "down",
    "vol_ratio":     1.0,
}

UPTREND_TECHNICAL = {
    "current_price": 110.0,
    "ema50":         105.0,
    "ema200":        100.0,
    "atr":           0.55,   # atr/price = 0.5%
    "rsi":           70,
    "trend":         "up",
    "vol_ratio":     1.0,
}


class TestScoreCryptoUsesRealRegime:
    async def test_downtrend_technical_data_produces_downtrend_regime_not_trending(self):
        fake = FakeUnifiedAnalyzer(DOWNTREND_TECHNICAL, action="SELL", confidence=80)
        analyzer = GlobalAnalyzer(fake, None, None)

        result = await analyzer._score_crypto("BTCUSDT", "1h", 500.0, "neutral")

        assert result["regime"] == "DOWNTREND"  # regression: used to always be "TRENDING"

    async def test_uptrend_technical_data_produces_trending_regime(self):
        fake = FakeUnifiedAnalyzer(UPTREND_TECHNICAL, action="BUY", confidence=80)
        analyzer = GlobalAnalyzer(fake, None, None)

        result = await analyzer._score_crypto("BTCUSDT", "1h", 500.0, "neutral")

        assert result["regime"] == "TRENDING"

    async def test_downtrend_regime_produces_different_sl_tp_than_the_old_always_trending_bug_would_have(self):
        # DOWNTREND uses 1.2x/2.4x ATR; the old hardcoded-TRENDING bug would
        # have always used 1.5x/3.0x ATR instead. With entry=90, atr=0.45,
        # action=SELL: correct (DOWNTREND) sl=90+0.45*1.2=90.54,
        # tp=90-0.45*2.4=88.92 -- distinct from the buggy TRENDING values
        # (sl=90.675, tp=88.65) that a regression back to the old behavior
        # would produce.
        fake = FakeUnifiedAnalyzer(DOWNTREND_TECHNICAL, action="SELL", confidence=80)
        analyzer = GlobalAnalyzer(fake, None, None)

        result = await analyzer._score_crypto("BTCUSDT", "1h", 500.0, "neutral")

        assert result["stop_loss"] == pytest.approx(90.54, abs=1e-6)
        assert result["take_profit"] == pytest.approx(88.92, abs=1e-6)

    async def test_missing_price_data_falls_back_to_trending_without_crashing(self):
        no_price_technical = {**DOWNTREND_TECHNICAL, "current_price": None}
        fake = FakeUnifiedAnalyzer(no_price_technical, action="SELL", confidence=80)
        analyzer = GlobalAnalyzer(fake, None, None)

        result = await analyzer._score_crypto("BTCUSDT", "1h", 500.0, "neutral")

        assert result["regime"] == "TRENDING"
