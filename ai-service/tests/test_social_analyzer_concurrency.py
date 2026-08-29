"""
Regression test for BUG-001 (2026-08-29 overnight validation report),
SocialAnalyzer's half of the fix.

Same missing-lock issue flagged for NewsAnalyzer.refresh(): N concurrent
callers hitting a cold/expired social cache each independently kicked off
their own Telegram/Twitter/Reddit collection instead of sharing one
in-flight refresh. Fixed with the identical asyncio.Lock +
double-checked-locking pattern.
"""
import asyncio

from app.services.social_analyzer import SocialAnalyzer


class FakePost:
    def __init__(self, content):
        self.content = content
        self.platform = "telegram"
        self.author = "tester"
        self.channel = "test"
        self.likes = 0
        self.shares = 0
        self.replies = 0
        self.authorFollowers = 0
        self.published_at = None
        self.is_mock = False


class FakeSentimentModel:
    def analyze(self, posts):
        return {
            "overall": "neutral", "score": 0.0, "market_score": 50,
            "hype_level": 0.0, "spam_ratio": 0.0,
            "manipulation_detected": False, "pump_detected": False,
            "influencer_count": 0, "breakdown": {},
        }

    def analyze_for_asset(self, posts, asset):
        result = self.analyze(posts)
        result["asset"] = asset
        result["relevant_posts"] = len(posts)
        return result

    def analyze_single(self, post):
        return {"sentiment": "neutral", "weight": 1.0, "is_hype": False}


class TestConcurrentRefreshCallsShareOneInFlightRefresh:
    async def test_five_concurrent_refresh_calls_only_collect_once_per_platform(self, monkeypatch):
        call_counts = {"telegram": 0, "twitter": 0, "reddit": 0}

        async def _fake_telegram():
            call_counts["telegram"] += 1
            await asyncio.sleep(0.05)
            return [FakePost("bitcoin to the moon")]

        async def _fake_twitter():
            call_counts["twitter"] += 1
            await asyncio.sleep(0.05)
            return []

        async def _fake_reddit():
            call_counts["reddit"] += 1
            await asyncio.sleep(0.05)
            return []

        monkeypatch.setattr("app.services.social_analyzer.collect_telegram_posts", _fake_telegram)
        monkeypatch.setattr("app.services.social_analyzer.collect_tweets", _fake_twitter)
        monkeypatch.setattr("app.services.social_analyzer.collect_reddit_posts", _fake_reddit)

        analyzer = SocialAnalyzer(FakeSentimentModel())

        results = await asyncio.gather(*(analyzer.refresh() for _ in range(5)))

        assert call_counts == {"telegram": 1, "twitter": 1, "reddit": 1}
        assert all(r["global"]["total_posts"] == 1 for r in results)

    async def test_a_second_call_after_the_first_completes_uses_the_cache_not_a_new_refresh(self, monkeypatch):
        call_count = {"n": 0}

        async def _fake_telegram():
            call_count["n"] += 1
            return [FakePost("bitcoin to the moon")]

        async def _fake_empty():
            return []

        monkeypatch.setattr("app.services.social_analyzer.collect_telegram_posts", _fake_telegram)
        monkeypatch.setattr("app.services.social_analyzer.collect_tweets", _fake_empty)
        monkeypatch.setattr("app.services.social_analyzer.collect_reddit_posts", _fake_empty)

        analyzer = SocialAnalyzer(FakeSentimentModel())

        await analyzer.refresh()
        await analyzer.refresh()

        assert call_count["n"] == 1
