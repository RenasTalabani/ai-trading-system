"""
Tests for the Reddit collector's mock-fallback behavior (T-033).

Bug context: collect_reddit_posts() silently returned hardcoded mock posts
whenever every subreddit fetch failed or came back empty -- with no way for
a caller (or an operator reading logs) to tell fabricated content apart from
real Reddit chatter. That fake content then flowed straight into production
sentiment scoring via social_analyzer.py. These tests pin down: (1) mock
posts are now tagged is_mock=True, (2) real posts are is_mock=False, and
(3) a WARNING is logged specifically when the fallback fires due to a failed
live fetch (distinct from silent success).
"""
from unittest.mock import AsyncMock

import pytest

from app.services.collectors.reddit_collector import (
    RedditPost,
    SUBREDDITS,
    _get_mock_posts,
    collect_reddit_posts,
)


class TestMockPostsAreTagged:
    def test_all_mock_posts_have_is_mock_true(self):
        posts = _get_mock_posts()
        assert len(posts) > 0
        assert all(p.is_mock is True for p in posts)

    def test_real_post_defaults_to_is_mock_false(self):
        post = RedditPost(content="real content", channel="r/Bitcoin")
        assert post.is_mock is False


class TestCollectRedditPostsFallback:
    @pytest.mark.asyncio
    async def test_falls_back_to_mock_when_every_subreddit_fails(self, monkeypatch):
        monkeypatch.setattr(
            "app.services.collectors.reddit_collector._fetch_subreddit",
            AsyncMock(return_value=[]),
        )
        posts = await collect_reddit_posts()
        assert len(posts) > 0
        assert all(p.is_mock for p in posts)

    @pytest.mark.asyncio
    async def test_logs_warning_when_falling_back_to_mock(self, monkeypatch, caplog):
        monkeypatch.setattr(
            "app.services.collectors.reddit_collector._fetch_subreddit",
            AsyncMock(return_value=[]),
        )
        with caplog.at_level("WARNING", logger="ai-service.reddit_collector"):
            await collect_reddit_posts()
        assert any("mock placeholder" in rec.message for rec in caplog.records)
        assert any("NOT live" in rec.message for rec in caplog.records)

    @pytest.mark.asyncio
    async def test_real_posts_returned_as_is_and_not_flagged_mock(self, monkeypatch, caplog):
        real_post = RedditPost(content="Real market commentary", channel="r/Bitcoin")

        async def fake_fetch(session, subreddit, sort="hot", limit=10):
            return [real_post] if subreddit == SUBREDDITS[0] else []

        monkeypatch.setattr(
            "app.services.collectors.reddit_collector._fetch_subreddit",
            fake_fetch,
        )
        with caplog.at_level("WARNING", logger="ai-service.reddit_collector"):
            posts = await collect_reddit_posts()

        assert len(posts) == 1
        assert posts[0].is_mock is False
        assert not any("mock placeholder" in rec.message for rec in caplog.records)
