"""
Tests for fvg_engine.py (Phase 4, Order Block Intelligence Engine
build-out, 2026-09-01). Plain-Python-runnable, same convention as the
rest of this build-out (no pytest available in this environment).
"""
import pandas as pd

from app.services.fvg_engine import detect_fvgs, track_fill_status, analyze_fvgs


def _candles(rows):
    df = pd.DataFrame(rows, columns=["open", "high", "low", "close"])
    df["timestamp"] = [f"t{i}" for i in range(len(df))]
    return df


class TestDetectBullishFvg:
    def test_clear_bullish_gap_detected(self):
        rows = [
            (100, 101, 99, 100.5),   # i-1: high=101
            (100.5, 106, 100, 105),  # i: displacement candle
            (105, 108, 103, 106),    # i+1: low=103 > 101 -> bullish gap [101,103]
        ]
        df = _candles(rows)
        fvgs = detect_fvgs(df)
        assert len(fvgs) == 1
        assert fvgs[0].kind == "bullish"
        assert fvgs[0].bottom == 101.0
        assert fvgs[0].top == 103.0
        assert fvgs[0].index == 1

    def test_no_gap_when_next_low_touches_prev_high(self):
        rows = [
            (100, 101, 99, 100.5),
            (100.5, 106, 100, 105),
            (105, 108, 101, 106),    # low=101 == prev high -> NOT > , no gap
        ]
        df = _candles(rows)
        fvgs = detect_fvgs(df)
        assert len(fvgs) == 0


class TestDetectBearishFvg:
    def test_clear_bearish_gap_detected(self):
        rows = [
            (100, 101, 99, 99.5),    # i-1: low=99
            (99.5, 100, 94, 95),     # i: displacement candle down
            (95, 97, 92, 93),        # i+1: high=97 < 99 -> bearish gap [97,99]
        ]
        df = _candles(rows)
        fvgs = detect_fvgs(df)
        assert len(fvgs) == 1
        assert fvgs[0].kind == "bearish"
        assert fvgs[0].bottom == 97.0
        assert fvgs[0].top == 99.0


class TestNoGapCases:
    def test_too_few_candles_returns_empty(self):
        df = _candles([(100, 101, 99, 100), (100, 101, 99, 100)])
        assert detect_fvgs(df) == []

    def test_overlapping_ranges_produce_no_gap(self):
        rows = [
            (100, 105, 95, 102),
            (102, 107, 97, 104),
            (104, 109, 96, 106),   # overlaps candle i-1's range -> no gap either direction
        ]
        df = _candles(rows)
        assert detect_fvgs(df) == []

    def test_nan_in_triplet_is_skipped(self):
        rows = [
            (100, float("nan"), 99, 100.5),
            (100.5, 106, 100, 105),
            (105, 108, 103, 106),
        ]
        df = _candles(rows)
        fvgs = detect_fvgs(df)
        assert len(fvgs) == 0


class TestMinGapPctFilter:
    def test_tiny_gap_filtered_by_min_gap_pct(self):
        rows = [
            (100, 100.01, 99, 100.0),
            (100.0, 100.02, 99.9, 100.01),
            (100.01, 100.05, 100.011, 100.02),  # gap [100.01, 100.011] -- tiny
        ]
        df = _candles(rows)
        fvgs_unfiltered = detect_fvgs(df, min_gap_pct=0.0)
        assert len(fvgs_unfiltered) == 1
        fvgs_filtered = detect_fvgs(df, min_gap_pct=0.01)  # 1% -- way bigger than this gap
        assert len(fvgs_filtered) == 0


class TestFillTrackingBullish:
    def _bullish_gap_df(self, fill_rows):
        rows = [
            (100, 101, 99, 100.5),
            (100.5, 106, 100, 105),
            (105, 108, 103, 106),   # bullish gap [101, 103]
        ]
        rows.extend(fill_rows)
        return _candles(rows)

    def test_open_when_never_touched(self):
        df = self._bullish_gap_df([(106, 110, 105, 108), (108, 112, 107, 110)])
        fvgs = detect_fvgs(df)
        track_fill_status(df, fvgs)
        assert fvgs[0].status == "OPEN"
        assert fvgs[0].first_fill_index is None

    def test_partially_filled_when_low_enters_zone_not_through_bottom(self):
        # zone [101,103]; low=102 enters but doesn't reach bottom=101
        df = self._bullish_gap_df([(106, 107, 102, 103)])
        fvgs = detect_fvgs(df)
        track_fill_status(df, fvgs)
        assert fvgs[0].status == "PARTIALLY_FILLED"
        assert fvgs[0].first_fill_index == 3
        assert fvgs[0].full_fill_index is None

    def test_fully_filled_when_low_reaches_bottom(self):
        df = self._bullish_gap_df([(106, 107, 100, 103)])  # low=100 <= bottom=101
        fvgs = detect_fvgs(df)
        track_fill_status(df, fvgs)
        assert fvgs[0].status == "FILLED"
        assert fvgs[0].first_fill_index == 3
        assert fvgs[0].full_fill_index == 3

    def test_partial_then_full_fill_progression(self):
        df = self._bullish_gap_df([
            (106, 107, 102, 103),   # partial: enters zone at 102
            (103, 104, 100, 101),   # now fully fills: low=100 <= bottom=101
        ])
        fvgs = detect_fvgs(df)
        track_fill_status(df, fvgs)
        assert fvgs[0].status == "FILLED"
        assert fvgs[0].first_fill_index == 3   # first touch, the partial fill
        assert fvgs[0].full_fill_index == 4    # full fill happened later

    def test_defining_candle_i_plus_1_itself_never_counts_as_fill(self):
        # i+1's own low (103) exactly equals the gap's top -- Rule 13: the
        # defining triplet is never a fill candle for its own gap, so this
        # must stay OPEN, not PARTIALLY_FILLED, with no scan starting
        # before index i+2.
        df = self._bullish_gap_df([])
        fvgs = detect_fvgs(df)
        track_fill_status(df, fvgs)
        assert fvgs[0].status == "OPEN"


class TestFillTrackingBearish:
    def _bearish_gap_df(self, fill_rows):
        rows = [
            (100, 101, 99, 99.5),
            (99.5, 100, 94, 95),
            (95, 97, 92, 93),   # bearish gap [97, 99]
        ]
        rows.extend(fill_rows)
        return _candles(rows)

    def test_fully_filled_when_high_reaches_top(self):
        df = self._bearish_gap_df([(93, 99.5, 92, 94)])  # high=99.5 >= top=99
        fvgs = detect_fvgs(df)
        track_fill_status(df, fvgs)
        assert fvgs[0].status == "FILLED"

    def test_partially_filled_when_high_enters_zone_not_through_top(self):
        df = self._bearish_gap_df([(93, 98, 92, 94)])  # high=98 in [97,99], < top
        fvgs = detect_fvgs(df)
        track_fill_status(df, fvgs)
        assert fvgs[0].status == "PARTIALLY_FILLED"


class TestAnalyzeFvgsEntryPoint:
    def test_full_pipeline_runs_end_to_end(self):
        rows = [
            (100, 101, 99, 100.5),
            (100.5, 106, 100, 105),
            (105, 108, 103, 106),
            (106, 107, 100, 103),
        ]
        df = _candles(rows)
        fvgs = analyze_fvgs(df)
        assert len(fvgs) == 1
        assert fvgs[0].status == "FILLED"


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
