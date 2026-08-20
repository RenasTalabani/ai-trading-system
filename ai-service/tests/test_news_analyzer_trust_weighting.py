"""
Regression tests for T-035 (2026-08-20, PM continuous-improvement pass).

Bug: NewsQualityLayer builds a per-source trust registry (Reuters/Bloomberg
1.00 down to Google News/Unknown 0.40-0.55) and its own class docstring
documents trust as 40% of the quality formula meant to weight fused
sentiment -- but `weighted_sentiment_score()`, the method that actually
applies that weighting, was never called anywhere in the app (confirmed by
grep). Past the binary MIN_QUALITY_SCORE pass/fail cutoff, NewsAnalyzer
averaged every passed article into `global.sentiment`/`global.market_score`
with EQUAL weight regardless of trust -- a low-trust source moved the score
exactly as much as Reuters. This directly affects GlobalAnalyzer's
`_macro_news_score()` (T-034), which reads `global.sentiment`.

These tests drive `NewsAnalyzer.refresh()` with two fake articles of very
different trust (Reuters trust=1.00, Google News trust=0.55) and opposite
sentiment, and confirm the global score reflects the trust-weighted average
(favoring the high-trust source) rather than the naive 50/50 average, while
confirming the no-filtered-articles fallback path is completely unchanged.
"""
from datetime import datetime, timezone
from unittest.mock import AsyncMock

import pytest

from app.models.news_sentiment import NewsSentimentModel
from app.services.news_analyzer import NewsAnalyzer
from app.services.collectors.news_collector import NewsArticle


def _now():
    return datetime.now(timezone.utc)


TRUSTED_TITLE   = "Reuters reports major regulatory clarity for global finance"
UNTRUSTED_TITLE = "Tech roundup covers major economic policy shifts today"


def _fake_articles():
    return [
        NewsArticle(title=TRUSTED_TITLE, url="https://reuters.example/1",
                    source="Reuters", published_at=_now(),
                    summary="A longer summary paragraph describing the story in detail."),
        NewsArticle(title=UNTRUSTED_TITLE, url="https://googlenews.example/1",
                    source="Google News", published_at=_now(),
                    summary="A longer summary paragraph describing the story in detail."),
    ]


def _fake_analyze(headlines):
    """Stand-in for NewsSentimentModel.analyze(): TRUSTED_TITLE is maximally
    positive (compound=1.0), UNTRUSTED_TITLE is maximally negative
    (compound=-1.0) -- an unweighted average is exactly 0.0 (neutral,
    market_score 50), while the trust-weighted average should be positive
    and skew toward the Reuters (trust=1.00) headline."""
    results = []
    for h in headlines:
        compound = 1.0 if h == TRUSTED_TITLE else -1.0
        results.append({
            "text": h[:150], "sentiment": "positive" if compound > 0 else "negative",
            "compound": compound, "confidence": 100.0, "model": "fake",
            "impact_score": 5, "impact_level": "medium", "events": [],
            "related_assets": [], "keywords": [],
        })
    avg = sum(r["compound"] for r in results) / len(results) if results else 0.0
    return {
        "overall_sentiment": "positive" if avg >= 0.05 else "negative" if avg <= -0.05 else "neutral",
        "score": round(avg, 4),
        "market_score": round((avg + 1) / 2 * 100, 1),
        "impact": 5.0,
        "count": len(results),
        "breakdown": {"positive": sum(1 for r in results if r["compound"] > 0),
                      "negative": sum(1 for r in results if r["compound"] < 0),
                      "neutral": 0},
        "detected_events": [],
        "results": results,
    }


class TestGlobalSentimentIsTrustWeighted:
    async def test_high_trust_source_outweighs_low_trust_source(self, monkeypatch):
        monkeypatch.setattr(
            "app.services.news_analyzer.collect_all_news",
            AsyncMock(return_value=_fake_articles()),
        )
        analyzer = NewsAnalyzer(NewsSentimentModel())
        monkeypatch.setattr(analyzer.model, "analyze", _fake_analyze)

        result = await analyzer.refresh()

        # Unweighted average of +1.0/-1.0 is exactly 0.0 (neutral, 50) --
        # the trust-weighted average (Reuters trust=1.00 vs Google News
        # trust=0.55) must be positive and skew toward Reuters instead.
        assert result["global"]["sentiment"] == "positive"
        assert result["global"]["market_score"] == pytest.approx(64.5, abs=0.1)

    async def test_weighted_value_matches_manual_trust_weighted_formula(self, monkeypatch):
        monkeypatch.setattr(
            "app.services.news_analyzer.collect_all_news",
            AsyncMock(return_value=_fake_articles()),
        )
        analyzer = NewsAnalyzer(NewsSentimentModel())
        monkeypatch.setattr(analyzer.model, "analyze", _fake_analyze)

        result = await analyzer.refresh()

        # (1.0*1.00 + (-1.0)*0.55) / (1.00 + 0.55) == 0.2903...
        expected = (1.0 * 1.00 + (-1.0) * 0.55) / (1.00 + 0.55)
        expected_market_score = round((expected + 1) / 2 * 100, 1)
        assert result["global"]["market_score"] == pytest.approx(expected_market_score, abs=0.1)


class TestFallbackPathUnchangedWhenNothingPassesQuality:
    async def test_no_articles_pass_quality_filter_uses_unweighted_analysis_unchanged(self, monkeypatch):
        # A title matching a spam pattern fails quality outright regardless
        # of source trust, so `filtered` is empty and the old (unweighted)
        # behavior must be used exactly as before this fix.
        spam_article = NewsArticle(
            title="100x guaranteed returns - click here to sign up now",
            url="https://spam.example/1", source="Reuters", published_at=_now(),
            summary="",
        )
        monkeypatch.setattr(
            "app.services.news_analyzer.collect_all_news",
            AsyncMock(return_value=[spam_article]),
        )
        analyzer = NewsAnalyzer(NewsSentimentModel())

        def fallback_analyze(headlines):
            return {
                "overall_sentiment": "neutral", "score": 0.0, "market_score": 50.0,
                "impact": 0.0, "count": len(headlines),
                "breakdown": {"positive": 0, "negative": 0, "neutral": len(headlines)},
                "detected_events": [], "results": [],
            }
        monkeypatch.setattr(analyzer.model, "analyze", fallback_analyze)

        result = await analyzer.refresh()

        assert result["global"]["sentiment"] == "neutral"
        assert result["global"]["market_score"] == 50.0
