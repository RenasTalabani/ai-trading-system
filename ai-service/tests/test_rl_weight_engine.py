"""
Tests for RLWeightEngine.

Originally written for T-041 (2026-08-22): MIN_WEIGHT=0.05 ("floor") and
MAX_WEIGHT=0.70 ("ceiling") are applied to each weight's raw value
*before* _normalise() rescales the whole dict to sum to 1.0. Simulation
confirmed that under sustained, realistic feedback (the same signal
source consistently winning while the other three consistently lose),
the *effective* weight actually returned by get_weights() could settle
above the documented 0.70 ceiling (~0.7277 in the scenario simulated
below), because the post-clamp renormalisation step was unbounded. At
the time this was left as a documented, owner-decision gap rather than
fixed, since a correct fix needs an algorithm choice, not a one-line
change, and would alter live signal-fusion weights.

**T-069 (2026-08-29): the owner has since authorized fixing this**, after
its real consequence was observed live -- the "macro" component drifting
to ~72% of the fused score, which independently combined with a separate
vocabulary bug (T-068) to make /global/scan's pass threshold
mathematically unreachable regardless of real market conditions.
_normalise() now runs its naive rescale through a new
_clamp_to_effective_bounds() pass (iterative clamp-and-redistribute) so
the *returned* weight always stays within [MIN_EFFECTIVE_WEIGHT,
MAX_EFFECTIVE_WEIGHT] = [10%, 45%]. The tests below that used to LOCK IN
the old gap as expected behavior now assert the fix actually holds,
using the exact same steady-state scenario that used to demonstrate the
bug -- see TestEffectiveWeightBoundsEnforcedUnderSustainedFeedback.

Also investigated: MIN_UPDATES_LOG=5 is defined but never referenced
anywhere in this module. Confirmed via grep this is the only occurrence.
Not fixed: the only logging gate that exists is `self._updates % 10 == 0`,
and 10 > 5, so wiring in `and self._updates >= MIN_UPDATES_LOG` would be
a no-op (the modulo-10 condition can never fire before update 10, which
already exceeds 5) -- i.e. it is dead but behaviorally inert, the same
conclusion reached for `ATR_SIDEWAYS_THRESHOLD` in regime_detector.py.

Zero prior test coverage existed for this module before this pass.
"""
import json
import os

import pytest

from app.services.rl_weight_engine import (
    RLWeightEngine,
    DEFAULT_WEIGHTS,
    MIN_WEIGHT,
    MAX_WEIGHT,
    LEARNING_RATE,
    MIN_EFFECTIVE_WEIGHT,
    MAX_EFFECTIVE_WEIGHT,
    _clamp_to_effective_bounds,
)


@pytest.fixture
def engine(tmp_path, monkeypatch):
    # Isolate each test's weights file so tests never share/persist state.
    weights_file = tmp_path / "signal_weights.json"
    monkeypatch.setattr(
        "app.services.rl_weight_engine._WEIGHTS_FILE", str(weights_file)
    )
    return RLWeightEngine()


class TestBasicWeightUpdateBehavior:
    def test_starts_from_default_weights(self, engine):
        assert engine.get_weights() == DEFAULT_WEIGHTS

    def test_weights_always_sum_to_one_after_a_single_update(self, engine):
        w = engine.record_outcome("WIN", {"technical": 0.6, "news": 0.3, "social": 0.1, "macro": 0.0})
        assert abs(sum(w.values()) - 1.0) < 1e-3

    def test_win_increases_contributing_signal_relative_weight(self, engine):
        # T-069: uses "news" (default 0.20) rather than "technical" here --
        # "technical"'s default (0.45) sits exactly at the new
        # MAX_EFFECTIVE_WEIGHT ceiling, so a WIN update to it would
        # correctly get clamped right back to 0.45 (no observable
        # increase), which is the new bound working as intended, not a
        # broken test. "news" has headroom below the ceiling instead.
        before = engine.get_weights()["news"]
        w = engine.record_outcome("WIN", {"technical": 0.0, "news": 1.0, "social": 0.0, "macro": 0.0})
        assert w["news"] > before

    def test_loss_decreases_contributing_signal_relative_weight(self, engine):
        before = engine.get_weights()["technical"]
        w = engine.record_outcome("LOSS", {"technical": 1.0, "news": 0.0, "social": 0.0, "macro": 0.0})
        assert w["technical"] < before

    def test_invalid_result_string_is_a_no_op(self, engine):
        before = engine.get_weights()
        w = engine.record_outcome("DRAW", {"technical": 1.0})
        assert w == before

    def test_missing_contribution_key_defaults_to_quarter_share(self, engine):
        # signal_contributions.get(key, 0.25) -- confirm the documented default.
        w1 = engine.record_outcome("WIN", {})
        engine2 = RLWeightEngine()
        engine2._weights = dict(DEFAULT_WEIGHTS)
        w2 = engine2.record_outcome(
            "WIN", {"technical": 0.25, "news": 0.25, "social": 0.25, "macro": 0.25}
        )
        assert w1 == w2


class TestResetAndStats:
    def test_reset_restores_defaults_and_zeroes_update_count(self, engine):
        engine.record_outcome("WIN", {"technical": 1.0})
        w = engine.reset()
        assert w == DEFAULT_WEIGHTS
        assert engine.stats()["total_updates"] == 0

    def test_stats_reports_weights_and_update_count(self, engine):
        engine.record_outcome("WIN", {"technical": 1.0})
        engine.record_outcome("LOSS", {"news": 1.0})
        stats = engine.stats()
        assert stats["total_updates"] == 2
        assert stats["weights"] == engine.get_weights()


class TestPersistence:
    def test_weights_survive_reload_from_file(self, tmp_path, monkeypatch):
        weights_file = tmp_path / "signal_weights.json"
        monkeypatch.setattr(
            "app.services.rl_weight_engine._WEIGHTS_FILE", str(weights_file)
        )
        e1 = RLWeightEngine()
        w = e1.record_outcome("WIN", {"technical": 1.0, "news": 0.0, "social": 0.0, "macro": 0.0})
        assert weights_file.exists()

        e2 = RLWeightEngine()
        assert e2.get_weights() == w

    def test_corrupt_weights_file_falls_back_to_defaults(self, tmp_path, monkeypatch):
        weights_file = tmp_path / "signal_weights.json"
        weights_file.write_text("{ not valid json")
        monkeypatch.setattr(
            "app.services.rl_weight_engine._WEIGHTS_FILE", str(weights_file)
        )
        e = RLWeightEngine()
        assert e.get_weights() == DEFAULT_WEIGHTS


class TestEffectiveWeightBoundsEnforcedUnderSustainedFeedback:
    """
    T-069 (2026-08-29, owner-authorized fix): this class used to LOCK IN
    the T-041 gap (the effective weight could drift past the documented
    ceiling) as a documented-but-unfixed behavior. The owner has since
    authorized fixing it directly -- these tests now assert the bug is
    actually gone, using the exact steady-state scenario that used to
    demonstrate it (500 rounds of "technical" always winning, the other
    three always losing -- the realistic steady state a persistently
    outperforming signal source would drive the RL loop toward).
    """

    def test_sustained_one_sided_feedback_no_longer_breaches_the_effective_ceiling(self, engine):
        for _ in range(500):
            engine.record_outcome("WIN",  {"technical": 1.0, "news": 0.0, "social": 0.0, "macro": 0.0})
            engine.record_outcome("LOSS", {"technical": 0.0, "news": 1.0, "social": 0.0, "macro": 0.0})
            engine.record_outcome("LOSS", {"technical": 0.0, "news": 0.0, "social": 1.0, "macro": 0.0})
            engine.record_outcome("LOSS", {"technical": 0.0, "news": 0.0, "social": 0.0, "macro": 1.0})

        w = engine.get_weights()
        # Regression: before T-069, this same scenario pushed "technical"
        # to ~0.7277, past the documented 0.70 ceiling. It must now never
        # exceed the new, actually-enforced MAX_EFFECTIVE_WEIGHT.
        assert w["technical"] <= MAX_EFFECTIVE_WEIGHT + 1e-6
        # And the three losing signals must never be squeezed below the floor.
        assert w["news"]   >= MIN_EFFECTIVE_WEIGHT - 1e-6
        assert w["social"] >= MIN_EFFECTIVE_WEIGHT - 1e-6
        assert w["macro"]  >= MIN_EFFECTIVE_WEIGHT - 1e-6
        # Weights still always sum to 1.0 -- the normalisation contract
        # itself is intact, and now so is the per-key box constraint.
        assert abs(sum(w.values()) - 1.0) < 1e-2

    def test_weights_stay_within_effective_bounds_at_every_intermediate_step(self, engine):
        # T-069's own required verification: the getter's output must
        # stay within the configured bounds regardless of RL engine
        # state, checked after every single update, not just at the end.
        for _ in range(50):
            engine.record_outcome("WIN", {"technical": 1.0, "news": 0.0, "social": 0.0, "macro": 0.0})
            w = engine.get_weights()
            assert abs(sum(w.values()) - 1.0) < 1e-2
            for v in w.values():
                assert MIN_EFFECTIVE_WEIGHT - 1e-6 <= v <= MAX_EFFECTIVE_WEIGHT + 1e-6

    def test_raw_pre_normalisation_clamp_still_applies_every_call(self, engine):
        # The original T-041 per-call raw delta bound is unchanged by
        # T-069 -- confirmed by checking a single large-contribution
        # update never jumps by more than LEARNING_RATE in one call
        # (using "news", which has headroom below the effective ceiling,
        # so the effective-bounds clamp doesn't mask this check).
        before = engine.get_weights()["news"]
        after = engine.record_outcome("WIN", {"technical": 0.0, "news": 1.0, "social": 0.0, "macro": 0.0})["news"]
        assert after - before <= LEARNING_RATE + 0.01  # + normalisation slack

    def test_opposite_steady_state_also_respects_bounds(self, engine):
        # Same scenario, opposite direction: "technical" always loses,
        # the other three always win -- proves the floor holds too, not
        # just the ceiling from the primary scenario above.
        for _ in range(500):
            engine.record_outcome("LOSS", {"technical": 1.0, "news": 0.0, "social": 0.0, "macro": 0.0})
            engine.record_outcome("WIN",  {"technical": 0.0, "news": 1.0, "social": 0.0, "macro": 0.0})
            engine.record_outcome("WIN",  {"technical": 0.0, "news": 0.0, "social": 1.0, "macro": 0.0})
            engine.record_outcome("WIN",  {"technical": 0.0, "news": 0.0, "social": 0.0, "macro": 1.0})

        w = engine.get_weights()
        assert w["technical"] >= MIN_EFFECTIVE_WEIGHT - 1e-6
        for k in ("news", "social", "macro"):
            assert w[k] <= MAX_EFFECTIVE_WEIGHT + 1e-6
        assert abs(sum(w.values()) - 1.0) < 1e-2


class TestClampToEffectiveBounds:
    """Direct unit tests for the clamp-and-redistribute algorithm itself,
    independent of the full RLWeightEngine."""

    def test_already_in_bounds_weights_pass_through_unchanged(self):
        w = _clamp_to_effective_bounds({"a": 0.30, "b": 0.30, "c": 0.20, "d": 0.20})
        assert w == {"a": 0.30, "b": 0.30, "c": 0.20, "d": 0.20}

    def test_one_weight_over_ceiling_redistributes_the_excess(self):
        w = _clamp_to_effective_bounds({"a": 0.70, "b": 0.10, "c": 0.10, "d": 0.10})
        assert w["a"] == MAX_EFFECTIVE_WEIGHT
        # Tolerance is 1e-5, not 1e-6: the function's own return statement
        # rounds each of the 4 values to 6dp independently, which can
        # accumulate up to ~4*0.5e-6 of drift in the total -- a real
        # (harmless) rounding artifact, not an algorithm bug.
        assert abs(sum(w.values()) - 1.0) < 1e-5
        assert all(MIN_EFFECTIVE_WEIGHT - 1e-6 <= v <= MAX_EFFECTIVE_WEIGHT + 1e-6 for v in w.values())

    def test_the_t041_documented_steady_state_is_correctly_bounded(self):
        # The exact values T-041's simulation found before this fix existed.
        w = _clamp_to_effective_bounds({"technical": 0.7277, "news": 0.15, "social": 0.05, "macro": 0.0723})
        # technical was the only value over the ceiling -- pinned exactly.
        assert w["technical"] == MAX_EFFECTIVE_WEIGHT
        # social and macro started under the floor, but redistributing
        # technical's excess among the remaining free weights lifts both
        # back above the floor in the same pass -- neither needs a second,
        # separate pin to hit the bound exactly (that would only happen if
        # the redistributed share itself still undershot the floor).
        assert w["social"] >= MIN_EFFECTIVE_WEIGHT - 1e-9
        assert w["macro"] >= MIN_EFFECTIVE_WEIGHT - 1e-9
        assert all(v <= MAX_EFFECTIVE_WEIGHT + 1e-9 for v in w.values())
        assert abs(sum(w.values()) - 1.0) < 1e-5

    def test_multiple_weights_simultaneously_out_of_bounds_still_converges(self):
        # Two weights over ceiling, one under floor -- exercises the
        # iterative (not single-pass) part of the algorithm.
        w = _clamp_to_effective_bounds({"a": 0.60, "b": 0.60, "c": 0.02, "d": -0.22})
        assert abs(sum(w.values()) - 1.0) < 1e-5
        assert all(MIN_EFFECTIVE_WEIGHT - 1e-6 <= v <= MAX_EFFECTIVE_WEIGHT + 1e-6 for v in w.values())
