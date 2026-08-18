"""
Telegram connector -- wraps the existing telegram_collector.py (which
already does the actual fetching, promotional filtering, and translation)
and adapts its output into RawItem, attaching each channel's own configured
reliability tier from TELEGRAM_CHANNELS.
"""
import logging
from typing import List

from app.services.collectors.telegram_collector import collect_telegram_posts, TELEGRAM_CHANNELS
from app.services.intel.connectors.base import SourceConnector
from app.services.intel.models import RawItem

logger = logging.getLogger("ai-service.intel.telegram_source")

_CHANNEL_CONFIG = {c["username"]: c for c in TELEGRAM_CHANNELS}


class TelegramSourceConnector(SourceConnector):
    name = "telegram_channels"
    source_type = "telegram"

    async def fetch(self) -> List[RawItem]:
        try:
            posts = await collect_telegram_posts()
        except Exception as e:
            logger.warning(f"Telegram connector fetch failed: {e}")
            return []

        items = []
        for p in posts:
            username = p.channel.lstrip("@")
            cfg = _CHANNEL_CONFIG.get(username, {})
            items.append(RawItem(
                source=p.channel,
                source_url=f"https://t.me/s/{username}",
                source_type="telegram",
                language=p.language,
                text=p.content,
                original_text=p.original_content,
                published_at=p.published_at,
                reliability_tier=cfg.get("reliability", "medium"),
            ))
        return items
