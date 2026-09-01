"""
Tests for premium_discount_engine.py (Phase 5, Order Block Intelligence
Engine build-out, 2026-09-01). Plain-Python-runnable, same convention as
the rest of this build-out.
"""
from app.services.market_structure_engine import SwingPoint
from app.services.premium_discount_engine import (
    compute_dealing_range, classify_price_in_range, analyze_premium_discount,
    DealingRange,
)


def _swing(index, kind, price):
    return SwingPoint(index=index, kind=kind, price=price, timestamp=f"t{index}")


class TestComputeDealingRange:
    def test_uses_most_recent_high_and_low(self):
        swings = [
            _swing(0, "high", 110.0),
            _swing(2, "low", 95.0),
            _swing(5, "high", 115.0),   # most recent high
            _swing(8, "low", 100.0),    # most recent low
        ]
        r = compute_dealing_range(swings)
        assert r.range_high == 115.0
        assert r.range_low == 100.0
        assert r.high_swing_index == 5
        assert r.low_swing_index == 8

    def test_no_highs_returns_none(self):
        swings = [_swing(0, "low", 95.0), _swing(2, "low", 100.0)]
        assert compute_dealing_range(swings) is None

    def test_no_lows_returns_none(self):
        swings = [_swing(0, "high", 110.0)]
        assert compute_dealing_range(swings) is None

    def test_empty_swings_returns_none(self):
        assert compute_dealing_range([]) is None

    def test_inverted_range_returns_none(self):
        # most recent high (100) is below most recent low (105) -- degenerate
        swings = [_swing(0, "high", 100.0), _swing(1, "low", 105.0)]
        assert compute_dealing_range(swings) is None


class TestClassifyPriceInRange:
    def _range(self):
        return DealingRange(range_high=110.0, range_low=100.0, high_swing_index=5, low_swing_index=3)

    def test_price_at_top_is_premium(self):
        result = classify_price_in_range(109.0, self._range())
        assert result["zone"] == "PREMIUM"
        assert not result["outside_range"]

    def test_price_at_bottom_is_discount(self):
        result = classify_price_in_range(101.0, self._range())
        assert result["zone"] == "DISCOUNT"

    def test_price_at_exact_midpoint_is_equilibrium(self):
        result = classify_price_in_range(105.0, self._range())
        assert result["zone"] == "EQUILIBRIUM"
        assert result["position_pct"] == 0.5

    def test_price_just_above_midpoint_within_tolerance_is_equilibrium(self):
        # eq_tolerance_pct default 0.05 -> band [0.45, 0.55] of range width
        # 105.3 -> position_pct = 0.53, still within tolerance
        result = classify_price_in_range(105.3, self._range())
        assert result["zone"] == "EQUILIBRIUM"

    def test_price_beyond_tolerance_above_midpoint_is_premium(self):
        # 106.0 -> position_pct = 0.6, beyond 0.55
        result = classify_price_in_range(106.0, self._range())
        assert result["zone"] == "PREMIUM"

    def test_price_above_range_high_is_outside_range_and_extreme_premium(self):
        result = classify_price_in_range(120.0, self._range())
        assert result["zone"] == "PREMIUM"
        assert result["outside_range"] is True
        assert result["position_pct"] > 1.0

    def test_price_below_range_low_is_outside_range_and_extreme_discount(self):
        result = classify_price_in_range(90.0, self._range())
        assert result["zone"] == "DISCOUNT"
        assert result["outside_range"] is True
        assert result["position_pct"] < 0.0

    def test_custom_tolerance_narrows_equilibrium_band(self):
        # with eq_tolerance_pct=0.0, only the exact midpoint is equilibrium
        result = classify_price_in_range(105.3, self._range(), eq_tolerance_pct=0.0)
        assert result["zone"] == "PREMIUM"


class TestAnalyzePremiumDiscountEntryPoint:
    def test_full_pipeline_ok_case(self):
        swings = [_swing(0, "high", 110.0), _swing(1, "low", 100.0)]
        result = analyze_premium_discount(swings, price=108.0)
        assert result["status"] == "OK"
        assert result["zone"] == "PREMIUM"
        assert result["dealing_range"]["range_high"] == 110.0

    def test_insufficient_data_when_no_range(self):
        result = analyze_premium_discount([], price=100.0)
        assert result["status"] == "INSUFFICIENT_DATA"
        assert result["zone"] is None

    def test_insufficient_data_on_nan_price(self):
        swings = [_swing(0, "high", 110.0), _swing(1, "low", 100.0)]
        result = analyze_premium_discount(swings, price=float("nan"))
        assert result["status"] == "INSUFFICIENT_DATA"
        assert "Invalid price" in result["reason"]

    def test_insufficient_data_on_bad_price_type(self):
        swings = [_swing(0, "high", 110.0), _swing(1, "low", 100.0)]
        result = analyze_premium_discount(swings, price="not a number")
        assert result["status"] == "INSUFFICIENT_DATA"


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
