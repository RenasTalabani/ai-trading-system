"""
Tests for MacroDataService (T-050, overnight continuous-improvement pass,
2026-08-25/26). Zero prior direct test coverage existed for this module.

FIXED (market-data reliability): every one of the module's five cached
fetch methods (get_fear_greed, get_global_crypto, get_trending_coins,
get_fred_series, get_funding_rates) used the pattern

    if hit := _cached(key):
        return hit

to check the in-process 10-minute cache before hitting a free/rate-limited
upstream API. `_cached()` returns `None` for "no entry" but returns the
cached value itself -- whatever it is -- for a hit. Three of the five
methods' own documented failure-fallback values are FALSY dicts (`{}` for
get_global_crypto and get_funding_rates on any fetch exception; `{}` for
get_fred_series both when a series has no observations and on fetch
exception). The walrus-in-if pattern treats a cached `{}` exactly like "no
cache entry" (`{}` is falsy in Python), so a call that failed once would
silently bypass the cache on every subsequent call within the same
10-minute window and re-hit the upstream API again -- directly
contradicting the module's own stated purpose ("All calls are cached for
10 minutes to avoid hammering free endpoints."). For endpoints with strict
rate limits (CoinGecko's free tier, Binance's futures API), repeatedly
re-hitting them after a single failure -- instead of backing off for the
cached 10-minute window like every other outcome does -- makes exactly
the failure scenario (upstream having trouble / being rate-limited) more
likely to escalate into an IP-level block, degrading macro-context data
(fear/greed, dominance, funding rates, Fed data) that feeds the AI
service's `macro_bias`/`macro_sentiment` signal inputs.

Fix: changed all five occurrences from `if hit := _cached(key):` to
`if (hit := _cached(key)) is not None:`, which correctly distinguishes
"no cache entry" from "cache entry whose value happens to be falsy."
"""
import sys
import pytest

sys.path.insert(0, "/home/claude/work/t045_pull/ai-service")

from app.services import macro_data_service as m


@pytest.fixture(autouse=True)
def _clear_cache():
    m._cache.clear()
    yield
    m._cache.clear()


class TestCacheHelperFalsyValueRegressionGuard:
    """Direct regression guard for the T-050 bug at the _cached/_store level --
    the exact primitive every affected method relies on."""

    def test_cached_falsy_dict_is_reported_as_a_hit(self):
        m._store("k", {})
        assert (hit := m._cached("k")) is not None
        assert hit == {}

    def test_cached_falsy_list_is_reported_as_a_hit(self):
        m._store("k", [])
        assert (hit := m._cached("k")) is not None
        assert hit == []

    def test_cached_zero_is_reported_as_a_hit(self):
        m._store("k", 0)
        assert (hit := m._cached("k")) is not None
        assert hit == 0

    def test_genuine_miss_still_returns_none(self):
        assert m._cached("never_stored") is None

    def test_expired_entry_still_returns_none(self):
        # store with a timestamp far enough in the past to have expired
        import time
        m._cache["k"] = (time.time() - m._CACHE_TTL - 1, {"stale": True})
        assert m._cached("k") is None


class _FakeResponse:
    def __init__(self, payload):
        self._payload = payload

    def json(self):
        return self._payload


class _FailingClient:
    """A client whose .get() always raises -- used to force a method's
    documented failure-fallback path."""
    async def get(self, *a, **kw):
        raise RuntimeError("simulated network failure")


class _AssertNotCalledClient:
    """A client that fails the test if .get() is invoked at all -- used to
    prove a second call served from cache instead of hitting the network."""
    async def get(self, *a, **kw):
        raise AssertionError("network was hit on what should have been a cache hit")


class TestGlobalCryptoCachesFailureAndServesItOnNextCall:
    """T-050 regression guard: get_global_crypto's failure fallback is `{}`
    (falsy) -- confirm a second call within the cache window does NOT hit
    the network again."""

    @pytest.mark.asyncio
    async def test_second_call_after_failure_does_not_refetch(self):
        svc = m.MacroDataService()
        svc._client = _FailingClient()
        first = await svc.get_global_crypto()
        assert first == {}

        svc._client = _AssertNotCalledClient()
        second = await svc.get_global_crypto()
        assert second == {}


class TestFundingRatesCachesFailureAndServesItOnNextCall:
    @pytest.mark.asyncio
    async def test_second_call_after_failure_does_not_refetch(self):
        svc = m.MacroDataService()
        svc._client = _FailingClient()
        first = await svc.get_funding_rates()
        assert first == {}

        svc._client = _AssertNotCalledClient()
        second = await svc.get_funding_rates()
        assert second == {}


class TestFredSeriesCachesFailureAndServesItOnNextCall:
    @pytest.mark.asyncio
    async def test_second_call_after_no_observations_does_not_refetch(self, monkeypatch):
        monkeypatch.setattr(m.settings, "fred_api_key", "test-key-123")
        svc = m.MacroDataService()

        class _EmptyObsClient:
            async def get(self, *a, **kw):
                return _FakeResponse({"observations": []})

        svc._client = _EmptyObsClient()
        first = await svc.get_fred_series("FEDFUNDS")
        assert first == {}

        svc._client = _AssertNotCalledClient()
        second = await svc.get_fred_series("FEDFUNDS")
        assert second == {}

    @pytest.mark.asyncio
    async def test_second_call_after_fetch_exception_does_not_refetch(self, monkeypatch):
        monkeypatch.setattr(m.settings, "fred_api_key", "test-key-123")
        svc = m.MacroDataService()
        svc._client = _FailingClient()
        first = await svc.get_fred_series("CPIAUCSL")
        assert first == {}

        svc._client = _AssertNotCalledClient()
        second = await svc.get_fred_series("CPIAUCSL")
        assert second == {}

    @pytest.mark.asyncio
    async def test_no_api_key_short_circuits_without_caching(self, monkeypatch):
        monkeypatch.setattr(m.settings, "fred_api_key", "")
        svc = m.MacroDataService()
        svc._client = _AssertNotCalledClient()
        result = await svc.get_fred_series("FEDFUNDS")
        assert result == {}
        # not cached (no key -> always short-circuits, nothing stored)
        assert m._cached("fred_FEDFUNDS") is None


class TestGenuineCacheHitStillAvoidsNetworkCall:
    """Confirm the fix didn't just make everything a cache miss -- a
    genuinely fresh, truthy cached value must still short-circuit too."""

    @pytest.mark.asyncio
    async def test_successful_fear_greed_result_is_served_from_cache(self):
        svc = m.MacroDataService()

        class _OkClient:
            calls = 0
            async def get(self, *a, **kw):
                _OkClient.calls += 1
                return _FakeResponse({"data": [{"value": "72", "value_classification": "Greed", "timestamp": "123"}]})

        svc._client = _OkClient()
        first = await svc.get_fear_greed()
        assert first["value"] == 72
        assert _OkClient.calls == 1

        svc._client = _AssertNotCalledClient()
        second = await svc.get_fear_greed()
        assert second == first


class TestGetFearGreedFallback:
    @pytest.mark.asyncio
    async def test_failure_falls_back_to_neutral_50(self):
        svc = m.MacroDataService()
        svc._client = _FailingClient()
        result = await svc.get_fear_greed()
        assert result == {"value": 50, "classification": "Neutral", "timestamp": ""}


class TestMacroBias:
    def test_strong_bull_conditions(self):
        assert m._macro_bias(fg=75, mkt_chg=6, funding={"BTCUSDT": {"funding_rate": -0.02}}) == "strong_bull"

    def test_strong_bear_conditions(self):
        assert m._macro_bias(fg=20, mkt_chg=-6, funding={"BTCUSDT": {"funding_rate": 0.1}}) == "strong_bear"

    def test_neutral_midpoint(self):
        assert m._macro_bias(fg=50, mkt_chg=0, funding={}) == "neutral"

    def test_overheated_funding_pulls_score_down(self):
        # fg=55 alone -> score=1 (mild_bull); high positive funding -> -1 -> score=0 -> neutral
        assert m._macro_bias(fg=55, mkt_chg=0, funding={"BTCUSDT": {"funding_rate": 0.06}}) == "neutral"

    def test_missing_btc_funding_key_defaults_gracefully(self):
        # no BTCUSDT key at all in funding dict -- should not raise
        result = m._macro_bias(fg=50, mkt_chg=0, funding={})
        assert result == "neutral"


class TestGetMacroSnapshotAggregation:
    @pytest.mark.asyncio
    async def test_exceptions_from_sub_calls_become_safe_defaults(self, monkeypatch):
        svc = m.MacroDataService()

        async def _raise(*a, **kw):
            raise RuntimeError("boom")

        monkeypatch.setattr(svc, "get_fear_greed", _raise)
        monkeypatch.setattr(svc, "get_global_crypto", _raise)
        monkeypatch.setattr(svc, "get_funding_rates", _raise)
        monkeypatch.setattr(svc, "get_trending_coins", _raise)
        monkeypatch.setattr(svc, "get_fed_snapshot", _raise)

        result = await svc.get_macro_snapshot()
        assert result["fear_greed"] == {}
        assert result["global_crypto"] == {}
        assert result["funding_rates"] == {}
        assert result["trending_coins"] == {"coins": []}
        assert result["fed"] == {}
        assert result["macro_sentiment"] == "neutral"

    @pytest.mark.asyncio
    async def test_bullish_sentiment_from_high_fear_greed(self, monkeypatch):
        svc = m.MacroDataService()

        async def _fg(): return {"value": 80, "classification": "Extreme Greed", "timestamp": ""}
        async def _gc(): return {"market_cap_change_24h": 0}
        async def _fr(): return {}
        async def _tc(): return {"coins": []}
        async def _fed(): return {}

        monkeypatch.setattr(svc, "get_fear_greed", _fg)
        monkeypatch.setattr(svc, "get_global_crypto", _gc)
        monkeypatch.setattr(svc, "get_funding_rates", _fr)
        monkeypatch.setattr(svc, "get_trending_coins", _tc)
        monkeypatch.setattr(svc, "get_fed_snapshot", _fed)

        result = await svc.get_macro_snapshot()
        assert result["macro_sentiment"] == "bullish"

    @pytest.mark.asyncio
    async def test_bearish_sentiment_from_low_fear_greed(self, monkeypatch):
        svc = m.MacroDataService()

        async def _fg(): return {"value": 15, "classification": "Extreme Fear", "timestamp": ""}
        async def _gc(): return {"market_cap_change_24h": 0}
        async def _fr(): return {}
        async def _tc(): return {"coins": []}
        async def _fed(): return {}

        monkeypatch.setattr(svc, "get_fear_greed", _fg)
        monkeypatch.setattr(svc, "get_global_crypto", _gc)
        monkeypatch.setattr(svc, "get_funding_rates", _fr)
        monkeypatch.setattr(svc, "get_trending_coins", _tc)
        monkeypatch.setattr(svc, "get_fed_snapshot", _fed)

        result = await svc.get_macro_snapshot()
        assert result["macro_sentiment"] == "bearish"
