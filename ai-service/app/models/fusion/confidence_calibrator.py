"""
Confidence Calibrator
Maps raw model confidence scores to empirically-calibrated probabilities.
Uses isotonic regression — no assumptions about distribution shape.
Calibration data comes from the feedback loop (signal outcomes).
"""
import logging
import os
import numpy as np
import joblib
from typing import List, Tuple, Optional

logger = logging.getLogger("ai-service.calibrator")

CALIBRATOR_FILE = "confidence_calibrator.joblib"


class ConfidenceCalibrator:
    """
    Platt scaling + isotonic regression confidence calibrator.
    Trained on historical signal outcomes:
      X = raw_confidence (0–100)
      y = 1 if signal was correct, 0 if wrong
    Outputs calibrated confidence that reflects true win probability.
    """

    def __init__(self, model_path: str):
        self.model_path = model_path
        self.calibrator = None
        self.is_fitted  = False
        self._try_load()

    def _path(self) -> str:
        return os.path.join(self.model_path, CALIBRATOR_FILE)

    def _try_load(self):
        p = self._path()
        if os.path.exists(p):
            try:
                self.calibrator = joblib.load(p)
                self.is_fitted  = True
                logger.info("Confidence calibrator loaded from disk.")
            except Exception as e:
                logger.warning(f"Failed to load calibrator: {e}")

    def fit(self, confidences: List[float], outcomes: List[int]) -> dict:
        """
        confidences: raw model confidence 0–100
        outcomes:    1 = correct signal, 0 = wrong signal
        """
        if len(confidences) < 20:
            return {"success": False, "message": f"Need >= 20 samples, got {len(confidences)}"}

        from sklearn.isotonic import IsotonicRegression
        X = np.array(confidences) / 100.0
        y = np.array(outcomes, dtype=float)

        self.calibrator = IsotonicRegression(out_of_bounds="clip")
        self.calibrator.fit(X, y)
        self.is_fitted = True

        joblib.dump(self.calibrator, self._path())

        # Compute calibration error
        preds = self.calibrator.predict(X)
        brier = float(np.mean((preds - y) ** 2))
        logger.info(f"Calibrator fitted on {len(confidences)} samples. Brier score: {brier:.4f}")
        return {"success": True, "samples": len(confidences), "brier_score": round(brier, 4)}

    def calibrate(self, raw_confidence: float) -> float:
        """Return calibrated confidence (0–100). Falls back to raw if not fitted."""
        if not self.is_fitted or self.calibrator is None:
            return raw_confidence
        try:
            calibrated = float(self.calibrator.predict([raw_confidence / 100.0])[0])
            return round(calibrated * 100, 1)
        except Exception:
            return raw_confidence

    def calibrate_batch(self, confidences: List[float]) -> List[float]:
        if not self.is_fitted:
            return confidences
        return [self.calibrate(c) for c in confidences]

    def expected_accuracy(self, confidence: float) -> float:
        """What win rate should we expect at this confidence level?"""
        return self.calibrate(confidence) / 100.0
