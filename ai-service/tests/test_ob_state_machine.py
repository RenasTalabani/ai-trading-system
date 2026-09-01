"""
Tests for ob_state_machine.py (Phase 8, Order Block Intelligence Engine
build-out, 2026-09-01). Plain-Python-runnable.
"""
import pandas as pd

from app.services.ob_state_machine import compute_ob_state


def _candles(rows):
    df = pd.DataFrame(rows, columns=["open", "high", "low", "close"])
    df["timestamp"] = [f"t{i}" for i in range(len(df))]
    return df


class TestInsufficientData:
    def test_empty_df(self):
        df = _candles([])
        result = compute_ob_state(df, "bullish", 100.0, 102.0, formation_index=0)
        assert result.status == "INSUFFICIENT_DATA"

    def test_formation_index_at_last_candle(self):
        df = _candles([(100, 101, 99, 100)] * 3)
        result = compute_ob_state(df, "bullish", 100.0, 102.0, formation_index=2)
        assert result.status == "INSUFFICIENT_DATA"


class TestFreshAndApproaching:
    def test_never_touched_far_from_price_is_fresh(self):
        rows = [(100, 102, 98, 100)]  # formation candle, zone [100,102]
        rows += [(150, 151, 149, 150)] * 5  # price way above zone, never touches
        df = _candles(rows)
        result = compute_ob_state(df, "bullish", zone_low=100.0, zone_high=102.0, formation_index=0)
        assert result.status == "FRESH"
        assert result.touch_count == 0

    def test_never_touched_but_current_price_close_is_approaching(self):
        rows = [(100, 102, 98, 100)]
        rows += [(150, 151, 149, 150)] * 3
        rows += [(150, 150.5, 102.3, 102.5)]  # current close near zone_high=102, within 1%
        df = _candles(rows)
        result = compute_ob_state(df, "bullish", zone_low=100.0, zone_high=102.0, formation_index=0)
        assert result.status == "APPROACHING"
        assert result.touch_count == 0


class TestExpired:
    def test_never_touched_and_too_old_is_expired(self):
        rows = [(100, 102, 98, 100)]
        rows += [(150, 151, 149, 150)] * 250  # far from zone, well past max_age_candles=200
        df = _candles(rows)
        result = compute_ob_state(df, "bullish", zone_low=100.0, zone_high=102.0, formation_index=0)
        assert result.status == "EXPIRED"
        assert result.age_candles > 200

    def test_not_yet_old_enough_stays_fresh(self):
        rows = [(100, 102, 98, 100)]
        rows += [(150, 151, 149, 150)] * 50  # well under 200
        df = _candles(rows)
        result = compute_ob_state(df, "bullish", zone_low=100.0, zone_high=102.0, formation_index=0)
        assert result.status == "FRESH"


class TestTestedAndMitigated:
    def test_single_touch_no_reaction_is_tested(self):
        # zone [100,102], height=2, reaction target=104 -- keep every high
        # strictly below 104 so no candle accidentally also reacts.
        rows = [(100, 102, 98, 100)]
        rows += [(103, 103.8, 101.5, 103.5)]  # low=101.5 touches zone [100,102], high=103.8 < 104
        rows += [(103, 103.8, 103, 103.5)] * 2  # stays away, no reaction, no more touches
        df = _candles(rows)
        result = compute_ob_state(df, "bullish", zone_low=100.0, zone_high=102.0, formation_index=0)
        assert result.status == "TESTED"
        assert result.touch_count == 1
        assert result.first_touch_index == 1

    def test_two_touches_no_reaction_is_mitigated(self):
        rows = [(100, 102, 98, 100)]
        rows += [(103, 103.8, 101.5, 103.5)]  # touch 1, high < 104 reaction target
        rows += [(103, 103.8, 103, 103.5)]
        rows += [(103, 103.8, 101.8, 103.5)]  # touch 2, high < 104
        df = _candles(rows)
        result = compute_ob_state(df, "bullish", zone_low=100.0, zone_high=102.0, formation_index=0)
        assert result.status == "MITIGATED"
        assert result.touch_count == 2


class TestReacted:
    def test_touch_then_reaction_beats_mitigation(self):
        # zone [100,102], height=2, reaction target = 102 + 1.0*2 = 104
        rows = [(100, 102, 98, 100)]
        rows += [(103, 103.8, 101.5, 103.5)]  # touch 1, high < 104
        rows += [(103, 103.8, 101.8, 103.5)]  # touch 2 (would be MITIGATED otherwise), high < 104
        rows += [(103.5, 105, 103, 104.5)]    # reaction: high=105 >= 104
        df = _candles(rows)
        result = compute_ob_state(df, "bullish", zone_low=100.0, zone_high=102.0, formation_index=0)
        assert result.status == "REACTED"
        assert result.reacted_index == 3
        assert result.touch_count == 2

    def test_same_candle_touch_and_reaction_v_shape(self):
        # a single candle wicks down into the zone AND up past the reaction target
        rows = [(100, 102, 98, 100)]
        rows += [(101, 105, 101.5, 104.5)]  # low=101.5 touches, high=105 >= 104 reacts, same candle
        df = _candles(rows)
        result = compute_ob_state(df, "bullish", zone_low=100.0, zone_high=102.0, formation_index=0)
        assert result.status == "REACTED"
        assert result.reacted_index == 1
        assert result.first_touch_index == 1


class TestInvalidated:
    def test_close_through_zone_low_invalidates(self):
        rows = [(100, 102, 98, 100)]
        rows += [(99, 100, 97, 98)]   # close=98 < zone_low=100 -> INVALIDATED
        df = _candles(rows)
        result = compute_ob_state(df, "bullish", zone_low=100.0, zone_high=102.0, formation_index=0)
        assert result.status == "INVALIDATED"
        assert result.invalidated_index == 1

    def test_wick_through_zone_low_without_close_does_not_invalidate(self):
        rows = [(100, 102, 98, 100)]
        rows += [(101, 102, 97, 100.5)]  # wicks to 97 but closes at 100.5 (inside/above zone_low)
        df = _candles(rows)
        result = compute_ob_state(df, "bullish", zone_low=100.0, zone_high=102.0, formation_index=0)
        assert result.status != "INVALIDATED"

    def test_invalidation_takes_priority_over_prior_reaction(self):
        # Rule 25: even after reacting, a LATER close-through invalidates.
        rows = [(100, 102, 98, 100)]
        rows += [(101, 105, 101.5, 104.5)]  # touch + reaction, same candle (index 1)
        rows += [(104, 104, 99, 99.5)]      # later: closes below zone_low=100 -> INVALIDATED
        df = _candles(rows)
        result = compute_ob_state(df, "bullish", zone_low=100.0, zone_high=102.0, formation_index=0)
        assert result.status == "INVALIDATED"
        assert result.invalidated_index == 2


class TestBearishMirror:
    def test_bearish_touch_reaction_and_invalidation(self):
        # zone [100,102] bearish (resistance); touch = high >= zone_low(100);
        # invalidation = close > zone_high(102); reaction = low <= zone_low - height = 98
        rows = [(102, 103, 100, 101)]        # formation
        rows += [(99, 100.5, 99, 99.5)]       # touch: high=100.5 >= 100
        rows += [(99, 99.5, 97.5, 98)]        # reaction: low=97.5 <= 98
        df = _candles(rows)
        result = compute_ob_state(df, "bearish", zone_low=100.0, zone_high=102.0, formation_index=0)
        assert result.status == "REACTED"

    def test_bearish_invalidation(self):
        rows = [(102, 103, 100, 101)]
        rows += [(101, 103.5, 100, 103)]   # close=103 > zone_high=102 -> INVALIDATED
        df = _candles(rows)
        result = compute_ob_state(df, "bearish", zone_low=100.0, zone_high=102.0, formation_index=0)
        assert result.status == "INVALIDATED"


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
