"""
Regression test for BUG-002 (2026-08-29 overnight validation report).

Reproduced live in two ways: (1) firing 7 concurrent /predict calls while
another request was in flight caused all 7 to fail immediately with
"Insufficient market data"; (2) plain, one-at-a-time, non-concurrent calls
also failed intermittently -- BTCUSDT/ETHUSDT each failed after
~10.5-11.3s, right at the hard-coded 10s Binance-fetch timeout, while the
very next asset succeeded normally and a retry 15s later also succeeded
in under 3s. Root cause: fetch_market_data() opened a brand-new
aiohttp.ClientSession() per call with no retry/backoff, plausibly tripping
Binance's per-IP rate limiting under load, with any non-200/timeout
silently becoming None -> a generic 422 indistinguishable from a genuine
"too little history" case.

Fixed with (1) one shared, lazily-created ClientSession instead of one per
call, and (2) a 3-attempt retry with backoff on timeout or non-200. This
suite proves the retry actually recovers from exactly the failure pattern
reproduced live (fails on early attempts, succeeds on a later one), gives
up cleanly after exhausting all attempts, and confirms the session really
is shared and reusable across calls rather than opened fresh each time.
"""
import asyncio

import pandas as pd
import pytest

from app.services.data_processor import DataProcessor


async def _no_sleep(*args, **kwargs):
    """Skip the real backoff delay in tests without recursing into itself
    (a lambda that calls asyncio.sleep after asyncio.sleep is patched would
    call the patched version of itself, infinitely)."""
    return None


def _klines_payload(n=250):
    """Real-shaped Binance klines response: enough rows to survive
    compute_indicators()'s dropna() (EMA200 needs 200 rows)."""
    return [
        [1700000000000 + i * 3600000, "100.0", "101.0", "99.0", "100.5", "1000.0",
         1700000000000 + i * 3600000 + 3599999, "100500.0", 10, "500.0", "50000.0", "0"]
        for i in range(n)
    ]


class FakeResponse:
    def __init__(self, status, payload=None):
        self.status = status
        self._payload = payload

    async def json(self):
        return self._payload

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False


class FakeSession:
    """Queues canned responses/exceptions, one per call to .get()."""
    def __init__(self, script):
        self._script = list(script)
        self.get_call_count = 0
        self.closed = False

    def get(self, url, params=None, timeout=None):
        self.get_call_count += 1
        item = self._script.pop(0)
        if isinstance(item, Exception):
            raise item
        return item

    async def close(self):
        self.closed = True


@pytest.fixture(autouse=True)
def _reset_shared_session():
    # Each test gets a clean slate -- don't let one test's fake session
    # leak into another via the class-level shared-session cache.
    DataProcessor._shared_session = None
    yield
    DataProcessor._shared_session = None


class TestRetryRecoversFromTransientFailures:
    async def test_a_timeout_then_a_success_recovers_without_the_caller_seeing_a_failure(self, monkeypatch):
        """Mirrors exactly what was reproduced live: attempt 1 times out,
        a later attempt succeeds -- the caller should get real data back,
        not None."""
        fake_session = FakeSession([
            asyncio.TimeoutError(),
            FakeResponse(200, _klines_payload()),
        ])

        async def _fake_get_session(cls=None):
            return fake_session

        monkeypatch.setattr(DataProcessor, "_get_session", classmethod(_fake_get_session))
        monkeypatch.setattr("asyncio.sleep", _no_sleep)  # skip real backoff delay in tests

        dp = DataProcessor()
        result = await dp.fetch_market_data("BTCUSDT")

        assert result is not None
        assert isinstance(result, pd.DataFrame)
        assert fake_session.get_call_count == 2

    async def test_a_non_200_then_a_success_also_recovers(self, monkeypatch):
        fake_session = FakeSession([
            FakeResponse(429, None),  # Binance rate-limit status
            FakeResponse(200, _klines_payload()),
        ])

        async def _fake_get_session(cls=None):
            return fake_session

        monkeypatch.setattr(DataProcessor, "_get_session", classmethod(_fake_get_session))
        monkeypatch.setattr("asyncio.sleep", _no_sleep)

        dp = DataProcessor()
        result = await dp.fetch_market_data("ETHUSDT")

        assert result is not None
        assert fake_session.get_call_count == 2

    async def test_all_attempts_failing_gives_up_cleanly_returning_none_not_raising(self, monkeypatch):
        fake_session = FakeSession([
            asyncio.TimeoutError(),
            asyncio.TimeoutError(),
            asyncio.TimeoutError(),
        ])

        async def _fake_get_session(cls=None):
            return fake_session

        monkeypatch.setattr(DataProcessor, "_get_session", classmethod(_fake_get_session))
        monkeypatch.setattr("asyncio.sleep", _no_sleep)

        dp = DataProcessor()
        result = await dp.fetch_market_data("SOLUSDT")

        assert result is None  # exhausted retries -- caller's existing None-check still handles this
        assert fake_session.get_call_count == 3  # exactly max_attempts, not more

    async def test_immediate_success_does_not_retry_unnecessarily(self, monkeypatch):
        fake_session = FakeSession([FakeResponse(200, _klines_payload())])

        async def _fake_get_session(cls=None):
            return fake_session

        monkeypatch.setattr(DataProcessor, "_get_session", classmethod(_fake_get_session))

        dp = DataProcessor()
        result = await dp.fetch_market_data("BNBUSDT")

        assert result is not None
        assert fake_session.get_call_count == 1  # no wasted retries on the happy path


class TestSharedSessionIsReusedNotRecreatedPerCall:
    async def test_two_separate_dataprocessor_instances_share_one_session(self, monkeypatch):
        # BUG-002's root cause was "a brand-new session per call" -- this
        # proves _get_session() returns the SAME object across both calls
        # and across two different DataProcessor() instances (the codebase
        # creates many separate instances -- see the 10+ call sites), not
        # just within one instance.
        created_sessions = []

        class RealClientSessionStub:
            def __init__(self):
                self.closed = False
                created_sessions.append(self)

            async def close(self):
                self.closed = True

        monkeypatch.setattr("app.services.data_processor.aiohttp.ClientSession", RealClientSessionStub)

        s1 = await DataProcessor._get_session()
        s2 = await DataProcessor()._get_session()

        assert s1 is s2
        assert len(created_sessions) == 1  # only one real session was ever constructed

    async def test_close_session_allows_a_fresh_one_to_be_created_afterward(self, monkeypatch):
        created_sessions = []

        class RealClientSessionStub:
            def __init__(self):
                self.closed = False
                created_sessions.append(self)

            async def close(self):
                self.closed = True

        monkeypatch.setattr("app.services.data_processor.aiohttp.ClientSession", RealClientSessionStub)

        await DataProcessor._get_session()
        await DataProcessor.close_session()
        await DataProcessor._get_session()

        assert len(created_sessions) == 2
        assert created_sessions[0].closed is True
