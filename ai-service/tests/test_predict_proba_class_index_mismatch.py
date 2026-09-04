"""
Bug (2026-09-04, overnight continuous-improvement pass): MarketModel.predict()
and FusionModel.predict() both indexed predict_proba()'s output array using
the raw predicted class LABEL value (`proba[pred_class]`), and built their
`probabilities` dict by zipping `enumerate(proba)` positions directly against
LABEL_MAP's label values. Both silently assume the classifier's `classes_`
attribute is always the contiguous `[0, 1, 2]` (0=HOLD, 1=BUY, 2=SELL).

That assumption breaks the moment a training window omits one of the three
action classes entirely -- something this codebase's own T-091 fix
(test_classification_report_missing_class.py) already documents as a real,
observed-in-production occurrence (a run of examples skewed toward one
action). When that happens, sklearn's `classes_` only contains the labels
actually seen, e.g. `[0, 2]` (HOLD and SELL, no BUY) -- and predict_proba()'s
columns are ordered by THAT list, not by label value:

  - If the model predicts the class whose label value exceeds the
    truncated array's length (e.g. predicting SELL=2 when classes_==[0,2]
    means the proba array only has 2 columns, valid indices 0-1), the old
    code raised an uncaught IndexError -- a live crash on a request that
    should have returned a normal trade suggestion.
  - Even when no crash occurs (predicting a class within bounds), the old
    `probabilities` dict still silently mislabeled the wrong class's real
    probability under the wrong action name (position 1 in a [0, 2]-
    classes_ model actually holds SELL's probability, but the old code
    reported it under "BUY") and dropped the real SELL entry entirely --
    a live confidence-score corruption with no crash to reveal it.

Fixed by mapping through `self.model.classes_` explicitly instead of
assuming array position equals label value, in both files.

These tests train a REAL RandomForestClassifier / GradientBoostingClassifier
(both available in this environment) on synthetic data that deliberately
omits the BUY class, confirming predict() neither crashes nor mislabels a
probability, for both a predicted-class-out-of-naive-bounds case and a
predicted-class-in-bounds case.
"""
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestClassifier, GradientBoostingClassifier
from sklearn.preprocessing import StandardScaler

from app.models.market_model import MarketModel
from app.models.fusion.fusion_model import FusionModel


def _make_market_df(n, base):
    return pd.DataFrame({
        "close": np.full(n, base), "rsi": np.full(n, base), "macd": np.full(n, base),
        "macd_signal": np.full(n, base), "macd_hist": np.full(n, base),
        "ema20": np.full(n, base), "ema50": np.full(n, base), "ema200": np.full(n, base),
        "atr": np.ones(n), "vol_ratio": np.ones(n),
        "bb_lower": np.full(n, base - 1), "bb_upper": np.full(n, base + 1),
    })


class TestMarketModelPredictHandlesAClassMissingFromTraining:
    def _build_trained_model(self):
        m = MarketModel()
        n0, n2 = 40, 40
        df_train = pd.concat([_make_market_df(n0, 0.0), _make_market_df(n2, 10.0)], ignore_index=True)
        X = m._build_features(df_train)
        y = np.array([0] * n0 + [2] * n2)  # HOLD and SELL only -- BUY never seen

        scaler = StandardScaler()
        Xs = scaler.fit_transform(X)
        clf = RandomForestClassifier(n_estimators=50, random_state=42)
        clf.fit(Xs, y)
        assert list(clf.classes_) == [0, 2], "test setup invalid — classifier didn't skip class 1"

        m.model = clf
        m.scaler = scaler
        m.is_trained = True
        return m

    def test_predicting_the_missing_middle_class_does_not_raise_indexerror(self):
        m = self._build_trained_model()
        result = m.predict(_make_market_df(1, 10.0))  # squarely in the SELL cluster

        assert result["direction"] == "SELL"
        assert 0 <= result["confidence"] <= 100
        assert "SELL" in result["probabilities"]
        assert "BUY" not in result["probabilities"]  # never trained on — must not be fabricated

    def test_predicting_a_present_class_does_not_mislabel_the_missing_ones_probability(self):
        m = self._build_trained_model()
        result = m.predict(_make_market_df(1, 0.0))  # squarely in the HOLD cluster

        assert result["direction"] == "HOLD"
        # The real regression check: pre-fix, this case didn't crash, but
        # silently reported SELL's probability under the key "BUY" and
        # dropped "SELL" entirely.
        assert "SELL" in result["probabilities"]
        assert "BUY" not in result["probabilities"]


class TestFusionModelPredictHandlesAClassMissingFromTraining:
    FEATURE_DIM = 17

    def _make_fv_batch(self, n, base):
        rng = np.random.RandomState(0)
        return base + rng.normal(scale=0.01, size=(n, self.FEATURE_DIM))

    def _build_trained_model(self, tmp_path_str="/tmp"):
        m = FusionModel(model_path=tmp_path_str)
        n0, n2 = 40, 40
        X = np.vstack([self._make_fv_batch(n0, 0.0), self._make_fv_batch(n2, 10.0)])
        y = np.array([0] * n0 + [2] * n2)

        scaler = StandardScaler()
        Xs = scaler.fit_transform(X)
        clf = GradientBoostingClassifier(n_estimators=50, random_state=42)
        clf.fit(Xs, y)
        assert list(clf.classes_) == [0, 2], "test setup invalid — classifier didn't skip class 1"

        m.model = clf
        m.scaler = scaler
        m.is_trained = True
        return m

    def test_predicting_the_missing_middle_class_does_not_raise_indexerror(self):
        m = self._build_trained_model()
        result = m.predict(self._make_fv_batch(1, 10.0)[0])

        assert result["direction"] == "SELL"
        assert "SELL" in result["probabilities"]
        assert "BUY" not in result["probabilities"]

    def test_predicting_a_present_class_does_not_mislabel_the_missing_ones_probability(self):
        m = self._build_trained_model()
        result = m.predict(self._make_fv_batch(1, 0.0)[0])

        assert result["direction"] == "HOLD"
        assert "SELL" in result["probabilities"]
        assert "BUY" not in result["probabilities"]
