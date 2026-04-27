"""
Twitter / X API v2 Collector
Fetches recent tweets about crypto/trading using Bearer Token authentication.
Uses search/recent endpoint — no user-level auth required.
"""
import logging
import asyncio
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import List, Optional

import aiohttp

from app.config import get_settings

settings = get_settings()
logger = logging.getLogger("ai-service.twitter_collector")

TWITTER_API_BASE = "https://api.twitter.com/2"

SEARCH_QUERIES = [
    "bitcoin OR BTC lang:en -is:retweet",
    "ethereum OR ETH lang:en -is:retweet",
    "crypto trading signal lang:en -is:retweet",
    "crypto market bullish OR bearish lang:en -is:retweet",
    "altcoin season lang:en -is:retweet",
    "DeFi yield lang:en -is:retweet",
]

TWEET_FIELDS  = "created_at,public_metrics,author_id,lang"
MAX_RESULTS   = 10


@dataclass
class Tweet:
    platform: str = "twitter"
    content: str = ""
    author: str = "twitter_user"
    channel: str = "twitter"
    published_at: datetime = None
    likes: int = 0
    shares: int = 0
    replies: int = 0
    impressions: int = 0

    def __post_init__(self):
        if self.published_at is None:
            self.published_at = datetime.now(timezone.utc)


async def _search_tweets(
    session: aiohttp.ClientSession,
    query: str,
    bearer_token: str,
    max_results: int = MAX_RESULTS,
) -> List[Tweet]:
    url = f"{TWITTER_API_BASE}/tweets/search/recent"
    headers = {"Authorization": f"Bearer {bearer_token}"}
    params = {
        "query": query,
        "max_results": max_results,
        "tweet.fields": TWEET_FIELDS,
        "expansions": "author_id",
    }

    try:
        async with session.get(
            url, headers=headers, params=params,
            timeout=aiohttp.ClientTimeout(total=10),
        ) as resp:
            if resp.status == 401:
                logger.warning("Twitter: Invalid or expired Bearer Token.")
                return []
            if resp.status == 429:
                logger.warning("Twitter: Rate limit hit. Will retry next cycle.")
                return []
            if resp.status != 200:
                logger.debug(f"Twitter API returned {resp.status} for query: {query}")
                return []

            data = await resp.json()
            tweets_raw = data.get("data", [])

            tweets = []
            for t in tweets_raw:
                metrics = t.get("public_metrics", {})
                tweets.append(Tweet(
                    content=t.get("text", ""),
                    published_at=datetime.fromisoformat(
                        t.get("created_at", "").replace("Z", "+00:00")
                    ) if t.get("created_at") else datetime.now(timezone.utc),
                    likes=metrics.get("like_count", 0),
                    shares=metrics.get("retweet_count", 0),
                    replies=metrics.get("reply_count", 0),
                    impressions=metrics.get("impression_count", 0),
                ))
            return tweets

    except asyncio.TimeoutError:
        logger.warning(f"Twitter: Timeout for query: {query}")
        return []
    except Exception as e:
        logger.debug(f"Twitter fetch error: {e}")
        return []


async def collect_tweets() -> List[Tweet]:
    """Collect recent tweets across all configured queries."""
    token = settings.twitter_bearer_token
    if not token or token == "your_twitter_bearer_token":
        logger.info("Twitter: No Bearer Token configured — using mock data.")
        return _get_mock_tweets()

    tweets: List[Tweet] = []
    async with aiohttp.ClientSession() as session:
        tasks = [_search_tweets(session, q, token) for q in SEARCH_QUERIES]
        results = await asyncio.gather(*tasks, return_exceptions=True)
        seen = set()
        for batch in results:
            if isinstance(batch, list):
                for t in batch:
                    if t.content not in seen:
                        seen.add(t.content)
                        tweets.append(t)

    logger.info(f"Twitter: collected {len(tweets)} unique tweets")
    return tweets if tweets else _get_mock_tweets()


def _get_mock_tweets() -> List[Tweet]:
    """Realistic mock tweets for development."""
    now = datetime.now(timezone.utc)
    return [
        Tweet(content="$BTC holding strong above 60k. Bulls are in control. #Bitcoin #Crypto", likes=1200, shares=340, published_at=now),
        Tweet(content="$ETH gas fees dropping. Layer 2 adoption accelerating. Very bullish for the ecosystem.", likes=890, shares=210, published_at=now),
        Tweet(content="Crypto market dump incoming? Fed minutes were hawkish. Risk-off mode activated.", likes=2100, shares=670, published_at=now),
        Tweet(content="JUST IN: BlackRock BTC ETF sees record $500M inflow today. Institutional demand is real.", likes=5600, shares=1800, published_at=now),
        Tweet(content="$SOL network upgrade successful. Transaction speed increased 3x. Bullish for $SOL.", likes=430, shares=120, published_at=now),
        Tweet(content="Warning: Whale just moved 10,000 BTC to exchange. Potential sell pressure. #Bitcoin", likes=3200, shares=900, published_at=now),
        Tweet(content="Altseason incoming? BTC dominance dropping fast. Watch for $ETH and $SOL breakouts.", likes=780, shares=230, published_at=now),
        Tweet(content="CPI data lower than expected! Risk assets pumping. Crypto to benefit. #Fed #Inflation", likes=4500, shares=1200, published_at=now),
    ]
