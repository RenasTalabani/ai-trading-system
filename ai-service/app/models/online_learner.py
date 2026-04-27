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
import logging
from collections import deque
from typing import Optional, List

import numpy as np

logger = logging.getLogger("ai-service.online_learner")

UPDATE_INTERVAL = 10    # fine-tune after this many new experiences
MIN_SAMPLES     = 15    # minimum buffer size before any update
REPLAY_BUFFER   = 500   # max experiences kept


class Experience:
    __slots__ = ("sequence", "label", "confidence", "outcome")

    def __init__(self, sequence: np.ndarray, label: int, confidence: float, outcome: int):
        self.sequence   = sequence    # (SEQ_LEN, N_FEATURES) normalized
        self.label      = label       # 0=BUY, 1=HOLD, 2=SELL
        self.confidence = confidence
        self.outcome    = outcome     # 1=correct, 0=incorrect


class OnlineLearner:
    def __init__(self, transformer, calibrator, registry=None):
        self.transformer = transformer
        self.calibrator  = calibrator
        self.registry    = registry
        self._buffer: deque = deque(maxlen=REPLAY_BUFFER)
        self._since_update  = 0
        self._total_added   = 0

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
        n = len(self._buffer)
        if n == 0:
            return {"buffer_size": 0, "total_added": self._total_added, "win_rate": None}
        win_rate = sum(e.outcome for e in self._buffer) / n
        return {
            "buffer_size":   n,
            "total_added":   self._total_added,
            "win_rate":      round(win_rate, 4),
            "updates_until_finetune": max(0, UPDATE_INTERVAL - self._since_update),
        }
