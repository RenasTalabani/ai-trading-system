"""
Tests for the Twitter collector's mock-fallback behavior (T-033) -- the
same bug class fixed in reddit_collector.py, and one instance already fixed
for telegram_collector.py in an earlier pass: collect_tweets() silently
returned hardcoded mock tweets whenever the live fetch produced nothing
(either no Bearer Token configured, or a token that's configured but every
query still comes back empty), with no way to tell fake content apart from
real tweets once it reached social_analyzer.py's sentiment scoring.
"""
from unittest.mock import AsyncMock

import pytest

from app.services.collectors.twitter_collector import (
    Tweet,
    SEARCH_QUERIES,
    _get_mock_tweets,
    collect_tweets,
)


class TestMockTweetsAreTagged:
    def test_all_mock_tweets_have_is_mock_true(self):
        tweets = _get_mock_tweets()
        assert len(tweets) > 0
        assert all(t.is_mock is True for t in tweets)

    def test_real_tweet_defaults_to_is_mock_false(self):
        tweet = Tweet(content="real tweet")
        assert tweet.is_mock is False


class TestCollectTweetsFallback:
    @pytest.mark.asyncio
    async def test_no_token_configured_falls_back_to_mock(self, monkeypatch, caplog):
        fake_settings = type("S", (), {"twitter_bearer_token": ""})()
        monkeypatch.setattr(
            "app.services.collectors.twitter_collector.settings", fake_settings
        )
        with caplog.at_level("WARNING", logger="ai-service.twitter_collector"):
            tweets = await collect_tweets()
        assert len(tweets) > 0
        assert all(t.is_mock for t in tweets)
        assert any("No Bearer Token" in rec.message for rec in caplog.records)

    @pytest.mark.asyncio
    async def test_token_configured_but_every_query_empty_falls_back_to_mock(
        self, monkeypatch, caplog
    ):
        fake_settings = type("S", (), {"twitter_bearer_token": "real-token-value"})()
        monkeypatch.setattr(
            "app.services.collectors.twitter_collector.settings", fake_settings
        )
        monkeypatch.setattr(
            "app.services.collectors.twitter_collector._search_tweets",
            AsyncMock(return_value=[]),
        )
        with caplog.at_level("WARNING", logger="ai-service.twitter_collector"):
            tweets = await collect_tweets()
        assert len(tweets) > 0
        assert all(t.is_mock for t in tweets)
        assert any(
            "Bearer Token configured but 0 tweets" in rec.message
            for rec in caplog.records
        )

    @pytest.mark.asyncio
    async def test_real_tweets_returned_as_is_and_not_flagged_mock(self, monkeypatch, caplog):
        fake_settings = type("S", (), {"twitter_bearer_token": "real-token-value"})()
        monkeypatch.setattr(
            "app.services.collectors.twitter_collector.settings", fake_settings
        )
        real_tweet = Tweet(content="Real tweet about BTC")

        async def fake_search(session, query, bearer_token, max_results=10):
            return [real_tweet] if query == SEARCH_QUERIES[0] else []

        monkeypatch.setattr(
            "app.services.collectors.twitter_collector._search_tweets", fake_search
        )
        with caplog.at_level("WARNING", logger="ai-service.twitter_collector"):
            tweets = await collect_tweets()

        assert len(tweets) == 1
        assert tweets[0].is_mock is False
        assert not any(
            "falling back to mock" in rec.message for rec in caplog.records
        )
