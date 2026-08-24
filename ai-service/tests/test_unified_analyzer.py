"""
Tests for UnifiedAnalyzer (T-043, 2026-08-24 continuous-improvement pass).

Bug: `analyze()`'s fallback stop_loss/take_profit synthesis (used whenever
OrderBlockEngine's own signal didn't carry SL/TP, e.g. it held while
strategy+news+social still pushed the *fused* signal to a directional
call) unconditionally applied a long-only shape:

    stop_loss   = round(current_price * 0.98, 6)
    take_profit = round(current_price * 1.04, 6)

regardless of `fused_action`. For a fused SELL this hands out a stop_loss
BELOW entry and a take_profit ABOVE entry -- backwards for a short (no
real downside protection, and a target on the wrong side) -- and it also
fired for a fused HOLD, inventing live-looking trade levels for a
non-actionable signal. This reaches real consumers: the backend's
unifiedController.js passes the AI-service response through unchanged
(`res.json(aiResp.data)`), and the mobile dashboard's SignalCard renders
"Stop Loss"/"Take Profit" tiles whenever they are non-null, with no gate
on the signal's `action` -- so a SELL call would have displayed an
inverted stop, and a HOLD call would have displayed invented trade levels
for a signal that wasn't actionable, on several screens including
virtual_trades_screen.dart.

Fixed to mirror OrderBlockEngine's own SELL convention (stop above entry,
target below) and to only synthesize levels for an actionable BUY/SELL
fused action -- HOLD gets no SL/TP, matching how every other HOLD signal
in this codebase (e.g. OrderBlockEngine._hold_signal) carries none.

Zero prior test coverage existed for this module before this pass.
"""
import pytest

from app.services.unified_analyzer import (
    UnifiedAnalyzer,
    _action_to_score,
    _score_to_action,
)


class FakeStrategyEngine:
    def __init__(self, recs=None):
        self._recs = recs if recs is not None else []

    async def analyze_multi(self, assets, timeframe):
        return self._recs


class FakeOrderBlockEngine:
    def __init__(self, result=None):
        self._result = result if result is not None else {"success": False}

    async def analyze(self, asset, timeframe):
        return self._result


class FakeSentimentAnalyzer:
    def __init__(self, data=None):
        self._data = data if data is not None else {"by_asset": {}}

    async def refresh(self):
        return self._data


def _ob_result(current_price=100.0, action="HOLD", confidence=50,
               stop_loss=None, take_profit=None, entry_zone=None,
               reason="No valid OB within 5% of price."):
    return {
        "success": True,
        "current_price": current_price,
        "ema50": current_price, "ema200": current_price,
        "rsi": 50.0, "trend": "sideways",
        "order_blocks": [],
        "signal": {
            "action": action, "confidence": confidence,
            "entry_zone": entry_zone, "stop_loss": stop_loss,
            "take_profit": take_profit, "risk_reward": "1:2" if stop_loss else None,
            "reason": reason,
        },
    }


def _strat_rec(action="HOLD", confidence=50, expected_move_percent=2.0,
              win_probability=None, reasoning="synthetic"):
    rec = {
        "recommendation": action, "confidence": confidence,
        "expected_move_percent": expected_move_percent,
        "reasoning": reasoning,
    }
    if win_probability is not None:
        rec["win_probability"] = win_probability
    return rec


class TestActionToScore:
    def test_buy_returns_confidence(self):
        assert _action_to_score("BUY", 80) == 80

    def test_sell_returns_inverted_confidence(self):
        assert _action_to_score("SELL", 80) == 20

    def test_hold_returns_neutral_50(self):
        assert _action_to_score("HOLD", 99) == 50.0


class TestScoreToAction:
    def test_score_of_58_is_buy(self):
        action, conf = _score_to_action(58)
        assert action == "BUY"
        assert conf == 58

    def test_score_just_below_58_is_hold(self):
        action, _ = _score_to_action(57.9)
        assert action == "HOLD"

    def test_score_of_42_is_sell(self):
        action, conf = _score_to_action(42)
        assert action == "SELL"
        assert conf == 58

    def test_score_just_above_42_is_hold(self):
        action, _ = _score_to_action(42.1)
        assert action == "HOLD"

    def test_confidence_clamped_at_95_for_buy(self):
        _, conf = _score_to_action(100)
        assert conf == 95

    def test_confidence_clamped_at_95_for_sell(self):
        _, conf = _score_to_action(0)
        assert conf == 95


class TestFallbackStopLossDirectionMatchesFusedAction:
    """Direct regression guard for the T-043 fix."""

    async def test_fused_sell_with_no_ob_levels_gets_short_shaped_stop(self):
        # ob holds (no own SL/TP) but strategy pushes fused score to SELL
        analyzer = UnifiedAnalyzer(
            FakeStrategyEngine([_strat_rec(action="SELL", confidence=90)]),
            FakeOrderBlockEngine(_ob_result(current_price=100.0, action="HOLD")),
            FakeSentimentAnalyzer(),
            FakeSentimentAnalyzer(),
        )
        result = await analyzer.analyze("BTCUSDT", "1h")
        assert result["signal"]["action"] == "SELL"
        sl = result["signal"]["stop_loss"]
        tp = result["signal"]["take_profit"]
        assert sl is not None and tp is not None
        # Short: stop ABOVE entry, target BELOW entry.
        assert sl > 100.0
        assert tp < 100.0
        assert result["signal"]["risk_reward"] == "1:2"

    async def test_fused_buy_with_no_ob_levels_gets_long_shaped_stop(self):
        analyzer = UnifiedAnalyzer(
            FakeStrategyEngine([_strat_rec(action="BUY", confidence=90)]),
            FakeOrderBlockEngine(_ob_result(current_price=100.0, action="HOLD")),
            FakeSentimentAnalyzer(),
            FakeSentimentAnalyzer(),
        )
        result = await analyzer.analyze("BTCUSDT", "1h")
        assert result["signal"]["action"] == "BUY"
        sl = result["signal"]["stop_loss"]
        tp = result["signal"]["take_profit"]
        assert sl is not None and tp is not None
        # Long: stop BELOW entry, target ABOVE entry.
        assert sl < 100.0
        assert tp > 100.0
        assert result["signal"]["risk_reward"] == "1:2"

    async def test_fused_hold_gets_no_synthesized_levels_even_with_price_available(self):
        analyzer = UnifiedAnalyzer(
            FakeStrategyEngine([_strat_rec(action="HOLD", confidence=50)]),
            FakeOrderBlockEngine(_ob_result(current_price=100.0, action="HOLD")),
            FakeSentimentAnalyzer(),
            FakeSentimentAnalyzer(),
        )
        result = await analyzer.analyze("BTCUSDT", "1h")
        assert result["signal"]["action"] == "HOLD"
        assert result["signal"]["stop_loss"] is None
        assert result["signal"]["take_profit"] is None
        assert result["signal"]["entry_zone"] is None

    async def test_ob_provided_levels_pass_through_unchanged_for_sell(self):
        # When OB itself provides SL/TP, the synthesis path must not run
        # regardless of fused_action's direction.
        analyzer = UnifiedAnalyzer(
            FakeStrategyEngine([_strat_rec(action="SELL", confidence=90)]),
            FakeOrderBlockEngine(_ob_result(
                current_price=100.0, action="SELL", confidence=90,
                stop_loss=102.5, take_profit=95.0, entry_zone="99.0 - 101.0",
            )),
            FakeSentimentAnalyzer(),
            FakeSentimentAnalyzer(),
        )
        result = await analyzer.analyze("BTCUSDT", "1h")
        assert result["signal"]["stop_loss"] == 102.5
        assert result["signal"]["take_profit"] == 95.0
        assert result["signal"]["entry_zone"] == "99.0 - 101.0"

    async def test_ob_failure_leaves_levels_none_regardless_of_fused_action(self):
        # OB engine raised/timed out -> ob_result is None -> current_price
        # stays 0.0 -> no synthesis should be attempted, no crash either.
        class RaisingOrderBlockEngine:
            async def analyze(self, asset, timeframe):
                raise RuntimeError("boom")

        analyzer = UnifiedAnalyzer(
            FakeStrategyEngine([_strat_rec(action="SELL", confidence=90)]),
            RaisingOrderBlockEngine(),
            FakeSentimentAnalyzer(),
            FakeSentimentAnalyzer(),
        )
        result = await analyzer.analyze("BTCUSDT", "1h")
        assert result["signal"]["stop_loss"] is None
        assert result["signal"]["take_profit"] is None


class TestFusionWeighting:
    async def test_fusion_weights_reported_match_the_documented_split(self):
        analyzer = UnifiedAnalyzer(
            FakeStrategyEngine([]), FakeOrderBlockEngine(),
            FakeSentimentAnalyzer(), FakeSentimentAnalyzer(),
        )
        result = await analyzer.analyze("BTCUSDT", "1h")
        assert result["fusion_weights"] == {
            "ob": 0.40, "strategy": 0.35, "news": 0.15, "social": 0.10,
        }

    async def test_no_engines_returning_data_is_a_neutral_hold(self):
        analyzer = UnifiedAnalyzer(
            FakeStrategyEngine([]), FakeOrderBlockEngine(),
            FakeSentimentAnalyzer(), FakeSentimentAnalyzer(),
        )
        result = await analyzer.analyze("BTCUSDT", "1h")
        assert result["signal"]["action"] == "HOLD"
        assert result["success"] is True


class TestAllocationMath:
    async def test_allocation_is_60pct_of_capital_and_risk_is_5pct_of_allocation(self):
        analyzer = UnifiedAnalyzer(
            FakeStrategyEngine([]), FakeOrderBlockEngine(),
            FakeSentimentAnalyzer(), FakeSentimentAnalyzer(),
        )
        result = await analyzer.analyze("BTCUSDT", "1h", capital=1000.0)
        alloc = result["allocation"]
        assert alloc["recommended"] == 600.0
        assert alloc["risk_amount"] == 30.0
        assert alloc["expected_loss"] == -30.0

    async def test_win_rate_prefers_strategy_win_probability_when_present(self):
        analyzer = UnifiedAnalyzer(
            FakeStrategyEngine([_strat_rec(action="BUY", confidence=90, win_probability=72.5)]),
            FakeOrderBlockEngine(_ob_result(current_price=100.0, action="HOLD")),
            FakeSentimentAnalyzer(), FakeSentimentAnalyzer(),
        )
        result = await analyzer.analyze("BTCUSDT", "1h")
        assert result["allocation"]["win_rate"] == 72.5
