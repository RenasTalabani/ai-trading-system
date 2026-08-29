"""
Regression test for BUG-001 (2026-08-29 overnight validation report).

Reproduced live: a BTCUSDT /predict request hung for ~4.5-5 minutes. Root
cause traced to NewsAnalyzer.refresh(): no lock around the cache-refresh
path, so N concurrent callers hitting a cold/expired cache each
independently kicked off their own full collect_all_news() + FinBERT pass
-- N times the network fetch and N times the (sequential, one-asset-at-a-
time) sentiment work, compounding the underlying per-asset-loop cost into
a multi-minute wait under any concurrent load (e.g. several screens
polling the AI at once, or the Guide's own periodic scan overlapping a
user's manual /predict call).

Fixed with an asyncio.Lock + double-checked-locking pattern (recheck the
cache after acquiring the lock, in case another caller just finished) so
concurrent callers share ONE in-flight refresh instead of each starting
their own; and by running the per-asset FinBERT passes concurrently via
asyncio.gather instead of sequentially in a for-loop.

This test proves the concurrency fix directly: fire several refresh()
calls concurrently against a cold cache and assert the expensive
collection step was invoked exactly once, not once per caller.
"""
import asyncio
import time
from datetime import datetime, timezone

from app.services.news_analyzer import NewsAnalyzer


class FakeArticle:
    def __init__(self, title, source="Test Source"):
        self.title = title
        self.source = source
        self.published_at = datetime.now(timezone.utc)
        self.summary = ""


class FakeSentimentModel:
    """Minimal stand-in -- analyze() is what the per-asset loop calls."""
    def analyze(self, headlines):
        return {
            "overall_sentiment": "neutral", "score": 0.0, "market_score": 50,
            "impact": 0, "count": len(headlines), "results": [], "breakdown": {},
            "detected_events": [],
        }


class TestConcurrentRefreshCallsShareOneInFlightRefresh:
    async def test_five_concurrent_refresh_calls_only_collect_news_once(self, monkeypatch):
        call_count = {"n": 0}

        async def _fake_collect_all_news():
            call_count["n"] += 1
            # Simulate real network+FinBERT latency so the concurrent calls
            # genuinely overlap in time, not just get lucky with ordering.
            await asyncio.sleep(0.05)
            return [FakeArticle("Bitcoin rallies on ETF news")]

        monkeypatch.setattr(
            "app.services.news_analyzer.collect_all_news",
            _fake_collect_all_news,
        )

        analyzer = NewsAnalyzer(FakeSentimentModel())

        # 5 callers all hit the cold cache at once -- before the fix, this
        # would call collect_all_news() 5 times (once per caller); after
        # the fix, exactly once, with the other 4 sharing that one result.
        results = await asyncio.gather(*(analyzer.refresh() for _ in range(5)))

        assert call_count["n"] == 1
        # All 5 callers got the same (correct) result, not an error or a
        # partial/empty one from racing the lock.
        assert all(r["global"]["total_articles"] == 1 for r in results)

    async def test_a_second_call_after_the_first_completes_uses_the_cache_not_a_new_refresh(self, monkeypatch):
        call_count = {"n": 0}

        async def _fake_collect_all_news():
            call_count["n"] += 1
            return [FakeArticle("Bitcoin rallies on ETF news")]

        monkeypatch.setattr(
            "app.services.news_analyzer.collect_all_news",
            _fake_collect_all_news,
        )

        analyzer = NewsAnalyzer(FakeSentimentModel())

        await analyzer.refresh()
        await analyzer.refresh()

        assert call_count["n"] == 1  # second call hit the warm cache, no new collection


class TestPerAssetScoringRunsConcurrentlyNotSequentially:
    async def test_per_asset_finbert_passes_overlap_in_time(self, monkeypatch):
        """Proves the per-asset loop no longer awaits one asset at a time --
        if N per-asset passes each take `delay` seconds and run truly
        concurrently, wall-clock time for all of them should be close to
        one `delay`, not N * `delay` (which is what the old sequential
        for-loop would produce)."""

        async def _fake_collect_all_news():
            return [
                FakeArticle("Bitcoin news headline"),
                FakeArticle("Ethereum news headline"),
                FakeArticle("Solana news headline"),
            ]

        monkeypatch.setattr(
            "app.services.news_analyzer.collect_all_news",
            _fake_collect_all_news,
        )
        # Every headline matches every tracked asset's keyword list in this
        # fake, so every asset in ASSET_KEYWORDS takes the "has relevant
        # articles" branch and triggers its own run_in_executor call.
        monkeypatch.setattr(
            "app.services.news_analyzer.ASSET_KEYWORDS",
            {"BTC": ["bitcoin", "ethereum", "solana"],
             "ETH": ["bitcoin", "ethereum", "solana"],
             "SOL": ["bitcoin", "ethereum", "solana"]},
        )

        class SlowSentimentModel:
            def analyze(self, headlines):
                time.sleep(0.15)  # runs inside run_in_executor -- a real thread sleep
                return {
                    "overall_sentiment": "neutral", "score": 0.0, "market_score": 50,
                    "impact": 0, "count": len(headlines), "results": [], "breakdown": {},
                    "detected_events": [],
                }

        analyzer = NewsAnalyzer(SlowSentimentModel())

        started = time.monotonic()
        await analyzer.refresh()
        elapsed = time.monotonic() - started

        # 3 assets * 0.15s each: sequential would take >= 0.45s (plus the
        # one "global" analyze() call, so >= 0.60s); concurrent execution
        # across a thread pool should land close to ~0.15-0.30s total.
        # Generous upper bound to avoid CI flakiness while still clearly
        # distinguishing "concurrent" from "sequential".
        assert elapsed < 0.45, f"expected concurrent per-asset scoring, took {elapsed:.2f}s (sequential would be >= 0.45s)"
