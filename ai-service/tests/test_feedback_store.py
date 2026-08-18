"""
Regression suite for feedback_store.py's timeout/error resilience wrapper.

This protects against a real incident from this session: a MongoDB DNS outage
made every /api/predict call take ~20-30s and then return HTTP 500, even
though the model inference itself had already succeeded, because the feedback
DB write had no bound on how long it could block. The fix was `_safe()`, a
hard asyncio.wait_for() wrapper around every DB operation that degrades to a
safe default instead of propagating the failure or hanging.
"""
import asyncio
from datetime import datetime, timezone
import pytest

from app.services import feedback_store as fs


@pytest.mark.asyncio
async def test_safe_returns_real_result_on_fast_success():
    async def fast():
        return "ok"
    result = await fs._safe(fast(), default="fallback", label="test")
    assert result == "ok"


@pytest.mark.asyncio
async def test_safe_returns_default_on_exception_not_propagated():
    async def boom():
        raise RuntimeError("simulated DB failure")
    result = await fs._safe(boom(), default="fallback", label="test")
    assert result == "fallback"


@pytest.mark.asyncio
async def test_safe_returns_default_within_hard_timeout_when_coroutine_hangs():
    """
    The exact scenario from the incident: a DB call that hangs far longer than
    is acceptable (dnspython's own SRV/TXT resolver lifetime is ~20s) must
    still return within HARD_TIMEOUT_SECONDS, not the coroutine's own delay.
    """
    async def hangs_forever():
        await asyncio.sleep(30)  # far longer than HARD_TIMEOUT_SECONDS
        return "should never get here"

    loop = asyncio.get_event_loop()
    start = loop.time()
    result = await fs._safe(hangs_forever(), default=[], label="test")
    elapsed = loop.time() - start

    assert result == []
    assert elapsed < fs.HARD_TIMEOUT_SECONDS + 1.0, (
        f"_safe() took {elapsed:.1f}s but should bound to ~{fs.HARD_TIMEOUT_SECONDS}s"
    )


@pytest.mark.asyncio
async def test_collection_returns_none_when_no_mongodb_uri_configured(monkeypatch):
    class FakeSettings:
        mongodb_uri = None
    monkeypatch.setattr(fs, "get_settings", lambda: FakeSettings())
    fs._client = None
    assert fs._collection() is None


@pytest.mark.asyncio
async def test_every_public_function_degrades_safely_when_collection_is_unavailable(monkeypatch):
    """
    With no configured DB, every public read/write helper must return its
    documented safe default rather than raising -- this is what stops a DB
    outage from ever surfacing as a 500 on /api/predict.
    """
    monkeypatch.setattr(fs, "_collection", lambda: None)

    assert await fs.insert_pending({"asset": "X"}) is None
    assert await fs.get_ready_pending(datetime.now(timezone.utc)) == []
    await fs.mark_evaluated("fakeid", {"correct": True})  # must not raise
    assert await fs.count_evaluated() == 0
    assert await fs.count_pending() == 0
    assert await fs.get_recent_evaluated() == []
    assert await fs.get_by_asset_stats() == {}
    assert await fs.get_unused_fusion_examples() == []
    await fs.mark_fusion_used(["fakeid"])  # must not raise
