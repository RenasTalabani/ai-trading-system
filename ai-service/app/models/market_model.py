import logging
import os
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.preprocessing import StandardScaler
from sklearn.model_selection import train_test_split
from sklearn.metrics import classification_report
import joblib

from app.config import get_settings

settings = get_settings()
logger = logging.getLogger("ai-service.market_model")

LABEL_MAP = {0: "HOLD", 1: "BUY", 2: "SELL"}
MODEL_FILE = os.path.join(settings.model_path, "market_rf_model.joblib")
SCALER_FILE = os.path.join(settings.model_path, "market_scaler.joblib")


class MarketModel:
    """
    RandomForest-based market direction classifier.
    Inputs: technical indicators from DataProcessor.
    Outputs: BUY / SELL / HOLD + probability-based confidence score.
    """

    def __init__(self):
        self.model: RandomForestClassifier | None = None
        self.scaler = StandardScaler()
        self.is_trained = False
        self._try_load()

    def _try_load(self):
        if os.path.exists(MODEL_FILE) and os.path.exists(SCALER_FILE):
            try:
                self.model = joblib.load(MODEL_FILE)
                self.scaler = joblib.load(SCALER_FILE)
                self.is_trained = True
                logger.info("Market model loaded from disk.")
            except Exception as e:
                logger.warning(f"Failed to load saved model: {e}")

    def _generate_labels(self, df: pd.DataFrame, lookahead: int = 5, threshold: float = 0.015) -> np.ndarray:
        """Generate BUY/SELL/HOLD labels based on future price change."""
        future_return = df["close"].shift(-lookahead) / df["close"] - 1
        labels = np.where(future_return > threshold, 1,
                 np.where(future_return < -threshold, 2, 0))
        return labels

    def _build_features(self, df: pd.DataFrame) -> np.ndarray:
        cols = ["rsi", "macd", "macd_signal", "macd_hist",
                "ema20", "ema50", "ema200", "atr", "vol_ratio"]
        df = df.copy()
        df["ema20_dev"] = df["close"] / df["ema20"] - 1
        df["ema50_dev"] = df["close"] / df["ema50"] - 1
        df["bb_pos"] = (df["close"] - df["bb_lower"]) / (df["bb_upper"] - df["bb_lower"] + 1e-9)
        feature_cols = cols + ["ema20_dev", "ema50_dev", "bb_pos"]
        return df[feature_cols].values

    def train(self, df: pd.DataFrame) -> dict:
        logger.info("Training market model...")
        X = self._build_features(df)
        y = self._generate_labels(df)
        # Remove last lookahead rows (no future label)
        X, y = X[:-5], y[:-5]

        X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42, shuffle=False)
        X_train = self.scaler.fit_transform(X_train)
        X_test = self.scaler.transform(X_test)

        self.model = RandomForestClassifier(
            n_estimators=200,
            max_depth=10,
            min_samples_leaf=5,
            class_weight="balanced",
            n_jobs=-1,
            random_state=42,
        )
        self.model.fit(X_train, y_train)
        self.is_trained = True

        y_pred = self.model.predict(X_test)
        report = classification_report(y_test, y_pred, target_names=["HOLD", "BUY", "SELL"], output_dict=True)

        joblib.dump(self.model, MODEL_FILE)
        joblib.dump(self.scaler, SCALER_FILE)
        logger.info(f"Market model trained. Accuracy: {report['accuracy']:.3f}")
        return {"accuracy": report["accuracy"], "report": report}

    def predict(self, df: pd.DataFrame) -> dict:
        if not self.is_trained or self.model is None:
            logger.warning("Market model not trained. Using fallback rule-based prediction.")
            return self._rule_based_predict(df)

        X = self._build_features(df)
        X_last = self.scaler.transform(X[-1:])
        pred_class = self.model.predict(X_last)[0]
        proba = self.model.predict_proba(X_last)[0]
        confidence = round(float(proba[pred_class]) * 100, 1)
        direction = LABEL_MAP[pred_class]

        return {
            "direction": direction,
            "confidence": confidence,
            "model": "RandomForest",
            "probabilities": {LABEL_MAP[i]: round(float(p) * 100, 1) for i, p in enumerate(proba)},
        }

    def _rule_based_predict(self, df: pd.DataFrame) -> dict:
        """Simple rule-based fallback when model is not trained yet."""
        row = df.iloc[-1]
        rsi = row.get("rsi", 50)
        macd_hist = row.get("macd_hist", 0)
        close = row["close"]
        ema50 = row.get("ema50", close)
        ema200 = row.get("ema200", close)

        score = 0
        if rsi < 35: score += 2
        elif rsi > 65: score -= 2
        if macd_hist > 0: score += 1
        else: score -= 1
        if close > ema50: score += 1
        else: score -= 1
        if ema50 > ema200: score += 1
        else: score -= 1

        if score >= 3:
            direction, confidence = "BUY", 60 + min(score * 5, 30)
        elif score <= -3:
            direction, confidence = "SELL", 60 + min(abs(score) * 5, 30)
        else:
            direction, confidence = "HOLD", 50

        return {"direction": direction, "confidence": float(confidence), "model": "rule-based"}
