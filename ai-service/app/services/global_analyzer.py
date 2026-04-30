"""
GlobalAnalyzer — scans ALL asset classes and returns the best opportunity.
Crypto: full UnifiedAnalyzer pipeline (OB + Strategy + News + Social).
Commodities / Forex: technical indicators + macro news.
"""
import asyncio
import logging
from typing import Any

from app.services.unified_analyzer import (
    UnifiedAnalyzer, _action_to_score, _score_to_action,
)
from app.services.collectors.multi_asset_collector import (
    fetch_asset_data, ALL_MULTI_ASSETS,
)
from app.services.collectors.binance_collector import TRACKED_ASSETS

logger = logging.getLogger("ai-service.global_analyzer")

# ── Metadata ──────────────────────────────────────────────────────────────────

ASSET_CLASS_MAP: dict[str, str] = {
    **{a: "crypto"    for a in TRACKED_ASSETS},
    "XAUUSD": "commodity", "XAGUSD": "commodity",
    "WTI":    "commodity", "BRENT":  "commodity",
    "EURUSD": "forex",     "GBPUSD": "forex",
    "USDJPY": "forex",
}

ASSET_DISPLAY: dict[str, str] = {
    "BTCUSDT":  "Bitcoin",     "ETHUSDT":  "Ethereum",
    "BNBUSDT":  "BNB",         "SOLUSDT":  "Solana",
    "XRPUSDT":  "XRP",         "ADAUSDT":  "Cardano",
    "DOGEUSDT": "Dogecoin",    "AVAXUSDT": "Avalanche",
    "LINKUSDT": "Chainlink",   "MATICUSDT":"Polygon",
    "XAUUSD":   "Gold",        "XAGUSD":   "Silver",
    "WTI":      "Crude Oil",   "BRENT":    "Brent Oil",
    "EURUSD":   "EUR / USD",   "GBPUSD":   "GBP / USD",
    "USDJPY":   "USD / JPY",
}

_NEWS_KEYWORDS: dict[str, str] = {
    "XAUUSD": "gold",  "XAGUSD": "silver",
    "WTI":    "oil",   "BRENT":  "oil",
    "EURUSD": "euro",  "GBPUSD": "pound",
    "USDJPY": "japan",
}

# How many crypto assets to scan (keeps total latency under 60 s)
_CRYPTO_SCAN_LIMIT = 6


class GlobalAnalyzer:
    def __init__(self, unified_analyzer: UnifiedAnalyzer,
                 news_analyzer, social_analyzer):
        self._unified = unified_analyzer
        self._news    = news_analyzer
        self._social  = social_analyzer

    # ── Public ────────────────────────────────────────────────────────────────

    async def scan_all(self, capital: float = 500.0,
                       top_n: int = 5,
                       timeframe: str = "1h") -> dict:
        """
        Scan all asset classes in parallel.
        Returns ranked opportunities with the single best highlighted.
        """
        crypto_assets = TRACKED_ASSETS[:_CRYPTO_SCAN_LIMIT]
        multi_assets  = list(ALL_MULTI_ASSETS.keys())

        tasks = (
            [self._score_crypto(a, timeframe, capital)   for a in crypto_assets] +
            [self._score_multi_asset(sym)                for sym in multi_assets]
        )

        raw = await asyncio.gather(*tasks, return_exceptions=True)

        scored: list[dict] = []
        for r in raw:
            if isinstance(r, dict) and r.get("fused_score", 0) > 0:
                scored.append(r)
            elif isinstance(r, Exception):
                logger.warning(f"[Global] scorer error: {r}")

        scored.sort(key=lambda x: x.get("fused_score", 50), reverse=True)

        best = scored[0] if scored else None

        # Annotate rank
        for i, item in enumerate(scored):
            item["rank"] = i + 1

        return {
            "success":           True,
            "scanned":           len(scored),
            "capital":           capital,
            "timeframe":         timeframe,
            "best":              best,
            "top_opportunities": scored[:top_n],
        }

    # ── Crypto scorer (full pipeline) ─────────────────────────────────────────

    async def _score_crypto(self, asset: str, timeframe: str,
                            capital: float) -> dict[str, Any]:
        try:
            result = await asyncio.wait_for(
                self._unified.analyze(asset, timeframe, capital),
                timeout=30,
            )
            if not result.get("success"):
                return {}
            sig  = result["signal"]
            tech = result.get("technical", {})
            sent = result.get("sentiment", {})
            fs   = _action_to_score(sig["action"], sig["confidence"])
            return {
                "asset":         asset,
                "display_name":  ASSET_DISPLAY.get(asset, asset),
                "asset_class":   "crypto",
                "action":        sig["action"],
                "confidence":    sig["confidence"],
                "fused_score":   round(fs, 1),
                "current_price": tech.get("current_price"),
                "rsi":           tech.get("rsi"),
                "trend":         tech.get("trend"),
                "news_score":    sent.get("news_score", 50),
                "entry_zone":    sig.get("entry_zone"),
                "stop_loss":     sig.get("stop_loss"),
                "take_profit":   sig.get("take_profit"),
                "risk_reward":   sig.get("risk_reward"),
                "reason":        sig.get("reason"),
            }
        except Exception as e:
            logger.warning(f"[Global] crypto score error {asset}: {e}")
            return {}

    # ── Non-crypto scorer (technical + macro news) ────────────────────────────

    async def _score_multi_asset(self, symbol: str) -> dict[str, Any]:
        symbol = symbol.upper()

        async def _safe_df():
            try:
                return await asyncio.wait_for(fetch_asset_data(symbol), timeout=15)
            except Exception:
                return None

        df, news_score = await asyncio.gather(
            _safe_df(),
            self._macro_news_score(_NEWS_KEYWORDS.get(symbol, symbol.lower())),
        )

        current_price = 0.0
        tech_score    = 50.0
        rsi_val       = 50.0
        trend         = "sideways"
        ema50_val     = None
        ema200_val    = None

        if df is not None and len(df) >= 50:
            row           = df.iloc[-1]
            current_price = float(row["close"])
            ema50_val     = float(row.get("ema50",  current_price))
            ema200_val    = float(row.get("ema200", current_price))
            rsi_val       = float(row.get("rsi",    50))

            if current_price > ema50_val > ema200_val:
                trend      = "uptrend"
                tech_score = min(92, 60 + (rsi_val - 50) * 0.5)
            elif current_price < ema50_val < ema200_val:
                trend      = "downtrend"
                tech_score = max(8, 40 - (50 - rsi_val) * 0.5)
            else:
                tech_score = 50.0

            # Overbought / oversold RSI correction
            if rsi_val > 75:
                tech_score = min(tech_score, 38)
            elif rsi_val < 25:
                tech_score = max(tech_score, 62)

        # Fusion: Technical 65 % + Macro News 35 %
        fused = tech_score * 0.65 + float(news_score) * 0.35
        action, confidence = _score_to_action(fused)

        # Derive rough SL / TP from current price
        stop_loss   = round(current_price * 0.98, 6) if current_price else None
        take_profit = round(current_price * 1.04, 6) if current_price else None

        return {
            "asset":         symbol,
            "display_name":  ASSET_DISPLAY.get(symbol, symbol),
            "asset_class":   ASSET_CLASS_MAP.get(symbol, "other"),
            "action":        action,
            "confidence":    confidence,
            "fused_score":   round(fused, 1),
            "current_price": round(current_price, 6) if current_price else None,
            "rsi":           round(rsi_val, 1),
            "ema50":         round(ema50_val, 6)  if ema50_val  else None,
            "ema200":        round(ema200_val, 6) if ema200_val else None,
            "trend":         trend,
            "news_score":    round(float(news_score), 1),
            "entry_zone":    None,
            "stop_loss":     stop_loss,
            "take_profit":   take_profit,
            "risk_reward":   "1:2",
            "reason":        f"{trend.capitalize()} trend | RSI {rsi_val:.0f} | News {news_score:.0f}",
        }

    # ── Macro news scorer ─────────────────────────────────────────────────────

    async def _macro_news_score(self, keyword: str) -> float:
        try:
            result = await asyncio.wait_for(self._news.refresh(), timeout=10)
            sentiment = result.get("global", {}).get("overall_sentiment", "neutral")
            base      = {"bullish": 62.0, "bearish": 38.0}.get(sentiment, 50.0)
            headlines = [h.lower() for h in result.get("top_headlines", [])]
            hits      = sum(1 for h in headlines if keyword in h)
            return min(80.0, base + hits * 3.0)
        except Exception:
            return 50.0
