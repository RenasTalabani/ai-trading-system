"""
T-086 (2026-08-31): BUG-001's fix (test_news_analyzer_concurrency.py) made
the per-asset FinBERT passes run concurrently via asyncio.gather, unbounded
-- ~10-15 tracked assets meant up to that many concurrent CPU-bound FinBERT
forward passes on every news-cache refresh. Confirmed live via `railway
metrics` during a real global scan: CPU hit 8.7 vCPU against an 8.0 vCPU
limit (and memory sat at 90%) at the exact moment News/Social/OrderBlock --
all running concurrently across ~13 assets in a scan, none of which
themselves do heavy CPU work except News's FinBERT calls -- were hanging
past their 35-40s timeouts in unified_analyzer.py. Root cause: unbounded
concurrent FinBERT passes (each of which can itself use multiple cores via
PyTorch's intra-op parallelism) oversubscribing the container, starving the
event loop for everything scheduled on it -- not three independent slow
engines, one CPU-starved process.

Fixed with an asyncio.Semaphore(3) around the FinBERT executor call in
_score_asset() -- concurrent enough to stay far faster than the original
fully-sequential version BUG-001 fixed, bounded enough to leave real CPU
headroom. This test proves the cap is real: with more assets needing a
FinBERT pass than the semaphore allows, the number actually running at
once never exceeds 3, however many are queued.
"""
import asyncio
from datetime import datetime, timezone

from app.services.news_analyzer import NewsAnalyzer


class FakeArticle:
    def __init__(self, title, source="Test Source"):
        self.title = title
        self.source = source
        self.published_at = datetime.now(timezone.utc)
        self.summary = ""


class TestFinBERTPerAssetConcurrencyIsBounded:
    async def test_no_more_than_three_finbert_passes_run_at_once_across_many_assets(self, monkeypatch):
        async def _fake_collect_all_news():
            return [FakeArticle("Bitcoin Ethereum Solana XRP Cardano Dogecoin news")]

        monkeypatch.setattr(
            "app.services.news_analyzer.collect_all_news",
            _fake_collect_all_news,
        )
        # 8 assets, every headline matches every one -- all 8 need their own
        # per-asset FinBERT pass (plus the one "global" call).
        eight_assets = {
            f"ASSET{i}": ["bitcoin"] for i in range(8)
        }
        monkeypatch.setattr("app.services.news_analyzer.ASSET_KEYWORDS", eight_assets)

        in_flight  = {"n": 0}
        max_seen   = {"n": 0}
        lock       = asyncio.Lock()

        class ConcurrencyTrackingModel:
            def analyze(self, headlines):
                # Runs inside run_in_executor -- a real OS thread, so a
                # plain (non-async) counter increment/decrement here is
                # racy across threads in principle, but Python's GIL makes
                # a single `+= 1` / `-= 1` on an int effectively atomic
                # enough for this test's purposes, and any lost update would
                # only ever make max_seen *lower* than reality -- never
                # produce a false failure.
                in_flight["n"] += 1
                max_seen["n"] = max(max_seen["n"], in_flight["n"])
                import time
                time.sleep(0.08)
                in_flight["n"] -= 1
                return {
                    "overall_sentiment": "neutral", "score": 0.0, "market_score": 50,
                    "impact": 0, "count": len(headlines), "results": [], "breakdown": {},
                    "detected_events": [],
                }

        analyzer = NewsAnalyzer(ConcurrencyTrackingModel())

        await analyzer.refresh()

        assert max_seen["n"] <= 3, (
            f"expected at most 3 concurrent FinBERT passes, observed {max_seen['n']} at once"
        )
        # Sanity: the cap didn't just serialize everything down to 1 --
        # real concurrency (up to the cap) is still happening.
        assert max_seen["n"] >= 2, (
            f"expected genuine concurrency up to the cap, observed only {max_seen['n']} at once"
        )
