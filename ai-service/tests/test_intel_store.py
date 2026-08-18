"""
Regression suite for intel/store.py's timeout/error resilience -- same
pattern and same reasoning as test_feedback_store.py: a slow or unreachable
DB must degrade to a safe default, never hang or raise into the pipeline.
"""
import asyncio
import pytest

from app.services.intel import store as intel_store


@pytest.mark.asyncio
async def test_safe_returns_real_result_on_fast_success():
    async def fast():
        return "ok"
    result = await intel_store._safe(fast(), default="fallback", label="test")
    assert result == "ok"


@pytest.mark.asyncio
async def test_safe_returns_default_on_exception_not_propagated():
    async def boom():
        raise RuntimeError("simulated DB failure")
    result = await intel_store._safe(boom(), default="fallback", label="test")
    assert result == "fallback"


@pytest.mark.asyncio
async def test_safe_returns_default_within_hard_timeout_when_coroutine_hangs():
    async def hangs_forever():
        await asyncio.sleep(30)
        return "should never get here"

    loop = asyncio.get_event_loop()
    start = loop.time()
    result = await intel_store._safe(hangs_forever(), default=[], label="test")
    elapsed = loop.time() - start

    assert result == []
    assert elapsed < intel_store.HARD_TIMEOUT_SECONDS + 1.0


@pytest.mark.asyncio
async def test_insights_collection_returns_none_when_no_mongodb_uri_configured(monkeypatch):
    class FakeSettings:
        mongodb_uri = None
    monkeypatch.setattr(intel_store, "get_settings", lambda: FakeSettings())
    intel_store._client = None
    assert intel_store._insights_collection() is None


@pytest.mark.asyncio
async def test_every_public_function_degrades_safely_when_collection_is_unavailable(monkeypatch):
    """With no configured DB, every read/write helper returns its documented
    safe default rather than raising -- a DB outage must never break the
    collection pipeline or any endpoint built on top of it."""
    monkeypatch.setattr(intel_store, "_insights_collection", lambda: None)
    monkeypatch.setattr(intel_store, "_reliability_collection", lambda: None)

    assert await intel_store.insert_insight({"source": "X"}) is None
    assert await intel_store.find_by_content_hash("abc123") is None
    assert await intel_store.get_recent_insights() == []
    assert await intel_store.get_recent_insights(asset="BTCUSDT") == []
    await intel_store.update_related_insights("fakeid", ["a", "b"])  # must not raise
    assert await intel_store.get_source_reliability("KurdishFinancial") is None
    await intel_store.upsert_source_reliability("KurdishFinancial", {"score": 0.8})  # must not raise
    assert await intel_store.get_all_source_reliability() == []
