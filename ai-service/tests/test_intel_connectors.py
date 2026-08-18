"""
Tests for the source connectors. Each wraps an already-tested underlying
service (telegram_collector.py, macro_data_service.py) -- these tests focus
on the adapter logic (RawItem shape, reliability tier mapping) and on
failure handling (a connector must return [] on error, never raise, so one
broken source can't take down a whole collection cycle).
"""
from datetime import datetime, timezone
from unittest.mock import AsyncMock

import pytest

from app.services.intel.connectors.telegram_source import TelegramSourceConnector
from app.services.intel.connectors.coingecko_source import CoinGeckoSourceConnector
from app.services.intel.connectors.fred_source import FredSourceConnector


class _FakeTelegramPost:
    def __init__(self, channel, content, original_content, language):
        self.channel = channel
        self.content = content
        self.original_content = original_content
        self.language = language
        self.published_at = datetime.now(timezone.utc)


class TestTelegramSourceConnector:
    @pytest.mark.asyncio
    async def test_maps_posts_to_raw_items_with_correct_reliability_tier(self, monkeypatch):
        fake_posts = [
            _FakeTelegramPost("@KurdishFinancial", "translated text", "original text", "ku"),
        ]
        monkeypatch.setattr(
            "app.services.intel.connectors.telegram_source.collect_telegram_posts",
            AsyncMock(return_value=fake_posts),
        )
        connector = TelegramSourceConnector()
        items = await connector.fetch()
        assert len(items) == 1
        assert items[0].source == "@KurdishFinancial"
        assert items[0].text == "translated text"
        assert items[0].original_text == "original text"
        assert items[0].reliability_tier == "high"  # per TELEGRAM_CHANNELS config

    @pytest.mark.asyncio
    async def test_unknown_channel_falls_back_to_medium_reliability(self, monkeypatch):
        fake_posts = [_FakeTelegramPost("@SomeUnconfiguredChannel", "text", "text", "en")]
        monkeypatch.setattr(
            "app.services.intel.connectors.telegram_source.collect_telegram_posts",
            AsyncMock(return_value=fake_posts),
        )
        connector = TelegramSourceConnector()
        items = await connector.fetch()
        assert items[0].reliability_tier == "medium"

    @pytest.mark.asyncio
    async def test_collector_failure_returns_empty_list_not_an_exception(self, monkeypatch):
        monkeypatch.setattr(
            "app.services.intel.connectors.telegram_source.collect_telegram_posts",
            AsyncMock(side_effect=RuntimeError("network down")),
        )
        connector = TelegramSourceConnector()
        items = await connector.fetch()
        assert items == []


class TestCoinGeckoSourceConnector:
    @pytest.mark.asyncio
    async def test_returns_structured_items_for_global_and_trending(self):
        fake_macro = AsyncMock()
        fake_macro.get_global_crypto = AsyncMock(return_value={"btc_dominance": 52.0})
        fake_macro.get_trending_coins = AsyncMock(return_value={"coins": [{"symbol": "PENGU"}]})

        connector = CoinGeckoSourceConnector(fake_macro)
        items = await connector.fetch()

        assert len(items) == 2
        assert all(i.is_structured_data for i in items)
        assert all(i.reliability_tier == "official" for i in items)

    @pytest.mark.asyncio
    async def test_empty_upstream_data_yields_no_items(self):
        fake_macro = AsyncMock()
        fake_macro.get_global_crypto = AsyncMock(return_value={})
        fake_macro.get_trending_coins = AsyncMock(return_value={"coins": []})

        connector = CoinGeckoSourceConnector(fake_macro)
        items = await connector.fetch()
        assert items == []

    @pytest.mark.asyncio
    async def test_one_failing_call_does_not_prevent_the_other_from_returning(self):
        fake_macro = AsyncMock()
        fake_macro.get_global_crypto = AsyncMock(side_effect=RuntimeError("timeout"))
        fake_macro.get_trending_coins = AsyncMock(return_value={"coins": [{"symbol": "PENGU"}]})

        connector = CoinGeckoSourceConnector(fake_macro)
        items = await connector.fetch()
        assert len(items) == 1  # trending still came through despite global failing


class TestFredSourceConnector:
    @pytest.mark.asyncio
    async def test_returns_no_items_when_no_api_key_configured(self):
        # macro_data_service.get_fed_snapshot() already no-ops to empty dicts
        # per key when FRED_API_KEY isn't set -- the connector must reflect that.
        fake_macro = AsyncMock()
        fake_macro.get_fed_snapshot = AsyncMock(return_value={"fed_funds_rate": {}, "cpi": {}})

        connector = FredSourceConnector(fake_macro)
        items = await connector.fetch()
        assert items == []

    @pytest.mark.asyncio
    async def test_returns_items_when_data_is_present(self):
        fake_macro = AsyncMock()
        fake_macro.get_fed_snapshot = AsyncMock(return_value={
            "fed_funds_rate": {"series_id": "FEDFUNDS", "value": "5.33", "date": "2026-07-01"},
            "cpi": {},
        })

        connector = FredSourceConnector(fake_macro)
        items = await connector.fetch()
        assert len(items) == 1
        assert items[0].reliability_tier == "official"

    @pytest.mark.asyncio
    async def test_fetch_failure_returns_empty_list(self):
        fake_macro = AsyncMock()
        fake_macro.get_fed_snapshot = AsyncMock(side_effect=RuntimeError("connection reset"))

        connector = FredSourceConnector(fake_macro)
        items = await connector.fetch()
        assert items == []
