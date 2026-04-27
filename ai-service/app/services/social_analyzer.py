import asyncio
import logging
import time
from typing import List, Optional

from app.models.social_sentiment import SocialSentimentModel, ASSET_KEYWORDS
from app.services.collectors.telegram_collector import collect_telegram_posts, TelegramPost
from app.services.collectors.twitter_collector  import collect_tweets, Tweet
from app.services.collectors.reddit_collector   import collect_reddit_posts, RedditPost

logger = logging.getLogger("ai-service.social_analyzer")


def _to_post_dict(post) -> dict:
    """Normalize collector dataclasses to unified dict format."""
    return {
        "content":          getattr(post, "content", ""),
        "platform":         getattr(post, "platform", "unknown"),
        "author":           getattr(post, "author", "anonymous"),
        "channel":          getattr(post, "channel", ""),
        "likes":            getattr(post, "likes", 0),
        "shares":           getattr(post, "shares", 0),
        "replies":          getattr(post, "replies", 0),
        "author_followers": getattr(post, "authorFollowers", 0),
        "published_at":     getattr(post, "published_at", None),
    }


class SocialAnalyzer:
    """
    Orchestrates social media intelligence pipeline:
    1. Collect from Telegram + Twitter + Reddit concurrently
    2. Run sentiment + hype/manipulation detection
    3. Per-asset scoring for signal engine integration
    """

    CACHE_TTL = 900  # 15 minutes — social moves fast

    def __init__(self, sentiment_model: SocialSentimentModel):
        self.model = sentiment_model
        self._cache: Optional[dict] = None
        self._cache_ts: float = 0

    async def refresh(self) -> dict:
        now = time.time()
        if self._cache and (now - self._cache_ts) < self.CACHE_TTL:
            logger.debug("Social cache hit.")
            return self._cache

        logger.info("Refreshing social media intelligence...")

        # Collect from all 3 platforms concurrently
        telegram_raw, twitter_raw, reddit_raw = await asyncio.gather(
            collect_telegram_posts(),
            collect_tweets(),
            collect_reddit_posts(),
            return_exceptions=True,
        )

        all_posts: List[dict] = []

        for batch, platform in [
            (telegram_raw, "telegram"),
            (twitter_raw,  "twitter"),
            (reddit_raw,   "reddit"),
        ]:
            if isinstance(batch, Exception):
                logger.warning(f"Collection failed for {platform}: {batch}")
                continue
            all_posts.extend(_to_post_dict(p) for p in (batch or []))

        if not all_posts:
            logger.warning("No social posts collected from any platform.")
            return self._empty_result()

        logger.info(f"Social: {len(all_posts)} total posts collected "
                    f"(Telegram={sum(1 for p in all_posts if p['platform']=='telegram')}, "
                    f"Twitter={sum(1 for p in all_posts if p['platform']=='twitter')}, "
                    f"Reddit={sum(1 for p in all_posts if p['platform']=='reddit')})")

        # Global analysis
        global_result = self.model.analyze(all_posts)

        # Per-asset analysis
        asset_scores: dict = {}
        for asset in ASSET_KEYWORDS:
            asset_result = self.model.analyze_for_asset(all_posts, asset)
            asset_scores[asset] = {
                "market_score":         asset_result.get("market_score", 50),
                "sentiment":            asset_result.get("overall", "neutral"),
                "hype_level":           asset_result.get("hype_level", 0),
                "manipulation_detected":asset_result.get("manipulation_detected", False),
                "pump_detected":        asset_result.get("pump_detected", False),
                "influencer_count":     asset_result.get("influencer_count", 0),
                "relevant_posts":       asset_result.get("relevant_posts", 0),
            }

        # Platform breakdown
        by_platform: dict = {}
        for platform in ["telegram", "twitter", "reddit"]:
            platform_posts = [p for p in all_posts if p["platform"] == platform]
            if platform_posts:
                pr = self.model.analyze(platform_posts)
                by_platform[platform] = {
                    "sentiment": pr.get("overall", "neutral"),
                    "score":     pr.get("score", 0),
                    "count":     len(platform_posts),
                    "hype":      pr.get("hype_level", 0),
                }

        # Top influential posts (by weight × engagement)
        analyzed = [(self.model.analyze_single(p), p) for p in all_posts]
        top_posts = sorted(
            [(r, p) for r, p in analyzed if r["sentiment"] != "spam"],
            key=lambda x: x[0]["weight"] * max(x[1].get("likes", 0), 1),
            reverse=True,
        )[:5]

        result = {
            "global": {
                "sentiment":            global_result.get("overall", "neutral"),
                "market_score":         global_result.get("market_score", 50),
                "score":                global_result.get("score", 0),
                "hype_level":           global_result.get("hype_level", 0),
                "spam_ratio":           global_result.get("spam_ratio", 0),
                "manipulation_detected":global_result.get("manipulation_detected", False),
                "pump_detected":        global_result.get("pump_detected", False),
                "influencer_count":     global_result.get("influencer_count", 0),
                "total_posts":          len(all_posts),
                "breakdown":            global_result.get("breakdown", {}),
            },
            "by_asset":    asset_scores,
            "by_platform": by_platform,
            "top_posts": [
                {
                    "content":   p.get("content", "")[:200],
                    "platform":  p.get("platform", ""),
                    "channel":   p.get("channel", ""),
                    "sentiment": r.get("sentiment", "neutral"),
                    "likes":     p.get("likes", 0),
                    "is_hype":   r.get("is_hype", False),
                }
                for r, p in top_posts
            ],
        }

        self._cache = result
        self._cache_ts = now
        logger.info(
            f"Social analysis complete — {len(all_posts)} posts | "
            f"global: {result['global']['sentiment']} | "
            f"pump_detected: {result['global']['pump_detected']}"
        )
        return result

    def get_asset_score(self, asset: str) -> float:
        if self._cache:
            return self._cache.get("by_asset", {}).get(asset, {}).get("market_score", 50)
        return 50.0

    def is_manipulation_detected(self, asset: str) -> bool:
        if self._cache:
            data = self._cache.get("by_asset", {}).get(asset, {})
            return data.get("manipulation_detected", False) or data.get("pump_detected", False)
        return False

    def _empty_result(self) -> dict:
        empty_asset = {
            "market_score": 50, "sentiment": "neutral",
            "hype_level": 0, "manipulation_detected": False,
            "pump_detected": False, "influencer_count": 0, "relevant_posts": 0,
        }
        return {
            "global": {"sentiment": "neutral", "market_score": 50, "score": 0,
                       "hype_level": 0, "spam_ratio": 0, "manipulation_detected": False,
                       "pump_detected": False, "influencer_count": 0, "total_posts": 0, "breakdown": {}},
            "by_asset":    {a: dict(empty_asset) for a in ASSET_KEYWORDS},
            "by_platform": {},
            "top_posts":   [],
        }
