"""
Phase 8 — Model Drift Detector

Monitors live prediction quality to detect when the model needs retraining.

Signals for drift:
  1. Win rate drops below WARN_THRESHOLD for WINDOW consecutive evaluated signals
  2. Prediction distribution entropy increases significantly (model becoming uncertain)
  3. Confidence-accuracy calibration gap widens
"""
import logging
from collections import deque

import numpy as np

logger = logging.getLogger("ai-service.drift_detector")

WARN_THRESHOLD  = 0.45   # win rate below this = warning
CRIT_THRESHOLD  = 0.38   # win rate below this = critical / auto-retrain
WINDOW          = 30     # rolling window for win rate
ENTROPY_BASELINE_WINDOW = 100  # signals to establish baseline entropy


class DriftDetector:
    def __init__(self):
        self._outcomes:      deque = deque(maxlen=WINDOW)
        self._confidences:   deque = deque(maxlen=WINDOW)
        self._entropies:     deque = deque(maxlen=ENTROPY_BASELINE_WINDOW)
        self._baseline_entropy: float | None = None
        self.drift_level     = "none"   # none | warn | critical
        self.retrain_needed  = False

    def record(self, confidence: float, proba: dict, outcome: int) -> str:
        """
        Record one evaluated signal.
        proba   — dict with BUY/SELL/HOLD probabilities (0–100)
        outcome — 1=correct, 0=incorrect
        Returns current drift_level.
        """
        self._outcomes.append(outcome)
        self._confidences.append(confidence)

        # Compute prediction entropy
        p = np.array([proba.get("BUY", 33.3), proba.get("HOLD", 33.3), proba.get("SELL", 33.3)]) / 100.0
        p = np.clip(p, 1e-9, 1.0)
        entropy = float(-np.sum(p * np.log(p)))
        self._entropies.append(entropy)

        # Establish baseline after first window
        if len(self._entropies) == ENTROPY_BASELINE_WINDOW and self._baseline_entropy is None:
            self._baseline_entropy = float(np.mean(list(self._entropies)))
            logger.info(f"DriftDetector: baseline entropy established = {self._baseline_entropy:.4f}")

        self._assess()
        return self.drift_level

    def _assess(self):
        if len(self._outcomes) < 15:
            return

        win_rate = sum(self._outcomes) / len(self._outcomes)

        # Entropy drift
        entropy_drift = False
        if self._baseline_entropy and len(self._entropies) >= 10:
            recent_entropy = float(np.mean(list(self._entropies)[-10:]))
            if recent_entropy > self._baseline_entropy * 1.25:   # 25% more uncertain
                entropy_drift = True
                logger.warning(
                    f"DriftDetector: entropy drift detected "
                    f"({recent_entropy:.4f} vs baseline {self._baseline_entropy:.4f})"
                )

        # Calibration gap
        avg_conf     = float(np.mean(list(self._confidences))) / 100.0
        actual_wr    = win_rate
        calib_gap    = abs(avg_conf - actual_wr)
        calib_drift  = calib_gap > 0.20   # >20pp gap = poor calibration

        if win_rate < CRIT_THRESHOLD or (entropy_drift and win_rate < WARN_THRESHOLD):
            self.drift_level    = "critical"
            self.retrain_needed = True
            logger.error(
                f"DriftDetector: CRITICAL drift — win_rate={win_rate:.1%}, "
                f"entropy_drift={entropy_drift}, calib_gap={calib_gap:.2f}"
            )
        elif win_rate < WARN_THRESHOLD or entropy_drift or calib_drift:
            self.drift_level    = "warn"
            self.retrain_needed = False
            logger.warning(
                f"DriftDetector: WARNING drift — win_rate={win_rate:.1%}, "
                f"entropy_drift={entropy_drift}, calib_gap={calib_gap:.2f}"
            )
        else:
            self.drift_level = "none"

    def consume_retrain_flag(self) -> bool:
        flag = self.retrain_needed
        self.retrain_needed = False
        return flag

    def status(self) -> dict:
        n = len(self._outcomes)
        win_rate = sum(self._outcomes) / n if n else None
        avg_conf = float(np.mean(list(self._confidences))) / 100.0 if self._confidences else None
        avg_ent  = float(np.mean(list(self._entropies)[-10:])) if len(self._entropies) >= 10 else None

        return {
            "drift_level":        self.drift_level,
            "retrain_needed":     self.retrain_needed,
            "rolling_win_rate":   round(win_rate, 4) if win_rate else None,
            "rolling_window":     n,
            "avg_confidence":     round(avg_conf * 100, 1) if avg_conf else None,
            "avg_entropy":        round(avg_ent, 4) if avg_ent else None,
            "baseline_entropy":   round(self._baseline_entropy, 4) if self._baseline_entropy else None,
            "warn_threshold":     WARN_THRESHOLD,
            "critical_threshold": CRIT_THRESHOLD,
        }
