"""
Regression suite for T-065 (2026-08-28, owner decision applied): the
derived WAIT/AVOID decision label layered on top of SignalEngine's real
BUY/SELL/HOLD model output.

CONTEXT: the original product vision named four decision states (BUY,
SELL, WAIT, AVOID), but the live system only ever produced BUY/SELL/HOLD
-- confirmed by a real-product-validation pass (2026-08-28) that called
/predict live and grepped the codebase for WAIT/AVOID, finding neither
existed anywhere. Making WAIT/AVOID *trained* model classes would require
retraining the RandomForest/Transformer/Fusion models (their probability
dicts are hardcoded 3-class BUY/SELL/HOLD) -- out of scope for this pass
per the standing "no ML model changes without explicit analysis and
approval" rule. Instead, `_decision_label()` derives a display-only label
from data the pipeline already computes (confidence, and three risk flags
that previously only nudged `raw_confidence` up/down: social
manipulation/pump detection, multi-timeframe trend actively fighting the
model's lean, and extreme funding-rate conflict) without changing
`direction`, `confidence`, or any trading/notification logic that reads
`direction` elsewhere in this codebase.
"""
from app.services.signal_engine import _decision_label


class TestDecisionLabelHoldCases:
    def test_hold_with_no_risk_flags_is_wait(self):
        assert _decision_label("HOLD", manip_detected=False, mtf_fights=False,
                                funding_against=False) == "WAIT"

    def test_hold_with_manipulation_detected_is_avoid(self):
        assert _decision_label("HOLD", manip_detected=True, mtf_fights=False,
                                funding_against=False) == "AVOID"

    def test_hold_ignores_mtf_fights_and_funding_against_by_themselves(self):
        # These two flags can only ever be True when final_dir != "HOLD" in
        # generate_signal() (both are computed inside `if final_dir !=
        # "HOLD":` guards) -- but _decision_label() itself should still be
        # defensively correct if ever called with an inconsistent
        # combination, since manip_detected is the only flag that's
        # reachable independent of final_dir.
        assert _decision_label("HOLD", manip_detected=False, mtf_fights=True,
                                funding_against=True) == "WAIT"


class TestDecisionLabelActionableCases:
    def test_buy_with_no_risk_flags_stays_buy(self):
        assert _decision_label("BUY", manip_detected=False, mtf_fights=False,
                                funding_against=False) == "BUY"

    def test_sell_with_no_risk_flags_stays_sell(self):
        assert _decision_label("SELL", manip_detected=False, mtf_fights=False,
                                funding_against=False) == "SELL"

    def test_buy_with_manipulation_detected_becomes_avoid(self):
        assert _decision_label("BUY", manip_detected=True, mtf_fights=False,
                                funding_against=False) == "AVOID"

    def test_sell_with_manipulation_detected_becomes_avoid(self):
        assert _decision_label("SELL", manip_detected=True, mtf_fights=False,
                                funding_against=False) == "AVOID"

    def test_buy_with_mtf_fighting_the_lean_becomes_avoid(self):
        assert _decision_label("BUY", manip_detected=False, mtf_fights=True,
                                funding_against=False) == "AVOID"

    def test_sell_with_mtf_fighting_the_lean_becomes_avoid(self):
        assert _decision_label("SELL", manip_detected=False, mtf_fights=True,
                                funding_against=False) == "AVOID"

    def test_buy_with_funding_rate_conflict_becomes_avoid(self):
        assert _decision_label("BUY", manip_detected=False, mtf_fights=False,
                                funding_against=True) == "AVOID"

    def test_sell_with_funding_rate_conflict_becomes_avoid(self):
        assert _decision_label("SELL", manip_detected=False, mtf_fights=False,
                                funding_against=True) == "AVOID"

    def test_buy_with_all_three_risk_flags_is_still_just_avoid_not_a_crash(self):
        assert _decision_label("BUY", manip_detected=True, mtf_fights=True,
                                funding_against=True) == "AVOID"
