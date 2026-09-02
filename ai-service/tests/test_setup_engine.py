"""
Tests for setup_engine.py (Phase 9, Order Block Intelligence Engine
build-out, 2026-09-01). Plain-Python-runnable.
"""
from app.services.liquidity_engine import LiquidityPool
from app.services.setup_engine import generate_setup


def _quality(grade="A", completeness=100.0, status="OK"):
    return {"status": status, "grade": grade, "evidence_completeness_pct": completeness,
            "score": 80.0, "reason": None, "breakdown": {}}


class TestStateGate:
    def test_fresh_state_is_wait(self):
        result = generate_setup("bullish", 100.0, 102.0, "FRESH", _quality())
        assert result["verdict"] == "WAIT"
        assert "FRESH" in result["reason"]

    def test_mitigated_state_is_wait(self):
        result = generate_setup("bullish", 100.0, 102.0, "MITIGATED", _quality())
        assert result["verdict"] == "WAIT"

    def test_reacted_state_is_wait(self):
        result = generate_setup("bullish", 100.0, 102.0, "REACTED", _quality())
        assert result["verdict"] == "WAIT"

    def test_invalidated_state_is_wait(self):
        result = generate_setup("bullish", 100.0, 102.0, "INVALIDATED", _quality())
        assert result["verdict"] == "WAIT"

    def test_expired_state_is_wait(self):
        result = generate_setup("bullish", 100.0, 102.0, "EXPIRED", _quality())
        assert result["verdict"] == "WAIT"

    def test_tested_state_is_eligible(self):
        result = generate_setup("bullish", 100.0, 102.0, "TESTED", _quality())
        assert result["verdict"] == "SETUP"

    def test_approaching_state_is_eligible(self):
        result = generate_setup("bullish", 100.0, 102.0, "APPROACHING", _quality())
        assert result["verdict"] == "SETUP"


class TestQualityGate:
    def test_grade_below_minimum_is_wait(self):
        result = generate_setup("bullish", 100.0, 102.0, "TESTED", _quality(grade="C"))
        assert result["verdict"] == "WAIT"
        assert "below the minimum bar" in result["reason"]

    def test_grade_exactly_at_minimum_passes(self):
        result = generate_setup("bullish", 100.0, 102.0, "TESTED", _quality(grade="B"))
        assert result["verdict"] == "SETUP"

    def test_low_completeness_is_wait_even_with_good_grade(self):
        result = generate_setup("bullish", 100.0, 102.0, "TESTED",
                                 _quality(grade="A+", completeness=16.7))
        assert result["verdict"] == "WAIT"
        assert "completeness" in result["reason"]

    def test_insufficient_data_quality_result_is_wait(self):
        result = generate_setup("bullish", 100.0, 102.0, "TESTED", _quality(status="INSUFFICIENT_DATA"))
        assert result["verdict"] == "WAIT"

    def test_none_quality_result_is_wait(self):
        result = generate_setup("bullish", 100.0, 102.0, "TESTED", None)
        assert result["verdict"] == "WAIT"


class TestStopLossConvention:
    def test_bullish_sl_is_half_pct_below_zone_low(self):
        result = generate_setup("bullish", 100.0, 102.0, "TESTED", _quality())
        assert result["stop_loss"] == round(100.0 * 0.995, 6)

    def test_bearish_sl_is_half_pct_above_zone_high(self):
        result = generate_setup("bearish", 100.0, 102.0, "TESTED", _quality())
        assert result["stop_loss"] == round(102.0 * 1.005, 6)


class TestTakeProfitLiquidityVsFallback:
    def test_no_pools_uses_fixed_rr_fallback(self):
        result = generate_setup("bullish", 100.0, 102.0, "TESTED", _quality(), pools=None)
        assert result["tp_method"] == "FIXED_RR_FALLBACK"
        entry = 101.0
        sl = 100.0 * 0.995
        expected_tp = entry + 2.0 * (entry - sl)
        assert result["take_profit"] == round(expected_tp, 6)
        assert result["risk_reward"] == "1:2.0"

    def test_real_resting_pool_above_used_as_liquidity_target(self):
        pools = [
            LiquidityPool(index=5, kind="buy_side", level=110.0, reinforced=False, status="RESTING"),
        ]
        result = generate_setup("bullish", 100.0, 102.0, "TESTED", _quality(), pools=pools)
        assert result["tp_method"] == "LIQUIDITY_TARGET"
        assert result["take_profit"] == 110.0

    def test_nearest_of_multiple_resting_pools_chosen(self):
        pools = [
            LiquidityPool(index=5, kind="buy_side", level=130.0, reinforced=False, status="RESTING"),
            LiquidityPool(index=6, kind="buy_side", level=108.0, reinforced=False, status="RESTING"),
        ]
        result = generate_setup("bullish", 100.0, 102.0, "TESTED", _quality(), pools=pools)
        assert result["take_profit"] == 108.0

    def test_swept_pool_not_used_as_target(self):
        pools = [
            LiquidityPool(index=5, kind="buy_side", level=108.0, reinforced=False, status="SWEPT",
                          interaction_index=8, sweep_classification="CONFIRMED_SWEEP"),
        ]
        result = generate_setup("bullish", 100.0, 102.0, "TESTED", _quality(), pools=pools)
        assert result["tp_method"] == "FIXED_RR_FALLBACK"

    def test_wrong_side_pool_not_used_for_bullish(self):
        pools = [
            LiquidityPool(index=5, kind="sell_side", level=90.0, reinforced=False, status="RESTING"),
        ]
        result = generate_setup("bullish", 100.0, 102.0, "TESTED", _quality(), pools=pools)
        assert result["tp_method"] == "FIXED_RR_FALLBACK"

    def test_liquidity_target_too_close_falls_back_to_fixed_rr(self):
        # entry=101, sl=99.5, risk=1.5, min_acceptable_rr=1.0 -> need reward >= 1.5
        # pool at 101.8 gives reward=0.8 < 1.5 -> RR < 1.0 -> must fall back
        pools = [
            LiquidityPool(index=5, kind="buy_side", level=101.8, reinforced=False, status="RESTING"),
        ]
        result = generate_setup("bullish", 100.0, 102.0, "TESTED", _quality(), pools=pools)
        assert result["tp_method"] == "FIXED_RR_FALLBACK"

    def test_bearish_liquidity_target_below_entry(self):
        pools = [
            LiquidityPool(index=5, kind="sell_side", level=85.0, reinforced=False, status="RESTING"),
        ]
        result = generate_setup("bearish", 100.0, 102.0, "TESTED", _quality(), pools=pools)
        assert result["tp_method"] == "LIQUIDITY_TARGET"
        assert result["take_profit"] == 85.0


class TestRiskRewardIsRealNotHardcoded:
    def test_liquidity_target_gives_a_genuinely_different_rr_than_2(self):
        pools = [
            LiquidityPool(index=5, kind="buy_side", level=104.0, reinforced=False, status="RESTING"),
        ]
        result = generate_setup("bullish", 100.0, 102.0, "TESTED", _quality(), pools=pools)
        # entry=101, sl=99.5, tp=104 -> risk=1.5, reward=3.0 -> RR=2.0... pick a level
        # that actually differs from 2.0 to prove it's computed, not hardcoded:
        pools2 = [
            LiquidityPool(index=5, kind="buy_side", level=105.5, reinforced=False, status="RESTING"),
        ]
        result2 = generate_setup("bullish", 100.0, 102.0, "TESTED", _quality(), pools=pools2)
        assert result2["risk_reward"] != result["risk_reward"]
        assert result2["risk_reward"] == "1:3.0"  # (105.5-101)/1.5 = 3.0


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
