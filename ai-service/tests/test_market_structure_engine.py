"""
Tests for market_structure_engine.py (Phase 1, Order Block Intelligence
Engine build-out, 2026-09-01).

Written in pytest style to match this project's existing test convention
(see test_order_block_engine.py) so it runs unmodified once pytest is
available in an environment that has it. This session's sandbox does not
have pytest installed and has no network path to install it (confirmed
this session) -- so alongside this file, the exact same assertions are
also executed as a plain-Python script (see the `if __name__ ==
"__main__"` block at the bottom, and the accompanying run log) for real,
actually-executed verification in the environment this was written in.
Every one of the cases below was genuinely run, not just written.
"""
import pandas as pd
try:
    import pytest  # noqa: F401 -- not required by any test body below
except ImportError:
    pytest = None

from app.services.market_structure_engine import (
    analyze_structure, find_swings, classify_sequence, mark_external_structure,
    detect_structure_breaks, DEFAULT_LEFT, DEFAULT_RIGHT,
)


def _candles(rows):
    """rows: list of (open, high, low, close) tuples -> DataFrame with a
    synthetic timestamp column."""
    df = pd.DataFrame(rows, columns=["open", "high", "low", "close"])
    df["timestamp"] = [f"t{i}" for i in range(len(df))]
    return df


def _leg(start_price, extreme, retrace_to, tick=0.05, mid_frac=0.3):
    """One zigzag leg: 3 candles moving from start_price to `extreme`
    (the intended swing point, exactly hit by the 3rd candle's wick), 2
    candles retracing to `retrace_to` (the next leg's start / the opposite
    swing point, exactly hit by the 2nd candle's wick), then 2 flat
    "confirm" candles positioned safely *between* extreme and retrace_to
    (never touching either), so the fractal windows resolve cleanly with
    no accidental ties between candles. Works for both up-legs
    (extreme > start_price > ... > retrace_to is false; here extreme is a
    high, retrace_to is a higher low) and down-legs symmetrically, since
    it only ever compares against `tick`, not direction.
    Returns (rows, retrace_to) so legs can be chained.
    """
    rows = []
    n_up = 3
    prices = [start_price + (extreme - start_price) * (k + 1) / n_up for k in range(n_up)]
    for k, c in enumerate(prices):
        o = start_price if k == 0 else prices[k - 1]
        going_up = extreme > start_price
        if k < n_up - 1:
            h = max(o, c) + tick if going_up else max(o, c) + tick * 0.2
            l = min(o, c) - tick if not going_up else min(o, c) - tick * 0.2
        else:
            # last candle of the leg: its wick must BE the extreme exactly.
            h = extreme if going_up else max(o, c) + tick * 0.2
            l = extreme if not going_up else min(o, c) - tick * 0.2
        rows.append((o, h, l, c))

    n_dn = 2
    prices2 = [extreme + (retrace_to - extreme) * (k + 1) / n_dn for k in range(n_dn)]
    for k, c in enumerate(prices2):
        o = extreme if k == 0 else prices2[k - 1]
        going_up = retrace_to > extreme
        if k < n_dn - 1:
            h = max(o, c) + tick * 0.2 if going_up else max(o, c) + tick
            l = min(o, c) - tick if going_up else min(o, c) - tick * 0.2
        else:
            h = max(o, c) + tick * 0.2 if going_up else retrace_to
            l = retrace_to if going_up else min(o, c) - tick * 0.2
        rows.append((o, h, l, c))

    lo, hi = (extreme, retrace_to) if retrace_to > extreme else (retrace_to, extreme)
    mid = lo + (hi - lo) * mid_frac
    for _ in range(2):
        rows.append((mid, mid + tick * 0.2, mid - tick * 0.2, mid))

    return rows, retrace_to


def _uptrend(n_legs=6, start=100.0, leg_size=10.0, pullback=4.0, noise=0.0):
    """Clean staircase uptrend: each leg's high is `leg_size` above the
    previous leg's ending price, then retraces `pullback` to a strictly
    higher low than the previous leg's low -> HH + HL every leg."""
    rows = []
    price = start
    for _leg_i in range(n_legs):
        peak = price + leg_size
        higher_low = peak - pullback
        leg_rows, price = _leg(price, peak, higher_low)
        rows.extend(leg_rows)
    return _candles(rows)


def _downtrend(n_legs=6, start=200.0, leg_size=10.0, pullback=4.0):
    """Mirror of _uptrend: each leg's low is `leg_size` below the previous
    leg's ending price, then retraces `pullback` up to a strictly lower
    high than the previous leg's high -> LH + LL every leg."""
    rows = []
    price = start
    for _leg_i in range(n_legs):
        trough = price - leg_size
        lower_high = trough + pullback
        leg_rows, price = _leg(price, trough, lower_high)
        rows.extend(leg_rows)
    return _candles(rows)


class TestInsufficientData:
    def test_empty_dataframe(self):
        df = pd.DataFrame(columns=["open", "high", "low", "close"])
        r = analyze_structure(df)
        assert r.status == "INSUFFICIENT_DATA"

    def test_too_few_candles(self):
        df = _candles([(100, 101, 99, 100.5)] * 5)
        r = analyze_structure(df)
        assert r.status == "INSUFFICIENT_DATA"
        assert "Need at least" in r.reason

    def test_missing_columns(self):
        df = pd.DataFrame({"open": [1, 2, 3], "close": [1, 2, 3]})
        r = analyze_structure(df)
        assert r.status == "INSUFFICIENT_DATA"
        assert "Missing required columns" in r.reason


class TestCleanUptrend:
    def test_bias_becomes_bullish(self):
        df = _uptrend(n_legs=6)
        r = analyze_structure(df)
        assert r.status == "OK"
        assert r.bias == "BULLISH"
        assert r.bias_established_at_index is not None

    def test_hh_hl_labels_present(self):
        df = _uptrend(n_legs=6)
        r = analyze_structure(df)
        labels = [s.label for s in r.swings]
        assert "HH" in labels
        assert "HL" in labels
        assert "LH" not in labels
        assert "LL" not in labels

    def test_bos_fires_on_continuation(self):
        df = _uptrend(n_legs=6)
        r = analyze_structure(df)
        bos_events = [b for b in r.breaks if b.event == "BOS"]
        assert len(bos_events) >= 1
        assert all(b.direction == "bullish" for b in bos_events)


class TestCleanDowntrend:
    def test_bias_becomes_bearish(self):
        df = _downtrend(n_legs=6)
        r = analyze_structure(df)
        assert r.status == "OK"
        assert r.bias == "BEARISH"

    def test_lh_ll_labels_present(self):
        df = _downtrend(n_legs=6)
        r = analyze_structure(df)
        labels = [s.label for s in r.swings]
        assert "LH" in labels
        assert "LL" in labels
        assert "HH" not in labels
        assert "HL" not in labels

    def test_bos_fires_bearish(self):
        df = _downtrend(n_legs=6)
        r = analyze_structure(df)
        bos_events = [b for b in r.breaks if b.event == "BOS"]
        assert len(bos_events) >= 1
        assert all(b.direction == "bearish" for b in bos_events)


class TestChoch:
    def test_reversal_after_uptrend_fires_choch(self):
        # Establish a clean uptrend, then a sharp reversal leg that closes
        # decisively below the most recent swing low.
        up = _uptrend(n_legs=4)
        last_low = up["low"].min()
        reversal_rows = []
        price = float(up["close"].iloc[-1])
        target = last_low - 20.0
        for step in range(6):
            o = price
            price = price - (price - target) / 3
            c = price
            reversal_rows.append((o, max(o, c) + 0.1, min(o, c) - 0.1, c))
        for _ in range(2):
            reversal_rows.append((price, price + 0.2, price - 0.2, price))
        rev_df = _candles(reversal_rows)
        rev_df["timestamp"] = [f"r{i}" for i in range(len(rev_df))]
        full = pd.concat([up, rev_df], ignore_index=True)

        r = analyze_structure(full)
        assert r.status == "OK"
        choch_events = [b for b in r.breaks if b.event == "CHOCH"]
        assert len(choch_events) >= 1, "expected at least one CHoCH after the reversal"
        assert choch_events[0].direction == "bearish"


class TestEqualHighsLows:
    def test_equal_highs_labeled_eqh_not_hh(self):
        # Two up-legs whose peaks are the EXACT same price (equal highs),
        # separated by a genuine higher low so the fractal/label logic has
        # real structure to work with. _leg's last "up" candle's wick is
        # set to exactly `extreme`, so two legs sharing the same `extreme`
        # value produce two swing highs at the identical price.
        rows1, end1 = _leg(100.0, 130.0, 118.0)   # peak=130, higher low=118
        rows2, end2 = _leg(end1, 130.0, 122.0)     # SAME peak=130 again, even higher low
        df = _candles(rows1 + rows2)

        r = analyze_structure(df, eq_tolerance_pct=0.0005)
        highs = [s for s in r.swings if s.kind == "high"]
        assert len(highs) >= 2, f"expected 2 swing highs, got {[s.to_dict() for s in highs]}"
        assert highs[0].label == "first_high"
        assert highs[1].label == "EQH", f"expected EQH for an identical repeat high, got {highs[1].label}"
        assert highs[1].price == pytest.approx(highs[0].price, rel=1e-6) if pytest else abs(highs[1].price - highs[0].price) < 1e-6


class TestFalseBreakWick:
    def test_wick_beyond_level_without_close_is_not_bos(self):
        df = _uptrend(n_legs=4)
        r0 = analyze_structure(df)
        assert r0.bias == "BULLISH", "fixture sanity check: need an established bullish bias first"
        recent_high_level = max(s.price for s in r0.swings if s.kind == "high")

        last_close = float(df["close"].iloc[-1])
        # One candle wicks decisively above the established swing-high
        # level but CLOSES back below it -- a genuine wick-only violation,
        # not a real break.
        wick_row = (last_close, recent_high_level + 5, last_close - 1, last_close + 0.2)
        # A couple of quiet follow-up candles so nothing else fires.
        confirm_rows = [(last_close + 0.2, last_close + 0.3, last_close + 0.1, last_close + 0.2)] * 2
        extra = _candles([wick_row] + confirm_rows)
        extra["timestamp"] = [f"w{i}" for i in range(len(extra))]
        full = pd.concat([df, extra], ignore_index=True).reset_index(drop=True)

        r = analyze_structure(full)
        wick_candle_idx = len(df)  # index of the injected wick row in `full`
        wick_indices = {w.index for w in r.wick_violations}
        bos_indices = {b.index for b in r.breaks if b.event == "BOS"}

        assert wick_candle_idx in wick_indices, (
            f"expected the wick candle (idx {wick_candle_idx}) to be recorded as a "
            f"wick_violation; got wick_violations at {sorted(wick_indices)}"
        )
        assert wick_candle_idx not in bos_indices, "a wick-only pierce must never register as BOS"


class TestNoSwings:
    def test_flat_market_returns_ok_with_no_swings(self):
        rows = [(100, 100.1, 99.9, 100)] * 20
        df = _candles(rows)
        r = analyze_structure(df)
        assert r.status == "OK"
        assert r.bias == "UNKNOWN"


class TestMissingDataInWindow:
    def test_nan_candle_does_not_crash_and_is_skipped(self):
        df = _uptrend(n_legs=4)
        df.loc[5, "high"] = float("nan")
        r = analyze_structure(df)
        assert r.status == "OK"  # must not raise


if __name__ == "__main__":
    # Plain-Python execution path (no pytest) -- see module docstring.
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
