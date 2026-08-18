"""
Tests for cross-source agreement/conflict detection. Per instruction, this
never judges a claim "true" just because multiple sources repeated it --
it only records the agreement/conflict relationship.
"""
from app.services.intel.cross_reference import find_agreements_and_conflicts, source_agreement_rate


def insight(id_, source, direction=None, assets=None):
    return {"_id": id_, "source": source, "direction": direction, "related_assets": assets or []}


class TestFindAgreementsAndConflicts:
    def test_no_direction_on_target_returns_no_comparison(self):
        target = {"direction": None, "related_assets": ["BTCUSDT"]}
        candidates = [insight("a", "SourceA", "BUY", ["BTCUSDT"])]
        result = find_agreements_and_conflicts(target, candidates)
        assert result["agree_with"] == []
        assert result["conflict_with"] == []
        assert result["agreement_rate"] is None

    def test_no_directional_candidates_returns_no_comparison(self):
        target = {"direction": "BUY", "related_assets": ["BTCUSDT"]}
        candidates = [insight("a", "SourceA", None, ["BTCUSDT"])]
        result = find_agreements_and_conflicts(target, candidates)
        assert result["agreement_rate"] is None

    def test_matching_direction_is_an_agreement(self):
        target = {"direction": "BUY", "related_assets": ["BTCUSDT"]}
        candidates = [insight("a", "SourceA", "BUY", ["BTCUSDT"])]
        result = find_agreements_and_conflicts(target, candidates)
        assert "a" in result["agree_with"]
        assert result["conflict_with"] == []

    def test_opposing_direction_is_a_conflict(self):
        target = {"direction": "BUY", "related_assets": ["BTCUSDT"]}
        candidates = [insight("a", "SourceA", "SELL", ["BTCUSDT"])]
        result = find_agreements_and_conflicts(target, candidates)
        assert "a" in result["conflict_with"]
        assert result["agree_with"] == []

    def test_mixed_agreement_and_conflict_computes_correct_rate(self):
        target = {"direction": "BUY", "related_assets": ["BTCUSDT"]}
        candidates = [
            insight("a", "SourceA", "BUY", ["BTCUSDT"]),
            insight("b", "SourceB", "BUY", ["BTCUSDT"]),
            insight("c", "SourceC", "SELL", ["BTCUSDT"]),
        ]
        result = find_agreements_and_conflicts(target, candidates)
        assert set(result["agree_with"]) == {"a", "b"}
        assert result["conflict_with"] == ["c"]
        assert result["agreement_rate"] == round(2 / 3, 3)


class TestSourceAgreementRate:
    def test_source_with_no_directional_calls_returns_none(self):
        insights = [insight("a", "SourceA", None, ["BTCUSDT"])]
        assert source_agreement_rate("SourceA", insights) is None

    def test_no_other_sources_to_compare_against_returns_none(self):
        insights = [insight("a", "SourceA", "BUY", ["BTCUSDT"])]
        assert source_agreement_rate("SourceA", insights) is None

    def test_source_agreeing_with_majority_scores_high(self):
        insights = [
            insight("a", "SourceA", "BUY", ["BTCUSDT"]),
            insight("b", "SourceB", "BUY", ["BTCUSDT"]),
            insight("c", "SourceC", "BUY", ["BTCUSDT"]),
        ]
        rate = source_agreement_rate("SourceA", insights)
        assert rate == 1.0

    def test_source_conflicting_with_majority_scores_low(self):
        insights = [
            insight("a", "SourceA", "SELL", ["BTCUSDT"]),
            insight("b", "SourceB", "BUY", ["BTCUSDT"]),
            insight("c", "SourceC", "BUY", ["BTCUSDT"]),
        ]
        rate = source_agreement_rate("SourceA", insights)
        assert rate == 0.0

    def test_unrelated_asset_insights_are_not_compared(self):
        insights = [
            insight("a", "SourceA", "BUY", ["BTCUSDT"]),
            insight("b", "SourceB", "SELL", ["ETHUSDT"]),  # different asset -- irrelevant
        ]
        rate = source_agreement_rate("SourceA", insights)
        assert rate is None  # no other source active on the same asset
