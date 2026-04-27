import logging
import asyncio
from typing import Optional

import aiohttp
import pandas as pd
import numpy as np
import ta

import os
from app.config import get_settings

settings = get_settings()
logger = logging.getLogger("ai-service.data_processor")

BINANCE_BASE = os.environ.get("BINANCE_BASE_URL", "https://api.binance.com")


class DataProcessor:
    """Fetches raw OHLCV data and computes technical indicators."""

    async def fetch_market_data(self, asset: str, interval: str = "1h", limit: int = 500) -> Optional[pd.DataFrame]:
        url = f"{BINANCE_BASE}/api/v3/klines"
        params = {"symbol": asset, "interval": interval, "limit": limit}

        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(url, params=params, timeout=aiohttp.ClientTimeout(total=10)) as resp:
                    if resp.status != 200:
                        logger.warning(f"Binance returned {resp.status} for {asset}")
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
            logger.error(f"Timeout fetching market data for {asset}")
            return None
        except Exception as e:
            logger.error(f"Error fetching {asset}: {e}")
            return None

    def compute_indicators(self, df: pd.DataFrame) -> pd.DataFrame:
        close = df["close"]
        high = df["high"]
        low = df["low"]
        volume = df["volume"]

        # RSI (14)
        df["rsi"] = ta.momentum.RSIIndicator(close=close, window=14).rsi()

        # MACD
        macd_obj = ta.trend.MACD(close=close)
        df["macd"] = macd_obj.macd()
        df["macd_signal"] = macd_obj.macd_signal()
        df["macd_hist"] = macd_obj.macd_diff()

        # EMA
        df["ema20"] = ta.trend.EMAIndicator(close=close, window=20).ema_indicator()
        df["ema50"] = ta.trend.EMAIndicator(close=close, window=50).ema_indicator()
        df["ema200"] = ta.trend.EMAIndicator(close=close, window=200).ema_indicator()

        # Bollinger Bands
        bb = ta.volatility.BollingerBands(close=close)
        df["bb_upper"] = bb.bollinger_hband()
        df["bb_lower"] = bb.bollinger_lband()
        df["bb_mid"] = bb.bollinger_mavg()

        # ATR (volatility)
        df["atr"] = ta.volatility.AverageTrueRange(high=high, low=low, close=close).average_true_range()

        # Volume SMA
        df["vol_sma20"] = volume.rolling(window=20).mean()
        df["vol_ratio"] = volume / df["vol_sma20"]

        df.dropna(inplace=True)
        return df

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
