"""
LSTM Price Direction Predictor
Input : sequence of 60 candles × N indicator features
Output: probability distribution over [HOLD, BUY, SELL]
"""
import logging
import os
import numpy as np
import pandas as pd
import joblib
from typing import Optional, Tuple

logger = logging.getLogger("ai-service.lstm_model")

SEQUENCE_LEN  = 60       # look-back window
N_FEATURES    = 13       # must match _build_sequences()
LABEL_MAP     = {0: "HOLD", 1: "BUY", 2: "SELL"}
MIN_TRAIN_LEN = SEQUENCE_LEN + 20

try:
    import torch
    import torch.nn as nn
    TORCH_AVAILABLE = True
except ImportError:
    TORCH_AVAILABLE = False
    logger.warning("PyTorch not available — LSTM model disabled, RF fallback active.")


# ─── PyTorch LSTM network ──────────────────────────────────────────────────────

class _LSTMNet(object if not TORCH_AVAILABLE else __builtins__.__class__):
    pass


if TORCH_AVAILABLE:
    import torch
    import torch.nn as nn

    class _LSTMNet(nn.Module):
        def __init__(self, input_size: int, hidden_size: int = 128,
                     num_layers: int = 2, num_classes: int = 3, dropout: float = 0.3):
            super().__init__()
            self.lstm = nn.LSTM(
                input_size=input_size,
                hidden_size=hidden_size,
                num_layers=num_layers,
                batch_first=True,
                dropout=dropout if num_layers > 1 else 0.0,
            )
            self.dropout = nn.Dropout(dropout)
            self.fc = nn.Sequential(
                nn.Linear(hidden_size, 64),
                nn.ReLU(),
                nn.Dropout(0.2),
                nn.Linear(64, num_classes),
            )

        def forward(self, x):
            out, _ = self.lstm(x)
            out = self.dropout(out[:, -1, :])   # last time step
            return self.fc(out)


# ─── Feature engineering ───────────────────────────────────────────────────────

FEATURE_COLS = [
    "rsi", "macd", "macd_signal", "macd_hist",
    "ema20", "ema50", "ema200", "atr", "vol_ratio",
    "bb_upper", "bb_lower", "bb_mid",
    "close",
]


def _normalize_df(df: pd.DataFrame) -> pd.DataFrame:
    """Min-max normalize each feature column independently."""
    out = df.copy()
    for col in FEATURE_COLS:
        if col in out.columns:
            mn, mx = out[col].min(), out[col].max()
            if mx - mn > 0:
                out[col] = (out[col] - mn) / (mx - mn)
            else:
                out[col] = 0.0
    return out


def _build_sequences(df: pd.DataFrame, lookahead: int = 5,
                     threshold: float = 0.015) -> Tuple[np.ndarray, np.ndarray]:
    """Build (X, y) sequences for LSTM training."""
    df_norm = _normalize_df(df)
    feature_data = df_norm[FEATURE_COLS].values.astype(np.float32)
    close        = df["close"].values

    X, y = [], []
    for i in range(SEQUENCE_LEN, len(df) - lookahead):
        seq = feature_data[i - SEQUENCE_LEN: i]
        future_return = (close[i + lookahead] - close[i]) / close[i]
        label = 1 if future_return > threshold else (2 if future_return < -threshold else 0)
        X.append(seq)
        y.append(label)

    return np.array(X, dtype=np.float32), np.array(y, dtype=np.int64)


# ─── LSTM Model wrapper ────────────────────────────────────────────────────────

MODEL_FILE  = None   # set dynamically per model_path

class LSTMModel:
    def __init__(self, model_path: str):
        self.model_path = model_path
        self.net:    Optional[object] = None
        self.scaler: Optional[object] = None
        self.is_trained = False
        global MODEL_FILE
        MODEL_FILE = os.path.join(model_path, "lstm_model.pt")
        self._try_load()

    def _try_load(self):
        if not TORCH_AVAILABLE:
            return
        pt_path = os.path.join(self.model_path, "lstm_model.pt")
        if os.path.exists(pt_path):
            try:
                self.net = _LSTMNet(input_size=N_FEATURES)
                self.net.load_state_dict(torch.load(pt_path, map_location="cpu"))
                self.net.eval()
                self.is_trained = True
                logger.info("LSTM model loaded from disk.")
            except Exception as e:
                logger.warning(f"Failed to load LSTM model: {e}")

    def train(self, df: pd.DataFrame, epochs: int = 30, lr: float = 1e-3) -> dict:
        if not TORCH_AVAILABLE:
            return {"success": False, "message": "PyTorch not installed"}
        if len(df) < MIN_TRAIN_LEN:
            return {"success": False, "message": f"Need >= {MIN_TRAIN_LEN} candles, got {len(df)}"}

        logger.info(f"Training LSTM on {len(df)} candles...")
        X, y = _build_sequences(df)
        if len(X) == 0:
            return {"success": False, "message": "No training sequences generated"}

        # Train/val split (80/20, no shuffle — time series)
        split = int(len(X) * 0.8)
        X_train, X_val = X[:split], X[split:]
        y_train, y_val = y[:split], y[split:]

        X_train_t = torch.from_numpy(X_train)
        y_train_t = torch.from_numpy(y_train)
        X_val_t   = torch.from_numpy(X_val)
        y_val_t   = torch.from_numpy(y_val)

        net = _LSTMNet(input_size=N_FEATURES)

        # Class weights for imbalanced data
        counts   = np.bincount(y_train, minlength=3).astype(float)
        weights  = torch.tensor(1.0 / (counts + 1e-6), dtype=torch.float32)
        criterion = nn.CrossEntropyLoss(weight=weights)
        optimizer = torch.optim.Adam(net.parameters(), lr=lr, weight_decay=1e-4)
        scheduler = torch.optim.lr_scheduler.ReduceLROnPlateau(optimizer, patience=5, factor=0.5)

        best_val_acc = 0.0
        best_state   = None

        for epoch in range(epochs):
            net.train()
            optimizer.zero_grad()
            out  = net(X_train_t)
            loss = criterion(out, y_train_t)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(net.parameters(), 1.0)
            optimizer.step()

            net.eval()
            with torch.no_grad():
                val_out  = net(X_val_t)
                val_pred = val_out.argmax(dim=1)
                val_acc  = (val_pred == y_val_t).float().mean().item()
            scheduler.step(loss)

            if val_acc > best_val_acc:
                best_val_acc = val_acc
                best_state   = {k: v.clone() for k, v in net.state_dict().items()}

            if (epoch + 1) % 10 == 0:
                logger.info(f"  Epoch {epoch+1}/{epochs} — loss={loss.item():.4f}, val_acc={val_acc:.3f}")

        # Restore best weights
        if best_state:
            net.load_state_dict(best_state)
        net.eval()
        self.net        = net
        self.is_trained = True

        pt_path = os.path.join(self.model_path, "lstm_model.pt")
        torch.save(net.state_dict(), pt_path)
        logger.info(f"LSTM trained. Best val_acc={best_val_acc:.3f}. Saved to {pt_path}")
        return {"success": True, "val_accuracy": round(best_val_acc, 4), "epochs": epochs}

    def predict(self, df: pd.DataFrame) -> dict:
        if not TORCH_AVAILABLE or not self.is_trained or self.net is None:
            return {"direction": "HOLD", "confidence": 50.0, "model": "lstm-unavailable"}
        if len(df) < SEQUENCE_LEN:
            return {"direction": "HOLD", "confidence": 50.0, "model": "lstm-insufficient-data"}

        df_norm  = _normalize_df(df)
        seq      = df_norm[FEATURE_COLS].values[-SEQUENCE_LEN:].astype(np.float32)
        x_tensor = torch.from_numpy(seq).unsqueeze(0)  # (1, 60, 13)

        self.net.eval()
        with torch.no_grad():
            logits = self.net(x_tensor)
            proba  = torch.softmax(logits, dim=1).squeeze().numpy()

        pred_class = int(np.argmax(proba))
        confidence = round(float(proba[pred_class]) * 100, 1)
        direction  = LABEL_MAP[pred_class]

        return {
            "direction":    direction,
            "confidence":   confidence,
            "model":        "LSTM",
            "probabilities": {LABEL_MAP[i]: round(float(p) * 100, 1) for i, p in enumerate(proba)},
        }
