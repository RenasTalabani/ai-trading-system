"""
MultiAssetCollector — OHLCV data for commodities and forex.
Uses yfinance (Yahoo Finance) — completely free, no API key required.
Covers: Gold, Silver, WTI Oil, Brent Oil, EUR/USD, GBP/USD, USD/JPY.
"""
import asyncio
import logging
from concurrent.futures import ThreadPoolExecutor
from typing import Optional

import pandas as pd
import yfinance as yf

from app.services import indicators as ind

logger = logging.getLogger("ai-service.multi_asset_collector")

# Internal symbol → Yahoo Finance ticker
YAHOO_SYMBOLS: dict[str, str] = {
    "XAUUSD": "GC=F",      # Gold futures
    "XAGUSD": "SI=F",      # Silver futures
    "WTI":    "CL=F",      # WTI Crude Oil futures
    "BRENT":  "BZ=F",      # Brent Crude Oil futures
    "EURUSD": "EURUSD=X",  # Euro / US Dollar
    "GBPUSD": "GBPUSD=X",  # British Pound / US Dollar
    "USDJPY": "USDJPY=X",  # US Dollar / Japanese Yen
}

ALL_MULTI_ASSETS: dict[str, str] = {
    "XAUUSD": "commodity",
    "XAGUSD": "commodity",
    "WTI":    "commodity",
    "BRENT":  "commodity",
    "EURUSD": "forex",
    "GBPUSD": "forex",
    "USDJPY": "forex",
}

_executor = ThreadPoolExecutor(max_workers=4)


def _compute_indicators(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    close, high, low, volume = df["close"], df["high"], df["low"], df["volume"]

    df["rsi"] = ind.rsi(close, window=14)
    df["macd"], df["macd_signal"], df["macd_hist"] = ind.macd(close)
    df["ema20"]  = ind.ema(close, 20)
    df["ema50"]  = ind.ema(close, 50)
    df["ema200"] = ind.ema(close, 200)
    df["bb_upper"], df["bb_lower"], df["bb_mid"] = ind.bollinger_bands(close)
    df["atr"] = ind.atr(high, low, close)
    df["vol_sma20"] = volume.rolling(window=20).mean()
    df["vol_ratio"] = volume / df["vol_sma20"].replace(0, 1e-9)
    return df


def _fetch_sync(yahoo_ticker: str, period: str = "60d", interval: str = "1h") -> Optional[pd.DataFrame]:
    """Blocking yfinance call — always run inside _executor."""
    try:
        raw = yf.Ticker(yahoo_ticker).history(period=period, interval=interval, auto_adjust=True)
        if raw is None or raw.empty:
            logger.warning(f"[MultiAsset] Empty response from Yahoo Finance for {yahoo_ticker}")
            return None

        idx = raw.index
        if idx.tz is None:
            idx = idx.tz_localize("UTC")
        else:
            idx = idx.tz_convert("UTC")

        df = pd.DataFrame({
            "open":   raw["Open"].values,
            "high":   raw["High"].values,
            "low":    raw["Low"].values,
            "close":  raw["Close"].values,
            "volume": raw["Volume"].values,
        }, index=idx)
        df.index.name = "time"
        df = df.sort_index()
        # Match data_processor.py's shape (a real "timestamp" column, not just
        # a named index) — callers like the backtester expect this uniformly
        # regardless of whether candles came from Binance or Yahoo Finance.
        df["timestamp"] = df.index
        return _compute_indicators(df)
    except Exception as e:
        logger.warning(f"[MultiAsset] yfinance fetch failed for {yahoo_ticker}: {e}")
        return None


def _price_sync(yahoo_ticker: str) -> float:
    """Blocking price-only lookup — always run inside _executor."""
    try:
        info = yf.Ticker(yahoo_ticker).fast_info
        price = float(info.last_price or 0)
        return price if price > 0 else 0.0
    except Exception as e:
        logger.warning(f"[MultiAsset] Price lookup failed for {yahoo_ticker}: {e}")
        return 0.0


async def fetch_asset_data(symbol: str) -> Optional[pd.DataFrame]:
    """Return OHLCV + indicators DataFrame for any non-crypto symbol."""
    symbol = symbol.upper()
    yahoo_ticker = YAHOO_SYMBOLS.get(symbol)
    if not yahoo_ticker:
        logger.warning(f"[MultiAsset] Unknown symbol: {symbol}")
        return None

    loop = asyncio.get_event_loop()
    df = await loop.run_in_executor(_executor, _fetch_sync, yahoo_ticker)

    if df is not None and not df.empty:
        latest = df["close"].iloc[-1]
        logger.info(f"[MultiAsset] {symbol} ({yahoo_ticker}): {len(df)} bars, close={latest:.4f}")
    return df


async def get_current_price(symbol: str) -> float:
    """Return the latest price for a non-crypto symbol."""
    symbol = symbol.upper()
    yahoo_ticker = YAHOO_SYMBOLS.get(symbol)
    if not yahoo_ticker:
        return 0.0

    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(_executor, _price_sync, yahoo_ticker)
