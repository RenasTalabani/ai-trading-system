"""
Telegram Public Channel Collector.

Reads real content from the user's trusted public channels via Telegram's
own public web preview (https://t.me/s/<channel>) -- the same page a logged-
out browser sees, not an authenticated or access-controlled endpoint, so
this involves no login, no API key, and no anti-bot circumvention.

This replaces the previous version of this file, which used the Telegram
Bot API's getChat endpoint. That approach cannot work: bots can only
receive live updates in channels they're a member of, never read historical
posts (a real Telegram platform limitation, not a bug in the old code) --
so collect_telegram_posts() always fell through to hardcoded mock posts,
meaning the "social sentiment" score has never actually reflected real
Telegram content until now.
"""
import asyncio
import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import List

import aiohttp
from bs4 import BeautifulSoup

from app.services.translation_service import get_translation_service

logger = logging.getLogger("ai-service.telegram_collector")

# Real, user-verified public channels. language drives translation before
# sentiment analysis (VADER's lexicon is English-only); reliability is
# carried through for future weighting even though it isn't consumed yet.
TELEGRAM_CHANNELS = [
    {"username": "KurdishFinancial", "language": "ku", "reliability": "high"},
    {"username": "yawmly",           "language": "ar", "reliability": "medium"},
    {"username": "kurdchain",        "language": "ku", "reliability": "high"},
]

# Promotional/referral content filtered out before it ever reaches sentiment
# analysis -- strong, low-false-positive signals of an ad rather than
# genuine market commentary (per user instruction: filter broker referrals,
# advertisements, promotional posts, spam).
PROMO_PATTERNS = [
    "referral", "affiliate", "bonus", "sign up bonus", "sign-up bonus",
    "promo code", "use my link", "use my code", "invite link",
    "join my", "discount code", "cashback", "eplanet",
]


@dataclass
class TelegramPost:
    platform: str = "telegram"
    content: str = ""           # translated (English) text fed to sentiment analysis
    original_content: str = ""  # untranslated source text -- for debugging only, never surfaced to the user
    language: str = "en"
    author: str = "channel"
    channel: str = ""
    published_at: datetime = None
    likes: int = 0   # Telegram has no "likes" -- view count used as the engagement proxy
    shares: int = 0

    def __post_init__(self):
        if self.published_at is None:
            self.published_at = datetime.now(timezone.utc)


def _is_promotional(text: str) -> bool:
    lower = text.lower()
    return any(p in lower for p in PROMO_PATTERNS)


def _parse_view_count(raw: str) -> int:
    """Telegram formats views like '1.2K' or '323' -- normalize to an int."""
    raw = raw.strip().upper()
    try:
        if raw.endswith("K"):
            return int(float(raw[:-1]) * 1_000)
        if raw.endswith("M"):
            return int(float(raw[:-1]) * 1_000_000)
        return int(raw)
    except ValueError:
        return 0


@dataclass
class _RawPost:
    """Pre-translation extraction result -- kept separate from TelegramPost
    so HTML parsing can be unit-tested with a static fixture, no network or
    translation model required."""
    text: str
    published_at: datetime
    views: int


def extract_posts_from_html(html: str, limit: int) -> List[_RawPost]:
    """Pure parsing step: HTML in, raw (untranslated) posts out. Filters out
    promotional content and empty messages before they go any further."""
    soup = BeautifulSoup(html, "lxml")
    raw_posts: List[_RawPost] = []

    for msg in soup.select("div.tgme_widget_message[data-post]")[-limit:]:
        text_el = msg.select_one(".tgme_widget_message_text")
        if not text_el:
            continue
        text = text_el.get_text(separator=" ", strip=True)
        if not text or _is_promotional(text):
            continue

        published_at = datetime.now(timezone.utc)
        time_el = msg.select_one("time[datetime]")
        if time_el and time_el.get("datetime"):
            try:
                published_at = datetime.fromisoformat(time_el["datetime"])
            except ValueError:
                pass

        views = 0
        views_el = msg.select_one(".tgme_widget_message_views")
        if views_el:
            views = _parse_view_count(views_el.get_text(strip=True))

        raw_posts.append(_RawPost(text=text, published_at=published_at, views=views))

    return raw_posts


async def _fetch_channel(session: aiohttp.ClientSession, channel_cfg: dict, limit: int) -> List[TelegramPost]:
    username = channel_cfg["username"]
    language = channel_cfg["language"]
    url = f"https://t.me/s/{username}"

    try:
        async with session.get(
            url,
            timeout=aiohttp.ClientTimeout(total=10),
            headers={"User-Agent": "Mozilla/5.0 (compatible; AITradingIntelligence/1.0)"},
        ) as resp:
            if resp.status != 200:
                logger.debug(f"Telegram: {username} returned HTTP {resp.status}")
                return []
            html = await resp.text()
    except Exception as e:
        logger.debug(f"Telegram: fetch failed for {username}: {e}")
        return []

    translator = get_translation_service()
    posts: List[TelegramPost] = []

    for raw in extract_posts_from_html(html, limit):
        translated = await translator.translate_async(raw.text, language) if language != "en" else raw.text
        posts.append(TelegramPost(
            content=translated,
            original_content=raw.text,
            language=language,
            channel=f"@{username}",
            published_at=raw.published_at,
            likes=raw.views,
        ))

    return posts


async def collect_telegram_posts(limit_per_channel: int = 20) -> List[TelegramPost]:
    """Collect recent posts from the configured public Telegram channels."""
    posts: List[TelegramPost] = []
    async with aiohttp.ClientSession() as session:
        tasks = [_fetch_channel(session, ch, limit_per_channel) for ch in TELEGRAM_CHANNELS]
        results = await asyncio.gather(*tasks, return_exceptions=True)
        for batch in results:
            if isinstance(batch, list):
                posts.extend(batch)
            elif isinstance(batch, Exception):
                logger.debug(f"Telegram channel fetch raised: {batch}")

    logger.info(f"Telegram: collected {len(posts)} real posts from {len(TELEGRAM_CHANNELS)} channels")
    return posts
