import asyncio
import logging
from typing import List, Optional

from app.models.news_sentiment import NewsSentimentModel, ASSET_KEYWORDS
from app.services.collectors.news_collector import collect_all_news, NewsArticle
from app.services.news_quality_layer import NewsQualityLayer, DEFAULT_TRUST

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
        # BUG-001 (2026-08-29 overnight validation): refresh() had no lock,
        # so N concurrent callers hitting a cold/expired cache each kicked
        # off their own full collect+FinBERT pass independently -- N times
        # the network fetch and N times the (already slow, see below)
        # sentiment work, compounding the very hang this hunts.
        self._refresh_lock = asyncio.Lock()

    async def refresh(self) -> dict:
        """Fetch fresh news and run full analysis. Result cached for 30 min."""
        import time
        now = time.time()
        if self._cache and (now - self._cache_ts) < self._cache_ttl:
            logger.debug("News cache hit.")
            return self._cache

        async with self._refresh_lock:
            # Re-check after acquiring the lock -- a concurrent caller may
            # have just finished a refresh while we were waiting for it,
            # in which case we return that result instead of doing it again.
            now = time.time()
            if self._cache and (now - self._cache_ts) < self._cache_ttl:
                logger.debug("News cache hit (after waiting on an in-flight refresh).")
                return self._cache
            return await self._do_refresh(now)

    async def _do_refresh(self, now: float) -> dict:
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
        # Sentiment scoring (FinBERT, when active) is CPU-bound and can take a
        # while over hundreds of headlines — run it in a worker thread so it
        # doesn't freeze the event loop for every other concurrent request.
        loop = asyncio.get_event_loop()
        analysis = await loop.run_in_executor(None, self.model.analyze, headlines)

        # T-035 (2026-08-20): NewsQualityLayer builds a per-source trust
        # registry (Reuters/Bloomberg 1.00 down to Google News/Unknown
        # 0.40-0.55) and its class docstring documents that this trust score
        # is meant to weight the fused sentiment ("Source trust (40%)" of
        # the quality formula) -- but `weighted_sentiment_score()`, the
        # method that actually does that weighting, was never called
        # anywhere (confirmed by grep across the whole app/ tree). Past the
        # binary MIN_QUALITY_SCORE pass/fail cutoff, every source that
        # passed quality filtering was averaged into `global.sentiment` /
        # `global.market_score` with EQUAL weight regardless of trust --
        # a CryptoPanic or Google News headline (trust 0.55-0.60) moved the
        # score exactly as much as a Reuters or Bloomberg headline (trust
        # 1.00). This directly affects trade-signal quality: `global` is
        # what GlobalAnalyzer._macro_news_score() (see T-034) reads for
        # per-asset headline sentiment. Fixed by trust-weighting the global
        # score when quality-scored articles are available -- `filtered`
        # and `analysis["results"]` share the same order (both built from
        # `headlines = [a["title"] for a in filtered]`), so each per-headline
        # result can be paired with its article's trust_score. Falls back to
        # the original unweighted analysis when quality filtering rejected
        # every article (the `articles[:20]` fallback path has no trust
        # scores attached), preserving prior behavior there exactly.
        global_sentiment  = analysis["overall_sentiment"]
        global_market_sc  = analysis["market_score"]
        global_score      = analysis["score"]
        if filtered and analysis.get("results"):
            scored_for_weighting = [
                {**r, "trust_score": filtered[i].get("trust_score", DEFAULT_TRUST)}
                for i, r in enumerate(analysis["results"])
                if i < len(filtered)
            ]
            weighted = self.quality.weighted_sentiment_score(
                scored_for_weighting, sentiment_key="compound",
            )
            global_score     = round(weighted, 4)
            global_market_sc = round((weighted + 1) / 2 * 100, 1)
            global_sentiment = (
                "positive" if weighted >= 0.05 else
                "negative" if weighted <= -0.05 else
                "neutral"
            )

        # Per-asset breakdown.
        # BUG-001 (2026-08-29 overnight validation): this used to await one
        # asset's FinBERT pass at a time in a sequential for-loop -- with
        # ~10-15 tracked assets each needing their own run_in_executor call,
        # that's that many sequential CPU-bound passes stacked end to end on
        # every cache refresh, the leading root cause of the reported
        # multi-minute /predict hang. Per-headline results are already cached
        # by text in NewsSentimentModel (self._sentiment_cache), so this does
        # not change what gets computed or its outputs -- only that the
        # per-asset passes now run concurrently via asyncio.gather instead of
        # one after another.
        #
        # T-086 (2026-08-31): unbounded concurrency here traded that hang for
        # a different one. Confirmed live: `railway metrics` showed CPU at
        # 8.7 vCPU against an 8.0 vCPU limit and memory at 90% during a real
        # scan, at the exact moment News/Social/OrderBlock (all running
        # concurrently across ~13 assets, each independently entering this
        # per-asset gather) were hanging past 35-40s timeouts in
        # unified_analyzer.py -- ~15 concurrent FinBERT forward passes
        # (each itself able to use multiple cores via PyTorch's intra-op
        # parallelism) oversubscribing an 8-core container starves the event
        # loop for everything else scheduled on it, not just this call.
        # Bounded to 3 concurrent FinBERT passes -- enough to keep this
        # meaningfully faster than the old fully-sequential version, low
        # enough to leave real headroom for Strategy/OB/Social's own CPU
        # work happening at the same time across the rest of a scan.
        _finbert_limiter = asyncio.Semaphore(3)

        async def _score_asset(asset: str):
            kws = ASSET_KEYWORDS[asset]
            relevant = [a.title for a in articles if any(k in a.title.lower() for k in kws)]
            if relevant:
                async with _finbert_limiter:
                    asset_result = await loop.run_in_executor(None, self.model.analyze, relevant)
                return asset, {
                    "market_score": asset_result["market_score"],
                    "sentiment": asset_result["overall_sentiment"],
                    "impact": asset_result["impact"],
                    "article_count": len(relevant),
                    "top_events": asset_result["detected_events"][:3],
                }
            return asset, {
                "market_score": 50,
                "sentiment": "neutral",
                "impact": 0,
                "article_count": 0,
                "top_events": [],
            }

        asset_pairs = await asyncio.gather(*(_score_asset(a) for a in ASSET_KEYWORDS))
        asset_scores = dict(asset_pairs)

        result = {
            "global": {
                "sentiment": global_sentiment,
                "market_score": global_market_sc,
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
            f"score: {global_score:.3f}"
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
