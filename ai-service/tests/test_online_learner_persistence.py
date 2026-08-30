"""
T-072 (2026-08-30): GET /api/health's phase8.online_learning
(buffer_size/total_added/win_rate) was purely in-memory and confirmed,
via overnight testing, to reset to near-zero on every ai-service restart.

These tests verify the write-through telemetry persistence added to
OnlineLearner -- a NEW process (a fresh OnlineLearner instance, same
model_path) picks up where a previous one left off -- without touching
the real Transformer fine-tune buffer (self._buffer), which stays
in-memory-only and legitimately empty after a "restart" (its sequence
arrays were never persistable, a pre-existing, documented limitation --
see feedback_loop.py).
"""
import json
import os

import numpy as np
import pytest

from app.models.online_learner import OnlineLearner, REPLAY_BUFFER, STATE_FILE


class _FakeTransformer:
    is_trained = False


class _FakeCalibrator:
    def fit(self, confidences, outcomes):
        return {"fitted": len(confidences)}


def _make_learner(model_path=None):
    return OnlineLearner(transformer=_FakeTransformer(), calibrator=_FakeCalibrator(), model_path=model_path)


class TestTelemetrySurvivesARestart:
    def test_total_added_and_win_rate_survive_a_fresh_instance_at_the_same_path(self, tmp_path):
        model_path = str(tmp_path)
        learner1 = _make_learner(model_path)

        for outcome in (1, 1, 0, 1, 0):  # 3 wins, 2 losses
            learner1.add_outcome(sequence=None, label=0, confidence=70.0, outcome=outcome)

        stats1 = learner1.stats()
        assert stats1["total_added"] == 5
        assert stats1["buffer_size"] == 5
        assert stats1["win_rate"] == pytest.approx(0.6)

        # Simulate a full process restart: a brand new OnlineLearner
        # instance, same model_path, nothing carried over in memory.
        learner2 = _make_learner(model_path)
        stats2 = learner2.stats()

        assert stats2["total_added"] == 5
        assert stats2["buffer_size"] == 5
        assert stats2["win_rate"] == pytest.approx(0.6)

    def test_further_updates_after_a_restart_continue_accumulating_not_reset(self, tmp_path):
        model_path = str(tmp_path)
        learner1 = _make_learner(model_path)
        for _ in range(13):
            learner1.add_outcome(sequence=None, label=0, confidence=60.0, outcome=1)

        learner2 = _make_learner(model_path)  # "restart"
        learner2.add_outcome(sequence=None, label=0, confidence=60.0, outcome=0)

        assert learner2.stats()["total_added"] == 14  # 13 + 1, not reset to 1

    def test_no_model_path_is_fully_backward_compatible(self):
        # Existing callers (and any test) that construct OnlineLearner
        # without model_path must keep working exactly as before --
        # in-memory only, no file I/O, no crash.
        learner = _make_learner(model_path=None)
        learner.add_outcome(sequence=None, label=0, confidence=50.0, outcome=1)
        stats = learner.stats()
        assert stats["total_added"] == 1
        assert stats["buffer_size"] == 1

    def test_state_file_written_at_the_expected_path(self, tmp_path):
        model_path = str(tmp_path)
        learner = _make_learner(model_path)
        learner.add_outcome(sequence=None, label=0, confidence=50.0, outcome=1)

        state_file = os.path.join(model_path, STATE_FILE)
        assert os.path.exists(state_file)
        with open(state_file) as f:
            data = json.load(f)
        assert data["total_added"] == 1
        assert data["outcomes"] == [1]

    def test_corrupt_state_file_falls_back_to_fresh_state_without_crashing(self, tmp_path):
        model_path = str(tmp_path)
        os.makedirs(model_path, exist_ok=True)
        with open(os.path.join(model_path, STATE_FILE), "w") as f:
            f.write("{not valid json")

        learner = _make_learner(model_path)  # must not raise
        assert learner.stats() == {"buffer_size": 0, "total_added": 0, "win_rate": None}

    def test_telemetry_outcomes_capped_at_replay_buffer_like_the_real_buffer(self, tmp_path):
        model_path = str(tmp_path)
        learner = _make_learner(model_path)
        for _ in range(REPLAY_BUFFER + 20):
            learner.add_outcome(sequence=None, label=0, confidence=50.0, outcome=1)

        assert learner.stats()["buffer_size"] == REPLAY_BUFFER
        assert learner.stats()["total_added"] == REPLAY_BUFFER + 20  # uncapped counter


class TestRealFineTuneBufferIsUntouchedByPersistence:
    """The actual algorithm state (self._buffer, used for
    _fine_tune_transformer) must NOT be faked back from persisted
    telemetry -- it has no sequence data to restore, by design."""

    def test_real_buffer_starts_empty_after_a_restart_even_with_persisted_telemetry(self, tmp_path):
        model_path = str(tmp_path)
        learner1 = _make_learner(model_path)
        real_seq = np.zeros((10, 5), dtype=np.float32)
        for _ in range(5):
            learner1.add_outcome(sequence=real_seq, label=0, confidence=70.0, outcome=1)
        assert len(learner1._buffer) == 5  # real buffer has real sequences

        learner2 = _make_learner(model_path)  # "restart"
        assert len(learner2._buffer) == 0  # real buffer legitimately empty
        assert learner2.stats()["total_added"] == 5  # telemetry still survived
        assert learner2.stats()["buffer_size"] == 5  # telemetry-reported, not the real buffer

    def test_a_sequence_less_outcome_still_counts_toward_reported_telemetry(self, tmp_path):
        # add_outcome() only appends to self._buffer when a sequence is
        # available (e.g. a signal evaluated in a different process --
        # see feedback_loop.py). Telemetry should still count it.
        model_path = str(tmp_path)
        learner = _make_learner(model_path)
        learner.add_outcome(sequence=None, label=0, confidence=70.0, outcome=1)

        assert len(learner._buffer) == 0
        assert learner.stats()["buffer_size"] == 1
        assert learner.stats()["total_added"] == 1
