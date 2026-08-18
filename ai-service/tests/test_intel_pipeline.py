"""
Integration tests for the pipeline orchestrator: collect -> dedup ->
classify -> score reliability -> cross-reference -> store. The MongoDB
layer (store.py) is replaced with an in-memory fake so this exercises the
real pipeline logic without needing a live database connection.
"""
from datetime import datetime, timezone

import pytest

from app.services.intel import pipeline, store
from app.services.intel.models import RawItem
from app.services.intel.connectors.base import SourceConnector


class FakeConnector(SourceConnector):
    def __init__(self, name, items=None, raises=False):
        self.name = name
        self.source_type = "api"
        self._items = items or []
        self._raises = raises

    async def fetch(self):
        if self._raises:
            raise RuntimeError(f"{self.name} is down")
        return self._items


class InMemoryStore:
    """Fakes the store module's functions against a plain dict/list, so the
    pipeline's own logic (dedup, reliability lookup, cross-reference wiring)
    is exercised for real."""
    def __init__(self):
        self.insights = []
        self.reliability = {}
        self._next_id = 1

    async def find_by_content_hash(self, content_hash):
        return next((i for i in self.insights if i["content_hash"] == content_hash), None)

    async def insert_insight(self, doc):
        doc = dict(doc)
        doc["_id"] = str(self._next_id)
        self._next_id += 1
        self.insights.append(doc)
        return doc["_id"]

    async def get_recent_insights(self, asset=None, hours=48, limit=200):
        if asset:
            return [i for i in self.insights if asset in i.get("related_assets", [])]
        return list(self.insights)

    async def update_related_insights(self, insight_id, related_ids):
        for i in self.insights:
            if i["_id"] == insight_id:
                i["related_insights"] = related_ids

    async def get_source_reliability(self, source):
        return self.reliability.get(source)

    async def upsert_source_reliability(self, source, fields):
        self.reliability.setdefault(source, {}).update(fields)

    async def get_all_source_reliability(self):
        return [{"source": k, **v} for k, v in self.reliability.items()]


@pytest.fixture
def fake_store(monkeypatch):
    fake = InMemoryStore()
    monkeypatch.setattr(store, "find_by_content_hash", fake.find_by_content_hash)
    monkeypatch.setattr(store, "insert_insight", fake.insert_insight)
    monkeypatch.setattr(store, "get_recent_insights", fake.get_recent_insights)
    monkeypatch.setattr(store, "update_related_insights", fake.update_related_insights)
    monkeypatch.setattr(store, "get_source_reliability", fake.get_source_reliability)
    monkeypatch.setattr(store, "upsert_source_reliability", fake.upsert_source_reliability)
    return fake


def raw_item(source, text, reliability_tier="medium", published_at=None):
    return RawItem(
        source=source, source_url=f"https://example.com/{source}", source_type="telegram",
        language="en", text=text, original_text=text,
        published_at=published_at or datetime.now(timezone.utc),
        reliability_tier=reliability_tier,
    )


class TestBuildInsight:
    def test_text_item_produces_a_classified_insight(self):
        item = raw_item("TestSource", "BTC could reach $70,000 by next month")
        insight = pipeline.build_insight(item, source_reliability=0.8)
        assert insight.kind == "prediction"
        assert "BTCUSDT" in insight.related_assets
        assert insight.source_reliability == 0.8

    def test_structured_item_produces_a_fact_insight(self):
        item = RawItem(
            source="CoinGecko", source_url="https://api.coingecko.com/v3/global",
            source_type="api", language="en", text="",
            is_structured_data=True, structured_payload={"btc_dominance": 52.0},
            reliability_tier="official",
        )
        insight = pipeline.build_insight(item, source_reliability=0.95)
        assert insight.kind == "fact"
        assert insight.is_fact is True

    def test_content_summary_is_bounded_and_not_the_full_raw_text(self):
        long_text = "BUY BUY BUY " * 100
        item = raw_item("TestSource", long_text)
        insight = pipeline.build_insight(item, source_reliability=0.8)
        assert len(insight.content_summary) <= pipeline.SUMMARY_MAX_CHARS


class TestRunCycleDuplicateDetection:
    @pytest.mark.asyncio
    async def test_the_same_content_is_not_stored_twice_across_cycles(self, fake_store):
        connector = FakeConnector("A", items=[raw_item("SourceA", "BTC target $70,000")])
        result1 = await pipeline.run_cycle([connector])
        result2 = await pipeline.run_cycle([connector])  # same item fetched again

        assert result1["stored"] == 1
        assert result1["duplicates"] == 0
        assert result2["stored"] == 0
        assert result2["duplicates"] == 1
        assert len(fake_store.insights) == 1  # never double-stored

    @pytest.mark.asyncio
    async def test_different_content_from_the_same_source_is_stored_separately(self, fake_store):
        connector = FakeConnector("A", items=[
            raw_item("SourceA", "BTC target $70,000"),
            raw_item("SourceA", "ETH looking weak today"),
        ])
        result = await pipeline.run_cycle([connector])
        assert result["stored"] == 2


class TestRunCycleFailureIsolation:
    @pytest.mark.asyncio
    async def test_one_failing_connector_does_not_block_the_others(self, fake_store):
        good = FakeConnector("Good", items=[raw_item("SourceA", "BTC target $70,000")])
        bad  = FakeConnector("Bad", raises=True)
        result = await pipeline.run_cycle([good, bad])
        assert result["stored"] == 1
        assert result["by_source"]["Bad"] == 0
        assert result["by_source"]["Good"] == 1

    @pytest.mark.asyncio
    async def test_all_connectors_failing_returns_a_clean_zeroed_summary_not_an_exception(self, fake_store):
        bad1 = FakeConnector("Bad1", raises=True)
        bad2 = FakeConnector("Bad2", raises=True)
        result = await pipeline.run_cycle([bad1, bad2])
        assert result["collected"] == 0
        assert result["stored"] == 0


class TestRunCycleCrossReferencing:
    @pytest.mark.asyncio
    async def test_agreeing_sources_get_linked_as_related_insights(self, fake_store):
        connector = FakeConnector("A", items=[
            raw_item("SourceA", "Buy BTC now, strong setup"),
            raw_item("SourceB", "You should buy BTC here too"),
        ])
        await pipeline.run_cycle([connector])
        # Both insights mention BTC with a BUY direction -- the second one
        # (processed after the first is already stored) should link back to it.
        linked = [i for i in fake_store.insights if i.get("related_insights")]
        assert len(linked) >= 1

    @pytest.mark.asyncio
    async def test_insights_with_no_asset_mention_are_never_cross_referenced(self, fake_store):
        connector = FakeConnector("A", items=[
            raw_item("SourceA", "I think the market looks interesting today"),
        ])
        result = await pipeline.run_cycle([connector])
        assert result["stored"] == 1
        assert fake_store.insights[0].get("related_insights", []) == []


class TestRunCycleUpdatesReliabilityOverTime:
    @pytest.mark.asyncio
    async def test_a_source_that_disagrees_with_consensus_gets_a_lower_score_next_cycle(self, fake_store):
        # Two sources agree BUY on BTC, one (SourceC) disagrees with SELL --
        # its agreement rate should be recorded low, pulling next cycle's
        # reliability computation down from the plain baseline.
        connector = FakeConnector("A", items=[
            raw_item("SourceA", "Buy BTC now", reliability_tier="high"),
            raw_item("SourceB", "You should buy BTC too", reliability_tier="high"),
            raw_item("SourceC", "Sell BTC immediately", reliability_tier="high"),
        ])
        await pipeline.run_cycle([connector])

        assert fake_store.reliability["SourceC"]["agreement_rate"] < 0.5
        assert fake_store.reliability["SourceA"]["agreement_rate"] > 0.5

    @pytest.mark.asyncio
    async def test_reliability_score_used_on_the_next_cycle_reflects_the_update(self, fake_store):
        connector1 = FakeConnector("A", items=[
            raw_item("SourceA", "Buy BTC now"),
            raw_item("SourceB", "Buy BTC too"),
            raw_item("SourceC", "Sell BTC now"),  # disagrees -- will be scored down
        ])
        await pipeline.run_cycle([connector1])
        low_reliability_insight = next(i for i in fake_store.insights if i["source"] == "SourceC")

        # Second cycle, new content from SourceC -- should be stored with a
        # LOWER source_reliability than its plain "medium" baseline would give,
        # because last cycle's disagreement was persisted and is now applied.
        connector2 = FakeConnector("A", items=[raw_item("SourceC", "Buy ETH now")])
        await pipeline.run_cycle([connector2])
        second_insight = next(i for i in fake_store.insights if i["source"] == "SourceC" and i["_id"] != low_reliability_insight["_id"])

        from app.services.intel.reliability import baseline_score
        assert second_insight["source_reliability"] < baseline_score("medium")


class TestRunCycleSummaryNeverLeaksRawContent:
    @pytest.mark.asyncio
    async def test_cycle_summary_contains_only_counts_no_post_text(self, fake_store):
        connector = FakeConnector("A", items=[raw_item("SourceA", "some private-ish trading chatter")])
        result = await pipeline.run_cycle([connector])
        serialized = str(result)
        assert "private-ish trading chatter" not in serialized
        assert set(result.keys()) == {"collected", "stored", "duplicates", "by_source"}
