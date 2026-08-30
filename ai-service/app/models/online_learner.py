"""
Phase 8 — Online / Incremental Learning

Continuously adapts the Transformer and confidence calibrator
from real signal outcomes without requiring full retraining.

Strategy:
  - Experience replay buffer (max 500 entries)
  - Fine-tune Transformer every UPDATE_INTERVAL new outcomes
  - Re-fit calibrator on every new outcome batch
  - Update fusion model feature weights periodically
"""
import json
import logging
import os
from collections import deque
from typing import Optional, List

import numpy as np

logger = logging.getLogger("ai-service.online_learner")

UPDATE_INTERVAL = 10    # fine-tune after this many new experiences
MIN_SAMPLES     = 15    # minimum buffer size before any update
REPLAY_BUFFER   = 500   # max experiences kept

# T-072 (2026-08-30, owner-authorized): GET /api/health's
# phase8.online_learning (buffer_size/total_added/win_rate, from stats()
# below) was purely in-memory and confirmed, via overnight testing, to
# reset to near-zero on every service restart (total_added observed
# dropping from ~55 to ~13). This does NOT persist -- or try to
# reconstruct -- the real Transformer fine-tuning buffer (self._buffer):
# that buffer holds full normalised (SEQ_LEN, N_FEATURES) sequence arrays
# that are only ever available for signals evaluated in the same process
# that generated them (feedback_loop.py's own comment: "sequence replay
# only available... lost across a restart since numpy arrays aren't
# Mongo-stored") -- faking that back from a JSON file would misrepresent
# what fine-tuning actually has to work with, which is real
# algorithm-behavior, out of this task's narrow scope.
# Instead, a separate, lightweight *telemetry* record -- just the
# win/loss outcome (0/1) of every evaluated signal, capped at
# REPLAY_BUFFER entries like the real buffer, no sequence/label data --
# is write-through-persisted to a local JSON file, matching this
# codebase's existing pattern for this kind of small durable counter
# (RLWeightEngine's saved_models/signal_weights.json,
# ModelRegistry's saved_models/registry.json). self._buffer and
# self._since_update (the real fine-tune-eligibility state) are
# completely untouched and still legitimately start empty/zero after a
# restart, exactly as before this change.
STATE_FILE = "online_learner_state.json"


class Experience:
    __slots__ = ("sequence", "label", "confidence", "outcome")

    def __init__(self, sequence: np.ndarray, label: int, confidence: float, outcome: int):
        self.sequence   = sequence    # (SEQ_LEN, N_FEATURES) normalized
        self.label      = label       # 0=BUY, 1=HOLD, 2=SELL
        self.confidence = confidence
        self.outcome    = outcome     # 1=correct, 0=incorrect


class OnlineLearner:
    def __init__(self, transformer, calibrator, registry=None, model_path: Optional[str] = None):
        self.transformer = transformer
        self.calibrator  = calibrator
        self.registry    = registry
        self._buffer: deque = deque(maxlen=REPLAY_BUFFER)
        self._since_update  = 0

        # T-072: persisted telemetry only -- see module comment above.
        # `model_path` is optional (defaults to no persistence, e.g. in
        # existing unit tests that construct OnlineLearner directly)
        # so this is fully backward compatible.
        self._state_path = os.path.join(model_path, STATE_FILE) if model_path else None
        self._total_added, restored_outcomes = self._load_state()
        self._telemetry_outcomes: deque = deque(restored_outcomes, maxlen=REPLAY_BUFFER)

    def _load_state(self) -> tuple:
        if self._state_path and os.path.exists(self._state_path):
            try:
                with open(self._state_path) as f:
                    data = json.load(f)
                total_added = int(data.get("total_added", 0))
                outcomes    = [int(o) for o in data.get("outcomes", [])]
                logger.info(
                    f"OnlineLearner: restored persisted telemetry "
                    f"(total_added={total_added}, {len(outcomes)} outcomes)"
                )
                return total_added, outcomes
            except Exception as e:
                logger.warning(f"OnlineLearner: could not load persisted telemetry, starting fresh: {e}")
        return 0, []

    def _save_state(self) -> None:
        if not self._state_path:
            return
        try:
            os.makedirs(os.path.dirname(self._state_path), exist_ok=True)
            with open(self._state_path, "w") as f:
                json.dump({
                    "total_added": self._total_added,
                    "outcomes":    list(self._telemetry_outcomes),
                }, f)
        except Exception as e:
            logger.warning(f"OnlineLearner: could not persist telemetry: {e}")

    def add_outcome(self,
                    sequence: Optional[np.ndarray],
                    label: int,
                    confidence: float,
                    outcome: int) -> None:
        """
        Record a resolved signal outcome.
        sequence — the normalized (SEQ_LEN, N_FEATURES) array at signal time.
        label    — predicted class (0=BUY, 1=HOLD, 2=SELL)
        outcome  — 1=win, 0=loss
        """
        if sequence is not None:
            self._buffer.append(Experience(sequence, label, confidence, outcome))
        self._since_update  += 1
        self._total_added   += 1

        # T-072: telemetry-only record, independent of self._buffer above
        # (which stays real-sequence-only, in-memory, restart-reset).
        self._telemetry_outcomes.append(int(outcome))
        self._save_state()

        # Always update calibrator immediately — it's fast
        self._update_calibrator()

        # Fine-tune Transformer periodically
        if (self._since_update >= UPDATE_INTERVAL and
                len(self._buffer) >= MIN_SAMPLES):
            self._fine_tune_transformer()
            self._since_update = 0

    def _update_calibrator(self):
        if len(self._buffer) < 10:
            return
        confidences = [e.confidence for e in self._buffer]
        outcomes    = [e.outcome    for e in self._buffer]
        try:
            result = self.calibrator.fit(confidences, outcomes)
            logger.debug(f"OnlineLearner: calibrator updated ({len(self._buffer)} samples). {result}")
        except Exception as e:
            logger.warning(f"OnlineLearner: calibrator update failed: {e}")

    def _fine_tune_transformer(self):
        if not self.transformer or not self.transformer.is_trained:
            return

        # Use full replay buffer
        seqs   = np.array([e.sequence for e in self._buffer], dtype=np.float32)
        labels = np.array([e.label    for e in self._buffer], dtype=np.int64)

        try:
            result = self.transformer.fine_tune(seqs, labels, epochs=3, lr=1e-5)
            if result.get("success"):
                logger.info(
                    f"OnlineLearner: Transformer fine-tuned on {result['samples']} samples, "
                    f"avg_loss={result.get('avg_loss','?')}"
                )
                if self.registry:
                    win_rate = sum(e.outcome for e in self._buffer) / len(self._buffer)
                    self.registry.record_performance(
                        win_rate=win_rate,
                        n_signals=len(self._buffer),
                        notes="online-learning-update",
                    )
        except Exception as e:
            logger.warning(f"OnlineLearner: Transformer fine-tune failed: {e}")

    def force_update(self) -> dict:
        """Manually trigger all updates — useful after bulk evaluation."""
        self._update_calibrator()
        if len(self._buffer) >= MIN_SAMPLES:
            self._fine_tune_transformer()
            self._since_update = 0
        return self.stats()

    def stats(self) -> dict:
        # T-072: buffer_size/win_rate below are read from the persisted
        # telemetry deque (survives a restart), not the real fine-tune
        # buffer self._buffer (sequence-bearing, in-memory only, and
        # unavoidably restart-empty -- see module comment). Reported
        # numbers are therefore a superset of what self._buffer ever held
        # (it only gets sequence-bearing entries), which is intentional:
        # this is meant to answer "how is the online learner doing
        # overall", not "how big is the in-memory fine-tune queue".
        n = len(self._telemetry_outcomes)
        if n == 0:
            return {"buffer_size": 0, "total_added": self._total_added, "win_rate": None}
        win_rate = sum(self._telemetry_outcomes) / n
        return {
            "buffer_size":   n,
            "total_added":   self._total_added,
            "win_rate":      round(win_rate, 4),
            "updates_until_finetune": max(0, UPDATE_INTERVAL - self._since_update),
        }
