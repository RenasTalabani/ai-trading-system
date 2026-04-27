"""
Strategy Engine — HOLD/BUY/SELL recommendations based on timeframe.
Pure add-on: reads market data only, writes nothing.
"""
import logging
from typing import Optional
import pandas as pd
import numpy as np

from app.services.data_processor import DataProcessor

logger = logging.getLogger("ai-service.strategy_engine")

# Timeframe → (candle interval, candle limit)
_TIMEFRAME_MAP = {
    "1d":  ("1h",  24),
    "7d":  ("4h",  42),
    "30d": ("1d",  30),
}


def _ema(series: pd.Series, span: int) -> pd.Series:
    return series.ewm(span=span, adjust=False).mean()


def _rsi(series: pd.Series, period: int = 14) -> float:
    delta = series.diff()
    gain  = delta.clip(lower=0)
    loss  = (-delta).clip(lower=0)
    avg_g = gain.ewm(com=period - 1, min_periods=period).mean()
    avg_l = loss.ewm(com=period - 1, min_periods=period).mean()
    rs    = avg_g / (avg_l + 1e-9)
    rsi   = 100 - (100 / (1 + rs))
    return float(rsi.iloc[-1])


class StrategyEngine:
    def __init__(self):
        self._dp = DataProcessor()

    async def analyze(self, asset: str, timeframe: str) -> dict:
        """Return recommendation for a single asset over the given timeframe."""
        asset     = asset.upper()
        timeframe = timeframe.lower()

        interval, limit = _TIMEFRAME_MAP.get(timeframe, ("1h", 24))

        df = await self._dp.fetch_market_data(asset, interval, limit=max(limit + 50, 100))
        if df is None or len(df) < 30:
            return self._fallback(asset, timeframe, "Insufficient market data")

        close = df["close"]
        price = float(close.iloc[-1])

        ema50  = float(_ema(close, 50).iloc[-1])  if len(close) >= 50  else float(_ema(close, len(close)).iloc[-1])
        ema200 = float(_ema(close, 200).iloc[-1]) if len(close) >= 200 else ema50
        rsi    = _rsi(close)

        # Expected move: use stddev of recent returns (annualised to timeframe)
        returns = close.pct_change().dropna()
        volatility_pct = float(returns.std() * 100 * (len(df) ** 0.5))
        expected_move  = round(min(volatility_pct, 50.0), 2)

        # Trend detection
        above_ema50  = price > ema50
        above_ema200 = price > ema200
        ema_aligned  = ema50 > ema200   # golden cross

        if above_ema50 and ema_aligned and rsi > 50:
            trend  = "bullish"
            rec    = "BUY"
            conf   = self._confidence(rsi, above_ema50, above_ema200, ema_aligned, bullish=True)
            reason = self._reason_bullish(rsi, above_ema50, above_ema200, ema_aligned)
        elif not above_ema50 and not ema_aligned and rsi < 50:
            trend  = "bearish"
            rec    = "SELL"
            conf   = self._confidence(rsi, above_ema50, above_ema200, ema_aligned, bullish=False)
            reason = self._reason_bearish(rsi, above_ema50, above_ema200, ema_aligned)
        else:
            trend  = "sideways"
            rec    = "HOLD"
            conf   = 55 + int(abs(rsi - 50) * 0.3)
            reason = f"Price consolidating near EMA50. RSI {rsi:.0f} — no clear directional bias"

        return {
            "asset":                 asset,
            "timeframe":             timeframe,
            "recommendation":        rec,
            "trend":                 trend,
            "confidence":            min(conf, 95),
            "expected_move_percent": expected_move,
            "current_price":         round(price, 6),
            "ema50":                 round(ema50, 6),
            "ema200":                round(ema200, 6),
            "rsi":                   round(rsi, 1),
            "reason":                reason,
        }

    def _confidence(self, rsi, above50, above200, aligned, bullish: bool) -> int:
        base = 60
        if aligned:              base += 10
        if above50:              base += 8
        if above200:             base += 7
        if bullish and rsi > 60: base += int((rsi - 60) * 0.4)
        if not bullish and rsi < 40: base += int((40 - rsi) * 0.4)
        return base

    def _reason_bullish(self, rsi, above50, above200, aligned) -> str:
        parts = []
        if aligned:   parts.append("EMA50 above EMA200 (golden cross)")
        if above50:   parts.append("price above EMA50")
        if above200:  parts.append("price above EMA200")
        if rsi > 55:  parts.append(f"RSI {rsi:.0f} bullish")
        return ". ".join(parts) if parts else "Bullish momentum detected"

    def _reason_bearish(self, rsi, above50, above200, aligned) -> str:
        parts = []
        if not aligned:  parts.append("EMA50 below EMA200 (death cross)")
        if not above50:  parts.append("price below EMA50")
        if not above200: parts.append("price below EMA200")
        if rsi < 45:     parts.append(f"RSI {rsi:.0f} bearish")
        return ". ".join(parts) if parts else "Bearish momentum detected"

    def _fallback(self, asset, timeframe, reason) -> dict:
        return {
            "asset": asset, "timeframe": timeframe,
            "recommendation": "HOLD", "trend": "unknown",
            "confidence": 50, "expected_move_percent": 0.0,
            "current_price": 0.0, "ema50": 0.0, "ema200": 0.0, "rsi": 50.0,
            "reason": reason,
        }

    async def analyze_multi(self, assets: list, timeframe: str) -> list:
        """Analyze multiple assets and return sorted by confidence."""
        import asyncio
        results = await asyncio.gather(
            *[self.analyze(a, timeframe) for a in assets],
            return_exceptions=True,
        )
        out = []
        for r in results:
            if isinstance(r, Exception):
                continue
            out.append(r)
        out.sort(key=lambda x: x["confidence"], reverse=True)
        return out
