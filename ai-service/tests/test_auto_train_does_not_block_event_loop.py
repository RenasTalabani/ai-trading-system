"""
T-081 (2026-08-31): auto_train_pipeline() called transformer_model.train()
and lstm_model.train() -- real, synchronous, CPU-bound PyTorch training
loops -- directly, un-awaited. Since asyncio's event loop is
single-threaded, this blocked EVERY other coroutine (including a trivial
/health handler) for the entire training duration. Confirmed live: a
fresh production container with no cached models made every request time
out for 90+ seconds on every single cold start, reproducibly -- not a
one-time cost, since auto_train_pipeline() always runs this exact path
when no saved models exist yet.

Fix: run the blocking .train() calls in the default executor thread pool
(same pattern T-076 already used for FinBERT's model load) so the event
loop stays free for the whole training duration, in both main.py's
auto_train_pipeline() and its source, trainer.py's ModelTrainer.

These tests prove the event loop stays responsive to a concurrent
coroutine while a slow, synchronous "training" call is in flight --
using a fake blocking call standing in for the real PyTorch/sklearn
training, so the test runs in milliseconds instead of minutes.
"""
import asyncio
import time

import pandas as pd
import pytest

from app.services.trainer import ModelTrainer


class _SlowSyncMarketModel:
    """Stands in for MarketModel -- .train() is a real blocking sleep,
    same shape as the real synchronous sklearn/PyTorch training calls."""
    is_trained = False

    def train(self, df):
        time.sleep(0.3)  # simulates real CPU-bound training work
        return {"accuracy": 0.99}


def _fake_df(n=600):
    return pd.DataFrame({"timestamp": range(n), "close": [100.0] * n})


class _FakeDataProcessor:
    async def get_candles(self, asset, interval, limit):
        return _fake_df()


class TestAutoTrainDoesNotBlockEventLoop:
    async def test_train_multi_asset_does_not_block_a_concurrent_coroutine(self):
        trainer = ModelTrainer(market_model=_SlowSyncMarketModel())
        trainer.processor = _FakeDataProcessor()

        ticks = []

        async def ticker():
            # If train_multi_asset() were blocking the event loop, this
            # coroutine -- running concurrently via asyncio.gather -- would
            # never get a chance to tick during that ~0.3s window.
            for _ in range(6):
                await asyncio.sleep(0.05)
                ticks.append(time.monotonic())

        started = time.monotonic()
        await asyncio.gather(
            trainer.train_multi_asset(["BTCUSDT", "ETHUSDT"], interval="1h"),
            ticker(),
        )
        elapsed = time.monotonic() - started

        # The ticker must have actually ticked *during* training, not all
        # bunched up after it finished -- proves the loop wasn't blocked.
        assert len(ticks) == 6
        first_tick_offset = ticks[0] - started
        assert first_tick_offset < 0.2, (
            f"first tick came {first_tick_offset:.3f}s after start -- "
            f"the event loop was blocked during training"
        )
        # Sanity: the blocking work actually happened (didn't get skipped)
        assert elapsed >= 0.3

    async def test_train_single_asset_does_not_block_a_concurrent_coroutine(self):
        trainer = ModelTrainer(market_model=_SlowSyncMarketModel())
        trainer.processor = _FakeDataProcessor()

        ticked = asyncio.Event()

        async def ticker():
            await asyncio.sleep(0.05)
            ticked.set()

        async def training_task():
            await trainer.train("BTCUSDT", interval="1h")

        started = time.monotonic()
        await asyncio.gather(training_task(), ticker())
        # If blocked, ticker() couldn't have set the event until after the
        # full 0.3s training completed -- confirm it set early instead.
        elapsed_to_here = time.monotonic() - started
        assert ticked.is_set()
        assert elapsed_to_here < 0.35  # both ran concurrently, not serially-blocked
