"""
Phase 8 — Transformer Price Predictor
Torch-optional: falls back to stub when PyTorch is not installed.
"""
import logging
import math
import os
from typing import Optional

import numpy as np
import pandas as pd

logger = logging.getLogger("ai-service.transformer")

try:
    import torch
    import torch.nn as nn
    from torch.utils.data import DataLoader, TensorDataset
    TORCH_AVAILABLE = True
except ImportError:
    TORCH_AVAILABLE = False

SEQ_LEN    = 60
N_FEATURES = 13
D_MODEL    = 64
N_HEADS    = 4
N_LAYERS   = 3
FF_DIM     = 256
DROPOUT    = 0.1
LABEL_MAP  = {0: "BUY", 1: "HOLD", 2: "SELL"}
ILABEL_MAP = {"BUY": 0, "HOLD": 1, "SELL": 2}

FEATURE_COLS = [
    "close", "volume", "rsi", "macd", "macd_signal", "macd_hist",
    "ema20", "ema50", "bb_upper", "bb_lower", "atr", "vol_ratio", "returns",
]


if not TORCH_AVAILABLE:
    class TransformerModel:
        """Stub — PyTorch not installed (lightweight cloud deployment)."""
        def __init__(self, model_path: str):
            self.is_trained = False
            logger.info("TransformerModel: torch not available, using stub.")

        def train(self, df, epochs=30):
            return {"success": False, "message": "torch not installed"}

        def predict(self, df):
            return {"direction": "HOLD", "confidence": 50,
                    "model": "transformer-unavailable",
                    "probabilities": {"BUY": 33.3, "HOLD": 33.3, "SELL": 33.3}}

        def fine_tune(self, sequences, labels, epochs=3, lr=1e-5):
            return {"success": False, "message": "torch not installed"}

        def get_sequence_for_replay(self, df):
            return None

        def save(self):
            pass

else:
    class PositionalEncoding(nn.Module):
        def __init__(self, d_model: int, max_len: int = 200, dropout: float = 0.1):
            super().__init__()
            self.dropout = nn.Dropout(p=dropout)
            pe = torch.zeros(max_len, d_model)
            position = torch.arange(max_len).unsqueeze(1).float()
            div = torch.exp(torch.arange(0, d_model, 2).float() * (-math.log(10000.0) / d_model))
            pe[:, 0::2] = torch.sin(position * div)
            pe[:, 1::2] = torch.cos(position * div)
            self.register_buffer("pe", pe.unsqueeze(0))

        def forward(self, x: torch.Tensor) -> torch.Tensor:
            x = x + self.pe[:, :x.size(1)]
            return self.dropout(x)

    class _PriceTransformerNet(nn.Module):
        def __init__(self):
            super().__init__()
            self.input_proj = nn.Linear(N_FEATURES, D_MODEL)
            self.pos_enc    = PositionalEncoding(D_MODEL, dropout=DROPOUT)
            encoder_layer   = nn.TransformerEncoderLayer(
                d_model=D_MODEL, nhead=N_HEADS, dim_feedforward=FF_DIM,
                dropout=DROPOUT, batch_first=True, norm_first=True,
            )
            self.encoder = nn.TransformerEncoder(encoder_layer, num_layers=N_LAYERS)
            self.norm    = nn.LayerNorm(D_MODEL)
            self.drop    = nn.Dropout(DROPOUT)
            self.head    = nn.Linear(D_MODEL, 3)

        def forward(self, x: torch.Tensor) -> torch.Tensor:
            x = self.input_proj(x)
            x = self.pos_enc(x)
            x = self.encoder(x)
            x = x.mean(dim=1)
            x = self.norm(x)
            x = self.drop(x)
            return self.head(x)

    class TransformerModel:
        def __init__(self, model_path: str):
            self.model_path = model_path
            self._model: Optional[_PriceTransformerNet] = None
            self.is_trained = False
            self._feature_mean: Optional[np.ndarray] = None
            self._feature_std: Optional[np.ndarray] = None
            self._try_load()

        def _ckpt_path(self) -> str:
            return os.path.join(self.model_path, "transformer.pt")

        def _try_load(self):
            p = self._ckpt_path()
            if not os.path.exists(p):
                return
            try:
                ckpt = torch.load(p, map_location="cpu", weights_only=False)
                net  = _PriceTransformerNet()
                net.load_state_dict(ckpt["state_dict"])
                net.eval()
                self._model        = net
                self._feature_mean = np.array(ckpt["feature_mean"])
                self._feature_std  = np.array(ckpt["feature_std"])
                self.is_trained    = True
                logger.info("Transformer model loaded from disk.")
            except Exception as e:
                logger.warning(f"Transformer load failed: {e}")

        def _extract_features(self, df: pd.DataFrame) -> Optional[np.ndarray]:
            if "returns" not in df.columns:
                df = df.copy()
                df["returns"] = df["close"].pct_change().fillna(0)
            missing = [c for c in FEATURE_COLS if c not in df.columns]
            if missing:
                logger.warning(f"Transformer: missing columns {missing}")
                return None
            return df[FEATURE_COLS].ffill().fillna(0).values.astype(np.float32)

        def _normalize(self, X: np.ndarray) -> np.ndarray:
            return (X - self._feature_mean) / (self._feature_std + 1e-8)

        def _build_sequences(self, X: np.ndarray, labels: Optional[np.ndarray] = None):
            seqs, labs = [], []
            for i in range(SEQ_LEN, len(X)):
                seqs.append(X[i - SEQ_LEN: i])
                if labels is not None:
                    labs.append(labels[i])
            if not seqs:
                return None, None
            return np.array(seqs, dtype=np.float32), (np.array(labs) if labels is not None else None)

        def _make_labels(self, df: pd.DataFrame) -> np.ndarray:
            ret = df["close"].pct_change(1).shift(-1).fillna(0).values
            labels = np.where(ret > 0.003, ILABEL_MAP["BUY"],
                     np.where(ret < -0.003, ILABEL_MAP["SELL"], ILABEL_MAP["HOLD"]))
            return labels.astype(np.int64)

        def train(self, df: pd.DataFrame, epochs: int = 30) -> dict:
            X_raw = self._extract_features(df)
            if X_raw is None or len(X_raw) < SEQ_LEN + 10:
                return {"success": False, "message": "Insufficient data"}

            self._feature_mean = X_raw.mean(axis=0)
            self._feature_std  = X_raw.std(axis=0)
            X_norm = self._normalize(X_raw)

            labels = self._make_labels(df)
            X_seq, y_seq = self._build_sequences(X_norm, labels)
            if X_seq is None or len(X_seq) < 30:
                return {"success": False, "message": "Too few sequences"}

            split = int(len(X_seq) * 0.8)
            X_tr, X_val = X_seq[:split], X_seq[split:]
            y_tr, y_val = y_seq[:split], y_seq[split:]

            counts  = np.bincount(y_tr, minlength=3).astype(float)
            weights = torch.tensor(1.0 / (counts + 1e-6), dtype=torch.float32)
            weights = weights / weights.sum() * 3

            ds_tr = TensorDataset(torch.from_numpy(X_tr), torch.from_numpy(y_tr))
            dl_tr = DataLoader(ds_tr, batch_size=64, shuffle=True)

            net   = _PriceTransformerNet()
            opt   = torch.optim.Adam(net.parameters(), lr=1e-3, weight_decay=1e-4)
            sched = torch.optim.lr_scheduler.ReduceLROnPlateau(opt, patience=3, factor=0.5)
            crit  = nn.CrossEntropyLoss(weight=weights)

            best_val_loss = float("inf")
            best_state    = None
            no_improve    = 0
            val_acc       = 0.0

            for epoch in range(epochs):
                net.train()
                for xb, yb in dl_tr:
                    opt.zero_grad()
                    loss = crit(net(xb), yb)
                    loss.backward()
                    nn.utils.clip_grad_norm_(net.parameters(), 1.0)
                    opt.step()

                net.eval()
                with torch.no_grad():
                    xv = torch.from_numpy(X_val)
                    yv = torch.from_numpy(y_val)
                    val_loss = crit(net(xv), yv).item()
                    preds    = net(xv).argmax(dim=1)
                    val_acc  = (preds == yv).float().mean().item()

                sched.step(val_loss)
                if val_loss < best_val_loss:
                    best_val_loss = val_loss
                    best_state    = {k: v.clone() for k, v in net.state_dict().items()}
                    no_improve    = 0
                else:
                    no_improve += 1
                    if no_improve >= 7:
                        break

            if best_state:
                net.load_state_dict(best_state)
            net.eval()
            self._model     = net
            self.is_trained = True

            torch.save({
                "state_dict":   net.state_dict(),
                "feature_mean": self._feature_mean.tolist(),
                "feature_std":  self._feature_std.tolist(),
            }, self._ckpt_path())

            return {
                "success": True,
                "best_val_loss": round(best_val_loss, 4),
                "val_accuracy":  round(val_acc, 4),
                "sequences":    len(X_seq),
                "epochs":       epochs,
                "model":        "transformer",
            }

        def fine_tune(self, sequences: np.ndarray, labels: np.ndarray,
                      epochs: int = 3, lr: float = 1e-5) -> dict:
            if not self.is_trained or self._model is None:
                return {"success": False, "message": "Model not trained yet"}
            if len(sequences) < 10:
                return {"success": False, "message": "Need >=10 samples"}

            X = torch.from_numpy(sequences.astype(np.float32))
            y = torch.from_numpy(labels.astype(np.int64))

            self._model.train()
            opt  = torch.optim.Adam(self._model.parameters(), lr=lr, weight_decay=1e-4)
            crit = nn.CrossEntropyLoss()
            total_loss = 0.0
            for _ in range(epochs):
                opt.zero_grad()
                loss = crit(self._model(X), y)
                loss.backward()
                nn.utils.clip_grad_norm_(self._model.parameters(), 0.5)
                opt.step()
                total_loss += loss.item()

            self._model.eval()
            torch.save({
                "state_dict":   self._model.state_dict(),
                "feature_mean": self._feature_mean.tolist(),
                "feature_std":  self._feature_std.tolist(),
            }, self._ckpt_path())

            return {"success": True, "samples": len(sequences), "avg_loss": round(total_loss / epochs, 4)}

        def predict(self, df: pd.DataFrame) -> dict:
            if not self.is_trained or self._model is None:
                return {"direction": "HOLD", "confidence": 50,
                        "model": "transformer-unavailable",
                        "probabilities": {"BUY": 33.3, "HOLD": 33.3, "SELL": 33.3}}

            X_raw = self._extract_features(df)
            if X_raw is None or len(X_raw) < SEQ_LEN:
                return {"direction": "HOLD", "confidence": 50,
                        "model": "transformer-insufficient-data",
                        "probabilities": {"BUY": 33.3, "HOLD": 33.3, "SELL": 33.3}}

            X_norm = self._normalize(X_raw)
            seq    = torch.from_numpy(X_norm[-SEQ_LEN:].astype(np.float32)).unsqueeze(0)

            self._model.eval()
            with torch.no_grad():
                logits = self._model(seq)[0]
                proba  = torch.softmax(logits, dim=0).numpy()

            pred_idx  = int(np.argmax(proba))
            direction = LABEL_MAP[pred_idx]
            return {
                "direction":  direction,
                "confidence": round(float(proba[pred_idx]) * 100, 1),
                "model":      "transformer-v1",
                "probabilities": {
                    "BUY":  round(float(proba[0]) * 100, 1),
                    "HOLD": round(float(proba[1]) * 100, 1),
                    "SELL": round(float(proba[2]) * 100, 1),
                },
            }

        def get_sequence_for_replay(self, df: pd.DataFrame) -> Optional[np.ndarray]:
            if self._feature_mean is None:
                return None
            X_raw = self._extract_features(df)
            if X_raw is None or len(X_raw) < SEQ_LEN:
                return None
            return self._normalize(X_raw)[-SEQ_LEN:].astype(np.float32)
