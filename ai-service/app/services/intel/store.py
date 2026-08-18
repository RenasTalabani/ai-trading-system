"""
Durable storage for structured market insights -- the AI's persistent
knowledge layer, as opposed to raw source content (which is never
persisted long-term, only summarized).

Same resilience pattern as feedback_store.py: every operation is wrapped in
a hard wall-clock timeout and degrades to a safe default rather than
raising, because a slow/unreachable DB must never be allowed to break the
collection pipeline or any endpoint built on top of it (see feedback_store.py
for the full incident history behind this pattern).
"""
import asyncio
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

from motor.motor_asyncio import AsyncIOMotorClient

from app.config import get_settings

logger = logging.getLogger("ai-service.intel_store")

HARD_TIMEOUT_SECONDS = 3.0
RECENT_WINDOW_HOURS = 48  # how far back cross-referencing looks for related insights

_client: Optional[AsyncIOMotorClient] = None


def _insights_collection():
    global _client
    settings = get_settings()
    if not settings.mongodb_uri:
        return None
    if _client is None:
        _client = AsyncIOMotorClient(
            settings.mongodb_uri,
            serverSelectionTimeoutMS=int(HARD_TIMEOUT_SECONDS * 1000),
        )
    return _client.get_default_database()["market_insights"]


def _reliability_collection():
    global _client
    settings = get_settings()
    if not settings.mongodb_uri:
        return None
    if _client is None:
        _client = AsyncIOMotorClient(
            settings.mongodb_uri,
            serverSelectionTimeoutMS=int(HARD_TIMEOUT_SECONDS * 1000),
        )
    return _client.get_default_database()["source_reliability"]


async def _safe(coro, default, label: str):
    try:
        return await asyncio.wait_for(coro, timeout=HARD_TIMEOUT_SECONDS)
    except Exception as e:
        logger.warning(f"intel_store.{label} failed (non-fatal): {e}")
        return default


async def insert_insight(doc: dict) -> Optional[str]:
    coll = _insights_collection()
    if coll is None:
        return None

    async def _do():
        result = await coll.insert_one(doc)
        return str(result.inserted_id)

    return await _safe(_do(), None, "insert_insight")


async def find_by_content_hash(content_hash: str) -> Optional[dict]:
    """Duplicate check -- the same post re-collected on the next cycle
    (Telegram's preview always shows the same recent window) shouldn't be
    stored twice."""
    coll = _insights_collection()
    if coll is None:
        return None
    return await _safe(coll.find_one({"content_hash": content_hash}), None, "find_by_content_hash")


async def get_recent_insights(asset: Optional[str] = None, hours: int = RECENT_WINDOW_HOURS, limit: int = 200) -> list:
    coll = _insights_collection()
    if coll is None:
        return []

    async def _do():
        since = datetime.now(timezone.utc) - timedelta(hours=hours)
        query = {"timestamp": {"$gte": since}}
        if asset:
            query["related_assets"] = asset
        cursor = coll.find(query).sort("timestamp", -1).limit(limit)
        return [doc async for doc in cursor]

    return await _safe(_do(), [], "get_recent_insights")


async def update_related_insights(insight_id: str, related_ids: list):
    coll = _insights_collection()
    if coll is None or not related_ids:
        return
    from bson import ObjectId
    await _safe(
        coll.update_one({"_id": ObjectId(insight_id)}, {"$set": {"related_insights": related_ids}}),
        None, "update_related_insights",
    )


async def get_source_reliability(source: str) -> Optional[dict]:
    coll = _reliability_collection()
    if coll is None:
        return None
    return await _safe(coll.find_one({"source": source}), None, "get_source_reliability")


async def upsert_source_reliability(source: str, fields: dict):
    coll = _reliability_collection()
    if coll is None:
        return
    await _safe(
        coll.update_one({"source": source}, {"$set": fields, "$setOnInsert": {"source": source}}, upsert=True),
        None, "upsert_source_reliability",
    )


async def get_all_source_reliability() -> list:
    coll = _reliability_collection()
    if coll is None:
        return []

    async def _do():
        return [doc async for doc in coll.find({})]

    return await _safe(_do(), [], "get_all_source_reliability")
