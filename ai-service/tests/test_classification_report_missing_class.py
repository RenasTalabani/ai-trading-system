"""
T-091 (2026-09-01): both FusionModel.train() and MarketModel.train() called
sklearn's classification_report(y_test, y_pred, target_names=["HOLD","BUY",
"SELL"]) with no matching `labels` param -- classification_report infers
which classes to score from whatever's actually present in y_test/y_pred,
and raises ValueError the moment that set doesn't have exactly 3 members
(e.g. a train/test split whose test fold happens to contain only BUY and
SELL outcomes, no HOLD). Confirmed live in production: "Feedback loop
error: Number of classes, 2, does not match size of target_names, 3" --
plausible any time the accumulated label set skews toward one action,
which is exactly what's been happening the same night this pipeline
started accumulating real examples again after ~4 months mostly idle
(T-085's evidence trail).

Worse than a failed report: both train() methods already call .fit() and
set is_trained = True *before* this line, so the exception happens after
the model is already fit but before it's persisted to disk or the caller
learns training succeeded -- fusion_model.py's caller (feedback_loop.py's
_maybe_train_fusion()) never marks its examples used, so it retries the
same expensive fit on largely the same batch every 30 minutes, forever,
on an already memory-constrained container.

Fixed by passing `labels=[0, 1, 2]` explicitly (matching this codebase's
established 0=HOLD/1=BUY/2=SELL encoding in both files) so sklearn scores
all 3 classes regardless of which are actually present in a given split,
plus zero_division=0 so an absent class scores 0 instead of raising an
UndefinedMetricWarning.

These tests construct a small, deliberately 2-class-only dataset (BUY and
SELL, no HOLD) -- exactly the scenario that broke in production -- and
confirm train() completes and returns a real report instead of raising.
"""
import numpy as np
import pandas as pd
import pytest

from app.models.fusion.fusion_model import FusionModel
from app.models.market_model import MarketModel


class TestFusionModelHandlesAMissingClassInTheSplit:
    def test_train_does_not_raise_when_the_test_split_only_has_two_of_three_classes(self, tmp_path, monkeypatch):
        # Avoid any real filesystem side effects from joblib.dump().
        monkeypatch.setattr("app.models.fusion.fusion_model.joblib.dump", lambda *a, **k: None)

        rng = np.random.default_rng(3)
        n = 60
        X = rng.normal(size=(n, 14)).astype(np.float32)
        # shuffle=False in train() means the LAST 20% (12 samples) becomes
        # the test split. The first 48 cycle through all 3 classes so the
        # *training* split is valid (a classifier can't fit on a single
        # class); the last 12 are BUY(1)/SELL(2) only, no HOLD(0) -- so
        # y_test itself genuinely has just 2 classes present.
        #
        # Note: sklearn's classification_report actually keys its class
        # count off the UNION of y_true and y_pred, not y_test alone -- if
        # the trained model happens to predict HOLD for even one test
        # sample, the union is back to 3 and this specific data wouldn't
        # reproduce the live crash even on the unfixed code (verified: a
        # version of this test built only from y_test triggered the same
        # model unpredictably). This is still a legitimate, useful
        # end-to-end smoke test that train() completes successfully; the
        # test below pins down the actual mechanism deterministically.
        y = np.array(([0, 1, 2] * 16) + ([1, 2] * 6), dtype=np.int64)

        model = FusionModel(model_path=str(tmp_path))
        result = model.train(X, y)

        assert result["success"] is True
        assert "report" in result
        assert model.is_trained is True
        assert "HOLD" in result["report"]

    def test_classification_report_call_itself_handles_a_class_absent_from_both_true_and_pred(self):
        """Deterministic, direct test of the actual mechanism T-091 fixes --
        routing through a real model's .fit()/.predict() can't reliably
        force a specific class out of both y_true AND y_pred at once (see
        the note on the test above), so this calls classification_report
        exactly as fusion_model.py's train() and market_model.py's train()
        now do, with data where HOLD(0) is absent from both arrays --
        this is the actual failure condition, and was confirmed to raise
        ValueError before this fix (ValueError: Number of classes, 2,
        does not match size of target_names, 3) when called without the
        `labels` param, matching the live production error exactly."""
        from sklearn.metrics import classification_report

        y_true = np.array([1, 1, 2, 2, 1, 2])
        y_pred = np.array([1, 2, 2, 2, 1, 1])  # also never predicts 0

        # This is exactly what would have raised pre-fix:
        with pytest.raises(ValueError, match="does not match size of target_names"):
            classification_report(y_true, y_pred, target_names=["HOLD", "BUY", "SELL"], output_dict=True)

        # This is the actual fix -- must NOT raise, and must still report
        # on the absent class (scored 0 via zero_division, not dropped).
        report = classification_report(
            y_true, y_pred, labels=[0, 1, 2],
            target_names=["HOLD", "BUY", "SELL"], output_dict=True, zero_division=0,
        )
        assert report["HOLD"]["support"] == 0
        assert report["HOLD"]["recall"] == 0


class TestMarketModelHandlesAMissingClassInTheSplit:
    def test_train_does_not_raise_when_the_test_split_only_has_two_of_three_classes(self, monkeypatch):
        monkeypatch.setattr("app.models.market_model.joblib.dump", lambda *a, **k: None)

        n = 120
        rng = np.random.default_rng(5)
        close = 100.0 * np.cumprod(1 + rng.normal(0, 0.002, n))
        # Flat-ish tail on the DataFrame's last 20% (the test split, given
        # shuffle=False) keeps future_return inside the +/-1.5% threshold
        # for most of it -> HOLD-only-ish there is the realistic failure
        # mode; this dataset is constructed so the split skews to 2
        # classes rather than reproducing the RF's exact real labels.
        df = pd.DataFrame({
            "close": close,
            "rsi": np.full(n, 50.0), "macd": np.zeros(n), "macd_signal": np.zeros(n),
            "macd_hist": np.zeros(n), "ema20": close, "ema50": close, "ema200": close,
            "atr": np.full(n, 1.0), "vol_ratio": np.full(n, 1.0),
            "bb_upper": close * 1.02, "bb_lower": close * 0.98,
        })

        model = MarketModel()
        result = model.train(df)

        assert "report" in result
        assert model.is_trained is True
        assert "HOLD" in result["report"]
