"""
Tests for Phase 3 (2026-09-01) of the Order Block Intelligence Engine --
the real structure + liquidity context added to order_block_engine.py.

Written in the same plain-Python-runnable style as
test_market_structure_engine.py / test_liquidity_engine.py (no top-level
`import pytest` -- this environment has no pytest available, confirmed
again this pass). Separate file from the pre-existing
test_order_block_engine.py: that file's 35 tests were re-run unmodified
against this phase's changes and all still pass (verified this same
session); this file adds coverage for the genuinely NEW logic this phase
introduces, which had zero prior coverage.

Importing order_block_engine.py in this sandbox requires the same
dependency shims used for the pre-existing suite (aiohttp,
pydantic_settings, yfinance are not installed here and cannot be --
PyPI network-blocked, confirmed again this session) -- run with those
shim directories on PYTHONPATH ahead of the real ai-service path, same as
the pre-existing suite's run this session.
"""
import pandas as pd

from app.services.order_block_engine import (
    _structure_context_for_ob,
    _liquidity_sweep_confluence,
    _build_market_structure_summary,
    _build_liquidity_summary,
    _compute_structure_and_liquidity,
    _most_recent_break_at_or_before,
)
from app.services.market_structure_engine import analyze_structure, StructureBreak
from app.services.liquidity_engine import LiquidityPool


def _ob(ob_type="bullish", impulse_index=50, ob_index=45):
    return {"type": ob_type, "impulse_index": impulse_index, "ob_index": ob_index,
            "zone": {"low": 100.0, "high": 101.0}, "strength": 80,
            "freshness": "fresh", "timeframe": "1h", "timestamp": "t"}


class _FakeStructureResult:
    def __init__(self, status="OK", bias="UNKNOWN", breaks=None, reason=None):
        self.status = status
        self.bias = bias
        self.breaks = breaks or []
        self.reason = reason
        self.swings = []
        self.bias_established_at_index = None


class TestStructureContextForOb:
    def test_unknown_bias_gives_none_alignment_not_false(self):
        sr = _FakeStructureResult(status="OK", bias="UNKNOWN")
        ctx = _structure_context_for_ob(_ob("bullish"), sr)
        assert ctx["bias"] == "UNKNOWN"
        assert ctx["aligned_with_bias"] is None

    def test_bullish_ob_aligned_with_bullish_bias(self):
        sr = _FakeStructureResult(status="OK", bias="BULLISH")
        ctx = _structure_context_for_ob(_ob("bullish"), sr)
        assert ctx["aligned_with_bias"] is True

    def test_bearish_ob_not_aligned_with_bullish_bias(self):
        sr = _FakeStructureResult(status="OK", bias="BULLISH")
        ctx = _structure_context_for_ob(_ob("bearish"), sr)
        assert ctx["aligned_with_bias"] is False

    def test_none_structure_result_degrades_honestly(self):
        ctx = _structure_context_for_ob(_ob("bullish"), None)
        assert ctx["bias"] == "UNKNOWN"
        assert ctx["aligned_with_bias"] is None
        assert ctx["most_recent_break"] is None

    def test_insufficient_data_status_degrades_honestly(self):
        sr = _FakeStructureResult(status="INSUFFICIENT_DATA", bias="UNKNOWN")
        ctx = _structure_context_for_ob(_ob("bullish"), sr)
        assert ctx["aligned_with_bias"] is None

    def test_most_recent_break_picks_latest_at_or_before_impulse_not_after(self):
        b1 = StructureBreak(index=10, event="BOS", direction="bullish", level=100.0,
                             reference_swing_index=8, close_price=101.0)
        b2 = StructureBreak(index=40, event="CHOCH", direction="bearish", level=99.0,
                             reference_swing_index=38, close_price=98.5)
        b3 = StructureBreak(index=60, event="BOS", direction="bearish", level=97.0,
                             reference_swing_index=58, close_price=96.5)  # after impulse_index=50
        sr = _FakeStructureResult(status="OK", bias="BEARISH", breaks=[b1, b2, b3])
        ctx = _structure_context_for_ob(_ob("bearish", impulse_index=50), sr)
        assert ctx["most_recent_break"]["index"] == 40
        assert ctx["most_recent_break"]["event"] == "CHOCH"

    def test_no_break_before_impulse_returns_none(self):
        b1 = StructureBreak(index=60, event="BOS", direction="bullish", level=100.0,
                             reference_swing_index=58, close_price=101.0)
        sr = _FakeStructureResult(status="OK", bias="BULLISH", breaks=[b1])
        ctx = _structure_context_for_ob(_ob("bullish", impulse_index=50), sr)
        assert ctx["most_recent_break"] is None


class TestLiquiditySweepConfluence:
    def test_bullish_ob_matches_confirmed_sell_side_sweep_in_window(self):
        pool = LiquidityPool(index=40, kind="sell_side", level=95.0, reinforced=False,
                              status="SWEPT", interaction_index=45,
                              sweep_classification="CONFIRMED_SWEEP")
        result = _liquidity_sweep_confluence(_ob("bullish", impulse_index=50), [pool], window=20)
        assert result is not None
        assert result["kind"] == "sell_side"
        assert result["sweep_classification"] == "CONFIRMED_SWEEP"

    def test_bearish_ob_matches_buy_side_sweep_ignores_sell_side(self):
        sell_pool = LiquidityPool(index=40, kind="sell_side", level=95.0, reinforced=False,
                                   status="SWEPT", interaction_index=45,
                                   sweep_classification="CONFIRMED_SWEEP")
        buy_pool = LiquidityPool(index=41, kind="buy_side", level=110.0, reinforced=False,
                                  status="SWEPT", interaction_index=46,
                                  sweep_classification="FAILED_SWEEP")
        result = _liquidity_sweep_confluence(_ob("bearish", impulse_index=50),
                                              [sell_pool, buy_pool], window=20)
        assert result is not None
        assert result["kind"] == "buy_side"

    def test_ambiguous_classification_does_not_count_as_confluence(self):
        pool = LiquidityPool(index=40, kind="sell_side", level=95.0, reinforced=False,
                              status="SWEPT", interaction_index=45,
                              sweep_classification="AMBIGUOUS")
        result = _liquidity_sweep_confluence(_ob("bullish", impulse_index=50), [pool], window=20)
        assert result is None

    def test_resting_pool_no_interaction_is_not_confluence(self):
        pool = LiquidityPool(index=40, kind="sell_side", level=95.0, reinforced=False,
                              status="RESTING")
        result = _liquidity_sweep_confluence(_ob("bullish", impulse_index=50), [pool], window=20)
        assert result is None

    def test_sweep_outside_window_is_excluded(self):
        pool = LiquidityPool(index=1, kind="sell_side", level=95.0, reinforced=False,
                              status="SWEPT", interaction_index=10,
                              sweep_classification="CONFIRMED_SWEEP")
        result = _liquidity_sweep_confluence(_ob("bullish", impulse_index=50), [pool], window=20)
        assert result is None  # interaction_index=10 is 40 candles before impulse, window=20

    def test_sweep_after_impulse_is_excluded_not_look_ahead(self):
        pool = LiquidityPool(index=48, kind="sell_side", level=95.0, reinforced=False,
                              status="SWEPT", interaction_index=55,
                              sweep_classification="CONFIRMED_SWEEP")
        result = _liquidity_sweep_confluence(_ob("bullish", impulse_index=50), [pool], window=20)
        assert result is None

    def test_most_recent_qualifying_pool_chosen_when_multiple(self):
        older = LiquidityPool(index=30, kind="sell_side", level=94.0, reinforced=False,
                               status="SWEPT", interaction_index=35,
                               sweep_classification="CONFIRMED_SWEEP")
        newer = LiquidityPool(index=44, kind="sell_side", level=95.5, reinforced=False,
                               status="SWEPT", interaction_index=48,
                               sweep_classification="FAILED_SWEEP")
        result = _liquidity_sweep_confluence(_ob("bullish", impulse_index=50),
                                              [older, newer], window=20)
        assert result["level"] == 95.5


class TestBuildMarketStructureSummary:
    def test_none_result_is_unavailable(self):
        summary = _build_market_structure_summary(None)
        assert summary["status"] == "UNAVAILABLE"
        assert summary["bias"] == "UNKNOWN"

    def test_insufficient_data_passthrough(self):
        sr = _FakeStructureResult(status="INSUFFICIENT_DATA", reason="too short")
        summary = _build_market_structure_summary(sr)
        assert summary["status"] == "INSUFFICIENT_DATA"
        assert summary["reason"] == "too short"

    def test_ok_status_includes_last_3_breaks_only(self):
        breaks = [
            StructureBreak(index=i, event="BOS", direction="bullish", level=100.0,
                            reference_swing_index=i - 2, close_price=101.0)
            for i in [10, 20, 30, 40, 50]
        ]
        sr = _FakeStructureResult(status="OK", bias="BULLISH", breaks=breaks)
        summary = _build_market_structure_summary(sr)
        assert summary["status"] == "OK"
        assert len(summary["recent_breaks"]) == 3
        assert [b["index"] for b in summary["recent_breaks"]] == [30, 40, 50]


class TestBuildLiquiditySummary:
    def test_empty_pools_gives_zeroed_shape(self):
        summary = _build_liquidity_summary([], 100.0)
        assert summary["pools_total"] == 0
        assert summary["resting_buy_side"] == 0
        assert summary["buy_side_density_near_price"]["count"] == 0

    def test_counts_split_correctly_by_kind_and_status(self):
        pools = [
            LiquidityPool(index=1, kind="buy_side", level=101.0, reinforced=False, status="RESTING"),
            LiquidityPool(index=2, kind="buy_side", level=101.5, reinforced=False, status="SWEPT",
                          interaction_index=5, sweep_classification="CONFIRMED_SWEEP"),
            LiquidityPool(index=3, kind="sell_side", level=99.0, reinforced=False, status="RESTING"),
            LiquidityPool(index=4, kind="sell_side", level=98.0, reinforced=False, status="BROKEN",
                          interaction_index=6),
        ]
        summary = _build_liquidity_summary(pools, 100.0)
        assert summary["pools_total"] == 4
        assert summary["resting_buy_side"] == 1
        assert summary["resting_sell_side"] == 1
        assert summary["swept"] == 1
        assert summary["broken"] == 1
        # 101.0 is within 1.5% of 100.0 and RESTING -> counted
        assert summary["buy_side_density_near_price"]["count"] == 1


class TestComputeStructureAndLiquidityIntegration:
    # Reuses the real, current, already-verified uptrend fixture from
    # test_market_structure_engine.py (14/14 passing there this build-out)
    # rather than duplicating a hand-rolled one -- an earlier draft of this
    # test file hand-copied an OLDER version of that fixture from a stale
    # cloud-sandbox cache and hit exactly the float-tie-produces-zero-swings
    # bug that fixture generator was already rewritten to avoid (see that
    # file's own docstring and this build-out's Phase 1 history). Importing
    # the real, current fixture directly avoids re-introducing a bug that
    # was already found and fixed once.
    def _uptrend_df(self, n_legs=6, start=100.0, leg_size=10.0, pullback=4.0):
        from test_market_structure_engine import _uptrend
        df = _uptrend(n_legs=n_legs, start=start, leg_size=leg_size, pullback=pullback)
        df["volume"] = 1000.0
        return df

    def test_real_uptrend_produces_ok_structure_and_a_pool_list(self):
        df = self._uptrend_df()
        structure_result, pools = _compute_structure_and_liquidity(df)
        assert structure_result is not None
        assert structure_result.status == "OK"
        assert structure_result.bias == "BULLISH"
        assert isinstance(pools, list)
        # Every confirmed swing became a pool (Rule 7)
        assert len(pools) == len(structure_result.swings)

    def test_too_short_df_degrades_to_insufficient_data_without_raising(self):
        df = pd.DataFrame({"open": [1, 2, 3], "high": [1, 2, 3],
                           "low": [1, 2, 3], "close": [1, 2, 3]})
        structure_result, pools = _compute_structure_and_liquidity(df)
        assert structure_result is not None
        assert structure_result.status == "INSUFFICIENT_DATA"
        assert pools == []

    def test_missing_columns_does_not_raise(self):
        df = pd.DataFrame({"open": [1, 2, 3], "close": [1, 2, 3]})
        structure_result, pools = _compute_structure_and_liquidity(df)
        assert structure_result is not None
        assert structure_result.status == "INSUFFICIENT_DATA"
        assert pools == []


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
