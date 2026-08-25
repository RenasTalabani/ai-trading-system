"""
Tests for SmartSimulator (T-049, 2026-08-25/26 overnight continuous-
improvement pass).

Zero prior test coverage existed for this module before this pass.

FIXED (critical, core paper-trading correctness): _simulate_asset()'s
per-trade pnl calculation applied a `if direction == "SELL": pnl_pct =
-pnl_pct` sign flip after computing pnl_pct from hit_tp/hit_sl. This was
backwards. hit_tp/hit_sl are already direction-aware (TP is placed on the
favorable side of entry and SL on the unfavorable side for BOTH BUY and
SELL, by construction in the entry-signal block a few lines below) --
so `pnl_pct = abs(tp-entry)/entry` at a TP hit is already correctly
positive for either direction (a TP hit is *always* a win by definition),
and `pnl_pct = -abs(sl-entry)/entry` at an SL hit is already correctly
negative for either direction (an SL hit is *always* a loss). The
direction-based flip inverted this correct sign specifically for SELL
trades: proven directly below, a SELL trade that hits TP (win=True, the
price moved favorably) was recorded with NEGATIVE pnl, and a SELL trade
that hits SL (win=False, price moved against the position) was recorded
with POSITIVE pnl -- completely inverted, for every single short trade
this "realistic P&L" simulator ever produced. BUY trades were unaffected
(pnl_pct was already correctly signed for BUY with no flip applied).
Practical impact: any simulation involving short trades (which the
bearish EMA-crossover signal generates routinely) had a systematically
wrong final_balance/profit/return_pct -- a genuinely profitable bearish
period would show as a loss and vice versa, directly misleading a user
comparing simulated strategy performance. win_rate itself stayed correct
(computed from the "win" field, which correctly reflects hit_tp/hit_sl,
independent of the broken pnl sign) -- only the dollar P&L figures were
inverted for shorts, which is what makes this bug easy to miss on a
quick glance (trade counts and win rate look sane; the money is wrong).

Fix: removed the erroneous `if direction == "SELL": pnl_pct = -pnl_pct`
block entirely -- the pre-flip sign was already correct for both
directions.
"""
import pandas as pd
import pytest

from app.services.smart_simulator import (
    _simulate_asset,
    _compute_indicators,
    _summary,
    SmartSimulator,
)


def _hand_crafted_df(rows):
    """rows: list of dicts with close/ema20/ema50/rsi/atr -- bypasses
    _compute_indicators() so entry/exit conditions are fully deterministic."""
    return pd.DataFrame(rows)


class TestSellTradeSignRegressionGuard:
    """Direct regression guard for the T-049 sign-inversion bug."""

    def _bearish_entry_row(self, ema20=45.0, ema50=50.0, rsi=40.0, atr=1.0, close=100.0):
        return {"close": close, "ema20": ema20, "ema50": ema50, "rsi": rsi, "atr": atr}

    def _prev_row_for_bearish_entry(self):
        return {"close": 100.0, "ema20": 55.0, "ema50": 50.0, "rsi": 50.0, "atr": 1.0}

    def test_winning_short_produces_positive_pnl(self):
        # entry=100 (SELL), sl=101.5, tp=97.5 -- next candle closes at TP -> a WIN.
        df = _hand_crafted_df([
            {"close": 100.0, "ema20": 50.0, "ema50": 50.0, "rsi": 50.0, "atr": 1.0},  # row 0 (unused, i starts at 2)
            self._prev_row_for_bearish_entry(),                                        # row 1 = "prev" for i=2
            self._bearish_entry_row(),                                                 # row 2: bearish entry fires
            {"close": 97.5, "ema20": 44.0, "ema50": 51.0, "rsi": 30.0, "atr": 1.0},     # row 3: hits TP
        ])
        result = _simulate_asset(df, capital=1000.0, risk_pct=5.0)
        assert result["trades"] == 1
        trade = result["trade_log"][0]
        assert trade["direction"] == "SELL"
        assert trade["win"] is True
        assert trade["pnl"] > 0, "a winning SELL trade must have positive pnl"
        assert result["profit"] > 0
        assert result["final_balance"] > 1000.0

    def test_losing_short_produces_negative_pnl(self):
        # Same entry, but next candle closes at SL -> a LOSS.
        df = _hand_crafted_df([
            {"close": 100.0, "ema20": 50.0, "ema50": 50.0, "rsi": 50.0, "atr": 1.0},
            self._prev_row_for_bearish_entry(),
            self._bearish_entry_row(),
            {"close": 101.5, "ema20": 56.0, "ema50": 51.0, "rsi": 70.0, "atr": 1.0},     # row 3: hits SL
        ])
        result = _simulate_asset(df, capital=1000.0, risk_pct=5.0)
        assert result["trades"] == 1
        trade = result["trade_log"][0]
        assert trade["direction"] == "SELL"
        assert trade["win"] is False
        assert trade["pnl"] < 0, "a losing SELL trade must have negative pnl"
        assert result["profit"] < 0
        assert result["final_balance"] < 1000.0

    def test_win_field_and_pnl_sign_always_agree_for_sell(self):
        """The core invariant the bug violated: a trade marked win=True must
        never have negative pnl, and win=False must never have positive pnl."""
        win_df = _hand_crafted_df([
            {"close": 100.0, "ema20": 50.0, "ema50": 50.0, "rsi": 50.0, "atr": 1.0},
            self._prev_row_for_bearish_entry(),
            self._bearish_entry_row(),
            {"close": 97.5, "ema20": 44.0, "ema50": 51.0, "rsi": 30.0, "atr": 1.0},
        ])
        loss_df = _hand_crafted_df([
            {"close": 100.0, "ema20": 50.0, "ema50": 50.0, "rsi": 50.0, "atr": 1.0},
            self._prev_row_for_bearish_entry(),
            self._bearish_entry_row(),
            {"close": 101.5, "ema20": 56.0, "ema50": 51.0, "rsi": 70.0, "atr": 1.0},
        ])
        for df, expected_win in [(win_df, True), (loss_df, False)]:
            trade = _simulate_asset(df, capital=1000.0, risk_pct=5.0)["trade_log"][0]
            assert trade["win"] is expected_win
            assert (trade["pnl"] > 0) == expected_win


class TestBuyTradeSignUnaffected:
    """The BUY side was already correct before the fix -- confirm the fix
    didn't disturb it."""

    def test_winning_long_produces_positive_pnl(self):
        # entry=100 (BUY), sl=98.5, tp=102.5.
        df = _hand_crafted_df([
            {"close": 100.0, "ema20": 50.0, "ema50": 50.0, "rsi": 50.0, "atr": 1.0},
            {"close": 100.0, "ema20": 45.0, "ema50": 50.0, "rsi": 50.0, "atr": 1.0},  # prev: ema20<=ema50
            {"close": 100.0, "ema20": 55.0, "ema50": 50.0, "rsi": 40.0, "atr": 1.0},  # bullish entry fires
            {"close": 102.5, "ema20": 60.0, "ema50": 51.0, "rsi": 70.0, "atr": 1.0},  # hits TP
        ])
        trade = _simulate_asset(df, capital=1000.0, risk_pct=5.0)["trade_log"][0]
        assert trade["direction"] == "BUY"
        assert trade["win"] is True
        assert trade["pnl"] > 0

    def test_losing_long_produces_negative_pnl(self):
        df = _hand_crafted_df([
            {"close": 100.0, "ema20": 50.0, "ema50": 50.0, "rsi": 50.0, "atr": 1.0},
            {"close": 100.0, "ema20": 45.0, "ema50": 50.0, "rsi": 50.0, "atr": 1.0},
            {"close": 100.0, "ema20": 55.0, "ema50": 50.0, "rsi": 40.0, "atr": 1.0},
            {"close": 98.5, "ema20": 44.0, "ema50": 51.0, "rsi": 30.0, "atr": 1.0},   # hits SL
        ])
        trade = _simulate_asset(df, capital=1000.0, risk_pct=5.0)["trade_log"][0]
        assert trade["direction"] == "BUY"
        assert trade["win"] is False
        assert trade["pnl"] < 0


class TestSimulateAssetGeneral:
    def test_no_crossover_produces_no_trades(self):
        rows = [{"close": 100.0, "ema20": 50.0, "ema50": 50.0, "rsi": 50.0, "atr": 1.0}] * 10
        result = _simulate_asset(_hand_crafted_df(rows), capital=500.0, risk_pct=5.0)
        assert result["trades"] == 0
        assert result["final_balance"] == 500.0
        assert result["win_rate"] == 0.0

    def test_win_rate_matches_win_trade_count(self):
        df = _hand_crafted_df([
            {"close": 100.0, "ema20": 50.0, "ema50": 50.0, "rsi": 50.0, "atr": 1.0},
            {"close": 100.0, "ema20": 45.0, "ema50": 50.0, "rsi": 50.0, "atr": 1.0},
            {"close": 100.0, "ema20": 55.0, "ema50": 50.0, "rsi": 40.0, "atr": 1.0},
            {"close": 102.5, "ema20": 60.0, "ema50": 51.0, "rsi": 70.0, "atr": 1.0},
        ])
        result = _simulate_asset(df, capital=1000.0, risk_pct=5.0)
        expected_wr = round(result["win_trades"] / result["trades"] * 100, 1)
        assert result["win_rate"] == expected_wr


class TestComputeIndicators:
    def test_adds_expected_columns(self):
        df = pd.DataFrame({
            "close": [100.0 + i for i in range(60)],
            "high":  [101.0 + i for i in range(60)],
            "low":   [99.0 + i for i in range(60)],
        })
        out = _compute_indicators(df)
        for col in ("ema20", "ema50", "rsi", "atr"):
            assert col in out.columns


class TestSummary:
    def test_no_trades_message(self):
        assert "No trades" in _summary(0.0, 0.0, 0)

    def test_excellent_threshold(self):
        assert "Excellent" in _summary(20.0, 70.0, 10)

    def test_high_drawdown_threshold(self):
        assert "drawdown" in _summary(-15.0, 30.0, 10)


class TestSmartSimulatorRun:
    async def test_capital_floored_at_10(self, monkeypatch):
        sim = SmartSimulator()

        async def fake_fetch(asset, interval, limit):
            return None

        monkeypatch.setattr(sim._dp, "fetch_market_data", fake_fetch)
        result = await sim.run(capital=0.0, assets=["BTCUSDT"], duration_days=7, risk_pct=5.0)
        assert result["capital"] == 10.0

    async def test_insufficient_data_reported_per_asset_without_crashing(self, monkeypatch):
        sim = SmartSimulator()

        async def fake_fetch(asset, interval, limit):
            return pd.DataFrame({"close": [1.0] * 5, "high": [1.0] * 5, "low": [1.0] * 5})

        monkeypatch.setattr(sim._dp, "fetch_market_data", fake_fetch)
        result = await sim.run(capital=500.0, assets=["BTCUSDT"], duration_days=7, risk_pct=5.0)
        assert result["success"] is True
        assert result["per_asset"][0]["error"] == "insufficient_data"

    async def test_assets_capped_at_10(self, monkeypatch):
        sim = SmartSimulator()

        async def fake_fetch(asset, interval, limit):
            return None

        monkeypatch.setattr(sim._dp, "fetch_market_data", fake_fetch)
        many_assets = [f"A{i}USDT" for i in range(15)]
        result = await sim.run(capital=500.0, assets=many_assets, duration_days=7, risk_pct=5.0)
        assert len(result["per_asset"]) == 10
