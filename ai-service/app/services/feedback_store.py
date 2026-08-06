"""
Durable storage for signal outcomes — MongoDB-backed so the feedback loop
(win-rate tracking, fusion model training data) survives process restarts
instead of living only in memory.
"""
import logging
from datetime import datetime
from typing import Optional

from motor.motor_asyncio import AsyncIOMotorClient
from bson import ObjectId

from app.config import get_settings

logger = logging.getLogger("ai-service.feedback_store")

CALIBRATOR_FIT_LIMIT = 2000
FUSION_BATCH_LIMIT = 500

_client: Optional[AsyncIOMotorClient] = None


def _collection():
    global _client
    settings = get_settings()
    if not settings.mongodb_uri:
        return None
    if _client is None:
        _client = AsyncIOMotorClient(settings.mongodb_uri)
    return _client.get_default_database()["signal_feedback"]


async def insert_pending(doc: dict) -> Optional[str]:
    coll = _collection()
    if coll is None:
        return None
    doc = {**doc, "status": "pending"}
    result = await coll.insert_one(doc)
    return str(result.inserted_id)


async def get_ready_pending(cutoff: datetime) -> list:
    coll = _collection()
    if coll is None:
        return []
    cursor = coll.find({"status": "pending", "generated_at": {"$lte": cutoff}})
    return [doc async for doc in cursor]


async def mark_evaluated(doc_id, outcome_fields: dict):
    coll = _collection()
    if coll is None:
        return
    await coll.update_one(
        {"_id": ObjectId(doc_id) if not isinstance(doc_id, ObjectId) else doc_id},
        {"$set": {**outcome_fields, "status": "evaluated"}},
    )


async def count_evaluated() -> int:
    coll = _collection()
    if coll is None:
        return 0
    return await coll.count_documents({"status": "evaluated"})


async def count_pending() -> int:
    coll = _collection()
    if coll is None:
        return 0
    return await coll.count_documents({"status": "pending"})


async def get_recent_evaluated(limit: int = CALIBRATOR_FIT_LIMIT) -> list:
    coll = _collection()
    if coll is None:
        return []
    cursor = coll.find({"status": "evaluated"}).sort("evaluated_at", -1).limit(limit)
    docs = [doc async for doc in cursor]
    docs.reverse()  # oldest-first, matching the old in-memory append order
    return docs


async def get_by_asset_stats(limit: int = 200) -> dict:
    coll = _collection()
    if coll is None:
        return {}
    cursor = coll.find({"status": "evaluated"}).sort("evaluated_at", -1).limit(limit)
    by_asset = {}
    async for h in cursor:
        a = h["asset"]
        if a not in by_asset:
            by_asset[a] = {"wins": 0, "losses": 0}
        if h["correct"]:
            by_asset[a]["wins"] += 1
        else:
            by_asset[a]["losses"] += 1
    for a, s in by_asset.items():
        total = s["wins"] + s["losses"]
        by_asset[a]["win_rate"] = round(s["wins"] / total, 3) if total else 0
    return by_asset


async def get_unused_fusion_examples(limit: int = FUSION_BATCH_LIMIT) -> list:
    """Evaluated signals with a captured feature vector, not yet used for a fusion training run."""
    coll = _collection()
    if coll is None:
        return []
    cursor = coll.find({
        "status": "evaluated",
        "feature_vector": {"$exists": True, "$ne": None},
        "used_for_fusion_training": {"$ne": True},
    }).limit(limit)
    return [doc async for doc in cursor]


async def mark_fusion_used(ids: list):
    coll = _collection()
    if coll is None or not ids:
        return
    object_ids = [i if isinstance(i, ObjectId) else ObjectId(i) for i in ids]
    await coll.update_many(
        {"_id": {"$in": object_ids}},
        {"$set": {"used_for_fusion_training": True}},
    )
