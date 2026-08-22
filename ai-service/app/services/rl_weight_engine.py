"""
RLWeightEngine — self-learning signal weight adjustment.
Reward winning signal combinations, punish losing ones.
Weights stored in saved_models/signal_weights.json (survives restarts).
"""
import json
import logging
import os
import threading
from typing import Optional

logger = logging.getLogger("ai-service.rl_weight_engine")

_WEIGHTS_FILE = os.path.join(
    os.environ.get("MODEL_PATH", "./saved_models"),
    "signal_weights.json",
)

DEFAULT_WEIGHTS = {
    "technical": 0.45,
    "news":      0.20,
    "social":    0.10,
    "macro":     0.25,
}

LEARNING_RATE   = 0.02    # how much to shift on each update

# T-041 (2026-08-22) NOTE ON ACTUAL BEHAVIOR:
# MIN_WEIGHT/MAX_WEIGHT are applied to each weight's *pre-normalisation*
# raw value inside record_outcome(), before _normalise() rescales the
# whole dict to sum to 1.0. That rescale step is not itself bounded, so
# the *effective* weight actually returned by get_weights() (and used
# directly in every live rl_score fusion formula, e.g.
# GlobalAnalyzer._score_crypto()'s
# `rl_score = fs*weights["technical"] + news_sc*weights["news"] + ...`)
# can end up outside [MIN_WEIGHT, MAX_WEIGHT] despite the names "floor"
# and "ceiling" implying an absolute bound on that effective weight.
# Confirmed by simulation: sustained, realistic feedback where the same
# signal source keeps winning while the other three keep losing (exactly
# the steady-state this module exists to reach) converges "technical" to
# an effective weight of ~0.7277 -- above the documented 0.70 ceiling --
# while the other three settle above the 0.05 floor. The magnitude is
# modest (roughly +4% over the stated ceiling in the worst realistic case
# found), and it only manifests after many (~hundreds of) consistent
# updates, not on any single call.
# A "fix" that enforces both constraints at once (weights sum to 1.0 AND
# every individual weight in [MIN_WEIGHT, MAX_WEIGHT]) requires an actual
# algorithm choice (e.g. iterative water-filling redistribution of the
# clamped excess/deficit across the unclamped weights) rather than a
# single unambiguous one-line change, and changes live signal-fusion
# weights -- so, per the standing instruction not to invent fixes without
# one evidence-backed correct answer, this pass documents and tests the
# actual behavior rather than changing it. See TASKS.md/PROJECT_STATUS.md
# T-041 for the corresponding OWNER DECISION flag.
MIN_WEIGHT      = 0.05    # floor on each weight's raw pre-normalisation value
MAX_WEIGHT      = 0.70    # ceiling on each weight's raw pre-normalisation value
MIN_UPDATES_LOG = 5       # only log drift after N updates


class RLWeightEngine:

    def __init__(self):
        self._lock    = threading.Lock()
        self._weights = self._load()
        self._updates = 0

    # ── Public API ────────────────────────────────────────────────────────────

    def get_weights(self) -> dict:
        with self._lock:
            return dict(self._weights)

    def record_outcome(
        self,
        result: str,                     # "WIN" or "LOSS"
        signal_contributions: dict,      # e.g. {"technical": 0.6, "news": 0.3, ...}
    ) -> dict:
        """
        Update weights based on trade outcome.
        signal_contributions = normalised fraction each source contributed to decision.
        Returns new weights.
        """
        if result not in ("WIN", "LOSS"):
            return self.get_weights()

        direction = 1 if result == "WIN" else -1

        with self._lock:
            for key in DEFAULT_WEIGHTS:
                contrib = signal_contributions.get(key, 0.25)
                delta   = direction * LEARNING_RATE * contrib
                self._weights[key] = max(
                    MIN_WEIGHT,
                    min(MAX_WEIGHT, self._weights[key] + delta),
                )

            self._weights = self._normalise(self._weights)
            self._updates += 1

            if self._updates % 10 == 0:
                logger.info(
                    f"[RL] weights after {self._updates} updates: "
                    + ", ".join(f"{k}={v:.3f}" for k, v in self._weights.items())
                )

            self._save()
            return dict(self._weights)

    def reset(self) -> dict:
        with self._lock:
            self._weights = dict(DEFAULT_WEIGHTS)
            self._updates = 0
            self._save()
            return dict(self._weights)

    def stats(self) -> dict:
        with self._lock:
            return {
                "weights":       dict(self._weights),
                "total_updates": self._updates,
                "weights_file":  _WEIGHTS_FILE,
            }

    # ── Internals ─────────────────────────────────────────────────────────────

    def _load(self) -> dict:
        try:
            if os.path.exists(_WEIGHTS_FILE):
                with open(_WEIGHTS_FILE) as f:
                    data = json.load(f)
                weights = {k: float(data.get(k, DEFAULT_WEIGHTS[k])) for k in DEFAULT_WEIGHTS}
                logger.info(f"[RL] Loaded weights: {weights}")
                return self._normalise(weights)
        except Exception as e:
            logger.warning(f"[RL] Could not load weights, using defaults: {e}")
        return dict(DEFAULT_WEIGHTS)

    def _save(self) -> None:
        try:
            os.makedirs(os.path.dirname(_WEIGHTS_FILE), exist_ok=True)
            with open(_WEIGHTS_FILE, "w") as f:
                json.dump(self._weights, f, indent=2)
        except Exception as e:
            logger.warning(f"[RL] Could not save weights: {e}")

    @staticmethod
    def _normalise(w: dict) -> dict:
        total = sum(w.values())
        if total <= 0:
            return dict(DEFAULT_WEIGHTS)
        return {k: round(v / total, 4) for k, v in w.items()}
