"""
RegimeDetector — classify current market condition from candle data.
Outputs: TRENDING | DOWNTREND | SIDEWAYS | VOLATILE
"""
import logging
import pandas as pd

logger = logging.getLogger("ai-service.regime_detector")

ATR_VOLATILE_THRESHOLD = 0.025   # ATR/price > 2.5 % → volatile
ATR_SIDEWAYS_THRESHOLD = 0.008   # ATR/price < 0.8 % → sideways


class RegimeDetector:

    def detect(self, df: pd.DataFrame) -> str:
        """
        Requires columns: close, ema50, ema200, atr.
        Falls back to TRENDING if columns missing.
        """
        try:
            row   = df.iloc[-1]
            price = float(row["close"])
            ema50 = float(row.get("ema50",  price))
            ema200= float(row.get("ema200", price))
            atr   = float(row.get("atr",    price * 0.015))

            atr_pct = atr / price if price > 0 else 0.015

            if atr_pct > ATR_VOLATILE_THRESHOLD:
                return "VOLATILE"

            if price > ema50 > ema200:
                return "TRENDING"

            if price < ema50 and ema50 < ema200:
                return "DOWNTREND"

            if atr_pct < ATR_SIDEWAYS_THRESHOLD:
                return "SIDEWAYS"

            return "SIDEWAYS"

        except Exception as e:
            logger.debug(f"RegimeDetector fallback: {e}")
            return "TRENDING"

    def regime_score_modifier(self, regime: str, action: str) -> float:
        """
        Returns a multiplier (0.5–1.2) applied to fused_score.
        Penalises trades that go against the regime.
        """
        if regime == "TRENDING" and action == "BUY":   return 1.10
        if regime == "TRENDING" and action == "SELL":  return 0.80
        if regime == "DOWNTREND" and action == "SELL": return 1.10
        if regime == "DOWNTREND" and action == "BUY":  return 0.75
        if regime == "VOLATILE":                        return 0.85
        if regime == "SIDEWAYS"  and action == "HOLD": return 1.05
        return 1.00
