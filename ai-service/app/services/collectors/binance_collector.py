import logging
import asyncio
from typing import Optional, List
import aiohttp
import pandas as pd

from app.config import get_settings

settings = get_settings()
logger = logging.getLogger("ai-service.binance_collector")

import os
BINANCE_BASE = os.environ.get("BINANCE_BASE_URL", "https://api.binance.com")
BINANCE_WS = "wss://stream.binance.com:9443/stream"

TRACKED_ASSETS = [
    "BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "XRPUSDT",
    "ADAUSDT", "DOGEUSDT", "AVAXUSDT", "LINKUSDT", "MATICUSDT",
]


async def fetch_klines(
    asset: str, interval: str = "1h", limit: int = 500
) -> Optional[pd.DataFrame]:
    url = f"{BINANCE_BASE}/api/v3/klines"
    params = {"symbol": asset, "interval": interval, "limit": limit}

    async with aiohttp.ClientSession() as session:
        async with session.get(url, params=params, timeout=aiohttp.ClientTimeout(total=10)) as resp:
            if resp.status != 200:
                logger.warning(f"Binance klines {resp.status} for {asset}")
                return None
            raw = await resp.json()

    df = pd.DataFrame(raw, columns=[
        "open_time", "open", "high", "low", "close", "volume",
        "close_time", "quote_volume", "trades",
        "taker_buy_base", "taker_buy_quote", "ignore",
    ])
    df[["open", "high", "low", "close", "volume"]] = df[
        ["open", "high", "low", "close", "volume"]
    ].astype(float)
    df["timestamp"] = pd.to_datetime(df["open_time"], unit="ms")
    return df[["timestamp", "open", "high", "low", "close", "volume"]].copy()


async def fetch_current_price(asset: str) -> Optional[float]:
    url = f"{BINANCE_BASE}/api/v3/ticker/price"
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(url, params={"symbol": asset}, timeout=aiohttp.ClientTimeout(total=5)) as resp:
                data = await resp.json()
                return float(data["price"])
    except Exception as e:
        logger.error(f"Price fetch failed for {asset}: {e}")
        return None


async def fetch_all_prices() -> dict:
    prices = {}
    tasks = [fetch_current_price(a) for a in TRACKED_ASSETS]
    results = await asyncio.gather(*tasks, return_exceptions=True)
    for asset, price in zip(TRACKED_ASSETS, results):
        if isinstance(price, float):
            prices[asset] = price
    return prices
