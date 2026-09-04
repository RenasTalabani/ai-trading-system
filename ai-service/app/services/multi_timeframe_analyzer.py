"""
MultiTimeframeAnalyzer — analyzes one asset across 5 timeframes simultaneously.
Uses technical indicators + trend alignment to produce per-timeframe recommendations.
"""
import asyncio
import logging
from typing import List, Dict

import pandas as pd
import numpy as np

from app.services.data_processor import DataProcessor

logger = logging.getLogger("ai-service.multi_timeframe")

# Map user-facing timeframe labels → (Binance interval, candle limit, description)
TIMEFRAME_CONFIG = {
    "1h":  {"interval": "5m",  "limit": 288, "label": "Next 1 Hour",   "atr_mult": 1.5},
    "4h":  {"interval": "15m", "limit": 192, "label": "Next 4 Hours",  "atr_mult": 2.0},
    "1d":  {"interval": "1h",  "limit": 168, "label": "Next 24 Hours", "atr_mult": 2.5},
    "7d":  {"interval": "4h",  "limit": 168, "label": "Next 7 Days",   "atr_mult": 3.0},
    "30d": {"interval": "1d",  "limit": 90,  "label": "Next 30 Days",  "atr_mult": 4.0},
}

RISK_LABELS = {(0, 40): "low", (40, 65): "medium", (65, 100): "high"}


def _risk_level(confidence: float) -> str:
    for (lo, hi), label in RISK_LABELS.items():
        if lo <= confidence < hi:
            return label
    return "high"


def _compute_indicators(df: pd.DataFrame) -> pd.DataFrame:
    close = df["close"]
    high  = df["high"]
    low   = df["low"]

    df["ema20"]  = close.ewm(span=20,  adjust=False).mean()
    df["ema50"]  = close.ewm(span=50,  adjust=False).mean()
    df["ema200"] = close.ewm(span=200, adjust=False).mean()

    # RSI
    # Bug fix (2026-09-04, overnight continuous-improvement pass):
    # loss.replace(0, np.nan) turned a completely ordinary event -- a
    # sustained rally with zero red candles anywhere in the 14-period
    # lookback, which real assets do regularly -- into a NaN RSI on
    # exactly the most recent candle. _score_timeframe() below reads
    # df.dropna().iloc[-1], and dropna() drops on ANY NaN column, so a
    # NaN RSI on only the latest row made it silently fall back to an
    # OLDER, stale candle (or, if the rally is longer than 14 candles,
    # wipes out the whole frame and raises an IndexError that
    # _analyze_one()'s broad except swallows into a neutral HOLD/50
    # fallback with zero indication anything went wrong). Either way this
    # directly weakens the multi-timeframe confirmation leg of decision
    # #8's noise filter, and does so specifically during the sharp,
    # sustained moves that gate exists to scrutinize. Fixed with the same
    # epsilon-guard pattern indicators.py's rsi() already uses elsewhere
    # in this codebase (`avg_loss + 1e-9`) instead of turning a
    # zero-loss window into NaN -- a zero-loss window is a real, finite
    # RSI approaching 100, not an undefined one.
    delta = close.diff()
    gain  = delta.clip(lower=0).rolling(14).mean()
    loss  = (-delta.clip(upper=0)).rolling(14).mean()
    rs    = gain / (loss + 1e-9)
    df["rsi"] = 100 - (100 / (1 + rs))

    # MACD
    ema12 = close.ewm(span=12, adjust=False).mean()
    ema26 = close.ewm(span=26, adjust=False).mean()
    df["macd"]      = ema12 - ema26
    df["macd_sig"]  = df["macd"].ewm(span=9, adjust=False).mean()
    df["macd_hist"] = df["macd"] - df["macd_sig"]

    # ATR
    tr = pd.concat([
        high - low,
        (high - close.shift()).abs(),
        (low  - close.shift()).abs(),
    ], axis=1).max(axis=1)
    df["atr"] = tr.rolling(14).mean()

    # Bollinger Bands
    sma20       = close.rolling(20).mean()
    std20       = close.rolling(20).std()
    df["bb_upper"] = sma20 + 2 * std20
    df["bb_lower"] = sma20 - 2 * std20
    # Same fix as RSI above, same reason: a flat 20-period band (bb_upper
    # == bb_lower) is rare but not impossible, and turning it into NaN
    # risks the identical stale-candle/IndexError failure mode via
    # df.dropna().iloc[-1] below.
    df["bb_pct"]   = (close - df["bb_lower"]) / ((df["bb_upper"] - df["bb_lower"]) + 1e-9)

    # Volume trend
    df["vol_ma"] = df["volume"].rolling(20).mean()

    return df


def _score_timeframe(df: pd.DataFrame, atr_mult: float) -> dict:
    """Produce a BUY/SELL/HOLD score from the last row of indicator data."""
    row  = df.dropna().iloc[-1]
    prev = df.dropna().iloc[-2] if len(df.dropna()) > 1 else row

    close   = float(row["close"])
    ema20   = float(row["ema20"])
    ema50   = float(row["ema50"])
    ema200  = float(row["ema200"])
    rsi     = float(row["rsi"])
    macd_h  = float(row["macd_hist"])
    atr     = float(row["atr"])
    bb_pct  = float(row.get("bb_pct", 0.5))
    vol     = float(row["volume"])
    vol_ma  = float(row.get("vol_ma", vol))
    prev_macd_h = float(prev.get("macd_hist", macd_h))

    score  = 0.0  # -100 bearish → +100 bullish

    # EMA alignment (40 pts max)
    if close > ema20 > ema50 > ema200:
        score += 40
    elif close > ema20 > ema50:
        score += 28
    elif close > ema20:
        score += 15
    elif close < ema20 < ema50 < ema200:
        score -= 40
    elif close < ema20 < ema50:
        score -= 28
    elif close < ema20:
        score -= 15

    # RSI (25 pts max)
    if rsi < 30:
        score += 25   # oversold — buy signal
    elif rsi < 45:
        score += 12
    elif rsi > 70:
        score -= 25   # overbought — sell signal
    elif rsi > 55:
        score -= 12

    # MACD histogram (20 pts max)
    if macd_h > 0:
        score += min(20, macd_h / (atr + 1e-9) * 10)
    else:
        score -= min(20, abs(macd_h) / (atr + 1e-9) * 10)

    # Bollinger Band position (15 pts max)
    if bb_pct < 0.2:
        score += 15   # near lower band — mean-reversion buy
    elif bb_pct > 0.8:
        score -= 15   # near upper band

    # Volume confirmation (bonus ±10)
    if vol > vol_ma * 1.3:
        score += 10 if score > 0 else -10

    # Clamp to [-100, 100]
    score = max(-100, min(100, score))

    # Convert score to action + confidence
    if score >= 20:
        action     = "BUY"
        confidence = round(50 + score * 0.45, 1)
    elif score <= -20:
        action     = "SELL"
        confidence = round(50 + abs(score) * 0.45, 1)
    else:
        action     = "HOLD"
        confidence = round(50 - abs(score) * 0.25, 1)

    confidence = min(95, max(35, confidence))

    # Expected return (ATR-based)
    expected_return_pct = round(atr / close * atr_mult * 100, 2)
    if action == "SELL":
        expected_return_pct = -expected_return_pct

    # Stop loss & take profit
    if action == "BUY":
        sl = round(close - atr * 1.2, 6)
        tp = round(close + atr * atr_mult, 6)
    elif action == "SELL":
        sl = round(close + atr * 1.2, 6)
        tp = round(close - atr * atr_mult, 6)
    else:
        sl = round(close - atr, 6)
        tp = round(close + atr, 6)

    # Build reason
    reasons = []
    if close > ema20 > ema50:
        reasons.append("Uptrend (EMA20>EMA50)")
    elif close < ema20 < ema50:
        reasons.append("Downtrend (EMA20<EMA50)")
    if rsi < 35:
        reasons.append(f"RSI oversold ({rsi:.0f})")
    elif rsi > 65:
        reasons.append(f"RSI overbought ({rsi:.0f})")
    # T-039 (2026-08-22): `prev` (the prior candle's row) was computed above
    # but never actually used anywhere -- this MACD reason unconditionally
    # fired "MACD bullish/bearish crossover" whenever `macd_h` was merely
    # nonzero (true on almost every real candle, since a continuous
    # histogram value is essentially never exactly 0.0), regardless of
    # whether a crossover (a sign change from the previous candle) had
    # actually just happened. That made the "crossover" claim in this
    # api-exposed `reason` string (`/advisor/analyze`, read by the mobile
    # Advisor screen) misleading on nearly every scored asset/timeframe --
    # it wasn't reporting an event, it was just restating the MACD sign.
    # Fixed by using the previously-unused `prev_macd_h` to detect an
    # actual sign change and only call it a "crossover" then; ongoing
    # (non-crossover) MACD direction is now labeled "momentum" instead,
    # which is what it actually is.
    macd_crossed_bullish = prev_macd_h <= 0 and macd_h > 0
    macd_crossed_bearish = prev_macd_h >= 0 and macd_h < 0
    if macd_crossed_bullish:
        reasons.append("MACD bullish crossover")
    elif macd_crossed_bearish:
        reasons.append("MACD bearish crossover")
    elif macd_h > 0:
        reasons.append("MACD bullish momentum")
    elif macd_h < 0:
        reasons.append("MACD bearish momentum")
    if not reasons:
        reasons.append("Consolidation — no clear trend")

    return {
        "action":              action,
        "confidence":          confidence,
        "score":               round(score, 1),
        "current_price":       round(close, 6),
        "expected_return_pct": f"{'+' if expected_return_pct >= 0 else ''}{expected_return_pct}%",
        "stop_loss":           sl,
        "take_profit":         tp,
        "risk_level":          _risk_level(confidence),
        "indicators": {
            "rsi":      round(rsi, 1),
            "macd_hist":round(float(row["macd_hist"]), 6),
            "ema20":    round(ema20, 6),
            "ema50":    round(ema50, 6),
            "ema200":   round(ema200, 6),
            "atr":      round(atr, 6),
        },
        "reason": " | ".join(reasons),
    }


class MultiTimeframeAnalyzer:
    def __init__(self):
        self._dp = DataProcessor()

    async def _analyze_one(self, asset: str, tf_key: str) -> dict:
        cfg = TIMEFRAME_CONFIG[tf_key]
        try:
            df = await self._dp.get_candles(asset, cfg["interval"], cfg["limit"])
            if df is None or len(df) < 60:
                return self._fallback(tf_key, cfg)
            df = _compute_indicators(df)
            result = _score_timeframe(df, cfg["atr_mult"])
            return {
                "timeframe":    tf_key,
                "label":        cfg["label"],
                **result,
            }
        except Exception as e:
            logger.warning(f"[MTF] {asset} {tf_key} error: {e}")
            return self._fallback(tf_key, cfg)

    def _fallback(self, tf_key: str, cfg: dict) -> dict:
        return {
            "timeframe":           tf_key,
            "label":               cfg["label"],
            "action":              "HOLD",
            "confidence":          50,
            "score":               0,
            "current_price":       0,
            "expected_return_pct": "0%",
            "stop_loss":           0,
            "take_profit":         0,
            "risk_level":          "medium",
            "indicators":          {},
            "reason":              "Insufficient data",
        }

    async def analyze(self, asset: str, timeframes: List[str]) -> dict:
        asset = asset.upper()
        valid_tfs = [tf for tf in timeframes if tf in TIMEFRAME_CONFIG]
        if not valid_tfs:
            valid_tfs = list(TIMEFRAME_CONFIG.keys())

        tasks = [self._analyze_one(asset, tf) for tf in valid_tfs]
        results = await asyncio.gather(*tasks)

        # Overall summary: pick the highest-confidence non-HOLD action
        active = [r for r in results if r["action"] != "HOLD"]
        if active:
            best = max(active, key=lambda r: r["confidence"])
        else:
            best = max(results, key=lambda r: r["confidence"])

        # Trend alignment score: how many timeframes agree
        buys  = sum(1 for r in results if r["action"] == "BUY")
        sells = sum(1 for r in results if r["action"] == "SELL")
        total = len(results)

        if buys > sells:
            trend_alignment = "bullish"
            alignment_pct   = round(buys / total * 100)
        elif sells > buys:
            trend_alignment = "bearish"
            alignment_pct   = round(sells / total * 100)
        else:
            trend_alignment = "neutral"
            alignment_pct   = 50

        return {
            "success":         True,
            "asset":           asset,
            "overall_action":  best["action"],
            "overall_confidence": best["confidence"],
            "trend_alignment": trend_alignment,
            "alignment_pct":   alignment_pct,
            "timeframes":      list(results),
            "best_timeframe":  best["timeframe"],
        }
