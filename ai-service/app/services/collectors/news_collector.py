import asyncio
import logging
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import List, Optional
from email.utils import parsedate_to_datetime

import aiohttp

logger = logging.getLogger("ai-service.news_collector")

RSS_FEEDS = [
    {"url": "https://feeds.finance.yahoo.com/rss/2.0/headline?s=BTC-USD&region=US&lang=en-US", "source": "Yahoo Finance"},
    {"url": "https://www.coindesk.com/arc/outboundfeeds/rss/", "source": "CoinDesk"},
    {"url": "https://cointelegraph.com/rss", "source": "CoinTelegraph"},
    {"url": "https://decrypt.co/feed", "source": "Decrypt"},
    {"url": "https://feeds.reuters.com/reuters/businessNews", "source": "Reuters"},
    {"url": "https://cryptopanic.com/news/rss/", "source": "CryptoPanic"},
    {"url": "https://www.forexlive.com/feed/news", "source": "ForexLive"},
    {"url": "https://www.investing.com/rss/news.rss", "source": "Investing.com"},
]

GOOGLE_NEWS_TOPICS = [
    "bitcoin+cryptocurrency",
    "ethereum+defi",
    "crypto+regulation",
    "stock+market+economy",
    "federal+reserve+interest+rate",
    "forex+trading",
]


@dataclass
class NewsArticle:
    title: str
    url: str
    source: str
    published_at: datetime
    summary: str = ""


def _parse_date(date_str: str) -> datetime:
    try:
        return parsedate_to_datetime(date_str).replace(tzinfo=timezone.utc)
    except Exception:
        return datetime.now(timezone.utc)


def _extract_tag(block: str, tag: str) -> str:
    pattern = rf"<{tag}[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?</{tag}>"
    m = re.search(pattern, block, re.IGNORECASE)
    if not m:
        return ""
    return re.sub(r"<[^>]+>", "", m.group(1)).strip()


def _parse_rss(xml: str, source: str) -> List[NewsArticle]:
    articles = []
    for item_match in re.finditer(r"<item[^>]*>([\s\S]*?)</item>", xml, re.IGNORECASE):
        block = item_match.group(1)
        title = _extract_tag(block, "title")
        url   = _extract_tag(block, "link") or _extract_tag(block, "guid")
        pub   = _extract_tag(block, "pubDate") or _extract_tag(block, "published") or ""
        desc  = _extract_tag(block, "description") or _extract_tag(block, "summary") or ""

        if title and url:
            articles.append(NewsArticle(
                title=title[:300],
                url=url,
                source=source,
                published_at=_parse_date(pub) if pub else datetime.now(timezone.utc),
                summary=desc[:500],
            ))
    return articles


async def _fetch_feed(session: aiohttp.ClientSession, feed: dict) -> List[NewsArticle]:
    try:
        async with session.get(
            feed["url"],
            timeout=aiohttp.ClientTimeout(total=8),
            headers={"User-Agent": "AITradingIntelligence/3.0 (news-collector)"},
        ) as resp:
            if resp.status != 200:
                return []
            text = await resp.text()
            return _parse_rss(text, feed["source"])
    except Exception as e:
        logger.debug(f"Feed [{feed['source']}] failed: {e}")
        return []


async def _fetch_google_news(session: aiohttp.ClientSession, query: str) -> List[NewsArticle]:
    url = f"https://news.google.com/rss/search?q={query}&hl=en-US&gl=US&ceid=US:en"
    try:
        async with session.get(url, timeout=aiohttp.ClientTimeout(total=8),
                               headers={"User-Agent": "Mozilla/5.0"}) as resp:
            if resp.status != 200:
                return []
            text = await resp.text()
            return _parse_rss(text, "Google News")
    except Exception as e:
        logger.debug(f"Google News [{query}] failed: {e}")
        return []


async def collect_all_news() -> List[NewsArticle]:
    """Fetch from all RSS feeds + Google News concurrently."""
    async with aiohttp.ClientSession() as session:
        rss_tasks   = [_fetch_feed(session, f) for f in RSS_FEEDS]
        gnews_tasks = [_fetch_google_news(session, q) for q in GOOGLE_NEWS_TOPICS]
        results = await asyncio.gather(*rss_tasks, *gnews_tasks, return_exceptions=True)

    articles: List[NewsArticle] = []
    seen_urls: set = set()

    for batch in results:
        if isinstance(batch, list):
            for a in batch:
                if a.url not in seen_urls:
                    seen_urls.add(a.url)
                    articles.append(a)

    logger.info(f"News collected: {len(articles)} unique articles from {len(RSS_FEEDS) + len(GOOGLE_NEWS_TOPICS)} sources")
    return articles
