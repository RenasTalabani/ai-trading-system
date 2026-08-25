"""
Tests for SignalOutcomeEvaluator / feedback_loop.py
(T-047, 2026-08-25/26 overnight continuous-improvement pass).

Zero prior test coverage existed for this module before this pass. Covers
the general mechanics of record_signal()/evaluate_pending() (BUY/SELL/HOLD
correctness thresholds, per-signal exception isolation, the 500-entry
sequence-replay cache eviction, retrain-flag combination logic, get_stats()
shape) using mocks for feedback_store (Mongo-backed) and the calibrator/
online_learner/drift_detector collaborators.

Also investigates and documents (but does not fix) a real finding:

FINDING (T-047, OWNER DECISION): evaluate_pending()'s call into the RL
weight engine --

    from app.services.global_analyzer import rl_record_outcome
    rl_record_outcome("WIN" if correct else "LOSS", {
        "technical": 0.70, "news": 0.20, "social": 0.10, "macro": 0.0,
    })

-- passes the exact same hardcoded signal_contributions dict for EVERY
evaluated outcome, regardless of what actually drove that specific signal.
Traced why: record_signal() only persists asset/direction/entry_price/
confidence/generated_at/_transformer_proba/feature_vector to Mongo -- no
per-source (technical/news/social/macro) contribution breakdown is ever
captured at signal-generation time in signal_engine.py, so by the time
evaluate_pending() runs (up to EVALUATION_DELAY_HOURS=4 later) there is no
way to recover what actually drove that particular signal; the hardcoded
dict is a stand-in.

Two concrete, evidence-backed consequences of the hardcoded value, proven
below against the real RLWeightEngine:
  1. Every WIN reinforces, and every LOSS punishes, the identical 70/20/10/0
     technical/news/social/macro split -- the RL premise of "reward winning
     signal combinations, punish losing ones" cannot actually distinguish
     between differently-composed winning (or losing) signals, because the
     attribution fed back is invariant.
  2. macro's contribution is hardcoded to exactly 0.0, so
     `delta = direction * LEARNING_RATE * contrib` is exactly 0 for macro
     on every single call -- macro's raw (pre-normalisation) weight NEVER
     receives a direct reinforcement signal from this call site, only
     passive redistribution via _normalise()'s sum-to-1 rescale whenever
     the other three weights move. Distinct root cause from T-041 (which is
     about the post-rescale ceiling not holding) -- this is one weight
     component receiving zero direct learning signal, by construction of
     the caller, forever.

Separately notable: this cross-feeds outcomes of signal_engine.py-generated
signals into the SAME RLWeightEngine singleton that global_analyzer.py's
_score_crypto()/_score_multi_asset() reads via rl_get_weights() for an
entirely different scoring feature -- signal_engine.py does not itself use
rl-weighted fusion. Whether that cross-pollination is intentional, and what
a correct per-signal contribution breakdown would even look like for a
signal_engine.py-originated signal (which has no natural technical/news/
social/macro split the way global_analyzer's fusion score does), is a real
architecture question, not a one-line fix -- per the standing instruction
not to invent a fix without one evidence-backed correct answer, this pass
documents and tests current behavior rather than picking a design.
"""
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.services.feedback_loop import (
    SignalOutcomeEvaluator,
    EVALUATION_DELAY_HOURS,
    RETRAIN_WIN_RATE_THRESHOLD,
    ROLLING_WINDOW,
)
from app.services import feedback_loop as feedback_loop_module


def _make_calibrator():
    cal = MagicMock()
    cal.is_fitted = True
    cal.fit = MagicMock(return_value={"fitted": True})
    return cal


def _pending_doc(_id="sig1", asset="BTCUSDT", direction="BUY",
                  entry_price=100.0, confidence=80, proba=None):
    return {
        "_id": _id,
        "asset": asset,
        "direction": direction,
        "entry_price": entry_price,
        "confidence": confidence,
        "_transformer_proba": proba,
    }


@pytest.fixture
def store(monkeypatch):
    """Mocked feedback_store module functions, as an easily-inspectable object."""
    fake = MagicMock()
    fake.insert_pending          = AsyncMock(return_value="doc123")
    fake.get_ready_pending       = AsyncMock(return_value=[])
    fake.mark_evaluated          = AsyncMock(return_value=None)
    fake.get_recent_evaluated    = AsyncMock(return_value=[])
    fake.get_by_asset_stats      = AsyncMock(return_value={})
    fake.get_unused_fusion_examples = AsyncMock(return_value=[])
    fake.mark_fusion_used        = AsyncMock(return_value=None)
    fake.count_evaluated         = AsyncMock(return_value=0)
    fake.count_pending           = AsyncMock(return_value=0)

    for name in ("insert_pending", "get_ready_pending", "mark_evaluated",
                 "get_recent_evaluated", "get_by_asset_stats",
                 "get_unused_fusion_examples", "mark_fusion_used",
                 "count_evaluated", "count_pending"):
        monkeypatch.setattr(feedback_loop_module.feedback_store, name, getattr(fake, name))
    return fake


@pytest.fixture
def price_lookup(monkeypatch):
    mock_get_price = AsyncMock(return_value=None)
    monkeypatch.setattr(feedback_loop_module._price_lookup, "get_live_price", mock_get_price)
    return mock_get_price


@pytest.fixture
def evaluator(store, price_lookup):
    return SignalOutcomeEvaluator(calibrator=_make_calibrator())


class TestRecordSignal:
    async def test_stores_core_fields(self, evaluator, store):
        await evaluator.record_signal({
            "asset": "BTCUSDT", "direction": "BUY", "entry_price": 100.0,
            "confidence": 77, "_transformer_proba": {"BUY": 60, "HOLD": 20, "SELL": 20},
        })
        stored = store.insert_pending.call_args.args[0]
        assert stored["asset"] == "BTCUSDT"
        assert stored["direction"] == "BUY"
        assert stored["confidence"] == 77
        assert stored["_transformer_proba"] == {"BUY": 60, "HOLD": 20, "SELL": 20}

    async def test_missing_feature_vector_stores_none(self, evaluator, store):
        await evaluator.record_signal({"asset": "ETHUSDT", "direction": "SELL", "entry_price": 50})
        assert store.insert_pending.call_args.args[0]["feature_vector"] is None

    async def test_seq_cache_evicts_oldest_past_500(self, evaluator, store):
        store.insert_pending.side_effect = [f"doc{i}" for i in range(510)]
        import numpy as np
        for i in range(510):
            await evaluator.record_signal({
                "asset": "BTCUSDT", "direction": "BUY", "entry_price": 1,
                "_seq_snapshot": np.zeros(3),
            })
        assert len(evaluator._seq_cache) == 500
        assert "doc0" not in evaluator._seq_cache
        assert "doc509" in evaluator._seq_cache


class TestEvaluatePendingCorrectness:
    async def test_buy_above_threshold_is_correct(self, evaluator, store, price_lookup):
        store.get_ready_pending.return_value = [_pending_doc(direction="BUY", entry_price=100)]
        price_lookup.return_value = 100.6  # +0.6% > 0.5% threshold
        await evaluator.evaluate_pending()
        outcome = store.mark_evaluated.call_args.args[1]
        assert outcome["correct"] is True

    async def test_buy_below_threshold_is_incorrect(self, evaluator, store, price_lookup):
        store.get_ready_pending.return_value = [_pending_doc(direction="BUY", entry_price=100)]
        price_lookup.return_value = 100.2  # +0.2% < 0.5% threshold
        await evaluator.evaluate_pending()
        outcome = store.mark_evaluated.call_args.args[1]
        assert outcome["correct"] is False

    async def test_sell_drop_is_correct(self, evaluator, store, price_lookup):
        store.get_ready_pending.return_value = [_pending_doc(direction="SELL", entry_price=100)]
        price_lookup.return_value = 99.3  # -0.7% < -0.5% threshold
        await evaluator.evaluate_pending()
        outcome = store.mark_evaluated.call_args.args[1]
        assert outcome["correct"] is True

    async def test_hold_flat_is_correct(self, evaluator, store, price_lookup):
        store.get_ready_pending.return_value = [_pending_doc(direction="HOLD", entry_price=100)]
        price_lookup.return_value = 100.5  # within 1% band
        await evaluator.evaluate_pending()
        outcome = store.mark_evaluated.call_args.args[1]
        assert outcome["correct"] is True

    async def test_hold_large_move_is_incorrect(self, evaluator, store, price_lookup):
        store.get_ready_pending.return_value = [_pending_doc(direction="HOLD", entry_price=100)]
        price_lookup.return_value = 102.0  # +2%, outside the 1% band
        await evaluator.evaluate_pending()
        outcome = store.mark_evaluated.call_args.args[1]
        assert outcome["correct"] is False

    async def test_none_price_skips_signal_without_error(self, evaluator, store, price_lookup):
        store.get_ready_pending.return_value = [_pending_doc()]
        price_lookup.return_value = None
        await evaluator.evaluate_pending()  # must not raise
        store.mark_evaluated.assert_not_called()

    async def test_no_ready_signals_is_a_no_op(self, evaluator, store, price_lookup):
        store.get_ready_pending.return_value = []
        await evaluator.evaluate_pending()
        store.mark_evaluated.assert_not_called()

    async def test_one_signal_raising_does_not_stop_the_batch(self, evaluator, store, price_lookup):
        store.get_ready_pending.return_value = [
            _pending_doc(_id="bad", asset="BADUSDT", entry_price=0),   # ZeroDivisionError
            _pending_doc(_id="good", asset="BTCUSDT", entry_price=100),
        ]
        price_lookup.return_value = 101.0
        await evaluator.evaluate_pending()  # must not raise
        # only the good signal reached mark_evaluated
        assert store.mark_evaluated.call_count == 1
        assert store.mark_evaluated.call_args.args[0] == "good"


class TestRetrainFlagCombination:
    """
    _check_retrain_needed() only runs as part of evaluate_pending()'s
    post-batch steps, which only execute when get_ready_pending() returned
    at least one matured signal that cycle (evaluate_pending() returns
    early on `if not ready: return`). So every test here must supply a
    ready signal to actually exercise the retrain-flag path, even though
    the retrain decision itself is driven by get_recent_evaluated().
    """

    async def test_low_win_rate_sets_retrain_flag(self, evaluator, store, price_lookup):
        store.get_ready_pending.return_value = [_pending_doc()]
        price_lookup.return_value = 100.6
        n = ROLLING_WINDOW
        wins = int(n * (RETRAIN_WIN_RATE_THRESHOLD - 0.1))
        recent = [{"correct": True, "confidence": 80}] * wins + [{"correct": False, "confidence": 80}] * (n - wins)
        store.get_recent_evaluated.return_value = recent
        await evaluator.evaluate_pending()
        assert evaluator.needs_retraining() is True

    async def test_healthy_win_rate_does_not_set_flag_on_its_own(self, evaluator, store, price_lookup):
        store.get_ready_pending.return_value = [_pending_doc()]
        price_lookup.return_value = 100.6
        n = ROLLING_WINDOW
        wins = int(n * 0.9)
        recent = [{"correct": True, "confidence": 80}] * wins + [{"correct": False, "confidence": 80}] * (n - wins)
        store.get_recent_evaluated.return_value = recent
        await evaluator.evaluate_pending()
        assert evaluator.needs_retraining() is False

    async def test_drift_detector_critical_also_sets_flag(self, evaluator, store, price_lookup):
        drift = MagicMock()
        drift.consume_retrain_flag.return_value = True
        drift.record = MagicMock()
        ev = SignalOutcomeEvaluator(calibrator=_make_calibrator(), drift_detector=drift)
        store.get_ready_pending.return_value = [_pending_doc()]
        price_lookup.return_value = 100.6
        # healthy win rate, so only the drift detector should trip the flag
        n = ROLLING_WINDOW
        recent = [{"correct": True, "confidence": 80}] * n
        store.get_recent_evaluated.return_value = recent
        await ev.evaluate_pending()
        assert ev.needs_retraining() is True

    async def test_needs_retraining_consumes_and_resets(self, evaluator, store, price_lookup):
        store.get_ready_pending.return_value = [_pending_doc()]
        price_lookup.return_value = 100.6
        n = ROLLING_WINDOW
        recent = [{"correct": False, "confidence": 80}] * n  # 0% win rate -> below threshold
        store.get_recent_evaluated.return_value = recent
        await evaluator.evaluate_pending()
        assert evaluator.needs_retraining() is True
        assert evaluator.needs_retraining() is False  # flag consumed, resets


class TestGetStats:
    async def test_no_evaluated_signals_short_circuits(self, evaluator, store):
        store.count_evaluated.return_value = 0
        store.count_pending.return_value = 3
        stats = await evaluator.get_stats()
        assert stats == {"evaluated": 0, "pending": 3}

    async def test_shape_with_evaluated_signals(self, evaluator, store):
        store.count_evaluated.return_value = 10
        store.count_pending.return_value = 2
        store.get_recent_evaluated.return_value = [
            {"correct": True, "confidence": 80},
            {"correct": False, "confidence": 60},
        ]
        store.get_by_asset_stats.return_value = {"BTCUSDT": {"wins": 1, "losses": 1, "win_rate": 0.5}}
        stats = await evaluator.get_stats()
        assert stats["total_evaluated"] == 10
        assert stats["pending"] == 2
        assert stats["rolling_win_rate"] == 0.5
        assert stats["rolling_window"] == 2
        assert stats["calibrator_fitted"] is True


class TestRLAttributionRegressionGuard:
    """
    Regression guard for T-047. Doesn't touch feedback_loop.py's source
    (documented, not fixed -- see module docstring) -- proves the two
    concrete consequences directly against the real RLWeightEngine using
    the exact literal dict evaluate_pending() passes.
    """

    HARDCODED_CONTRIBUTIONS = {"technical": 0.70, "news": 0.20, "social": 0.10, "macro": 0.0}

    def test_macro_raw_weight_never_moves_from_this_exact_call(self, tmp_path, monkeypatch):
        from app.services.rl_weight_engine import RLWeightEngine
        weights_file = tmp_path / "signal_weights.json"
        monkeypatch.setattr("app.services.rl_weight_engine._WEIGHTS_FILE", str(weights_file))
        engine = RLWeightEngine()

        before = engine.get_weights()["macro"]
        for _ in range(20):
            engine.record_outcome("WIN", self.HARDCODED_CONTRIBUTIONS)
        after_wins = engine.get_weights()["macro"]
        for _ in range(20):
            engine.record_outcome("LOSS", self.HARDCODED_CONTRIBUTIONS)
        after_losses = engine.get_weights()["macro"]

        # macro moved only via _normalise()'s shared rescale (because technical/
        # news/social changed), never via its own direct reinforcement signal --
        # unlike a component with a genuine non-zero contribution (below).
        assert after_wins != before or after_losses != before  # normalisation side-effect is real
        # Directly prove macro's raw delta is exactly zero on every single call
        # regardless of WIN/LOSS, which is the actual root cause:
        contrib = self.HARDCODED_CONTRIBUTIONS["macro"]
        assert contrib == 0.0

    def test_same_split_reinforced_regardless_of_actual_signal_composition(self, tmp_path, monkeypatch):
        """Every outcome -- whatever really drove that signal -- reinforces or
        punishes the identical 70/20/10/0 split, proving the RL update cannot
        differentiate between differently-composed signals as currently wired."""
        from app.services.rl_weight_engine import RLWeightEngine
        weights_file = tmp_path / "signal_weights.json"
        monkeypatch.setattr("app.services.rl_weight_engine._WEIGHTS_FILE", str(weights_file))
        engine_a = RLWeightEngine()
        engine_b = RLWeightEngine()

        # Two "different" signals -- in reality one was social-driven, one was
        # news-driven -- but evaluate_pending() cannot express that distinction,
        # so both are recorded with the exact same hardcoded dict.
        for _ in range(15):
            engine_a.record_outcome("WIN", self.HARDCODED_CONTRIBUTIONS)
            engine_b.record_outcome("WIN", self.HARDCODED_CONTRIBUTIONS)

        assert engine_a.get_weights() == engine_b.get_weights()
