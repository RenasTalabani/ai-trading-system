"""
MultiAssetCollector — OHLCV data for commodities and forex.
Uses Alpha Vantage (free tier: 5 req/min, 500 req/day).
Falls back to simulated data when ALPHA_VANTAGE_KEY is not set.
"""
import asyncio
import logging
import os
from datetime import datetime, timezone
from typing import Optional

import httpx
import pandas as pd

logger = logging.getLogger("ai-service.multi_asset_collector")

AV_KEY  = os.getenv("ALPHA_VANTAGE_KEY", "")
AV_BASE = "https://www.alphavantage.co/query"

# ── Asset registries ──────────────────────────────────────────────────────────

FOREX_PAIRS = {
    "EURUSD": ("EUR", "USD"),
    "GBPUSD": ("GBP", "USD"),
    "USDJPY": ("USD", "JPY"),
}

PRECIOUS_METALS = {
    "XAUUSD": ("XAU", "USD"),   # Gold
    "XAGUSD": ("XAG", "USD"),   # Silver
}

COMMODITY_FUNCTIONS = {
    "WTI":   "WTI",
    "BRENT": "BRENT",
}

ALL_MULTI_ASSETS: dict[str, str] = {
    **{k: "forex"     for k in FOREX_PAIRS},
    **{k: "commodity" for k in PRECIOUS_METALS},
    **{k: "commodity" for k in COMMODITY_FUNCTIONS},
}

_FALLBACK_PRICES = {
    "XAUUSD": 3300.0,
    "XAGUSD": 33.0,
    "WTI":    82.0,
    "BRENT":  86.0,
    "EURUSD": 1.085,
    "GBPUSD": 1.265,
    "USDJPY": 150.0,
}


# ── Indicator computation ─────────────────────────────────────────────────────

def _compute_indicators(df: pd.DataFrame) -> pd.DataFrame:
    close = df["close"]
    df = df.copy()
    df["ema50"]  = close.ewm(span=50,  adjust=False).mean()
    df["ema200"] = close.ewm(span=200, adjust=False).mean()
    delta    = close.diff()
    gain     = delta.clip(lower=0)
    loss     = (-delta).clip(lower=0)
    avg_gain = gain.ewm(span=14, adjust=False).mean()
    avg_loss = loss.ewm(span=14, adjust=False).mean()
    rs       = avg_gain / avg_loss.replace(0, 1e-9)
    df["rsi"] = 100 - (100 / (1 + rs))
    return df


# ── Alpha Vantage fetchers ────────────────────────────────────────────────────

async def _fetch_fx_intraday(from_sym: str, to_sym: str,
                              interval: str = "60min") -> Optional[pd.DataFrame]:
    if not AV_KEY:
        return None
    params = {
        "function":    "FX_INTRADAY",
        "from_symbol": from_sym,
        "to_symbol":   to_sym,
        "interval":    interval,
        "outputsize":  "compact",
        "apikey":      AV_KEY,
    }
    try:
        async with httpx.AsyncClient(timeout=12) as client:
            r = await client.get(AV_BASE, params=params)
        data = r.json()
        key  = f"Time Series FX ({interval})"
        ts   = data.get(key, {})
        if not ts:
            logger.warning(f"[MultiAsset] No FX data for {from_sym}{to_sym}: {list(data.keys())}")
            return None
        rows = []
        for dt_str, v in sorted(ts.items()):
            rows.append({
                "time":   datetime.fromisoformat(dt_str).replace(tzinfo=timezone.utc),
                "open":   float(v["1. open"]),
                "high":   float(v["2. high"]),
                "low":    float(v["3. low"]),
                "close":  float(v["4. close"]),
                "volume": 0.0,
            })
        df = pd.DataFrame(rows).set_index("time").sort_index()
        return _compute_indicators(df)
    except Exception as e:
        logger.warning(f"[MultiAsset] FX fetch error {from_sym}{to_sym}: {e}")
        return None


async def _fetch_commodity(function: str) -> Optional[pd.DataFrame]:
    if not AV_KEY:
        return None
    params = {"function": function, "interval": "monthly", "apikey": AV_KEY}
    try:
        async with httpx.AsyncClient(timeout=12) as client:
            r = await client.get(AV_BASE, params=params)
        data = r.json()
        ts = data.get("data", [])
        if not ts:
            return None
        rows = []
        for item in ts:
            v = item.get("value", ".")
            if v == ".":
                continue
            p = float(v)
            rows.append({
                "time":   datetime.strptime(item["date"], "%Y-%m-%d").replace(tzinfo=timezone.utc),
                "open":   p, "high": p, "low": p, "close": p, "volume": 0.0,
            })
        if not rows:
            return None
        df = pd.DataFrame(rows).set_index("time").sort_index()
        return _compute_indicators(df)
    except Exception as e:
        logger.warning(f"[MultiAsset] Commodity fetch error {function}: {e}")
        return None


# ── Simulated fallback ────────────────────────────────────────────────────────

def _simulated_df(seed_price: float, n: int = 200) -> pd.DataFrame:
    import random
    rng = random.Random(int(seed_price * 1000) % (2 ** 31))
    prices = [seed_price]
    for _ in range(n - 1):
        prices.append(prices[-1] * (1 + rng.gauss(0, 0.005)))
    now  = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
    rows = [{"time": now, "open": p, "high": p * 1.002,
             "low": p * 0.998, "close": p, "volume": 0.0}
            for p in prices]
    df = pd.DataFrame(rows).set_index("time").sort_index()
    return _compute_indicators(df)


# ── Public API ────────────────────────────────────────────────────────────────

async def fetch_asset_data(symbol: str) -> pd.DataFrame:
    """Return OHLCV DataFrame with ema50, ema200, rsi for any non-crypto symbol."""
    symbol = symbol.upper()
    fallback_price = _FALLBACK_PRICES.get(symbol, 1.0)

    if symbol in FOREX_PAIRS:
        from_s, to_s = FOREX_PAIRS[symbol]
        df = await _fetch_fx_intraday(from_s, to_s)
        return df if df is not None else _simulated_df(fallback_price)

    if symbol in PRECIOUS_METALS:
        from_s, to_s = PRECIOUS_METALS[symbol]
        df = await _fetch_fx_intraday(from_s, to_s)
        return df if df is not None else _simulated_df(fallback_price)

    if symbol in COMMODITY_FUNCTIONS:
        df = await _fetch_commodity(COMMODITY_FUNCTIONS[symbol])
        return df if df is not None else _simulated_df(fallback_price)

    return _simulated_df(fallback_price)


async def get_current_price(symbol: str) -> float:
    """Quick price lookup for a non-crypto symbol."""
    df = await fetch_asset_data(symbol)
    if df is not None and not df.empty:
        return float(df["close"].iloc[-1])
    return _FALLBACK_PRICES.get(symbol.upper(), 0.0)
