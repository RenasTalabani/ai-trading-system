"""
Tests for RiskManager (T-038, 2026-08-22 PM continuous-improvement pass).

Zero prior test coverage existed for this module before this pass, despite
it governing every trade's stop-loss/take-profit distance and recommended
position size across the entire app.

compute_sl_tp() is covered for correctness across all four regimes plus the
HOLD/invalid-input edge cases.

compute_position_size() is covered for its basic contract, AND for a
finding surfaced this pass: with the current defaults (risk_pct=2%,
max_cap=10%), the "Kelly-lite" ATR-normalized formula documented in the
function's own docstring only produces a value below the flat cap when
atr_normalized (ATR as a fraction of entry price) exceeds risk_pct/max_cap
= 20% -- an ATR/price ratio far beyond what any tracked asset class
realistically sustains. In practice, both call sites in global_analyzer.py
use the defaults, so every position_size in every scan result is currently
`capital * max_cap` regardless of real volatility, not an ATR-scaled size.
These tests pin down that actual behavior as a regression guard: if
RISK_PCT/MAX_POS_CAP (or the formula) are ever changed, these tests force
a conscious look at what changed rather than a silent behavior shift.
Whether to recalibrate the risk parameters is a real risk-policy decision
left for the owner (see PROJECT_STATUS.md T-038) -- not something this
pass changes unilaterally.
"""
import pytest

from app.services.risk_manager import RiskManager, RISK_PCT, MAX_POS_CAP


@pytest.fixture
def rm():
    return RiskManager()


class TestComputeSlTp:
    def test_buy_trending_uses_1_5x_atr_sl_and_3x_atr_tp(self, rm):
        sl, tp, rr = rm.compute_sl_tp(entry=100.0, atr=1.0, direction="BUY", regime="TRENDING")
        assert sl == pytest.approx(98.5)
        assert tp == pytest.approx(103.0)
        assert rr == "1:2.0"

    def test_sell_trending_inverts_sl_tp_direction(self, rm):
        sl, tp, rr = rm.compute_sl_tp(entry=100.0, atr=1.0, direction="SELL", regime="TRENDING")
        assert sl == pytest.approx(101.5)
        assert tp == pytest.approx(97.0)

    def test_downtrend_uses_tighter_1_2x_atr_sl_than_trending(self, rm):
        sl, tp, rr = rm.compute_sl_tp(entry=100.0, atr=1.0, direction="SELL", regime="DOWNTREND")
        assert sl == pytest.approx(101.2)
        assert tp == pytest.approx(97.6)

    def test_volatile_uses_widest_2x_atr_sl(self, rm):
        sl, tp, rr = rm.compute_sl_tp(entry=100.0, atr=1.0, direction="BUY", regime="VOLATILE")
        assert sl == pytest.approx(98.0)
        assert tp == pytest.approx(104.0)

    def test_sideways_uses_tightest_1x_atr_sl(self, rm):
        sl, tp, rr = rm.compute_sl_tp(entry=100.0, atr=1.0, direction="BUY", regime="SIDEWAYS")
        assert sl == pytest.approx(99.0)
        assert tp == pytest.approx(102.0)

    def test_unknown_regime_falls_back_to_trending_defaults(self, rm):
        sl, tp, rr = rm.compute_sl_tp(entry=100.0, atr=1.0, direction="BUY", regime="NOT_A_REAL_REGIME")
        assert sl == pytest.approx(98.5)
        assert tp == pytest.approx(103.0)

    def test_hold_action_returns_no_sl_tp(self, rm):
        sl, tp, rr = rm.compute_sl_tp(entry=100.0, atr=1.0, direction="HOLD", regime="TRENDING")
        assert sl is None and tp is None and rr == "N/A"

    def test_zero_entry_returns_no_sl_tp_without_crashing(self, rm):
        sl, tp, rr = rm.compute_sl_tp(entry=0.0, atr=1.0, direction="BUY", regime="TRENDING")
        assert sl is None and tp is None and rr == "N/A"

    def test_zero_atr_returns_no_sl_tp_without_crashing(self, rm):
        sl, tp, rr = rm.compute_sl_tp(entry=100.0, atr=0.0, direction="BUY", regime="TRENDING")
        assert sl is None and tp is None and rr == "N/A"


class TestComputePositionSize:
    def test_zero_entry_price_falls_back_to_flat_risk_pct(self, rm):
        size = rm.compute_position_size(account_balance=500.0, atr=1.0, entry_price=0.0)
        assert size == pytest.approx(500.0 * RISK_PCT)

    def test_zero_atr_falls_back_to_flat_risk_pct(self, rm):
        size = rm.compute_position_size(account_balance=500.0, atr=0.0, entry_price=100.0)
        assert size == pytest.approx(500.0 * RISK_PCT)

    def test_result_never_exceeds_max_cap_of_balance(self, rm):
        size = rm.compute_position_size(account_balance=500.0, atr=0.01, entry_price=100.0)
        assert size <= 500.0 * MAX_POS_CAP + 1e-9

    def test_result_never_below_one_dollar(self, rm):
        size = rm.compute_position_size(account_balance=10.0, atr=100.0, entry_price=100.0)
        assert size >= 1.0

    @pytest.mark.parametrize("atr_pct", [0.001, 0.005, 0.01, 0.02, 0.05, 0.10, 0.19])
    def test_realistic_atr_range_always_hits_the_flat_cap_with_current_defaults(self, rm, atr_pct):
        # T-038 finding: for the entire realistic ATR/price range (well
        # under the 20% = risk_pct/max_cap breakeven point), the "Kelly-lite"
        # formula is dominated by max_cap every time -- position size is a
        # flat 10% of balance, not ATR-scaled, with the current defaults.
        entry = 100.0
        atr = entry * atr_pct
        size = rm.compute_position_size(account_balance=500.0, atr=atr, entry_price=entry)
        assert size == pytest.approx(500.0 * MAX_POS_CAP, abs=0.01)

    def test_extreme_atr_above_breakeven_point_produces_a_value_below_the_cap(self, rm):
        # Only past atr_normalized > risk_pct/max_cap (20% here) does the
        # raw formula actually bind instead of the cap.
        entry = 100.0
        atr = entry * 0.25  # 25% ATR/price -- far beyond any realistic asset
        size = rm.compute_position_size(account_balance=500.0, atr=atr, entry_price=entry)
        assert size < 500.0 * MAX_POS_CAP
        assert size == pytest.approx(500.0 * (RISK_PCT / 0.25), abs=0.01)
