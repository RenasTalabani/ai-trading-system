"""
Tests for quality_engine.py (Phase 7, Order Block Intelligence Engine
build-out, 2026-09-01). Plain-Python-runnable.
"""
from app.services.quality_engine import score_order_block_quality, _grade_for_score


class TestInsufficientData:
    def test_none_strength_is_insufficient_data(self):
        result = score_order_block_quality(strength=None)
        assert result["status"] == "INSUFFICIENT_DATA"
        assert result["score"] is None
        assert result["grade"] is None


class TestGradeThresholds:
    def test_grade_boundaries_exact(self):
        assert _grade_for_score(100) == "A+"
        assert _grade_for_score(90) == "A+"
        assert _grade_for_score(89.99) == "A"
        assert _grade_for_score(70) == "A"
        assert _grade_for_score(69.99) == "B"
        assert _grade_for_score(55) == "B"
        assert _grade_for_score(54.99) == "C"
        assert _grade_for_score(40) == "C"
        assert _grade_for_score(39.99) == "D"
        assert _grade_for_score(25) == "D"
        assert _grade_for_score(24.99) == "F"
        assert _grade_for_score(0) == "F"


class TestScoringMath:
    def test_strength_only_no_other_evidence(self):
        result = score_order_block_quality(strength=50.0)
        assert result["status"] == "OK"
        assert result["score"] == 20.0   # 50 * 0.40
        assert result["evidence_completeness_pct"] == 0.0
        assert result["breakdown"]["strength"] == 20.0

    def test_full_positive_evidence_clamps_at_100(self):
        result = score_order_block_quality(
            strength=100.0, freshness="fresh", structure_aligned_with_bias=True,
            liquidity_sweep_confluence={"kind": "sell_side"}, fvg_confluence=True,
            premium_discount_fit="FAVORABLE", htf_alignment="ALIGNED",
        )
        assert result["score"] == 100.0   # raw 102, clamped
        assert result["grade"] == "A+"
        assert result["evidence_completeness_pct"] == 100.0

    def test_exact_90_score_via_explicit_construction(self):
        # 100*0.4=40 + fresh(10) + aligned(15) + liquidity(15) + fvg True(10) = 90
        result = score_order_block_quality(
            strength=100.0, freshness="fresh", structure_aligned_with_bias=True,
            liquidity_sweep_confluence={"x": 1}, fvg_confluence=True,
        )
        assert result["score"] == 90.0
        assert result["grade"] == "A+"

    def test_full_negative_evidence_clamps_at_0(self):
        result = score_order_block_quality(
            strength=0.0, freshness="mitigated", structure_aligned_with_bias=False,
            liquidity_sweep_confluence=None, fvg_confluence=False,
            premium_discount_fit="UNFAVORABLE", htf_alignment="CONFLICTING",
        )
        assert result["score"] == 0.0
        assert result["grade"] == "F"

    def test_mitigated_freshness_contributes_zero(self):
        result = score_order_block_quality(strength=50.0, freshness="mitigated")
        assert result["breakdown"]["freshness"] == 0
        assert result["evidence_completeness_pct"] == round(1 / 6 * 100, 1)

    def test_structure_conflict_is_penalized_not_neutral(self):
        aligned = score_order_block_quality(strength=50.0, structure_aligned_with_bias=True)
        conflicting = score_order_block_quality(strength=50.0, structure_aligned_with_bias=False)
        neutral = score_order_block_quality(strength=50.0, structure_aligned_with_bias=None)
        assert aligned["score"] > neutral["score"] > conflicting["score"]
        assert conflicting["breakdown"]["structure_alignment"] == -15


class TestAsymmetricEvidenceHandling:
    def test_liquidity_absence_never_counts_as_evaluated(self):
        # Rule 21/23: liquidity_sweep_confluence=None is genuinely
        # ambiguous ("not checked" vs "checked, nothing found") given how
        # Phase 3 produces it -- must NOT count toward completeness.
        result = score_order_block_quality(strength=50.0, liquidity_sweep_confluence=None)
        assert result["breakdown"]["liquidity_confluence"] == 0
        assert result["evidence_completeness_pct"] == 0.0

    def test_fvg_false_does_count_as_evaluated_unlike_liquidity(self):
        # Rule 23: fvg_confluence=False is an unambiguous "checked, none
        # found" (bool, not dict/None) -- DOES count toward completeness,
        # deliberately asymmetric with liquidity above.
        result = score_order_block_quality(strength=50.0, fvg_confluence=False)
        assert result["breakdown"]["fvg_confluence"] == 0
        assert result["evidence_completeness_pct"] == round(1 / 6 * 100, 1)

    def test_premium_discount_equilibrium_counts_as_evaluated_with_zero_points(self):
        result = score_order_block_quality(strength=50.0, premium_discount_fit="EQUILIBRIUM")
        assert result["breakdown"]["premium_discount_fit"] == 0
        assert result["evidence_completeness_pct"] == round(1 / 6 * 100, 1)

    def test_htf_unknown_and_not_applicable_do_not_count_as_evaluated(self):
        unknown = score_order_block_quality(strength=50.0, htf_alignment="UNKNOWN")
        na = score_order_block_quality(strength=50.0, htf_alignment="NOT_APPLICABLE")
        assert unknown["evidence_completeness_pct"] == 0.0
        assert na["evidence_completeness_pct"] == 0.0

    def test_htf_conflicting_penalized_more_than_aligned_bonus(self):
        aligned = score_order_block_quality(strength=50.0, htf_alignment="ALIGNED")
        conflicting = score_order_block_quality(strength=50.0, htf_alignment="CONFLICTING")
        assert aligned["breakdown"]["htf_alignment"] == 10
        assert conflicting["breakdown"]["htf_alignment"] == -15
        assert abs(conflicting["breakdown"]["htf_alignment"]) > aligned["breakdown"]["htf_alignment"]


class TestEvidenceCompleteness:
    def test_all_six_dimensions_evaluated_is_100_pct(self):
        result = score_order_block_quality(
            strength=50.0, freshness="fresh", structure_aligned_with_bias=True,
            liquidity_sweep_confluence={"x": 1}, fvg_confluence=False,
            premium_discount_fit="EQUILIBRIUM", htf_alignment="ALIGNED",
        )
        assert result["evidence_completeness_pct"] == 100.0

    def test_zero_optional_dimensions_is_0_pct(self):
        result = score_order_block_quality(strength=50.0)
        assert result["evidence_completeness_pct"] == 0.0


if __name__ == "__main__":
    import inspect
    import sys

    classes = [obj for name, obj in list(globals().items())
               if inspect.isclass(obj) and name.startswith("Test")]
    total = 0
    failed = 0
    for cls in classes:
        instance = cls()
        for name, method in inspect.getmembers(instance, predicate=inspect.ismethod):
            if not name.startswith("test_"):
                continue
            total += 1
            try:
                method()
                print(f"PASS  {cls.__name__}.{name}")
            except AssertionError as e:
                failed += 1
                print(f"FAIL  {cls.__name__}.{name}: {e}")
            except Exception as e:
                failed += 1
                print(f"ERROR {cls.__name__}.{name}: {type(e).__name__}: {e}")

    print(f"\n{total - failed}/{total} passed, {failed} failed")
    sys.exit(1 if failed else 0)
