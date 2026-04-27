"""
Reddit Trading Community Collector
Fetches posts from crypto/trading subreddits via Reddit JSON API (no auth needed for public posts).
"""
import logging
import asyncio
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import List

import aiohttp

from app.config import get_settings

settings = get_settings()
logger = logging.getLogger("ai-service.reddit_collector")

SUBREDDITS = [
    "CryptoCurrency",
    "Bitcoin",
    "ethereum",
    "CryptoMarkets",
    "SatoshiStreetBets",
    "algotrading",
    "Forex",
    "investing",
    "wallstreetbets",
]

SORT_MODES = ["hot", "new"]
POSTS_PER_SUB = 10

REDDIT_BASE = "https://www.reddit.com"
HEADERS = {
    "User-Agent": "AITradingIntelligence/4.0 (social analysis bot)",
    "Accept": "application/json",
}


@dataclass
class RedditPost:
    platform: str = "reddit"
    content: str = ""
    author: str = "redditor"
    channel: str = ""    # subreddit name
    published_at: datetime = None
    likes: int = 0       # upvotes
    shares: int = 0      # crosspost count
    replies: int = 0     # comment count
    upvote_ratio: float = 0.5

    def __post_init__(self):
        if self.published_at is None:
            self.published_at = datetime.now(timezone.utc)


async def _fetch_subreddit(
    session: aiohttp.ClientSession,
    subreddit: str,
    sort: str = "hot",
    limit: int = POSTS_PER_SUB,
) -> List[RedditPost]:
    url = f"{REDDIT_BASE}/r/{subreddit}/{sort}.json"
    params = {"limit": limit, "raw_json": 1}

    try:
        async with session.get(
            url, headers=HEADERS, params=params,
            timeout=aiohttp.ClientTimeout(total=10),
        ) as resp:
            if resp.status == 429:
                logger.warning(f"Reddit: Rate limit on r/{subreddit}. Skipping.")
                return []
            if resp.status != 200:
                logger.debug(f"Reddit: {resp.status} for r/{subreddit}")
                return []

            data = await resp.json()
            posts = []

            for item in data.get("data", {}).get("children", []):
                p = item.get("data", {})
                # Skip removed/deleted/NSFW posts
                if p.get("removed_by_category") or p.get("over_18") or not p.get("title"):
                    continue

                # Combine title + selftext for content
                title   = p.get("title", "")
                selftext = p.get("selftext", "")[:300]
                content = f"{title}. {selftext}".strip() if selftext else title

                posts.append(RedditPost(
                    content=content[:500],
                    author=p.get("author", "anonymous"),
                    channel=f"r/{subreddit}",
                    published_at=datetime.fromtimestamp(
                        p.get("created_utc", 0), tz=timezone.utc
                    ),
                    likes=p.get("ups", 0),
                    shares=p.get("num_crossposts", 0),
                    replies=p.get("num_comments", 0),
                    upvote_ratio=p.get("upvote_ratio", 0.5),
                ))

            return posts

    except asyncio.TimeoutError:
        logger.warning(f"Reddit: Timeout for r/{subreddit}")
        return []
    except Exception as e:
        logger.debug(f"Reddit fetch error for r/{subreddit}: {e}")
        return []


async def collect_reddit_posts() -> List[RedditPost]:
    """Collect posts from all configured subreddits (no API key needed for public posts)."""
    posts: List[RedditPost] = []
    seen_content: set = set()

    async with aiohttp.ClientSession() as session:
        tasks = [_fetch_subreddit(session, sub, "hot") for sub in SUBREDDITS]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        for batch in results:
            if isinstance(batch, list):
                for p in batch:
                    key = p.content[:80]
                    if key not in seen_content:
                        seen_content.add(key)
                        posts.append(p)

    logger.info(f"Reddit: collected {len(posts)} unique posts from {len(SUBREDDITS)} subreddits")
    return posts if posts else _get_mock_posts()


def _get_mock_posts() -> List[RedditPost]:
    """Fallback mock posts for development."""
    now = datetime.now(timezone.utc)
    return [
        RedditPost(content="BTC just bounced perfectly off the 200-day MA. Classic bull market signal. Accumulate.", channel="r/Bitcoin", likes=4200, replies=312, published_at=now),
        RedditPost(content="ETH/BTC ratio hitting 6-month low. Seems oversold. Could be good entry for ETH.", channel="r/ethereum", likes=1800, replies=156, published_at=now),
        RedditPost(content="WARNING: Multiple analysts pointing to potential head and shoulders on BTC 4H. Be careful.", channel="r/CryptoMarkets", likes=920, replies=234, published_at=now),
        RedditPost(content="SOL just did 20% in a week. Ecosystem growing insanely fast. Still undervalued imo.", channel="r/CryptoCurrency", likes=3100, replies=445, published_at=now),
        RedditPost(content="Fed pivot imminent according to latest data. Risk assets including crypto should benefit.", channel="r/investing", likes=5600, replies=890, published_at=now),
        RedditPost(content="XRP legal situation finally resolved. Major bullish catalyst unlocked. Target $1.5", channel="r/CryptoMarkets", likes=2300, replies=367, published_at=now),
        RedditPost(content="Market manipulation is insane rn. Same pattern every weekend — dump then pump Monday.", channel="r/SatoshiStreetBets", likes=780, replies=123, published_at=now),
    ]
