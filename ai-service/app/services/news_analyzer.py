import logging
from typing import List, Optional

from app.models.news_sentiment import NewsSentimentModel, ASSET_KEYWORDS
from app.services.collectors.news_collector import collect_all_news, NewsArticle
from app.services.news_quality_layer import NewsQualityLayer

logger = logging.getLogger("ai-service.news_analyzer")


class NewsAnalyzer:
    """
    Orchestrates full news pipeline:
    1. Collect articles from all sources
    2. Run sentiment + event detection on each headline
    3. Produce per-asset news impact scores for the signal engine
    """

    def __init__(self, sentiment_model: NewsSentimentModel):
        self.model   = sentiment_model
        self.quality = NewsQualityLayer()
        self._cache: Optional[dict] = None
        self._cache_ts: float = 0
        self._cache_ttl: int = 1800  # 30 min

    async def refresh(self) -> dict:
        """Fetch fresh news and run full analysis. Result cached for 30 min."""
        import time
        now = time.time()
        if self._cache and (now - self._cache_ts) < self._cache_ttl:
            logger.debug("News cache hit.")
            return self._cache

        logger.info("Refreshing news cache...")
        articles: List[NewsArticle] = await collect_all_news()

        if not articles:
            logger.warning("No articles fetched.")
            return self._empty_result()

        # Run quality filter before sentiment analysis
        raw_dicts = [
            {"title": a.title, "source": a.source,
             "published_at": a.published_at, "summary": a.summary}
            for a in articles
        ]
        filtered, q_stats = self.quality.filter_and_score(raw_dicts)
        logger.info(f"Quality filter: {q_stats['passed']}/{q_stats['total']} passed")

        headlines = [a["title"] for a in filtered] if filtered else [a.title for a in articles[:20]]
        analysis  = self.model.analyze(headlines)

        # Per-asset breakdown
        asset_scores = {}
        for asset in ASSET_KEYWORDS:
            kws = ASSET_KEYWORDS[asset]
            relevant = [a.title for a in articles if any(k in a.title.lower() for k in kws)]
            if relevant:
                asset_result = self.model.analyze(relevant)
                asset_scores[asset] = {
                    "market_score": asset_result["market_score"],
                    "sentiment": asset_result["overall_sentiment"],
                    "impact": asset_result["impact"],
                    "article_count": len(relevant),
                    "top_events": asset_result["detected_events"][:3],
                }
            else:
                asset_scores[asset] = {
                    "market_score": 50,
                    "sentiment": "neutral",
                    "impact": 0,
                    "article_count": 0,
                    "top_events": [],
                }

        result = {
            "global": {
                "sentiment": analysis["overall_sentiment"],
                "market_score": analysis["market_score"],
                "impact": analysis["impact"],
                "total_articles": len(articles),
                "breakdown": analysis["breakdown"],
                "detected_events": analysis["detected_events"],
            },
            "by_asset": asset_scores,
            "top_headlines": [a.title for a in articles[:10]],
            "sources_used": list({a.source for a in articles}),
        }

        self._cache = result
        self._cache_ts = now
        logger.info(
            f"News analysis complete — {len(articles)} articles | "
            f"global sentiment: {result['global']['sentiment']} | "
            f"score: {analysis['score']:.3f}"
        )
        return result

    def get_asset_score(self, asset: str) -> float:
        """Return cached market_score (0-100) for an asset. 50 = neutral."""
        if self._cache:
            return self._cache.get("by_asset", {}).get(asset, {}).get("market_score", 50)
        return 50.0

    def get_global_events(self) -> List[str]:
        if self._cache:
            return self._cache.get("global", {}).get("detected_events", [])
        return []

    def _empty_result(self) -> dict:
        return {
            "global": {"sentiment": "neutral", "market_score": 50, "impact": 0, "total_articles": 0, "breakdown": {}, "detected_events": []},
            "by_asset": {a: {"market_score": 50, "sentiment": "neutral", "impact": 0, "article_count": 0, "top_events": []} for a in ASSET_KEYWORDS},
            "top_headlines": [],
            "sources_used": [],
        }
