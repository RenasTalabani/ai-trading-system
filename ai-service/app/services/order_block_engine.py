"""
Order Block Engine — Smart Money Concepts (SMC)
Detects bullish and bearish order blocks from OHLCV data.

────────────────────────────────────────────────────────────────────────────
PHASE 3 (2026-09-01) — real structure + liquidity context
────────────────────────────────────────────────────────────────────────────
This phase does NOT change which order blocks are detected, how they are
scored, which BUY/SELL/HOLD signal is generated, or the sentiment fusion —
all of that is the original, already-tested logic below, untouched.

What Phase 3 adds is real, deterministic CONTEXT computed from the same
OHLCV data already fetched for this analysis, via the Phase 1 (market
structure) and Phase 2 (liquidity) engines built earlier in this build-out:

  - Each order block gets a `structure_context`: the current confirmed
    bias (BULLISH/BEARISH/UNKNOWN, never guessed), whether this OB's
    direction agrees with that bias, and the most recent real BOS/CHoCH
    break at or before this OB's impulse candle (or None if there wasn't
    one — never fabricated).
  - Each order block gets a `liquidity_context`: whether a liquidity pool
    on the OPPOSITE side (sell-side liquidity for a bullish OB, buy-side
    for a bearish OB — the classic "sweep then reversal" SMC pattern) was
    genuinely swept (CONFIRMED_SWEEP or FAILED_SWEEP — an unresolved wick
    with no confirm-window verdict yet does not count) within a bounded
    lookback window before this OB's impulse candle. `None` if no such
    event exists in that window — this module does not report "YES" to a
    liquidity-sweep question it cannot actually answer from real data.
  - The top-level response gains `market_structure` (bias, when it was
    established, swing count, the last few real breaks) and `liquidity`
    (pool counts by status/side, and resting-pool density near the current
    price on both sides) — a genuine snapshot of current structure/
    liquidity state, not new detection logic layered onto the OB scan
    itself.

Both new engines are called on the exact same `df` already fetched for
this request — no extra network calls, no second data source. If either
analysis fails for any reason, this module degrades gracefully (logs a
warning, returns UNAVAILABLE/None context) rather than breaking order
block detection, which remains fully independent of this context.
"""
import logging
from typing import Optional
import pandas as pd
import numpy as np

from app.services.data_processor import DataProcessor
from app.services.market_structure_engine import analyze_structure
from app.services.liquidity_engine import analyze_liquidity, resting_pool_density

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

# Phase 3: how many candles before an OB's impulse candle to look for a
# genuine opposite-side liquidity sweep (the "sweep then reversal" SMC
# confluence). Deliberately a separate constant from _LOOKBACK above --
# that one bounds the OB *zone-candle* search, this one bounds how far
# back a liquidity event can be and still be considered related to this
# OB's formation. 20 candles is a documented choice, not a magic number
# inherited from the zone search.
_LIQUIDITY_CONFLUENCE_WINDOW = 20


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


# ── Phase 3: structure + liquidity context helpers ─────────────────────────
# All pure functions, independently testable, no side effects on the
# original detection/signal logic.

def _compute_structure_and_liquidity(df: pd.DataFrame):
    """Runs the Phase 1 + Phase 2 engines on the already-fetched df. Never
    raises -- degrades to (None, []) on any failure so a problem here can
    never break order block detection itself."""
    structure_result = None
    pools: list = []
    try:
        structure_result = analyze_structure(df)
    except Exception as e:
        logger.warning(f"Phase 3: market structure analysis failed, degrading gracefully: {e}")
        structure_result = None

    if structure_result is not None and structure_result.status == "OK":
        try:
            pools = analyze_liquidity(df, structure_result.swings)
        except Exception as e:
            logger.warning(f"Phase 3: liquidity analysis failed, degrading gracefully: {e}")
            pools = []

    return structure_result, pools


def _most_recent_break_at_or_before(breaks: list, idx: int) -> Optional[dict]:
    candidates = [b for b in breaks if b.index <= idx]
    if not candidates:
        return None
    best = max(candidates, key=lambda b: b.index)
    return best.to_dict()


def _structure_context_for_ob(ob: dict, structure_result) -> dict:
    """Real bias/break context for one order block. Never guesses: bias is
    UNKNOWN and aligned_with_bias is None when the underlying structure
    analysis has no established bias yet, or is unavailable."""
    if structure_result is None or structure_result.status != "OK":
        return {"bias": "UNKNOWN", "aligned_with_bias": None, "most_recent_break": None}

    bias = structure_result.bias
    aligned = None
    if bias in ("BULLISH", "BEARISH"):
        aligned = (bias == "BULLISH") if ob["type"] == "bullish" else (bias == "BEARISH")

    recent_break = _most_recent_break_at_or_before(structure_result.breaks, ob["impulse_index"])

    return {
        "bias": bias,
        "aligned_with_bias": aligned,
        "most_recent_break": recent_break,
    }


def _liquidity_sweep_confluence(ob: dict, pools: list,
                                 window: int = _LIQUIDITY_CONFLUENCE_WINDOW) -> Optional[dict]:
    """Rule: for a bullish OB, look for a SELL-side pool that was genuinely
    swept (CONFIRMED_SWEEP or FAILED_SWEEP -- an AMBIGUOUS or unresolved
    wick does not count as evidence) within `window` candles at or before
    this OB's impulse candle -- the classic "liquidity grab, then reversal
    forms the order block" pattern. Mirrored for bearish OBs against
    BUY-side pools. Returns the most recent qualifying pool as a dict, or
    None if no such real event exists in that window (never fabricated)."""
    impulse_idx = ob["impulse_index"]
    side = "sell_side" if ob["type"] == "bullish" else "buy_side"

    candidates = [
        p for p in pools
        if p.kind == side
        and p.sweep_classification in ("CONFIRMED_SWEEP", "FAILED_SWEEP")
        and p.interaction_index is not None
        and impulse_idx - window <= p.interaction_index <= impulse_idx
    ]
    if not candidates:
        return None
    best = max(candidates, key=lambda p: p.interaction_index)
    return best.to_dict()


def _build_market_structure_summary(structure_result) -> dict:
    if structure_result is None:
        return {"status": "UNAVAILABLE", "reason": "Structure analysis failed", "bias": "UNKNOWN"}
    if structure_result.status != "OK":
        return {"status": structure_result.status, "reason": structure_result.reason, "bias": "UNKNOWN"}

    recent_breaks = sorted(structure_result.breaks, key=lambda b: b.index)[-3:]
    return {
        "status": "OK",
        "bias": structure_result.bias,
        "bias_established_at_index": structure_result.bias_established_at_index,
        "swing_count": len(structure_result.swings),
        "recent_breaks": [b.to_dict() for b in recent_breaks],
    }


def _build_liquidity_summary(pools: list, price: float) -> dict:
    if not pools:
        empty_density = {"count": 0, "levels": [], "proximity_pct": 0.015}
        return {
            "pools_total": 0, "resting_buy_side": 0, "resting_sell_side": 0,
            "swept": 0, "broken": 0,
            "buy_side_density_near_price": empty_density,
            "sell_side_density_near_price": empty_density,
        }

    resting_buy = sum(1 for p in pools if p.kind == "buy_side" and p.status == "RESTING")
    resting_sell = sum(1 for p in pools if p.kind == "sell_side" and p.status == "RESTING")
    swept = sum(1 for p in pools if p.status == "SWEPT")
    broken = sum(1 for p in pools if p.status == "BROKEN")

    return {
        "pools_total": len(pools),
        "resting_buy_side": resting_buy,
        "resting_sell_side": resting_sell,
        "swept": swept,
        "broken": broken,
        "buy_side_density_near_price": resting_pool_density(pools, price, "buy_side"),
        "sell_side_density_near_price": resting_pool_density(pools, price, "sell_side"),
    }


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

        # ── Phase 3: annotate with real structure + liquidity context ─────────
        # Computed once on this same df; never changes which OBs were found,
        # their strength, freshness, or ordering above.
        structure_result, pools = _compute_structure_and_liquidity(df)
        for ob in order_blocks:
            ob["structure_context"] = _structure_context_for_ob(ob, structure_result)
            ob["liquidity_context"] = {
                "swept_pool_before_formation": _liquidity_sweep_confluence(ob, pools),
            }

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
            "market_structure": _build_market_structure_summary(structure_result),
            "liquidity":        _build_liquidity_summary(pools, price),
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

            # T-042 (2026-08-24): this used to write `ob["_dist"] = dist` here,
            # mutating the same dict objects that `analyze()` returns (as
            # `order_blocks[:10]`) straight into the live `/order-blocks/analyze`
            # API response -- the leading underscore signals "internal", but
            # nothing ever stripped it back out, and the route has no
            # response_model to filter it. `dist` is only ever needed as a
            # local value for the threshold checks below, so it no longer
            # touches the dict at all.

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
            "market_structure": {"status": "UNAVAILABLE", "reason": reason, "bias": "UNKNOWN"},
            "liquidity":        _build_liquidity_summary([], 0),
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
