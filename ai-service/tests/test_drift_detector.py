"""
Tests for DriftDetector (T-045, 2026-08-24 continuous-improvement pass).

Finding: `_assess()`'s entropy-drift signal compares a recent 10-reading
average entropy against `baseline_entropy * 1.25`. The baseline is the
mean of the first `ENTROPY_BASELINE_WINDOW` (100) entropy readings ever
recorded. Every real caller (`feedback_loop.py`'s `evaluate_pending()`)
feeds `record()` whatever `sig.get("_transformer_proba")` was attached to
the signal -- and `signal_engine.py` sets that field to the literal
uniform placeholder `{"BUY": 33.3, "HOLD": 33.3, "SELL": 33.3}` whenever
no trained transformer/LSTM model was available for that prediction
(cold start for a newly-tracked asset, or a transient predict()
exception). A uniform 3-way distribution has entropy `ln(3) ~= 1.0986`,
which is the mathematical MAXIMUM possible entropy for a 3-category
distribution -- no real distribution can ever exceed it.

If enough of the first 100 baseline readings come from that "no model
available" placeholder (which happens whenever a real per-asset
transformer isn't trained yet, or intermittently fails), the baseline
entropy is pulled toward `ln(3)`. Once `baseline_entropy * 1.25` exceeds
`ln(3)` (i.e. baseline > ~0.879), NO real prediction can ever produce a
`recent_entropy` that clears the threshold -- entropy-drift detection
becomes permanently, silently unreachable for that DriftDetector
instance's lifetime (it lives as a long-running singleton in
routes.py), quietly losing one of the three documented drift signals
(win-rate, entropy, calibration) without any error or log line calling
it out.

Unlike T-042/T-043/T-044 (each had one unambiguous correct fix), the
right fix here requires a design choice DriftDetector's current API
can't make on its own: should "no model available" readings be excluded
from entropy tracking entirely (requires callers to pass an
availability flag), should the baseline only lock in once genuinely
low-variance, should the comparison be bounded relative to ln(3)
instead of the raw baseline, etc. -- each has different implications
for how quickly a fresh deployment (or a newly-tracked asset with no
transformer yet) starts getting a meaningful entropy signal. Per the
standing instruction not to invent a fix without one evidence-backed
correct answer, this pass documents and tests the actual behavior
(including the contaminated-baseline regression guard below) rather
than unilaterally picking an algorithm.

Practical severity note: as of this pass, every one of the 10 assets in
TRACKED_ASSETS already has a trained transformer checkpoint on disk, so
the "no model available" fallback is not the common case in the CURRENT
deployment -- this is a real, reachable structural gap (cold start,
newly-tracked assets, transient predict() failures), not an actively
firing bug on every request today.

Zero prior test coverage existed for this module before this pass.

Separate finding fixed in this same pass (T-046, not the T-045 design
gap above): `status()` used a plain truthy check (`if win_rate else
None`) to decide whether to report each rolling metric or `None`. In
Python, `0.0` is falsy, so a completely healthy reading of exactly
`win_rate=0.0` (every recent signal wrong -- the single worst-case,
most-important-to-see state) was silently reported as `rolling_win_rate:
null`, indistinguishable from "not enough data yet". The same falsy-zero
flaw applied to `avg_confidence`, `avg_entropy`, and `baseline_entropy`.
`status()` is directly exposed via the public `GET /models/drift`
endpoint and embedded in two other route payloads (`routes.py`), so this
was a real, reachable monitoring/observability gap, not theoretical.
Unlike T-045, this had one unambiguous correct fix (`is not None`
instead of a truthy check) with no design tradeoff, so it was fixed
directly, matching the T-042/T-043/T-044 pattern.
"""
import math

import pytest

from app.services.drift_detector import (
    DriftDetector,
    WARN_THRESHOLD,
    CRIT_THRESHOLD,
    WINDOW,
    ENTROPY_BASELINE_WINDOW,
)

UNIFORM_PROBA = {"BUY": 33.3, "HOLD": 33.3, "SELL": 33.3}
MAX_ENTROPY   = math.log(3)


def _confident_proba(direction="BUY", strength=95.0):
    other = (100.0 - strength) / 2
    d = {"BUY": other, "HOLD": other, "SELL": other}
    d[direction] = strength
    return d


def _entropy_of(proba):
    """Mirrors drift_detector.record()'s own entropy calc exactly, so the
    expected value in test_uniform_placeholder_baseline_equals_max_entropy
    isn't thrown off by UNIFORM_PROBA's values summing to 99.9 (not 100.0)
    -- that rounding is itself part of the real production constant in
    signal_engine.py, so the test should compare against ITS actual
    entropy, not the idealized ln(3) upper bound."""
    p = [proba.get("BUY", 33.3), proba.get("HOLD", 33.3), proba.get("SELL", 33.3)]
    p = [max(x, 1e-9) / 100.0 for x in p]
    return -sum(x * math.log(x) for x in p)


class TestFreshDetectorDefaults:
    def test_initial_state(self):
        det = DriftDetector()
        assert det.drift_level == "none"
        assert det.retrain_needed is False
        status = det.status()
        assert status["rolling_win_rate"] is None
        assert status["baseline_entropy"] is None


class TestWinRateOnlyThresholds:
    def test_win_rate_at_or_above_warn_is_none(self):
        det = DriftDetector()
        for _ in range(15):
            det.record(confidence=80, proba=_confident_proba("BUY"), outcome=1)
        assert det.drift_level == "none"

    def test_win_rate_below_warn_but_above_crit_is_warn(self):
        det = DriftDetector()
        # win rate ~0.40, between CRIT_THRESHOLD (0.38) and WARN_THRESHOLD (0.45)
        outcomes = ([1] * 6 + [0] * 9)  # 6/15 = 0.40
        for o in outcomes:
            det.record(confidence=80, proba=_confident_proba("BUY"), outcome=o)
        assert det.drift_level == "warn"
        assert det.retrain_needed is False

    def test_win_rate_below_crit_is_critical(self):
        det = DriftDetector()
        outcomes = ([1] * 4 + [0] * 11)  # 4/15 ~= 0.267, below CRIT_THRESHOLD
        for o in outcomes:
            det.record(confidence=80, proba=_confident_proba("BUY"), outcome=o)
        assert det.drift_level == "critical"
        assert det.retrain_needed is True

    def test_assessment_does_not_start_before_15_outcomes(self):
        det = DriftDetector()
        for _ in range(14):
            det.record(confidence=80, proba=_confident_proba("BUY"), outcome=0)
        assert det.drift_level == "none"  # would be critical if assessed


class TestCalibrationGap:
    def test_large_gap_between_confidence_and_actual_win_rate_triggers_warn(self):
        det = DriftDetector()
        # confidence always 95 (=> avg_conf 0.95), but only ~40% actually correct
        outcomes = ([1] * 6 + [0] * 9)
        for o in outcomes:
            det.record(confidence=95, proba=_confident_proba("BUY"), outcome=o)
        status = det.status()
        assert abs(status["avg_confidence"] / 100.0 - status["rolling_win_rate"]) > 0.20
        assert det.drift_level in ("warn", "critical")


class TestRollingWindow:
    def test_outcomes_window_capped_at_WINDOW(self):
        det = DriftDetector()
        for _ in range(WINDOW + 20):
            det.record(confidence=80, proba=_confident_proba("BUY"), outcome=1)
        assert det.status()["rolling_window"] == WINDOW

    def test_old_outcomes_roll_off_and_stop_affecting_win_rate(self):
        det = DriftDetector()
        # Fill the window with losses first...
        for _ in range(WINDOW):
            det.record(confidence=80, proba=_confident_proba("BUY"), outcome=0)
        assert det.status()["rolling_win_rate"] == 0.0
        # ...then push WINDOW more wins; the losses should have rolled off entirely.
        for _ in range(WINDOW):
            det.record(confidence=80, proba=_confident_proba("BUY"), outcome=1)
        assert det.status()["rolling_win_rate"] == 1.0


class TestConsumeRetrainFlag:
    def test_consume_returns_and_resets_the_flag(self):
        det = DriftDetector()
        outcomes = ([1] * 4 + [0] * 11)  # critical
        for o in outcomes:
            det.record(confidence=80, proba=_confident_proba("BUY"), outcome=o)
        assert det.retrain_needed is True
        assert det.consume_retrain_flag() is True
        assert det.retrain_needed is False
        assert det.consume_retrain_flag() is False

    def test_consume_on_a_fresh_detector_is_false(self):
        det = DriftDetector()
        assert det.consume_retrain_flag() is False


class TestEntropyBaselineEstablishment:
    def test_baseline_is_none_before_100_readings(self):
        det = DriftDetector()
        for _ in range(ENTROPY_BASELINE_WINDOW - 1):
            det.record(confidence=80, proba=_confident_proba("BUY"), outcome=1)
        assert det.status()["baseline_entropy"] is None

    def test_baseline_established_exactly_at_100th_reading(self):
        det = DriftDetector()
        for _ in range(ENTROPY_BASELINE_WINDOW):
            det.record(confidence=80, proba=_confident_proba("BUY"), outcome=1)
        assert det.status()["baseline_entropy"] is not None

    def test_baseline_does_not_change_after_being_established(self):
        det = DriftDetector()
        for _ in range(ENTROPY_BASELINE_WINDOW):
            det.record(confidence=80, proba=_confident_proba("BUY", strength=95), outcome=1)
        baseline_1 = det.status()["baseline_entropy"]
        for _ in range(50):
            det.record(confidence=80, proba=UNIFORM_PROBA, outcome=1)
        baseline_2 = det.status()["baseline_entropy"]
        assert baseline_1 == baseline_2


class TestEntropyDriftDetectionWorksWithAHealthyBaseline:
    def test_low_baseline_followed_by_genuinely_higher_entropy_is_detected(self):
        det = DriftDetector()
        # Establish a low, "confident model" baseline.
        for _ in range(ENTROPY_BASELINE_WINDOW):
            det.record(confidence=90, proba=_confident_proba("BUY", strength=98), outcome=1)
        baseline = det.status()["baseline_entropy"]
        assert baseline < 0.879  # low enough that 1.25x stays below ln(3)

        # Now feed genuinely higher-entropy (more uncertain) predictions,
        # keeping win rate healthy so only the entropy signal is exercised.
        for _ in range(15):
            det.record(confidence=90, proba=UNIFORM_PROBA, outcome=1)
        assert det.drift_level in ("warn", "critical")


class TestEntropyDriftDetectionRegressionGuardForContaminatedBaseline:
    """
    Direct regression guard for the T-045 finding: once the baseline is
    established from "no model available" uniform placeholder readings,
    entropy-drift detection becomes mathematically unreachable, because
    baseline_entropy * 1.25 exceeds ln(3), the max possible entropy any
    real distribution can produce.
    """

    def test_uniform_placeholder_baseline_equals_max_entropy(self):
        det = DriftDetector()
        for _ in range(ENTROPY_BASELINE_WINDOW):
            det.record(confidence=50, proba=UNIFORM_PROBA, outcome=1)
        baseline = det.status()["baseline_entropy"]
        assert baseline == pytest.approx(_entropy_of(UNIFORM_PROBA), abs=1e-4)
        # ...and that real-world value is itself indistinguishable from the
        # theoretical maximum for practical purposes -- reinforcing that
        # this baseline leaves essentially zero headroom for detection.
        assert baseline == pytest.approx(MAX_ENTROPY, abs=1e-3)

    def test_no_possible_reading_can_trigger_entropy_drift_once_baseline_is_maxed(self):
        det = DriftDetector()
        # confidence=100 throughout so avg_confidence tracks the (also
        # perfect) win rate exactly -- isolates the entropy channel from
        # the separate win-rate/calibration signals.
        for _ in range(ENTROPY_BASELINE_WINDOW):
            det.record(confidence=100, proba=UNIFORM_PROBA, outcome=1)

        # Feed more uniform (max-entropy) readings -- the theoretical
        # ceiling for ANY reading -- with win rate/calibration still healthy.
        for _ in range(15):
            det.record(confidence=100, proba=UNIFORM_PROBA, outcome=1)

        # Even at the theoretical maximum, drift_level cannot escalate on
        # entropy grounds -- this is the documented gap, not a false pass.
        assert det.drift_level == "none"


class TestStatusReportsGenuineZeroInsteadOfNone:
    """
    Regression guard for T-046: status() must distinguish "no data yet"
    (None) from a genuine reading of exactly 0.0 -- the old `if x else
    None` truthy check collapsed win_rate=0.0 (every recent signal wrong,
    the single most important state to see accurately) into the same
    `null` as "not enough data yet". status() is exposed directly via
    GET /models/drift and embedded in two other route payloads, so this
    was a real monitoring gap, not a cosmetic one.
    """

    def test_total_losing_streak_reports_zero_not_none(self):
        det = DriftDetector()
        for _ in range(WINDOW):
            det.record(confidence=80, proba=_confident_proba("BUY"), outcome=0)
        status = det.status()
        assert status["rolling_win_rate"] == 0.0
        assert status["rolling_win_rate"] is not None

    def test_zero_confidence_readings_report_zero_not_none(self):
        det = DriftDetector()
        for _ in range(20):
            det.record(confidence=0, proba=_confident_proba("BUY"), outcome=1)
        status = det.status()
        assert status["avg_confidence"] == 0.0
        assert status["avg_confidence"] is not None

    def test_baseline_entropy_still_reported_when_established(self):
        # Sanity check the "is not None" rewrite didn't break the ordinary,
        # already-passing case of a genuinely-set (non-zero) baseline.
        det = DriftDetector()
        for _ in range(ENTROPY_BASELINE_WINDOW):
            det.record(confidence=80, proba=_confident_proba("BUY", strength=95), outcome=1)
        assert det.status()["baseline_entropy"] is not None
        assert det.status()["baseline_entropy"] > 0.0
