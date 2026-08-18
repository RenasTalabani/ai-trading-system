"""
Durable storage for signal outcomes — MongoDB-backed so the feedback loop
(win-rate tracking, fusion model training data) survives process restarts
instead of living only in memory.

This is a best-effort background bookkeeping layer: every function is wrapped
in a hard wall-clock timeout and catches its own errors, degrading to a safe
default (None/[]/0/{}) rather than raising. A prediction must never fail or
stall just because feedback recording did — that already happened once (a
MongoDB DNS outage made every /api/predict call take ~20s and then 500, even
though the actual model inference had already succeeded). Note that plain
serverSelectionTimeoutMS does NOT cover this case — DNS SRV/TXT resolution
for a mongodb+srv:// URI happens before pymongo's server-selection logic
even starts, on dnspython's own ~20s default resolver lifetime. A wall-clock
asyncio.wait_for() around every call is the only thing that reliably bounds
the worst case regardless of which layer is slow.
"""
import asyncio
import logging
from datetime import datetime
from typing import Optional

from motor.motor_asyncio import AsyncIOMotorClient
from bson import ObjectId

from app.config import get_settings

logger = logging.getLogger("ai-service.feedback_store")

CALIBRATOR_FIT_LIMIT = 2000
FUSION_BATCH_LIMIT = 500
HARD_TIMEOUT_SECONDS = 3.0

_client: Optional[AsyncIOMotorClient] = None


def _collection():
    global _client
    settings = get_settings()
    if not settings.mongodb_uri:
        return None
    if _client is None:
        _client = AsyncIOMotorClient(
            settings.mongodb_uri,
            serverSelectionTimeoutMS=int(HARD_TIMEOUT_SECONDS * 1000),
        )
    return _client.get_default_database()["signal_feedback"]


async def _safe(coro, default, label: str):
    """Run a DB coroutine with a hard timeout, degrading to `default` on any failure."""
    try:
        return await asyncio.wait_for(coro, timeout=HARD_TIMEOUT_SECONDS)
    except Exception as e:
        logger.warning(f"feedback_store.{label} failed (non-fatal): {e}")
        return default


async def insert_pending(doc: dict) -> Optional[str]:
    coll = _collection()
    if coll is None:
        return None

    async def _do():
        result = await coll.insert_one({**doc, "status": "pending"})
        return str(result.inserted_id)

    return await _safe(_do(), None, "insert_pending")


async def get_ready_pending(cutoff: datetime) -> list:
    coll = _collection()
    if coll is None:
        return []

    async def _do():
        cursor = coll.find({"status": "pending", "generated_at": {"$lte": cutoff}})
        return [doc async for doc in cursor]

    return await _safe(_do(), [], "get_ready_pending")


async def mark_evaluated(doc_id, outcome_fields: dict):
    coll = _collection()
    if coll is None:
        return

    async def _do():
        await coll.update_one(
            {"_id": ObjectId(doc_id) if not isinstance(doc_id, ObjectId) else doc_id},
            {"$set": {**outcome_fields, "status": "evaluated"}},
        )

    await _safe(_do(), None, "mark_evaluated")


async def count_evaluated() -> int:
    coll = _collection()
    if coll is None:
        return 0
    return await _safe(coll.count_documents({"status": "evaluated"}), 0, "count_evaluated")


async def count_pending() -> int:
    coll = _collection()
    if coll is None:
        return 0
    return await _safe(coll.count_documents({"status": "pending"}), 0, "count_pending")


async def get_recent_evaluated(limit: int = CALIBRATOR_FIT_LIMIT) -> list:
    coll = _collection()
    if coll is None:
        return []

    async def _do():
        cursor = coll.find({"status": "evaluated"}).sort("evaluated_at", -1).limit(limit)
        docs = [doc async for doc in cursor]
        docs.reverse()  # oldest-first, matching the old in-memory append order
        return docs

    return await _safe(_do(), [], "get_recent_evaluated")


async def get_by_asset_stats(limit: int = 200) -> dict:
    coll = _collection()
    if coll is None:
        return {}

    async def _do():
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

    return await _safe(_do(), {}, "get_by_asset_stats")


async def get_unused_fusion_examples(limit: int = FUSION_BATCH_LIMIT) -> list:
    """Evaluated signals with a captured feature vector, not yet used for a fusion training run."""
    coll = _collection()
    if coll is None:
        return []

    async def _do():
        cursor = coll.find({
            "status": "evaluated",
            "feature_vector": {"$exists": True, "$ne": None},
            "used_for_fusion_training": {"$ne": True},
        }).limit(limit)
        return [doc async for doc in cursor]

    return await _safe(_do(), [], "get_unused_fusion_examples")


async def mark_fusion_used(ids: list):
    coll = _collection()
    if coll is None or not ids:
        return

    async def _do():
        object_ids = [i if isinstance(i, ObjectId) else ObjectId(i) for i in ids]
        await coll.update_many(
            {"_id": {"$in": object_ids}},
            {"$set": {"used_for_fusion_training": True}},
        )

    await _safe(_do(), None, "mark_fusion_used")
