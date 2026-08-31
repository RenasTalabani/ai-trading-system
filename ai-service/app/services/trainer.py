import asyncio
import logging
from typing import Optional

import pandas as pd

from app.config import get_settings
from app.services.data_processor import DataProcessor
from app.models.market_model import MarketModel

settings = get_settings()
logger = logging.getLogger("ai-service.trainer")

MIN_CANDLES_FOR_TRAINING = 300


class ModelTrainer:
    """
    Fetches historical data from Binance and trains/retrains the MarketModel.
    Called on demand (admin API) or scheduled (Phase 2 cron).
    """

    def __init__(self, market_model: MarketModel):
        self.market_model = market_model
        self.processor = DataProcessor()

    async def fetch_training_data(
        self, asset: str, interval: str = "1h", limit: int = 1000
    ) -> Optional[pd.DataFrame]:
        try:
            return await self.processor.get_candles(asset, interval, limit)
        except Exception as e:
            logger.error(f"Training data fetch failed for {asset}: {e}")
            return None

    async def train(self, asset: str, interval: str = "1h") -> dict:
        logger.info(f"Starting model training on {asset}/{interval}...")

        df = await self.fetch_training_data(asset, interval, limit=1000)
        if df is None or len(df) < MIN_CANDLES_FOR_TRAINING:
            msg = f"Insufficient data: need {MIN_CANDLES_FOR_TRAINING} candles, got {len(df) if df is not None else 0}"
            logger.error(msg)
            return {"success": False, "message": msg}

        logger.info(f"Training on {len(df)} candles for {asset}/{interval}")
        # T-081: market_model.train() is a synchronous, CPU-bound sklearn
        # call -- run it off the event loop so it can never block other
        # requests (same fix as main.py's auto_train_pipeline(), applied
        # at the source so every caller of this method benefits).
        loop = asyncio.get_event_loop()
        metrics = await loop.run_in_executor(None, lambda: self.market_model.train(df))

        return {
            "success": True,
            "asset": asset,
            "interval": interval,
            "candles_used": len(df),
            "accuracy": metrics.get("accuracy"),
            "model": "RandomForest",
        }

    async def train_multi_asset(self, assets: list, interval: str = "1h") -> dict:
        """Train on multiple assets by concatenating their data."""
        all_frames = []
        for asset in assets:
            df = await self.fetch_training_data(asset, interval, limit=500)
            if df is not None and len(df) >= 100:
                all_frames.append(df)
                logger.info(f"  Loaded {len(df)} candles for {asset}")

        if not all_frames:
            return {"success": False, "message": "No training data available"}

        combined = pd.concat(all_frames, ignore_index=True).sort_values("timestamp").reset_index(drop=True)
        combined.dropna(inplace=True)
        logger.info(f"Combined training set: {len(combined)} candles from {len(all_frames)} assets")

        # T-081: same fix as train() above -- keep this synchronous,
        # CPU-bound call off the event loop.
        loop = asyncio.get_event_loop()
        metrics = await loop.run_in_executor(None, lambda: self.market_model.train(combined))
        return {
            "success": True,
            "assets": assets,
            "interval": interval,
            "total_candles": len(combined),
            "accuracy": metrics.get("accuracy"),
            "model": "RandomForest",
        }
