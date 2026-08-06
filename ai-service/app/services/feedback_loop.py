"""
Self-Learning Feedback Loop
Monitors signal outcomes after a configurable delay, computes accuracy,
retrains the confidence calibrator, and optionally triggers model retraining.

Outcome history is persisted to MongoDB (app.services.feedback_store) so it
survives process restarts — the fusion model and RL weight engine both need
accumulated history to learn from, which is lost if it only lives in memory.
"""
import logging
from datetime import datetime, timezone, timedelta
from typing import List
import numpy as np

from app.services.collectors.binance_collector import fetch_current_price
from app.services import feedback_store

logger = logging.getLogger("ai-service.feedback_loop")

# After this many hours, evaluate if the signal direction was correct
EVALUATION_DELAY_HOURS = 4
# If win rate drops below this, trigger retraining alert
RETRAIN_WIN_RATE_THRESHOLD = 0.45
# Rolling window for win rate calculation
ROLLING_WINDOW = 50


class SignalOutcomeEvaluator:
    """
    Stores pending signals and evaluates their outcomes once enough time passes.
    Phase 8: feeds results into online learner + drift detector.
    """

    def __init__(self, calibrator, online_learner=None, drift_detector=None):
        self.calibrator      = calibrator
        self.online_learner  = online_learner   # Phase 8
        self.drift_detector  = drift_detector   # Phase 8
        self._retrain_flag = False
        # Transformer replay sequences (raw numpy arrays) aren't stored in Mongo —
        # kept in-memory, keyed by the Mongo doc id, so the online learner still
        # gets real replay data as long as the process hasn't restarted between
        # signal generation and evaluation. Lost only across a restart.
        self._seq_cache: dict = {}

    async def record_signal(self, signal: dict):
        """Call this every time a new signal is generated."""
        feature_vector = signal.get("_fusion_features")
        doc_id = await feedback_store.insert_pending({
            "asset":             signal.get("asset"),
            "direction":         signal.get("direction"),
            "entry_price":       signal.get("entry_price"),
            "confidence":        signal.get("confidence"),
            "generated_at":      datetime.now(timezone.utc),
            "_transformer_proba": signal.get("_transformer_proba"),
            "feature_vector":    feature_vector.tolist() if feature_vector is not None else None,
        })
        seq_snapshot = signal.get("_seq_snapshot")
        if doc_id and seq_snapshot is not None:
            if len(self._seq_cache) >= 500:
                self._seq_cache.pop(next(iter(self._seq_cache)))  # drop oldest
            self._seq_cache[doc_id] = seq_snapshot
        logger.debug(f"Feedback: recorded signal {signal.get('asset')} {signal.get('direction')}")

    async def evaluate_pending(self):
        """Check if any pending signals are old enough to evaluate."""
        cutoff = datetime.now(timezone.utc) - timedelta(hours=EVALUATION_DELAY_HOURS)
        ready = await feedback_store.get_ready_pending(cutoff)

        if not ready:
            return

        logger.info(f"Feedback: evaluating {len(ready)} matured signals...")

        for sig in ready:
            asset     = sig["asset"]
            direction = sig["direction"]
            entry     = sig["entry_price"]

            try:
                current_price = await fetch_current_price(asset)
                if current_price is None:
                    continue

                price_change_pct = (current_price - entry) / entry

                if direction == "BUY":
                    correct = price_change_pct > 0.005      # +0.5% threshold
                elif direction == "SELL":
                    correct = price_change_pct < -0.005
                else:
                    correct = abs(price_change_pct) < 0.01  # HOLD — price stayed flat

                await feedback_store.mark_evaluated(sig["_id"], {
                    "current_price":    current_price,
                    "price_change_pct": round(price_change_pct * 100, 3),
                    "correct":          correct,
                    "evaluated_at":     datetime.now(timezone.utc),
                })

                logger.info(
                    f"Feedback [{asset} {direction}]: entry={entry:.4f} "
                    f"now={current_price:.4f} Δ={price_change_pct:+.2%} → {'WIN' if correct else 'LOSS'}"
                )

                # Phase 8 — feed online learner (sequence replay only available
                # for signals evaluated in the same process that generated them —
                # lost across a restart since numpy arrays aren't Mongo-stored)
                if self.online_learner:
                    from app.models.transformer_model import ILABEL_MAP
                    label    = ILABEL_MAP.get(direction, 1)
                    seq_snap = self._seq_cache.pop(str(sig["_id"]), None)
                    self.online_learner.add_outcome(
                        sequence=seq_snap,
                        label=label,
                        confidence=sig["confidence"],
                        outcome=1 if correct else 0,
                    )

                # Phase 8 — feed drift detector
                if self.drift_detector:
                    self.drift_detector.record(
                        confidence=sig["confidence"],
                        proba=sig.get("_transformer_proba") or
                              {"BUY": 33.3, "HOLD": 33.3, "SELL": 33.3},
                        outcome=1 if correct else 0,
                    )

                # RL weight engine — close the loop so weights adapt to real outcomes
                try:
                    from app.services.global_analyzer import rl_record_outcome
                    rl_record_outcome("WIN" if correct else "LOSS", {
                        "technical": 0.70, "news": 0.20, "social": 0.10, "macro": 0.0,
                    })
                except Exception as e:
                    logger.debug(f"RL outcome recording skipped: {e}")

            except Exception as e:
                logger.error(f"Feedback evaluation error for {asset}: {e}")

        # Retrain calibrator after each batch
        await self._update_calibrator()
        await self._check_retrain_needed()
        await self._maybe_train_fusion()

    async def _update_calibrator(self):
        """Refit calibrator on recent historical outcomes."""
        recent = await feedback_store.get_recent_evaluated()
        if len(recent) < 20:
            return
        confidences = [h["confidence"] for h in recent]
        outcomes    = [1 if h["correct"] else 0 for h in recent]
        result      = self.calibrator.fit(confidences, outcomes)
        logger.info(f"Feedback: calibrator updated. {result}")

    async def _check_retrain_needed(self):
        """Flag if recent win rate is below threshold or drift detector is critical."""
        recent = await feedback_store.get_recent_evaluated(ROLLING_WINDOW)
        if len(recent) < 20:
            return
        win_rate = sum(1 for h in recent if h["correct"]) / len(recent)
        logger.info(f"Feedback: rolling win rate ({len(recent)} signals) = {win_rate:.1%}")
        if win_rate < RETRAIN_WIN_RATE_THRESHOLD:
            self._retrain_flag = True
            logger.warning(
                f"Feedback: WIN RATE {win_rate:.1%} below threshold {RETRAIN_WIN_RATE_THRESHOLD:.0%}. "
                "Model retraining recommended."
            )
        # Also check drift detector
        if self.drift_detector and self.drift_detector.consume_retrain_flag():
            self._retrain_flag = True
            logger.error("Feedback: drift detector triggered retraining flag.")

    async def _maybe_train_fusion(self):
        """Once enough labeled examples have accumulated, train the fusion model."""
        from app.models.fusion.fusion_model import ILABEL_MAP  # 0=HOLD,1=BUY,2=SELL — fusion's own encoding

        examples = await feedback_store.get_unused_fusion_examples()
        if len(examples) < 50:
            return

        def _label_from_outcome(pct: float) -> int:
            # Same +/-0.5% threshold evaluate_pending() uses to judge BUY/SELL correctness
            if pct > 0.5:  return ILABEL_MAP["BUY"]
            if pct < -0.5: return ILABEL_MAP["SELL"]
            return ILABEL_MAP["HOLD"]

        feature_matrix = np.array([e["feature_vector"] for e in examples], dtype=np.float32)
        labels = np.array([_label_from_outcome(e["price_change_pct"]) for e in examples], dtype=np.int64)

        from app.api.routes import fusion_model, model_registry
        result = fusion_model.train(feature_matrix, labels)
        if result.get("success"):
            model_registry.register("fusion", fusion_model._model_file(), result,
                                     notes="Auto-trained from accumulated signal outcomes")
            logger.info(f"Feedback: fusion model trained. {result}")
        await feedback_store.mark_fusion_used([e["_id"] for e in examples])

    def needs_retraining(self) -> bool:
        flag = self._retrain_flag
        self._retrain_flag = False
        return flag

    async def get_stats(self) -> dict:
        evaluated_count = await feedback_store.count_evaluated()
        pending_count   = await feedback_store.count_pending()
        if not evaluated_count:
            return {"evaluated": 0, "pending": pending_count}

        recent = await feedback_store.get_recent_evaluated(ROLLING_WINDOW)
        win_rate = sum(1 for h in recent if h["correct"]) / len(recent) if recent else 0
        avg_conf = np.mean([h["confidence"] for h in recent]) if recent else 0
        by_asset = await feedback_store.get_by_asset_stats()

        return {
            "total_evaluated": evaluated_count,
            "pending":         pending_count,
            "rolling_win_rate":round(win_rate, 3),
            "rolling_window":  len(recent),
            "avg_confidence":  round(float(avg_conf), 1),
            "by_asset":        by_asset,
            "calibrator_fitted": self.calibrator.is_fitted,
        }
