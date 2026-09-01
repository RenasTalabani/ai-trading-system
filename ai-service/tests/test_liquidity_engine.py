"""
Tests for liquidity_engine.py (Phase 2, Order Block Intelligence Engine
build-out, 2026-09-01).

Written in pytest style (matches this project's convention) with a plain-
Python fallback runner in __main__, same pattern as
test_market_structure_engine.py -- this sandbox has no pytest/network
access to install it, so every assertion here is also genuinely executed
as a plain script.

Covers the specific distinctions Phase 2's spec requires:
  - a genuine wick sweep that holds (CONFIRMED_SWEEP)
  - a close-through break (BROKEN, not a sweep)
  - a failed sweep (wick, then a close-through shortly after)
  - an ambiguous case (insufficient trailing candles to confirm/fail)
  - a reinforced pool (EQH/EQL from Phase 1)
  - pool density near a price
  - session_high_low() explicit-window behavior (in/out of range)
"""
import pandas as pd

from app.services.market_structure_engine import SwingPoint
from app.services.liquidity_engine import (
    build_pools, detect_sweeps, resting_pool_density, session_high_low,
    analyze_liquidity, LiquidityPool,
)


def _candles(rows):
    df = pd.DataFrame(rows, columns=["open", "high", "low", "close"])
    df["timestamp"] = [f"t{i}" for i in range(len(df))]
    return df


def _swing(index, kind, price, label="HH"):
    return SwingPoint(index=index, kind=kind, price=price, timestamp=f"t{index}", label=label)


class TestBuildPools:
    def test_high_swing_is_buy_side_low_swing_is_sell_side(self):
        swings = [_swing(2, "high", 110.0, "HH"), _swing(5, "low", 95.0, "HL")]
        pools = build_pools(swings)
        assert pools[0].kind == "buy_side"
        assert pools[0].level == 110.0
        assert pools[1].kind == "sell_side"
        assert pools[1].level == 95.0

    def test_eqh_eql_marks_reinforced(self):
        swings = [_swing(2, "high", 110.0, "EQH"), _swing(5, "low", 95.0, "EQL"),
                   _swing(8, "high", 111.0, "HH")]
        pools = build_pools(swings)
        assert pools[0].reinforced is True
        assert pools[1].reinforced is True
        assert pools[2].reinforced is False

    def test_all_pools_start_resting(self):
        swings = [_swing(2, "high", 110.0, "HH")]
        pools = build_pools(swings)
        assert pools[0].status == "RESTING"
        assert pools[0].interaction_index is None
        assert pools[0].sweep_classification is None


class TestCloseThroughBreak:
    def test_buy_side_pool_broken_by_close_beyond_level(self):
        # Swing high at 110 (index 0). Later candle closes above 110 -> BROKEN.
        rows = [
            (100, 110.2, 99, 100),   # 0: the swing high candle itself (level=110)
            (100, 100.5, 99.5, 100), # 1
            (100, 112, 99.5, 111.5), # 2: closes through 110 -> BROKEN, not a sweep
        ]
        df = _candles(rows)
        pools = build_pools([_swing(0, "high", 110.0, "HH")])
        detect_sweeps(df, pools)
        assert pools[0].status == "BROKEN"
        assert pools[0].interaction_index == 2
        assert pools[0].sweep_classification is None

    def test_sell_side_pool_broken_by_close_beyond_level(self):
        rows = [
            (100, 101, 89.8, 100),
            (100, 100.5, 99.5, 100),
            (100, 100.5, 88, 88.5),  # closes below 90 -> BROKEN
        ]
        df = _candles(rows)
        pools = build_pools([_swing(0, "low", 90.0, "LL")])
        detect_sweeps(df, pools)
        assert pools[0].status == "BROKEN"


class TestConfirmedSweep:
    def test_wick_beyond_level_that_holds_is_confirmed_sweep(self):
        # Swing high at 110. A candle wicks to 112 but closes back under 110.
        # confirm_window candles after it never close beyond 110 -> CONFIRMED_SWEEP.
        rows = [
            (100, 110.2, 99, 100),    # 0: swing high, level 110
            (100, 100.5, 99.5, 100),  # 1
            (105, 112, 104, 106),     # 2: wick above 110, closes at 106 (back under)
            (106, 106.5, 105.5, 106), # 3: confirm window candle 1, closes under 110
            (106, 106.5, 105.5, 106), # 4: confirm window candle 2
            (106, 106.5, 105.5, 106), # 5: confirm window candle 3 -- window complete
        ]
        df = _candles(rows)
        pools = build_pools([_swing(0, "high", 110.0, "HH")])
        detect_sweeps(df, pools, confirm_window=3)
        assert pools[0].status == "SWEPT"
        assert pools[0].interaction_index == 2
        assert pools[0].sweep_classification == "CONFIRMED_SWEEP"

    def test_sell_side_confirmed_sweep(self):
        rows = [
            (100, 101, 89.8, 100),     # 0: swing low, level 90
            (100, 100.5, 99.5, 100),   # 1
            (95, 96, 88, 94),          # 2: wick below 90, closes at 94 (back above)
            (94, 94.5, 93.5, 94),      # 3
            (94, 94.5, 93.5, 94),      # 4
            (94, 94.5, 93.5, 94),      # 5
        ]
        df = _candles(rows)
        pools = build_pools([_swing(0, "low", 90.0, "LL")])
        detect_sweeps(df, pools, confirm_window=3)
        assert pools[0].status == "SWEPT"
        assert pools[0].sweep_classification == "CONFIRMED_SWEEP"


class TestFailedSweep:
    def test_wick_then_close_through_within_window_is_failed_sweep(self):
        # Wick above 110 at index 2 (closes back under), but index 4 (within
        # the 3-candle confirm window) CLOSES beyond 110 -> FAILED_SWEEP.
        rows = [
            (100, 110.2, 99, 100),     # 0: swing high, level 110
            (100, 100.5, 99.5, 100),   # 1
            (105, 112, 104, 106),      # 2: wick above 110, closes back at 106
            (106, 108, 105, 107),      # 3: confirm window candle 1, still under
            (107, 115, 106, 113),      # 4: confirm window candle 2, CLOSES above 110
            (113, 114, 112, 113.5),    # 5: confirm window candle 3
        ]
        df = _candles(rows)
        pools = build_pools([_swing(0, "high", 110.0, "HH")])
        detect_sweeps(df, pools, confirm_window=3)
        assert pools[0].status == "SWEPT"
        assert pools[0].sweep_classification == "FAILED_SWEEP"


class TestAmbiguous:
    def test_wick_near_end_of_data_with_no_confirm_window_is_ambiguous(self):
        # Wick above 110 at the very last candle -- zero trailing candles to
        # confirm or fail against. Must return AMBIGUOUS, not guess.
        rows = [
            (100, 110.2, 99, 100),    # 0: swing high, level 110
            (100, 100.5, 99.5, 100),  # 1
            (105, 112, 104, 106),     # 2: wick above 110, closes back at 106 -- last candle
        ]
        df = _candles(rows)
        pools = build_pools([_swing(0, "high", 110.0, "HH")])
        detect_sweeps(df, pools, confirm_window=3)
        assert pools[0].status == "SWEPT"
        assert pools[0].sweep_classification == "AMBIGUOUS"

    def test_partial_confirm_window_still_ambiguous_if_no_close_through(self):
        # Only 1 of 3 needed confirm candles exist after the wick, and none
        # of them close through -- still AMBIGUOUS (not enough evidence for
        # CONFIRMED), not a guessed CONFIRMED_SWEEP.
        rows = [
            (100, 110.2, 99, 100),
            (100, 100.5, 99.5, 100),
            (105, 112, 104, 106),     # 2: wick
            (106, 106.5, 105.5, 106), # 3: only one trailing candle, no close-through
        ]
        df = _candles(rows)
        pools = build_pools([_swing(0, "high", 110.0, "HH")])
        detect_sweeps(df, pools, confirm_window=3)
        assert pools[0].sweep_classification == "AMBIGUOUS"


class TestNoInteraction:
    def test_pool_stays_resting_if_never_touched(self):
        rows = [
            (100, 110.2, 99, 100),
            (100, 101, 99.5, 100),
            (100, 101, 99.5, 100),
        ]
        df = _candles(rows)
        pools = build_pools([_swing(0, "high", 110.0, "HH")])
        detect_sweeps(df, pools)
        assert pools[0].status == "RESTING"
        assert pools[0].interaction_index is None


class TestPoolDensity:
    def test_counts_only_resting_pools_of_matching_side_within_proximity(self):
        pools = [
            LiquidityPool(index=0, kind="buy_side", level=101.0, reinforced=False, status="RESTING"),
            LiquidityPool(index=1, kind="buy_side", level=101.2, reinforced=False, status="RESTING"),
            LiquidityPool(index=2, kind="buy_side", level=150.0, reinforced=False, status="RESTING"),  # too far
            LiquidityPool(index=3, kind="sell_side", level=100.9, reinforced=False, status="RESTING"),  # wrong side
            LiquidityPool(index=4, kind="buy_side", level=101.1, reinforced=False, status="BROKEN"),     # not resting
        ]
        result = resting_pool_density(pools, price=101.0, side="buy_side", proximity_pct=0.015)
        assert result["count"] == 2
        assert 101.0 in result["levels"]
        assert 101.2 in result["levels"]


class TestSessionHighLow:
    def test_explicit_window_returns_real_high_low(self):
        rows = [(100, 105, 95, 102), (102, 108, 101, 107), (107, 110, 106, 109)]
        df = _candles(rows)
        r = session_high_low(df, 0, 3)
        assert r["high"] == 110.0
        assert r["low"] == 95.0

    def test_out_of_range_returns_none(self):
        rows = [(100, 105, 95, 102)]
        df = _candles(rows)
        assert session_high_low(df, 0, 5) is None
        assert session_high_low(df, -1, 1) is None
        assert session_high_low(df, 2, 1) is None


class TestAnalyzeLiquidityEntryPoint:
    def test_full_pipeline_runs_end_to_end(self):
        rows = [
            (100, 110.2, 99, 100),
            (100, 100.5, 99.5, 100),
            (100, 112, 99.5, 111.5),  # breaks the high
        ]
        df = _candles(rows)
        swings = [_swing(0, "high", 110.0, "HH")]
        pools = analyze_liquidity(df, swings)
        assert len(pools) == 1
        assert pools[0].status == "BROKEN"


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
