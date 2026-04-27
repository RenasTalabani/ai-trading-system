"""
Unified Fusion Model — the AI brain.
Combines outputs from:
  - RandomForest market model
  - LSTM market model
  - News sentiment (FinBERT/VADER)
  - Social sentiment (Telegram/Twitter/Reddit)
into a single calibrated prediction with confidence score.
"""
import logging
import os
import numpy as np
import joblib
from typing import Optional

from sklearn.ensemble import GradientBoostingClassifier
from sklearn.preprocessing import StandardScaler

logger = logging.getLogger("ai-service.fusion_model")

LABEL_MAP  = {0: "HOLD", 1: "BUY", 2: "SELL"}
ILABEL_MAP = {"HOLD": 0, "BUY": 1, "SELL": 2}

FUSION_MODEL_FILE  = "fusion_model.joblib"
FUSION_SCALER_FILE = "fusion_scaler.joblib"

# ─── Feature vector definition (Phase 8: 17 features) ────────────────────────
# [0]  rf_buy_prob           RandomForest P(BUY)
# [1]  rf_sell_prob          RandomForest P(SELL)
# [2]  rf_hold_prob          RandomForest P(HOLD)
# [3]  lstm_buy_prob         LSTM P(BUY)  (legacy, kept for back-compat)
# [4]  lstm_sell_prob        LSTM P(SELL)
# [5]  lstm_hold_prob        LSTM P(HOLD)
# [6]  news_market_score     News sentiment 0–1 (0=bearish, 1=bullish)
# [7]  news_impact           News impact score 0–1
# [8]  social_score          Social sentiment 0–1
# [9]  social_hype           Social hype level 0–1
# [10] social_manip          Manipulation flag 0/1
# [11] rsi_norm              RSI / 100
# [12] macd_hist_norm        MACD histogram normalized
# [13] vol_ratio_norm        Volume ratio capped at 3
# [14] transformer_buy_prob  Transformer P(BUY)  — Phase 8
# [15] transformer_sell_prob Transformer P(SELL) — Phase 8
# [16] transformer_hold_prob Transformer P(HOLD) — Phase 8
FEATURE_DIM    = 17
LEGACY_FEAT_DIM = 14  # models trained before Phase 8


class FusionModel:
    """
    Meta-learner that combines all signal sources.
    Phase 5: GradientBoosting (fast, interpretable).
    Phase 8 upgrade: replace with small Transformer.
    """

    def __init__(self, model_path: str):
        self.model_path = model_path
        self.model:  Optional[GradientBoostingClassifier] = None
        self.scaler: Optional[StandardScaler] = None
        self.is_trained = False
        self._try_load()

    def _model_file(self)  -> str: return os.path.join(self.model_path, FUSION_MODEL_FILE)
    def _scaler_file(self) -> str: return os.path.join(self.model_path, FUSION_SCALER_FILE)

    def _try_load(self):
        if os.path.exists(self._model_file()) and os.path.exists(self._scaler_file()):
            try:
                self.model  = joblib.load(self._model_file())
                self.scaler = joblib.load(self._scaler_file())
                self.is_trained = True
                logger.info("Fusion model loaded from disk.")
            except Exception as e:
                logger.warning(f"Failed to load fusion model: {e}")

    def build_feature_vector(
        self,
        rf_proba:          dict,
        lstm_proba:        dict,
        news_score:        float,
        news_impact:       float,
        social_score:      float,
        social_hype:       float,
        social_manip:      bool,
        rsi:               float,
        macd_hist:         float,
        vol_ratio:         float,
        transformer_proba: dict | None = None,
    ) -> np.ndarray:
        tp = transformer_proba or {}
        return np.array([
            rf_proba.get("BUY", 0.33)  / 100.0,
            rf_proba.get("SELL", 0.33) / 100.0,
            rf_proba.get("HOLD", 0.34) / 100.0,
            lstm_proba.get("BUY", 0.33)  / 100.0,
            lstm_proba.get("SELL", 0.33) / 100.0,
            lstm_proba.get("HOLD", 0.34) / 100.0,
            news_score  / 100.0,
            news_impact / 100.0,
            social_score / 100.0,
            min(social_hype, 1.0),
            1.0 if social_manip else 0.0,
            min(max(rsi, 0), 100) / 100.0,
            np.clip(macd_hist, -0.1, 0.1) / 0.1 * 0.5 + 0.5,
            min(vol_ratio, 3.0) / 3.0,
            # Phase 8 — Transformer features (default to uniform if unavailable)
            tp.get("BUY",  33.3) / 100.0,
            tp.get("SELL", 33.3) / 100.0,
            tp.get("HOLD", 33.3) / 100.0,
        ], dtype=np.float32)

    def train(self, feature_matrix: np.ndarray, labels: np.ndarray) -> dict:
        """
        Train fusion model on historical (features, outcome) pairs.
        labels: 0=HOLD, 1=BUY, 2=SELL (actual market outcomes)
        """
        if len(feature_matrix) < 50:
            return {"success": False, "message": f"Need >= 50 samples, got {len(feature_matrix)}"}

        from sklearn.model_selection import train_test_split
        from sklearn.metrics import classification_report

        self.scaler = StandardScaler()
        X = self.scaler.fit_transform(feature_matrix)
        y = labels

        X_train, X_test, y_train, y_test = train_test_split(
            X, y, test_size=0.2, random_state=42, shuffle=False
        )

        self.model = GradientBoostingClassifier(
            n_estimators=200,
            max_depth=4,
            learning_rate=0.05,
            subsample=0.8,
            min_samples_leaf=5,
            random_state=42,
        )
        self.model.fit(X_train, y_train)
        self.is_trained = True

        y_pred = self.model.predict(X_test)
        report = classification_report(y_test, y_pred,
                                       target_names=["HOLD", "BUY", "SELL"], output_dict=True)

        joblib.dump(self.model,  self._model_file())
        joblib.dump(self.scaler, self._scaler_file())

        logger.info(f"Fusion model trained. Accuracy: {report['accuracy']:.3f}")
        return {
            "success":  True,
            "accuracy": round(report["accuracy"], 4),
            "report":   report,
            "samples":  len(feature_matrix),
        }

    def predict(self, feature_vector: np.ndarray) -> dict:
        """Return direction + probability breakdown. Falls back to weighted vote if untrained."""
        if not self.is_trained or self.model is None:
            return self._weighted_vote_fallback(feature_vector)

        fv = feature_vector
        # Handle legacy 14-feature models — pad with uniform Transformer proba
        expected = getattr(self.model, "n_features_in_", FEATURE_DIM)
        if fv.shape[0] != expected:
            if fv.shape[0] == LEGACY_FEAT_DIM and expected == LEGACY_FEAT_DIM:
                pass  # old model, old vector — fine
            elif fv.shape[0] == FEATURE_DIM and expected == LEGACY_FEAT_DIM:
                fv = fv[:LEGACY_FEAT_DIM]  # trim Phase 8 features for legacy model
            else:
                return self._weighted_vote_fallback(feature_vector)

        X = self.scaler.transform(fv.reshape(1, -1))
        pred_class = int(self.model.predict(X)[0])
        proba      = self.model.predict_proba(X)[0]
        confidence = round(float(proba[pred_class]) * 100, 1)

        return {
            "direction":    LABEL_MAP[pred_class],
            "confidence":   confidence,
            "model":        "FusionGB",
            "probabilities": {LABEL_MAP[i]: round(float(p)*100,1) for i, p in enumerate(proba)},
        }

    def _weighted_vote_fallback(self, fv: np.ndarray) -> dict:
        """Simple weighted vote when fusion model is not yet trained."""
        # fv layout: [rf_buy, rf_sell, rf_hold, lstm_buy, lstm_sell, lstm_hold,
        #              news_score, news_impact, social_score, ...]
        buy_score = (
            fv[0] * 0.30 +   # RF BUY prob
            fv[3] * 0.20 +   # LSTM BUY prob
            fv[6] * 0.30 +   # news (bullish→1, bearish→0)
            fv[8] * 0.20     # social
        )
        sell_score = (
            fv[1] * 0.30 +
            fv[4] * 0.20 +
            (1 - fv[6]) * 0.30 +
            (1 - fv[8]) * 0.20
        )
        hold_score = 1.0 - max(buy_score, sell_score)

        scores = {"BUY": buy_score, "SELL": sell_score, "HOLD": hold_score}
        best   = max(scores, key=scores.get)
        conf   = round(scores[best] * 100, 1)

        return {
            "direction":    best,
            "confidence":   conf,
            "model":        "fusion-vote-fallback",
            "probabilities": {k: round(v*100,1) for k,v in scores.items()},
        }
