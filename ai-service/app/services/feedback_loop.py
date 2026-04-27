"""
Self-Learning Feedback Loop
Monitors signal outcomes after a configurable delay, computes accuracy,
retrains the confidence calibrator, and optionally triggers model retraining.
"""
import logging
import asyncio
from datetime import datetime, timezone, timedelta
from typing import List, Optional
import numpy as np

from app.services.collectors.binance_collector import fetch_current_price

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
        self._pending:  List[dict] = []
        self._history:  List[dict] = []
        self._retrain_flag = False

    def record_signal(self, signal: dict):
        """Call this every time a new signal is generated."""
        self._pending.append({
            "asset":             signal.get("asset"),
            "direction":         signal.get("direction"),
            "entry_price":       signal.get("entry_price"),
            "confidence":        signal.get("confidence"),
            "generated_at":      datetime.now(timezone.utc),
            "_seq_snapshot":     signal.get("_seq_snapshot"),
            "_transformer_proba": signal.get("_transformer_proba"),
        })
        logger.debug(f"Feedback: recorded signal {signal.get('asset')} {signal.get('direction')}")

    async def evaluate_pending(self):
        """Check if any pending signals are old enough to evaluate."""
        if not self._pending:
            return

        cutoff = datetime.now(timezone.utc) - timedelta(hours=EVALUATION_DELAY_HOURS)
        ready  = [s for s in self._pending if s["generated_at"] <= cutoff]
        still_pending = [s for s in self._pending if s["generated_at"] > cutoff]
        self._pending = still_pending

        if not ready:
            return

        logger.info(f"Feedback: evaluating {len(ready)} matured signals...")

        for sig in ready:
            asset     = sig["asset"]
            direction = sig["direction"]
            entry     = sig["entry_price"]
            generated = sig["generated_at"]

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

                outcome = {
                    **sig,
                    "current_price":    current_price,
                    "price_change_pct": round(price_change_pct * 100, 3),
                    "correct":          correct,
                    "evaluated_at":     datetime.now(timezone.utc),
                }
                self._history.append(outcome)

                logger.info(
                    f"Feedback [{asset} {direction}]: entry={entry:.4f} "
                    f"now={current_price:.4f} Δ={price_change_pct:+.2%} → {'✓ WIN' if correct else '✗ LOSS'}"
                )

                # Phase 8 — feed online learner
                if self.online_learner:
                    from app.models.transformer_model import ILABEL_MAP
                    label    = ILABEL_MAP.get(direction, 1)
                    seq_snap = sig.get("_seq_snapshot")
                    tf_proba = sig.get("_transformer_proba", {})
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

            except Exception as e:
                logger.error(f"Feedback evaluation error for {asset}: {e}")

        # Retrain calibrator after each batch
        await self._update_calibrator()
        self._check_retrain_needed()

    async def _update_calibrator(self):
        """Refit calibrator on all historical outcomes."""
        if len(self._history) < 20:
            return
        confidences = [h["confidence"] for h in self._history]
        outcomes    = [1 if h["correct"] else 0 for h in self._history]
        result      = self.calibrator.fit(confidences, outcomes)
        logger.info(f"Feedback: calibrator updated. {result}")

    def _check_retrain_needed(self):
        """Flag if recent win rate is below threshold or drift detector is critical."""
        recent = self._history[-ROLLING_WINDOW:]
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

    def needs_retraining(self) -> bool:
        flag = self._retrain_flag
        self._retrain_flag = False
        return flag

    def get_stats(self) -> dict:
        if not self._history:
            return {"evaluated": 0, "pending": len(self._pending)}
        recent = self._history[-ROLLING_WINDOW:]
        win_rate = sum(1 for h in recent if h["correct"]) / len(recent) if recent else 0
        avg_conf = np.mean([h["confidence"] for h in recent]) if recent else 0

        by_asset = {}
        for h in self._history[-200:]:
            a = h["asset"]
            if a not in by_asset:
                by_asset[a] = {"wins": 0, "losses": 0}
            if h["correct"]:
                by_asset[a]["wins"] += 1
            else:
                by_asset[a]["losses"] += 1
        for a, s in by_asset.items():
            total = s["wins"] + s["losses"]
            by_asset[a]["win_rate"] = round(s["wins"] / total, 3) if total else 0

        return {
            "total_evaluated": len(self._history),
            "pending":         len(self._pending),
            "rolling_win_rate":round(win_rate, 3),
            "rolling_window":  len(recent),
            "avg_confidence":  round(float(avg_conf), 1),
            "by_asset":        by_asset,
            "calibrator_fitted": self.calibrator.is_fitted,
        }
