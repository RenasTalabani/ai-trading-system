"""
Order Block Engine — Smart Money Concepts (SMC)
Detects bullish and bearish order blocks from OHLCV data.
"""
import logging
from typing import Optional
import pandas as pd
import numpy as np

from app.services.data_processor import DataProcessor

logger = logging.getLogger("ai-service.order_block_engine")

_TIMEFRAME_MAP = {
    "15m": ("15m", 300),
    "1h":  ("1h",  300),
    "4h":  ("4h",  200),
    "1d":  ("1d",  100),
}

_IMPULSE_MULTIPLIER = 2.5
_LOOKBACK           = 10   # candles to look back for OB before impulse
_AVG_WINDOW         = 20


def _ema(series: pd.Series, span: int) -> pd.Series:
    return series.ewm(span=span, adjust=False).mean()


def _rsi(series: pd.Series, period: int = 14) -> float:
    delta = series.diff()
    gain  = delta.clip(lower=0)
    loss  = (-delta).clip(lower=0)
    ag    = gain.ewm(com=period - 1, min_periods=period).mean()
    al    = loss.ewm(com=period - 1, min_periods=period).mean()
    rs    = ag / (al + 1e-9)
    return float((100 - 100 / (1 + rs)).iloc[-1])


def _strength_score(impulse_ratio: float, volume_ratio: float,
                    wick_ratio: float, ema_aligned: bool) -> int:
    """Score 0-100 based on impulse size, volume, clean departure, EMA alignment."""
    # Impulse ratio contribution (0-40)
    imp_score = min(40, int((impulse_ratio - _IMPULSE_MULTIPLIER) /
                             (_IMPULSE_MULTIPLIER * 2) * 40))
    imp_score = max(0, imp_score)

    # Volume spike contribution (0-20)
    vol_score = min(20, int((volume_ratio - 1.0) / 2.0 * 20))
    vol_score = max(0, vol_score)

    # Clean departure: low wick ratio = cleaner (0-20)
    # wick_ratio = wick_size / candle_range (0-1); lower is better
    clean_score = int((1 - min(wick_ratio, 1.0)) * 20)

    # EMA alignment (0-20)
    ema_score = 20 if ema_aligned else 0

    return min(100, imp_score + vol_score + clean_score + ema_score)


class OrderBlockEngine:
    def __init__(self, news_analyzer=None, social_analyzer=None):
        self._dp              = DataProcessor()
        self._news_analyzer   = news_analyzer
        self._social_analyzer = social_analyzer

    # ── News / social sentiment fetch ─────────────────────────────────────────

    async def _get_sentiment(self, asset: str) -> dict:
        """Return fused news+social sentiment score for the asset (0-100 bullish scale)."""
        base = asset.upper().replace("USDT", "").replace("BUSD", "")
        ns = ss = 50.0   # neutral fallback
        sentiment     = "neutral"
        impact        = 0.0
        top_events    = []
        article_count = 0

        try:
            if self._news_analyzer:
                nr = await self._news_analyzer.refresh()
                nd = nr.get("by_asset", {}).get(base, {})
                ns            = float(nd.get("market_score", 50))
                sentiment     = nd.get("sentiment", "neutral")
                impact        = float(nd.get("impact", 0.0))
                top_events    = nd.get("top_events", [])
                article_count = int(nd.get("article_count", 0))
        except Exception as e:
            logger.warning(f"News sentiment unavailable for {base}: {e}")

        try:
            if self._social_analyzer:
                sr = await self._social_analyzer.refresh()
                sd = sr.get("by_asset", {}).get(base, {})
                ss = float(sd.get("market_score", 50))
        except Exception as e:
            logger.warning(f"Social sentiment unavailable for {base}: {e}")

        combined = round((ns + ss) / 2, 1)
        return {
            "news_score":     round(ns, 1),
            "social_score":   round(ss, 1),
            "combined_score": combined,
            "sentiment":      sentiment,
            "impact":         round(impact, 3),
            "top_events":     top_events[:3],
            "article_count":  article_count,
        }

    # ── 60/40 fusion ──────────────────────────────────────────────────────────

    @staticmethod
    def _fuse(signal: dict, sent: dict):
        """Blend technical OB confidence (60%) with news/social sentiment (40%)."""
        action  = signal["action"]
        ob_conf = signal["confidence"]
        score   = sent["combined_score"]   # 0-100, higher = more bullish

        if action == "BUY":
            aligned_score = score          # high score boosts BUY
            aligned = score >= 50
        elif action == "SELL":
            aligned_score = 100 - score   # low news boosts SELL
            aligned = score < 50
        else:                              # HOLD — no fusion
            news_analysis = {**sent, "aligned": False, "confidence_boost": 0,
                             "technical_confidence": ob_conf}
            return signal, news_analysis

        fused = int(ob_conf * 0.6 + aligned_score * 0.4)
        fused = max(10, min(95, fused))
        boost = fused - ob_conf

        news_analysis = {
            **sent,
            "aligned":              aligned,
            "confidence_boost":     boost,
            "technical_confidence": ob_conf,
        }
        return {**signal, "confidence": fused}, news_analysis

    async def analyze(self, asset: str, timeframe: str) -> dict:
        asset     = asset.upper()
        timeframe = timeframe.lower()

        interval, limit = _TIMEFRAME_MAP.get(timeframe, ("1h", 300))

        df = await self._dp.fetch_market_data(asset, interval, limit=limit)
        if df is None or len(df) < 50:
            return self._fallback(asset, timeframe, "Insufficient market data")

        df = df.copy().reset_index(drop=True)

        # ── Technical indicators ─────────────────────────────────────────────
        df["body"]  = (df["close"] - df["open"]).abs()
        df["range"] = df["high"] - df["low"]
        df["avg_body"]   = df["body"].rolling(_AVG_WINDOW, min_periods=5).mean()
        df["avg_volume"] = df["volume"].rolling(_AVG_WINDOW, min_periods=5).mean()

        close  = df["close"]
        ema50  = _ema(close, 50).iloc[-1]
        ema200 = _ema(close, 200).iloc[-1] if len(close) >= 200 else ema50
        rsi    = _rsi(close)
        price  = float(close.iloc[-1])

        bullish_trend = ema50 > ema200
        bearish_trend = ema50 < ema200

        # ── Find impulse candles ──────────────────────────────────────────────
        order_blocks = []

        for i in range(_AVG_WINDOW + 1, len(df)):
            avg_b = float(df["avg_body"].iloc[i])
            avg_v = float(df["avg_volume"].iloc[i])
            if avg_b <= 0:
                continue

            body   = float(df["body"].iloc[i])
            volume = float(df["volume"].iloc[i])

            if body < _IMPULSE_MULTIPLIER * avg_b:
                continue  # not an impulse

            is_bull_impulse = df["close"].iloc[i] > df["open"].iloc[i]
            volume_ratio    = volume / (avg_v + 1e-9)

            # wick on impulse candle
            if is_bull_impulse:
                wick     = (df["high"].iloc[i] - df["close"].iloc[i])
            else:
                wick     = (df["open"].iloc[i] - df["low"].iloc[i])
            wick_ratio = wick / (float(df["range"].iloc[i]) + 1e-9)
            imp_ratio  = body / (avg_b + 1e-9)

            # ── Find the order block (last opposing candle before impulse) ────
            ob_candle = None
            for j in range(i - 1, max(i - _LOOKBACK, 0) - 1, -1):
                c_open  = float(df["open"].iloc[j])
                c_close = float(df["close"].iloc[j])
                c_high  = float(df["high"].iloc[j])
                c_low   = float(df["low"].iloc[j])
                c_ts    = str(df["timestamp"].iloc[j])

                is_bearish_c = c_close < c_open
                is_bullish_c = c_close > c_open

                if is_bull_impulse and is_bearish_c:
                    # Bullish OB: zone = open (top of bearish) to low
                    zone_high = c_open
                    zone_low  = c_low
                    ob_type   = "bullish"
                    ob_candle = (j, ob_type, zone_low, zone_high, c_ts)
                    break

                if not is_bull_impulse and is_bullish_c:
                    # Bearish OB: zone = open (bottom of bullish) to high
                    zone_low  = c_open
                    zone_high = c_high
                    ob_type   = "bearish"
                    ob_candle = (j, ob_type, zone_low, zone_high, c_ts)
                    break

            if ob_candle is None:
                continue

            j, ob_type, z_low, z_high = ob_candle[:4]
            ts = ob_candle[4]

            # ── Freshness check ───────────────────────────────────────────────
            future = df.iloc[i + 1:]
            if ob_type == "bullish":
                touches = int((future["low"] <= z_high).sum())
            else:
                touches = int((future["high"] >= z_low).sum())

            if touches == 0:
                freshness = "fresh"
            elif touches <= 2:
                freshness = "mitigated"
            else:
                continue  # invalid — skip

            # ── EMA alignment ─────────────────────────────────────────────────
            ema_ok = (ob_type == "bullish" and bullish_trend) or \
                     (ob_type == "bearish" and bearish_trend)

            strength = _strength_score(imp_ratio, volume_ratio, wick_ratio, ema_ok)
            if strength < 30:
                continue

            order_blocks.append({
                "type":      ob_type,
                "zone":      {"low": round(z_low, 6), "high": round(z_high, 6)},
                "strength":  strength,
                "freshness": freshness,
                "timeframe": timeframe,
                "timestamp": ts,
                "ob_index":  j,
                "impulse_index": i,
            })

        # ── Deduplicate overlapping zones (keep strongest) ────────────────────
        order_blocks = _deduplicate(order_blocks)

        # ── Sort by strength desc ─────────────────────────────────────────────
        order_blocks.sort(key=lambda x: x["strength"], reverse=True)

        # ── Generate signal ───────────────────────────────────────────────────
        signal = self._generate_signal(
            price, order_blocks, bullish_trend, bearish_trend, rsi
        )

        # ── Hybrid fusion: technical 60% + news/social 40% ───────────────────
        sent = await self._get_sentiment(asset)
        signal, news_analysis = self._fuse(signal, sent)

        return {
            "success": True,
            "asset":         asset,
            "timeframe":     timeframe,
            "current_price": round(price, 6),
            "ema50":         round(float(ema50), 6),
            "ema200":        round(float(ema200), 6),
            "rsi":           round(rsi, 1),
            "trend":         "bullish" if bullish_trend else "bearish" if bearish_trend else "sideways",
            "order_blocks":  order_blocks[:10],
            "signal":        signal,
            "news_analysis": news_analysis,
        }

    # ── Signal generation ─────────────────────────────────────────────────────

    def _generate_signal(self, price: float, obs: list,
                         bull_trend: bool, bear_trend: bool, rsi: float) -> dict:
        if not obs:
            return self._hold_signal("No valid order blocks detected")

        # Find nearest OB to current price
        best_buy = best_sell = None

        for ob in obs:
            z_low  = ob["zone"]["low"]
            z_high = ob["zone"]["high"]
            mid    = (z_low + z_high) / 2
            dist   = abs(price - mid) / (price + 1e-9)

            ob["_dist"] = dist

            if ob["type"] == "bullish" and ob["strength"] >= 60 and dist < 0.05:
                if best_buy is None or ob["strength"] > best_buy["strength"]:
                    best_buy = ob
            if ob["type"] == "bearish" and ob["strength"] >= 60 and dist < 0.05:
                if best_sell is None or ob["strength"] > best_sell["strength"]:
                    best_sell = ob

        # BUY signal
        if best_buy and bull_trend and rsi < 70:
            z_low  = best_buy["zone"]["low"]
            z_high = best_buy["zone"]["high"]
            sl     = round(z_low * 0.995, 6)       # 0.5% below OB low
            tp     = round(price + (price - sl) * 2, 6)  # 1:2 RR
            conf   = min(95, best_buy["strength"] + (10 if rsi < 50 else 0))
            return {
                "action":      "BUY",
                "confidence":  conf,
                "entry_zone":  f"{round(z_low,4)} – {round(z_high,4)}",
                "stop_loss":   sl,
                "take_profit": tp,
                "risk_reward": "1:2",
                "reason":      f"Price near fresh bullish OB (str={best_buy['strength']}). "
                               f"Trend bullish, RSI={rsi:.0f}",
            }

        # SELL signal
        if best_sell and bear_trend and rsi > 30:
            z_low  = best_sell["zone"]["low"]
            z_high = best_sell["zone"]["high"]
            sl     = round(z_high * 1.005, 6)
            tp     = round(price - (sl - price) * 2, 6)
            conf   = min(95, best_sell["strength"] + (10 if rsi > 60 else 0))
            return {
                "action":      "SELL",
                "confidence":  conf,
                "entry_zone":  f"{round(z_low,4)} – {round(z_high,4)}",
                "stop_loss":   sl,
                "take_profit": tp,
                "risk_reward": "1:2",
                "reason":      f"Price near fresh bearish OB (str={best_sell['strength']}). "
                               f"Trend bearish, RSI={rsi:.0f}",
            }

        return self._hold_signal(
            f"No valid OB within 5% of price. RSI={rsi:.0f}, "
            f"{'bull' if bull_trend else 'bear'} trend."
        )

    @staticmethod
    def _hold_signal(reason: str) -> dict:
        return {
            "action":      "HOLD",
            "confidence":  50,
            "entry_zone":  None,
            "stop_loss":   None,
            "take_profit": None,
            "risk_reward": None,
            "reason":      reason,
        }

    @staticmethod
    def _fallback(asset: str, timeframe: str, reason: str) -> dict:
        return {
            "success":       False,
            "asset":         asset,
            "timeframe":     timeframe,
            "current_price": 0,
            "order_blocks":  [],
            "signal":        OrderBlockEngine._hold_signal(reason),
            "news_analysis": {
                "news_score": 50, "social_score": 50, "combined_score": 50,
                "sentiment": "neutral", "impact": 0.0, "top_events": [],
                "article_count": 0, "aligned": False, "confidence_boost": 0,
                "technical_confidence": 50,
            },
            "error":         reason,
        }


def _deduplicate(obs: list, overlap_pct: float = 0.7) -> list:
    """Remove OBs whose zones overlap >70% — keep the stronger one."""
    kept = []
    for ob in sorted(obs, key=lambda x: x["strength"], reverse=True):
        z1_l, z1_h = ob["zone"]["low"], ob["zone"]["high"]
        z1_size    = z1_h - z1_l + 1e-9
        duplicate  = False
        for k in kept:
            if k["type"] != ob["type"]:
                continue
            z2_l, z2_h = k["zone"]["low"], k["zone"]["high"]
            overlap    = max(0, min(z1_h, z2_h) - max(z1_l, z2_l))
            if overlap / z1_size >= overlap_pct:
                duplicate = True
                break
        if not duplicate:
            kept.append(ob)
    return kept
