"""
Tests for NewsQualityLayer (T-051, overnight continuous-improvement pass,
2026-08-25/26). Zero prior direct test coverage existed for this module
(test_news_analyzer_trust_weighting.py covers a different bug, T-035, in
the caller NewsAnalyzer, not this class directly).

FIXED (AI reliability -- feeds the news sentiment pipeline that reaches the
AI service's global/macro signal inputs): evaluate()'s quality formula
computes a `clickbait_penalty = 0.10 if click else 0.0` -- this variable
already IS the intended 10%-weight deduction described in the class
docstring ("Spam/clickbait penalty (10%)"), matching the other three
components which are each used directly (`trust * 0.40`, `cq * 0.30`,
`rec * 0.20`). But the final formula multiplied it by another 0.10
(`- clickbait_penalty * 0.10`), diluting a detected clickbait title's
actual effect on the score from 0.10 to 0.01 -- ten times weaker than
every other component's per-unit weight, and ten times weaker than the
module's own documented intent. Proven directly: a clean vs. clickbait
title from the same trusted source differed by only 0.01 quality points
before the fix (should differ by ~0.10), and a concrete borderline
article (low-trust source, clickbait title, stale, mediocre content) that
should score 0.285 and be REJECTED by MIN_QUALITY_SCORE (0.30) instead
scored 0.375 and was WRONGLY ACCEPTED into the pipeline under the buggy
formula.

Fix: removed the redundant `* 0.10` -- clickbait_penalty is subtracted
directly, exactly like every other weighted component.
"""
import sys
import pytest
from datetime import datetime, timezone, timedelta

sys.path.insert(0, "/home/claude/work/t045_pull/ai-service")

from app.services.news_quality_layer import (
    NewsQualityLayer,
    QualityReport,
    MIN_QUALITY_SCORE,
    MAX_AGE_HOURS,
    DEFAULT_TRUST,
)


def _now():
    return datetime.now(timezone.utc)


@pytest.fixture
def q():
    return NewsQualityLayer()


class TestClickbaitPenaltyRegressionGuard:
    """Direct regression guard for the T-051 formula bug."""

    def test_clickbait_penalty_reduces_quality_by_approximately_ten_points(self, q):
        now = _now()
        clean = q.evaluate(
            title="Fed signals rate pause amid inflation data review process today",
            source="Reuters", published_at=now,
            summary="body text here padding padding",
        )
        clickbait = q.evaluate(
            title="You won't believe what the Fed just did to rates",
            source="Reuters", published_at=now,
            summary="body text here padding padding",
        )
        diff = round(clean.quality_score - clickbait.quality_score, 3)
        # The intended penalty is a full 0.10 (10% weight); the pre-fix bug
        # diluted this to 0.01. Assert it's close to the intended value,
        # not the buggy one.
        assert 0.08 <= diff <= 0.12, f"clickbait penalty was {diff}, expected ~0.10 (bug diluted it to ~0.01)"

    def test_borderline_clickbait_article_is_correctly_rejected(self, q):
        """The exact pass/fail-flip case: under the bug this article scored
        0.375 (passed); with the correct penalty it scores 0.285 (rejected)."""
        old_ish = _now() - timedelta(hours=30)
        title = "YOU WON'T BELIEVE THIS!!!"
        report = q.evaluate(title=title, source="Unknown Source", published_at=old_ish, summary="")
        assert report.quality_score == pytest.approx(0.285, abs=0.001)
        assert report.passed is False

    def test_non_clickbait_title_gets_no_penalty(self, q):
        now = _now()
        report = q.evaluate(
            title="Fed signals rate pause amid inflation data review process today",
            source="Reuters", published_at=now, summary="body",
        )
        # no clickbait pattern present -> no deduction at all beyond trust/cq/rec
        trust = q.get_trust_score("Reuters")
        cq, _ = q.content_quality_score(
            "Fed signals rate pause amid inflation data review process today", "body"
        )
        rec = q.recency_score(now)
        expected = round(max(0.0, min(1.0, trust * 0.40 + cq * 0.30 + rec * 0.20)), 3)
        assert report.quality_score == expected


class TestGetTrustScore:
    def test_known_source_exact_match(self, q):
        assert q.get_trust_score("Reuters") == 1.00

    def test_known_source_substring_match(self, q):
        assert q.get_trust_score("Reuters World News") == 1.00

    def test_unknown_source_falls_back_to_default_trust(self, q):
        assert q.get_trust_score("SomeRandomBlogNoOneHeardOf") == DEFAULT_TRUST

    def test_literal_unknown_source_uses_unknown_entry(self, q):
        assert q.get_trust_score("Unknown") == 0.40


class TestIsSpam:
    def test_detects_spam_pattern_case_insensitively(self, q):
        spam, reason = q.is_spam("100X GUARANTEED returns this week")
        assert spam is True
        assert "Spam pattern" in reason

    def test_clean_text_is_not_spam(self, q):
        spam, reason = q.is_spam("Fed holds rates steady in policy meeting")
        assert spam is False
        assert reason == ""


class TestIsClickbait:
    def test_detects_clickbait_pattern(self, q):
        click, reason = q.is_clickbait("The shocking truth about crypto regulation")
        assert click is True
        assert "Clickbait pattern" in reason

    def test_clean_title_is_not_clickbait(self, q):
        click, reason = q.is_clickbait("SEC issues new crypto custody guidance")
        assert click is False


class TestRecencyScore:
    def test_fresh_article_scores_highest(self, q):
        assert q.recency_score(_now()) == 1.00

    def test_old_article_within_window_scores_low(self, q):
        assert q.recency_score(_now() - timedelta(hours=30)) == 0.30

    def test_naive_datetime_treated_as_utc(self, q):
        naive_now = datetime.now().replace(tzinfo=None)
        # should not raise, and should score as roughly "fresh"
        score = q.recency_score(naive_now)
        assert 0.0 <= score <= 1.00


class TestContentQualityScore:
    def test_perfect_title_and_summary_scores_full_marks(self, q):
        cq, issues = q.content_quality_score(
            "Federal Reserve holds interest rates steady amid inflation concerns",
            "A longer summary body providing additional context for readers.",
        )
        assert cq == 1.0
        assert issues == []

    def test_too_short_title_penalized(self, q):
        cq, issues = q.content_quality_score("BTC up", "some summary")
        assert cq < 1.0
        assert "Title too short" in issues

    def test_all_caps_title_penalized(self, q):
        cq, issues = q.content_quality_score("BITCOIN SURGES TO NEW HIGHS TODAY IN TRADING", "summary")
        assert "All caps title (low quality indicator)" in issues

    def test_score_never_goes_negative(self, q):
        # stack every possible penalty
        cq, issues = q.content_quality_score("BAD!!!!", "")
        assert cq >= 0.0


class TestEvaluateSpamAndAgeRejection:
    def test_spam_article_rejected_with_zero_scores(self, q):
        report = q.evaluate(
            title="Get rich quick with this secret strategy",
            source="Reuters", published_at=_now(), summary="",
        )
        assert report.passed is False
        assert report.quality_score == 0.0
        assert report.trust_score == 0.0

    def test_too_old_article_rejected(self, q):
        report = q.evaluate(
            title="A perfectly normal news headline about markets today",
            source="Reuters",
            published_at=_now() - timedelta(hours=MAX_AGE_HOURS + 1),
            summary="normal summary",
        )
        assert report.passed is False
        assert report.quality_score == 0.0

    def test_article_just_under_max_age_boundary_not_rejected_by_age_check(self, q):
        # age_hours > MAX_AGE_HOURS is the rejection condition -- an article
        # a few seconds under the boundary should NOT be rejected by the age
        # check itself (evaluate()'s internal now() runs slightly later than
        # this timestamp, so using exactly MAX_AGE_HOURS would always tip
        # age_hours a hair over the threshold -- not a source bug, just wall
        # clock skew between test setup and the call under test).
        report = q.evaluate(
            title="Federal Reserve holds interest rates steady amid inflation",
            source="Reuters",
            published_at=_now() - timedelta(hours=MAX_AGE_HOURS) + timedelta(seconds=5),
            summary="normal summary text",
        )
        assert "too old" not in " ".join(report.reasons).lower()


class TestFilterAndScore:
    def test_mixed_batch_splits_passed_and_failed_correctly(self, q):
        articles = [
            {"title": "Federal Reserve holds interest rates steady amid inflation",
             "source": "Reuters", "published_at": _now(), "summary": "solid reporting"},
            {"title": "Get rich quick with this secret strategy today",
             "source": "Reuters", "published_at": _now(), "summary": ""},
        ]
        passed, stats = q.filter_and_score(articles)
        assert stats["total"] == 2
        assert stats["passed"] == 1
        assert stats["failed"] == 1
        assert passed[0]["quality_score"] > 0
        assert "quality_score" in passed[0] and "trust_score" in passed[0]

    def test_missing_fields_use_safe_defaults(self, q):
        articles = [{}]
        passed, stats = q.filter_and_score(articles)
        assert stats["total"] == 1
        # empty title -> too short -> likely fails, but must not raise
        assert stats["passed"] + stats["failed"] == 1


class TestWeightedSentimentScore:
    def test_empty_list_returns_zero(self, q):
        assert q.weighted_sentiment_score([]) == 0.0

    def test_weights_by_trust_score(self, q):
        articles = [
            {"compound": 1.0, "trust_score": 1.0},
            {"compound": -1.0, "trust_score": 0.1},
        ]
        result = q.weighted_sentiment_score(articles)
        # high-trust positive article should dominate
        assert result > 0.5

    def test_missing_trust_score_defaults_gracefully(self, q):
        articles = [{"compound": 0.5}]
        result = q.weighted_sentiment_score(articles)
        assert result == pytest.approx(0.5)
