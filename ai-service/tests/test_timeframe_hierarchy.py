"""
Tests for timeframe_hierarchy.py (Phase 6, Order Block Intelligence
Engine build-out, 2026-09-01). Plain-Python-runnable.
"""
from app.services.timeframe_hierarchy import (
    TIMEFRAME_ORDER, higher_timeframes_of, check_htf_alignment,
)


class TestHigherTimeframesOf:
    def test_15m_has_three_higher_timeframes(self):
        assert higher_timeframes_of("15m") == ["1h", "4h", "1d"]

    def test_1h_has_two_higher_timeframes(self):
        assert higher_timeframes_of("1h") == ["4h", "1d"]

    def test_4h_has_one_higher_timeframe(self):
        assert higher_timeframes_of("4h") == ["1d"]

    def test_1d_has_no_higher_timeframe(self):
        assert higher_timeframes_of("1d") == []

    def test_unrecognized_timeframe_returns_empty_not_a_guess(self):
        assert higher_timeframes_of("7d") == []          # multi_timeframe_analyzer.py's
        assert higher_timeframes_of("1w") == []           # concept -- deliberately not real here
        assert higher_timeframes_of("bogus") == []

    def test_order_is_exactly_the_real_ob_engine_timeframes(self):
        assert TIMEFRAME_ORDER == ["15m", "1h", "4h", "1d"]


class TestCheckHtfAlignment:
    def test_current_bias_unknown_is_not_applicable(self):
        result = check_htf_alignment("1h", "UNKNOWN", {"4h": "BULLISH", "1d": "BULLISH"})
        assert result["htf_alignment"] == "NOT_APPLICABLE"

    def test_no_htf_data_supplied_is_unknown(self):
        result = check_htf_alignment("1h", "BULLISH", {})
        assert result["htf_alignment"] == "UNKNOWN"
        assert result["aligned_htfs"] == []

    def test_all_higher_timeframes_agree_is_aligned(self):
        result = check_htf_alignment("1h", "BULLISH", {"4h": "BULLISH", "1d": "BULLISH"})
        assert result["htf_alignment"] == "ALIGNED"
        assert set(result["aligned_htfs"]) == {"4h", "1d"}
        assert result["conflicting_htfs"] == []

    def test_one_higher_timeframe_disagrees_is_conflicting_even_if_another_agrees(self):
        result = check_htf_alignment("1h", "BULLISH", {"4h": "BEARISH", "1d": "BULLISH"})
        assert result["htf_alignment"] == "CONFLICTING"
        assert result["conflicting_htfs"] == ["4h"]
        assert result["aligned_htfs"] == ["1d"]

    def test_all_higher_timeframes_unknown_is_unknown_not_aligned(self):
        result = check_htf_alignment("1h", "BULLISH", {"4h": "UNKNOWN", "1d": "UNKNOWN"})
        assert result["htf_alignment"] == "UNKNOWN"
        assert result["unknown_htfs"] == ["4h", "1d"]

    def test_lower_timeframe_data_is_ignored_never_checked(self):
        # "15m" is LOWER than "1h" -- must be ignored even if supplied.
        result = check_htf_alignment("1h", "BULLISH", {"15m": "BEARISH", "4h": "BULLISH"})
        assert result["htf_alignment"] == "ALIGNED"
        assert "15m" not in result["aligned_htfs"]
        assert "15m" not in result["conflicting_htfs"]
        assert "15m" not in result["unknown_htfs"]

    def test_1d_has_nothing_higher_always_unknown_regardless_of_data(self):
        result = check_htf_alignment("1d", "BULLISH", {"4h": "BULLISH"})  # 4h is lower than 1d
        assert result["htf_alignment"] == "UNKNOWN"

    def test_bearish_current_bias_checked_symmetrically(self):
        result = check_htf_alignment("4h", "BEARISH", {"1d": "BEARISH"})
        assert result["htf_alignment"] == "ALIGNED"
        result2 = check_htf_alignment("4h", "BEARISH", {"1d": "BULLISH"})
        assert result2["htf_alignment"] == "CONFLICTING"


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
