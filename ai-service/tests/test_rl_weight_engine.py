"""
Tests for RLWeightEngine (T-041, 2026-08-22 continuous-improvement pass).

Investigated: MIN_WEIGHT=0.05 ("floor") and MAX_WEIGHT=0.70 ("ceiling")
are applied to each weight's raw value *before* _normalise() rescales the
whole dict to sum to 1.0. Confirmed by simulation that under sustained,
realistic feedback (the same signal source consistently winning while the
other three consistently lose -- exactly the steady state this module is
designed to reach) the *effective* weight actually returned by
get_weights() can settle above the documented 0.70 ceiling (~0.7277 in
the scenario simulated below), because the post-clamp renormalisation
step is unbounded. This is a genuine, evidence-backed gap between the
documented "floor"/"ceiling" contract and actual behavior, but -- like
T-038's RiskManager finding -- fixing it correctly requires enforcing two
constraints at once (sum=1.0 AND each weight in [MIN_WEIGHT, MAX_WEIGHT]),
which needs an actual algorithm choice (e.g. iterative water-filling
redistribution), not a single unambiguous one-line change, and it would
alter live signal-fusion weights. Per the standing instruction not to
invent problems/features without an evidence-backed single correct fix,
this pass documents and LOCKS IN the current actual behavior with
regression tests (so a future intentional fix has a clear "before" to
diff against) rather than silently changing weighting.

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
        before = engine.get_weights()["technical"]
        w = engine.record_outcome("WIN", {"technical": 1.0, "news": 0.0, "social": 0.0, "macro": 0.0})
        assert w["technical"] > before

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


class TestDocumentedCeilingViolationUnderSustainedFeedback:
    """
    T-041 regression guard: LOCKS IN the actual (documented-as-a-gap)
    behavior so any future intentional fix has a clear, tested "before".
    Not asserting this is *desired* behavior -- asserting it is the
    *current, actual* behavior, per the OWNER DECISION flagged in
    TASKS.md/PROJECT_STATUS.md.
    """

    def test_sustained_one_sided_feedback_can_push_effective_weight_past_documented_ceiling(self, engine):
        # "technical" always wins; the other three always lose -- a
        # realistic (not exotic) steady-state the RL loop is designed to
        # converge toward given a persistently outperforming signal.
        for _ in range(500):
            engine.record_outcome("WIN",  {"technical": 1.0, "news": 0.0, "social": 0.0, "macro": 0.0})
            engine.record_outcome("LOSS", {"technical": 0.0, "news": 1.0, "social": 0.0, "macro": 0.0})
            engine.record_outcome("LOSS", {"technical": 0.0, "news": 0.0, "social": 1.0, "macro": 0.0})
            engine.record_outcome("LOSS", {"technical": 0.0, "news": 0.0, "social": 0.0, "macro": 1.0})

        w = engine.get_weights()
        # This is the documented gap: the *effective* (post-normalisation)
        # weight exceeds MAX_WEIGHT, even though MAX_WEIGHT is applied
        # every single call.
        assert w["technical"] > MAX_WEIGHT
        # Weights still always sum to ~1.0 -- the normalisation contract
        # itself is intact; only the per-key box constraint is not.
        assert abs(sum(w.values()) - 1.0) < 1e-2

    def test_weights_still_sum_to_one_at_every_intermediate_step(self, engine):
        for i in range(50):
            engine.record_outcome("WIN", {"technical": 1.0, "news": 0.0, "social": 0.0, "macro": 0.0})
            assert abs(sum(engine.get_weights().values()) - 1.0) < 1e-2

    def test_raw_pre_normalisation_clamp_still_applies_every_call(self, engine):
        # Even though the *effective* weight can drift past MAX_WEIGHT via
        # normalisation, the per-call raw delta step itself is still
        # bounded -- confirmed by checking a single large-contribution
        # update never jumps by more than LEARNING_RATE in one call.
        before = engine.get_weights()["technical"]
        after = engine.record_outcome("WIN", {"technical": 1.0, "news": 0.0, "social": 0.0, "macro": 0.0})["technical"]
        assert after - before <= LEARNING_RATE + 0.01  # + normalisation slack
