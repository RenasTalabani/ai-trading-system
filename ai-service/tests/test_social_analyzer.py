"""
Tests for SocialAnalyzer.refresh()'s mock-data visibility (T-033).

Bug context: reddit_collector.py / twitter_collector.py can silently
fall back to fabricated placeholder posts when live collection fails.
Before this fix, SocialAnalyzer.refresh() folded that fake content into
`all_posts` exactly like real posts -- no log line anywhere distinguished
"47 real posts" from "47 fabricated posts", so production sentiment scores
could be entirely synthetic with zero operational visibility. These tests
confirm is_mock survives the telegram/twitter/reddit -> dict normalization
step and that refresh() logs a WARNING naming which platforms and how many
posts were mock, whenever any are present.
"""
from datetime import datetime, timezone
from unittest.mock import AsyncMock

import pytest

from app.models.social_sentiment import SocialSentimentModel
from app.services.social_analyzer import SocialAnalyzer, _to_post_dict
from app.services.collectors.reddit_collector import RedditPost
from app.services.collectors.twitter_collector import Tweet


class _FakeTelegramPost:
    def __init__(self, content):
        self.platform = "telegram"
        self.content = content
        self.author = "channel"
        self.channel = "@test"
        self.likes = 10
        self.shares = 0
        self.replies = 0
        self.published_at = datetime.now(timezone.utc)


class TestToPostDict:
    def test_mock_reddit_post_carries_is_mock_true(self):
        post = RedditPost(content="fake", channel="r/Bitcoin", is_mock=True)
        d = _to_post_dict(post)
        assert d["is_mock"] is True

    def test_real_tweet_defaults_is_mock_false(self):
        tweet = Tweet(content="real")
        d = _to_post_dict(tweet)
        assert d["is_mock"] is False

    def test_telegram_post_without_is_mock_attribute_defaults_false(self):
        d = _to_post_dict(_FakeTelegramPost("real telegram content"))
        assert d["is_mock"] is False


class TestRefreshMockVisibility:
    @pytest.mark.asyncio
    async def test_warns_when_reddit_and_twitter_are_both_mock(self, monkeypatch, caplog):
        analyzer = SocialAnalyzer(SocialSentimentModel())

        # Master-plan decision #4/#7 (locked, 2026-09-03): Twitter/Reddit are
        # feature-flagged off by default in production (see
        # ENABLE_TWITTER_SOURCE/ENABLE_REDDIT_SOURCE in social_analyzer.py) --
        # they were never an agreed v1 source. This test predates that flag
        # and is about a different, still-valid concern (T-033's mock-post
        # visibility across whichever platforms ARE live), so it opts both
        # back on for its own scope only; production's default-off behavior
        # is untouched.
        monkeypatch.setattr("app.services.social_analyzer.ENABLE_TWITTER_SOURCE", True)
        monkeypatch.setattr("app.services.social_analyzer.ENABLE_REDDIT_SOURCE", True)

        monkeypatch.setattr(
            "app.services.social_analyzer.collect_telegram_posts",
            AsyncMock(return_value=[_FakeTelegramPost("Real telegram post about bitcoin")]),
        )
        monkeypatch.setattr(
            "app.services.social_analyzer.collect_tweets",
            AsyncMock(return_value=[Tweet(content="mock tweet", is_mock=True)]),
        )
        monkeypatch.setattr(
            "app.services.social_analyzer.collect_reddit_posts",
            AsyncMock(return_value=[RedditPost(content="mock reddit post", is_mock=True)]),
        )

        with caplog.at_level("WARNING", logger="ai-service.social_analyzer"):
            result = await analyzer.refresh()

        assert result["global"]["total_posts"] == 3
        warnings = [rec.message for rec in caplog.records]
        assert any("2/3 posts are fabricated mock placeholders" in w for w in warnings)
        assert any("reddit" in w and "twitter" in w for w in warnings)

    @pytest.mark.asyncio
    async def test_no_warning_when_all_platforms_are_live(self, monkeypatch, caplog):
        analyzer = SocialAnalyzer(SocialSentimentModel())

        # See the comment in test_warns_when_reddit_and_twitter_are_both_mock
        # above -- this test needs Twitter/Reddit actually invoked to prove
        # "no warning when everything is live", independent of production's
        # default-off gate for those sources.
        monkeypatch.setattr("app.services.social_analyzer.ENABLE_TWITTER_SOURCE", True)
        monkeypatch.setattr("app.services.social_analyzer.ENABLE_REDDIT_SOURCE", True)

        monkeypatch.setattr(
            "app.services.social_analyzer.collect_telegram_posts",
            AsyncMock(return_value=[_FakeTelegramPost("Real telegram post about bitcoin")]),
        )
        monkeypatch.setattr(
            "app.services.social_analyzer.collect_tweets",
            AsyncMock(return_value=[Tweet(content="real tweet about eth")]),
        )
        monkeypatch.setattr(
            "app.services.social_analyzer.collect_reddit_posts",
            AsyncMock(return_value=[RedditPost(content="real reddit post about sol")]),
        )

        with caplog.at_level("WARNING", logger="ai-service.social_analyzer"):
            result = await analyzer.refresh()

        assert result["global"]["total_posts"] == 3
        assert not any(
            "fabricated mock placeholders" in rec.message for rec in caplog.records
        )
