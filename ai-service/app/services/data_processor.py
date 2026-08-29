import logging
import asyncio
from typing import Optional

import aiohttp
import pandas as pd
import numpy as np

import os
from app.config import get_settings
from app.services import indicators as ind
from app.services.collectors import multi_asset_collector

settings = get_settings()
logger = logging.getLogger("ai-service.data_processor")

BINANCE_BASE = os.environ.get("BINANCE_BASE_URL", "https://api.binance.com")


class DataProcessor:
    """Fetches raw OHLCV data and computes technical indicators."""

    # BUG-002 (2026-08-29 overnight validation): fetch_market_data() used to
    # open a brand-new aiohttp.ClientSession() on every single call (this
    # class is instantiated many times across the codebase and this method
    # gets called per-request), with a hard 10s timeout and no retry. Under
    # back-to-back or concurrent load this plausibly tripped Binance's
    # per-IP rate limiting -- reproduced live both under concurrency (7
    # simultaneous calls all failed) and on isolated sequential calls
    # (BTCUSDT/ETHUSDT each failed right at the 10s timeout, then succeeded
    # normally 15s later). Any non-200/timeout silently became `None`,
    # which routes.py's callers turn into an identical "Insufficient market
    # data" 422 regardless of whether the real cause was a genuine data
    # shortage or a transient network/rate-limit failure -- masking which
    # one actually happened.
    #
    # Fixed two ways, both here so every caller (there are 10+ call sites
    # across this codebase) benefits without each needing its own fix:
    # (1) one shared, lazily-created, class-level ClientSession instead of
    # one per call -- avoids the connection/TLS-handshake churn of opening
    # a fresh session per request, standard aiohttp practice; (2) a small
    # retry-with-backoff loop on timeout or non-200, since the report's own
    # evidence showed a retry ~15s later succeeded in under 3s -- most
    # failures here are transient, not a real "Binance has no data" case.
    _shared_session: Optional[aiohttp.ClientSession] = None
    _session_lock = asyncio.Lock()

    @classmethod
    async def _get_session(cls) -> aiohttp.ClientSession:
        if cls._shared_session is None or cls._shared_session.closed:
            async with cls._session_lock:
                if cls._shared_session is None or cls._shared_session.closed:
                    cls._shared_session = aiohttp.ClientSession()
        return cls._shared_session

    @classmethod
    async def close_session(cls) -> None:
        """Called from the app's shutdown lifecycle so the shared session's
        connections are closed cleanly rather than leaking on process exit."""
        if cls._shared_session is not None and not cls._shared_session.closed:
            await cls._shared_session.close()
        cls._shared_session = None

    async def fetch_market_data(self, asset: str, interval: str = "1h", limit: int = 500) -> Optional[pd.DataFrame]:
        url = f"{BINANCE_BASE}/api/v3/klines"
        params = {"symbol": asset, "interval": interval, "limit": limit}
        max_attempts = 3
        backoff_seconds = (1, 2)  # between attempts 1->2 and 2->3

        for attempt in range(1, max_attempts + 1):
            try:
                session = await self._get_session()
                async with session.get(url, params=params, timeout=aiohttp.ClientTimeout(total=10)) as resp:
                    if resp.status != 200:
                        logger.warning(
                            f"Binance returned {resp.status} for {asset} "
                            f"(attempt {attempt}/{max_attempts})"
                        )
                        if attempt < max_attempts:
                            await asyncio.sleep(backoff_seconds[attempt - 1])
                            continue
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
                df = df[["timestamp", "open", "high", "low", "close", "volume"]].copy()
                return self.compute_indicators(df)

            except asyncio.TimeoutError:
                logger.warning(
                    f"Timeout fetching market data for {asset} "
                    f"(attempt {attempt}/{max_attempts})"
                )
                if attempt < max_attempts:
                    await asyncio.sleep(backoff_seconds[attempt - 1])
                    continue
                # Distinct from the "ran out of history" case checked by
                # callers (len(df) < N) -- this is specifically a network/
                # rate-limit failure surviving retries, logged as such so
                # it isn't misdiagnosed as a genuine data shortage again.
                logger.error(f"Giving up on {asset} after {max_attempts} timeouts — likely rate-limited or network-degraded, not a real data shortage")
                return None
            except Exception as e:
                logger.error(f"Error fetching {asset}: {e}")
                return None

        return None

    def compute_indicators(self, df: pd.DataFrame) -> pd.DataFrame:
        close = df["close"]
        high = df["high"]
        low = df["low"]
        volume = df["volume"]

        # RSI (14)
        df["rsi"] = ind.rsi(close, window=14)

        # MACD
        df["macd"], df["macd_signal"], df["macd_hist"] = ind.macd(close)

        # EMA
        df["ema20"] = ind.ema(close, 20)
        df["ema50"] = ind.ema(close, 50)
        df["ema200"] = ind.ema(close, 200)

        # Bollinger Bands
        df["bb_upper"], df["bb_lower"], df["bb_mid"] = ind.bollinger_bands(close)

        # ATR (volatility)
        df["atr"] = ind.atr(high, low, close)

        # Volume SMA
        df["vol_sma20"] = volume.rolling(window=20).mean()
        df["vol_ratio"] = volume / df["vol_sma20"]

        df.dropna(inplace=True)
        return df

    async def get_candles(self, asset: str, interval: str = "1h", limit: int = 500) -> Optional[pd.DataFrame]:
        """Dispatch to the right collector: Binance for crypto, yfinance for
        commodities/forex (multi_asset_collector.ALL_MULTI_ASSETS)."""
        asset = asset.upper()
        if asset in multi_asset_collector.ALL_MULTI_ASSETS:
            return await multi_asset_collector.fetch_asset_data(asset)
        return await self.fetch_market_data(asset, interval, limit)

    async def get_live_price(self, asset: str) -> Optional[float]:
        """Same dispatch as get_candles, but for a single current price.
        Named distinctly from get_current_price(df) below, which extracts a
        price from an already-fetched candles DataFrame — different signature,
        same name would have silently shadowed one or the other."""
        from app.services.collectors.binance_collector import fetch_current_price
        asset = asset.upper()
        if asset in multi_asset_collector.ALL_MULTI_ASSETS:
            return await multi_asset_collector.get_current_price(asset)
        return await fetch_current_price(asset)

    def build_feature_vector(self, df: pd.DataFrame) -> np.ndarray:
        """Extract last-row features for ML model input."""
        row = df.iloc[-1]
        features = [
            row["rsi"],
            row["macd"],
            row["macd_signal"],
            row["macd_hist"],
            row["ema20"],
            row["ema50"],
            row["ema200"],
            row["close"] / row["ema20"] - 1,   # price vs ema20 deviation
            row["close"] / row["ema50"] - 1,   # price vs ema50 deviation
            row["close"] / row["bb_upper"] - 1,
            row["close"] / row["bb_lower"] - 1,
            row["atr"] / row["close"],         # normalized volatility
            row["vol_ratio"],
        ]
        return np.array(features, dtype=np.float32)

    def get_current_price(self, df: pd.DataFrame) -> float:
        return float(df.iloc[-1]["close"])
