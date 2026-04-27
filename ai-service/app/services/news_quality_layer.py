import logging
import re
from dataclasses import dataclass, field
from typing import List, Tuple
from datetime import datetime, timezone, timedelta

logger = logging.getLogger("ai-service.news_quality")

# ─── Source trust registry ────────────────────────────────────────────────────
# Score 0.0–1.0: higher = more trustworthy + more weight in sentiment fusion

SOURCE_TRUST = {
    "Reuters":          1.00,
    "Bloomberg Markets":1.00,
    "Yahoo Finance":    0.90,
    "CoinDesk":         0.85,
    "CoinTelegraph":    0.80,
    "Decrypt":          0.75,
    "Investing.com":    0.75,
    "ForexLive":        0.75,
    "CryptoPanic":      0.60,
    "Google News":      0.55,
    "Unknown":          0.40,
}

DEFAULT_TRUST = 0.50

# ─── Spam / clickbait patterns ────────────────────────────────────────────────
SPAM_PATTERNS = [
    r"100x guaranteed",
    r"get rich quick",
    r"moon in \d+ days",
    r"exclusive signal",
    r"\$\d+[km]? giveaway",
    r"click here to",
    r"limited time offer",
    r"sign up now",
    r"earn \d+% daily",
    r"passive income",
    r"secret strategy",
    r"insider tip",
]

CLICKBAIT_PATTERNS = [
    r"you won't believe",
    r"shocking truth",
    r"this one weird trick",
    r"broke the internet",
    r"going viral",
]

COMPILED_SPAM      = [re.compile(p, re.IGNORECASE) for p in SPAM_PATTERNS]
COMPILED_CLICKBAIT = [re.compile(p, re.IGNORECASE) for p in CLICKBAIT_PATTERNS]

# ─── Minimum quality thresholds ───────────────────────────────────────────────
MIN_TITLE_LENGTH     = 15
MAX_TITLE_LENGTH     = 300
MAX_AGE_HOURS        = 48
MIN_QUALITY_SCORE    = 0.30     # articles below this are discarded


@dataclass
class QualityReport:
    passed:        bool
    quality_score: float
    trust_score:   float
    reasons:       List[str] = field(default_factory=list)
    warnings:      List[str] = field(default_factory=list)


class NewsQualityLayer:
    """
    Filters, scores, and weights news articles before they reach the AI sentiment model.

    Quality score (0–1) combines:
      - Source trust (40%)
      - Content quality (30%)
      - Recency (20%)
      - Spam/clickbait penalty (10%)
    """

    def get_trust_score(self, source: str) -> float:
        for key, score in SOURCE_TRUST.items():
            if key.lower() in source.lower():
                return score
        return DEFAULT_TRUST

    def is_spam(self, text: str) -> Tuple[bool, str]:
        for pattern in COMPILED_SPAM:
            if pattern.search(text):
                return True, f"Spam pattern: {pattern.pattern}"
        return False, ""

    def is_clickbait(self, text: str) -> Tuple[bool, str]:
        for pattern in COMPILED_CLICKBAIT:
            if pattern.search(text):
                return True, f"Clickbait pattern: {pattern.pattern}"
        return False, ""

    def recency_score(self, published_at: datetime) -> float:
        now = datetime.now(timezone.utc)
        if published_at.tzinfo is None:
            published_at = published_at.replace(tzinfo=timezone.utc)
        age_hours = (now - published_at).total_seconds() / 3600
        if age_hours < 1:    return 1.00
        if age_hours < 6:    return 0.90
        if age_hours < 12:   return 0.75
        if age_hours < 24:   return 0.55
        if age_hours < 48:   return 0.30
        return 0.10

    def content_quality_score(self, title: str, summary: str = "") -> Tuple[float, List[str]]:
        issues = []
        score = 1.0

        if len(title) < MIN_TITLE_LENGTH:
            issues.append("Title too short")
            score -= 0.3
        if len(title) > MAX_TITLE_LENGTH:
            issues.append("Title too long (truncated?)")
            score -= 0.1
        if title.isupper():
            issues.append("All caps title (low quality indicator)")
            score -= 0.2
        if title.count("!") > 2:
            issues.append("Excessive exclamation marks")
            score -= 0.15
        if not summary and len(title) < 40:
            issues.append("No summary and short title")
            score -= 0.1

        return max(0.0, score), issues

    def evaluate(self, title: str, source: str, published_at: datetime, summary: str = "") -> QualityReport:
        reasons  = []
        warnings = []

        # Spam check
        spam, spam_reason = self.is_spam(title + " " + summary)
        if spam:
            return QualityReport(passed=False, quality_score=0.0, trust_score=0.0, reasons=[spam_reason])

        # Clickbait check
        click, click_reason = self.is_clickbait(title)
        if click:
            warnings.append(click_reason)

        # Age check
        now = datetime.now(timezone.utc)
        if published_at.tzinfo is None:
            published_at = published_at.replace(tzinfo=timezone.utc)
        age_hours = (now - published_at).total_seconds() / 3600
        if age_hours > MAX_AGE_HOURS:
            return QualityReport(passed=False, quality_score=0.0, trust_score=0.0,
                                 reasons=[f"Article too old: {age_hours:.0f}h"])

        # Component scores
        trust  = self.get_trust_score(source)
        rec    = self.recency_score(published_at)
        cq, cq_issues = self.content_quality_score(title, summary)
        warnings.extend(cq_issues)

        clickbait_penalty = 0.10 if click else 0.0

        quality = (
            trust  * 0.40 +
            cq     * 0.30 +
            rec    * 0.20 -
            clickbait_penalty * 0.10
        )
        quality = round(max(0.0, min(1.0, quality)), 3)

        passed = quality >= MIN_QUALITY_SCORE
        if not passed:
            reasons.append(f"Quality score {quality:.2f} below threshold {MIN_QUALITY_SCORE}")

        return QualityReport(
            passed=passed,
            quality_score=quality,
            trust_score=trust,
            reasons=reasons,
            warnings=warnings,
        )

    def filter_and_score(self, articles: list) -> Tuple[list, dict]:
        """
        Filter a list of article dicts (must have title, source, published_at).
        Returns (passed_articles_with_quality_scores, stats).
        """
        passed = []
        stats  = {"total": len(articles), "passed": 0, "failed": 0, "reasons": {}}

        for article in articles:
            report = self.evaluate(
                title=article.get("title", ""),
                source=article.get("source", "Unknown"),
                published_at=article.get("published_at", datetime.now(timezone.utc)),
                summary=article.get("summary", ""),
            )
            if report.passed:
                article["quality_score"] = report.quality_score
                article["trust_score"]   = report.trust_score
                article["warnings"]      = report.warnings
                passed.append(article)
                stats["passed"] += 1
            else:
                stats["failed"] += 1
                for r in report.reasons:
                    stats["reasons"][r] = stats["reasons"].get(r, 0) + 1

        logger.info(
            f"Quality filter: {stats['passed']}/{stats['total']} passed "
            f"({stats['failed']} rejected)"
        )
        return passed, stats

    def weighted_sentiment_score(self, articles_with_scores: list, sentiment_key: str = "compound") -> float:
        """
        Compute trust-weighted average sentiment score.
        Articles with higher trust scores have proportionally more influence.
        """
        if not articles_with_scores:
            return 0.0
        total_weight  = sum(a.get("trust_score", DEFAULT_TRUST) for a in articles_with_scores)
        weighted_sum  = sum(
            a.get(sentiment_key, 0.0) * a.get("trust_score", DEFAULT_TRUST)
            for a in articles_with_scores
        )
        return weighted_sum / total_weight if total_weight > 0 else 0.0
