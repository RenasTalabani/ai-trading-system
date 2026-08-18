"""
Pipeline orchestrator: collect -> dedup -> classify -> score reliability ->
cross-reference -> store. This is the only place that wires the pieces
together; connectors, classifier, reliability, and cross_reference are all
independently testable in isolation.

Per instruction, this never surfaces raw content anywhere -- run_cycle()
returns a small numeric summary (collected/stored/duplicates/by_source),
suitable for a log line, not a message. The actual knowledge lives in
MongoDB (market_insights), queried later through the intel API.
"""
import hashlib
import logging
from datetime import datetime, timezone
from typing import List

from app.services.intel import store, classifier
from app.services.intel.connectors.base import SourceConnector
from app.services.intel.models import Insight, RawItem
from app.services.intel.reliability import compute_reliability
from app.services.intel.cross_reference import find_agreements_and_conflicts, source_agreement_rate

logger = logging.getLogger("ai-service.intel.pipeline")

SUMMARY_MAX_CHARS = 300


def content_hash(source: str, text: str, structured_payload: dict | None) -> str:
    basis = f"{source}:{text}" if text else f"{source}:{structured_payload}"
    return hashlib.sha256(basis.encode("utf-8", errors="ignore")).hexdigest()


def _summarize(item: RawItem) -> str:
    if item.is_structured_data:
        return f"{item.source} data: " + ", ".join(f"{k}={v}" for k, v in (item.structured_payload or {}).items())[:SUMMARY_MAX_CHARS]
    return item.text[:SUMMARY_MAX_CHARS]


def _market_relevance(classification: dict, item: RawItem) -> float:
    if item.is_structured_data:
        return 0.7  # macro data is generically relevant, not asset-specific
    if classification["related_assets"]:
        return 0.9 if classification["is_signal"] else 0.7
    return 0.3  # no asset mentioned, no clear trading relevance


def build_insight(item: RawItem, source_reliability: float) -> Insight:
    if item.is_structured_data:
        classification = classifier.classify_structured_data(item.structured_payload or {})
    else:
        classification = classifier.classify_text(item.text)

    return Insight(
        source=item.source,
        source_url=item.source_url,
        source_type=item.source_type,
        timestamp=item.published_at or datetime.now(timezone.utc),
        collected_at=item.collected_at,
        language=item.language,
        category=classification["category"],
        kind=classification["kind"],
        is_fact=classification["is_fact"],
        is_opinion=classification["is_opinion"],
        is_prediction=classification["is_prediction"],
        is_signal=classification["is_signal"],
        content_summary=_summarize(item),
        market_relevance=_market_relevance(classification, item),
        confidence=classification["confidence"],
        source_reliability=source_reliability,
        related_assets=classification["related_assets"],
        direction=classification["direction"],
        price_targets=classification["price_targets"],
        is_promotional=False,  # promotional content is already filtered out before reaching the pipeline
        content_hash=content_hash(item.source, item.text, item.structured_payload),
    )


async def _cross_reference_and_link(insight_id: str, insight: Insight):
    for asset in insight.related_assets:
        recent = await store.get_recent_insights(asset=asset)
        recent = [r for r in recent if str(r.get("_id")) != insight_id]
        target = {"direction": insight.direction, "related_assets": insight.related_assets}
        result = find_agreements_and_conflicts(target, recent)
        related_ids = [str(i) for i in (result["agree_with"] + result["conflict_with"])]
        if related_ids:
            await store.update_related_insights(insight_id, related_ids)


async def run_cycle(connectors: List[SourceConnector]) -> dict:
    """Runs one full collection+processing cycle across all connectors."""
    all_items: List[RawItem] = []
    per_source_counts: dict = {}

    for connector in connectors:
        try:
            items = await connector.fetch()
        except Exception as e:
            logger.warning(f"Connector {getattr(connector, 'name', '?')} failed: {e}")
            items = []
        all_items.extend(items)
        per_source_counts[connector.name] = len(items)

    stored = 0
    duplicates = 0

    for item in all_items:
        c_hash = content_hash(item.source, item.text, item.structured_payload)
        existing = await store.find_by_content_hash(c_hash)
        if existing:
            duplicates += 1
            continue

        reliability_doc = await store.get_source_reliability(item.source)
        promotional_ratio = (reliability_doc or {}).get("promotional_ratio", 0.0)
        agreement_rate = (reliability_doc or {}).get("agreement_rate")
        reliability = compute_reliability(item.reliability_tier, promotional_ratio, agreement_rate)

        insight = build_insight(item, reliability)
        insight_id = await store.insert_insight(insight.to_doc())
        if insight_id is None:
            continue  # DB unavailable -- already logged by store, just skip

        stored += 1
        if insight.related_assets and insight.direction:
            await _cross_reference_and_link(insight_id, insight)

    # Reliability is a running score, not a one-shot calculation -- after
    # storing this cycle's insights, recompute each active source's
    # agreement rate against the current cross-source consensus and persist
    # it, so the NEXT cycle's compute_reliability() call reflects it. This
    # is the "updated over time" half of the reliability requirement; the
    # promotional_ratio half is currently always 0 because promotional
    # content is filtered out before it ever becomes an insight (see
    # telegram_collector.py) -- there's nothing left to penalize by the
    # time content reaches this layer, which is a stronger guarantee than
    # scoring it down after the fact.
    sources_this_cycle = {item.source for item in all_items}
    if sources_this_cycle:
        recent_all = await store.get_recent_insights()
        for source in sources_this_cycle:
            rate = source_agreement_rate(source, recent_all)
            if rate is not None:
                await store.upsert_source_reliability(source, {"agreement_rate": rate})

    logger.info(
        f"[Intel] Cycle complete — collected {len(all_items)}, stored {stored}, "
        f"duplicates {duplicates}, by source: {per_source_counts}"
    )
    return {
        "collected": len(all_items),
        "stored": stored,
        "duplicates": duplicates,
        "by_source": per_source_counts,
    }
