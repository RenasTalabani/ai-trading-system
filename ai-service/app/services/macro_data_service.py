"""
MacroDataService — pulls free macro/economic indicators with no API key.
Sources:
  • CoinGecko Global (crypto market cap, dominance, volume)
  • Binance funding rates (BTC, ETH)
  • Fear & Greed index via alternative.me
  • FRED proxy via data.nasdaq.com (10Y yield, DXY)
All calls are cached for 10 minutes to avoid hammering free endpoints.
"""
import asyncio
import logging
import time
from typing import Any

import httpx

logger = logging.getLogger("ai-service.macro")

_CACHE_TTL = 600  # 10 minutes
_cache: dict[str, tuple[float, Any]] = {}


def _cached(key: str) -> Any | None:
    entry = _cache.get(key)
    if entry and (time.time() - entry[0]) < _CACHE_TTL:
        return entry[1]
    return None


def _store(key: str, value: Any) -> None:
    _cache[key] = (time.time(), value)


class MacroDataService:
    def __init__(self):
        self._client = httpx.AsyncClient(timeout=10.0, follow_redirects=True)

    async def get_fear_greed(self) -> dict:
        key = "fear_greed"
        if hit := _cached(key):
            return hit
        try:
            r = await self._client.get(
                "https://api.alternative.me/fng/?limit=1&format=json"
            )
            d = r.json()["data"][0]
            result = {
                "value":              int(d["value"]),
                "classification":     d["value_classification"],
                "timestamp":          d["timestamp"],
            }
        except Exception as e:
            logger.warning(f"[Macro] Fear&Greed fetch failed: {e}")
            result = {"value": 50, "classification": "Neutral", "timestamp": ""}
        _store(key, result)
        return result

    async def get_global_crypto(self) -> dict:
        key = "global_crypto"
        if hit := _cached(key):
            return hit
        try:
            r = await self._client.get("https://api.coingecko.com/api/v3/global")
            d = r.json().get("data", {})
            result = {
                "total_market_cap_usd":  d.get("total_market_cap", {}).get("usd", 0),
                "total_volume_24h_usd":  d.get("total_volume", {}).get("usd", 0),
                "btc_dominance":         round(d.get("market_cap_percentage", {}).get("btc", 0), 1),
                "eth_dominance":         round(d.get("market_cap_percentage", {}).get("eth", 0), 1),
                "market_cap_change_24h": round(d.get("market_cap_change_percentage_24h_usd", 0), 2),
                "active_cryptocurrencies": d.get("active_cryptocurrencies", 0),
            }
        except Exception as e:
            logger.warning(f"[Macro] CoinGecko global fetch failed: {e}")
            result = {}
        _store(key, result)
        return result

    async def get_funding_rates(self) -> dict:
        """Fetch Binance perpetual funding rates for BTC and ETH."""
        key = "funding_rates"
        if hit := _cached(key):
            return hit
        try:
            r = await self._client.get(
                "https://fapi.binance.com/fapi/v1/premiumIndex",
                params={"symbol": "BTCUSDT"},
            )
            btc = r.json()
            r2 = await self._client.get(
                "https://fapi.binance.com/fapi/v1/premiumIndex",
                params={"symbol": "ETHUSDT"},
            )
            eth = r2.json()
            result = {
                "BTCUSDT": {
                    "funding_rate":     round(float(btc.get("lastFundingRate", 0)) * 100, 4),
                    "mark_price":       float(btc.get("markPrice", 0)),
                    "index_price":      float(btc.get("indexPrice", 0)),
                },
                "ETHUSDT": {
                    "funding_rate":     round(float(eth.get("lastFundingRate", 0)) * 100, 4),
                    "mark_price":       float(eth.get("markPrice", 0)),
                    "index_price":      float(eth.get("indexPrice", 0)),
                },
            }
        except Exception as e:
            logger.warning(f"[Macro] Funding rates fetch failed: {e}")
            result = {}
        _store(key, result)
        return result

    async def get_macro_snapshot(self) -> dict:
        """Aggregate all macro signals into one dict."""
        fear_greed, global_crypto, funding = await asyncio.gather(
            self.get_fear_greed(),
            self.get_global_crypto(),
            self.get_funding_rates(),
            return_exceptions=True,
        )
        # Replace exceptions with empty dicts
        if isinstance(fear_greed,   Exception): fear_greed   = {}
        if isinstance(global_crypto, Exception): global_crypto = {}
        if isinstance(funding,       Exception): funding       = {}

        fg_val = fear_greed.get("value", 50)
        fg_cls = fear_greed.get("classification", "Neutral")
        mktchg = global_crypto.get("market_cap_change_24h", 0)

        macro_sentiment = "neutral"
        if fg_val >= 65 or mktchg > 3:
            macro_sentiment = "bullish"
        elif fg_val <= 35 or mktchg < -3:
            macro_sentiment = "bearish"

        return {
            "fear_greed":        fear_greed,
            "global_crypto":     global_crypto,
            "funding_rates":     funding,
            "macro_sentiment":   macro_sentiment,
            "macro_bias":        _macro_bias(fg_val, mktchg, funding),
        }

    async def close(self):
        await self._client.aclose()


def _macro_bias(fg: int, mkt_chg: float, funding: dict) -> str:
    btc_fr = funding.get("BTCUSDT", {}).get("funding_rate", 0)
    score  = 0
    if fg >= 70: score += 2
    elif fg >= 55: score += 1
    elif fg <= 30: score -= 2
    elif fg <= 45: score -= 1
    if mkt_chg > 5: score += 2
    elif mkt_chg > 2: score += 1
    elif mkt_chg < -5: score -= 2
    elif mkt_chg < -2: score -= 1
    if btc_fr > 0.05: score -= 1   # high positive funding = overheated longs
    elif btc_fr < -0.01: score += 1  # negative funding = oversold
    if score >= 3:   return "strong_bull"
    if score >= 1:   return "mild_bull"
    if score <= -3:  return "strong_bear"
    if score <= -1:  return "mild_bear"
    return "neutral"
