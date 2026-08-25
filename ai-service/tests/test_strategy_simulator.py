"""
Tests for StrategySimulator (T-048, 2026-08-25/26 overnight continuous-
improvement pass).

Zero prior test coverage existed for this module before this pass.

FIXED: _simulate_asset()'s insufficient-data early return
(`len(df) < signal_window + 10`) omitted the "final_balance" key that its
only caller, StrategySimulator.simulate(), unconditionally reads twice
(`final_balance += sim["final_balance"]` and in the per-asset result dict).
Reproduced directly: any single requested asset whose fetched candle
history is shorter than signal_window+10 (a realistic condition -- a
newly-listed asset, a rate-limited/partial Binance response, or simply
requesting a longer timeframe than the asset has history for) raised an
unhandled KeyError from inside the per-asset loop, which is not caught
anywhere inside simulate() -- it propagates out of the whole multi-asset
request. routes.py's /strategy/simulate handler does catch generic
Exception and turns it into a 500, so the service itself doesn't crash,
but ONE asset with too-short history took down the ENTIRE batch response
for every other asset in the same request, even ones with plenty of data
-- unlike a failed fetch (returned as an Exception/None by asyncio.gather),
which was already handled gracefully by falling back to a flat "capital
preserved, no trades" result. This directly affects the paper-trading
simulator surfaced to users -- core trading-correctness territory.
Single unambiguous fix: add "final_balance": round(capital, 2) to the
early-return dict, matching the "no trade happened, capital preserved"
semantics already used for the fetch-failure fallback.

ALSO FIXED (same file, same pass, same nature -- found while writing
coverage for the fix above): StrategySimulator.simulate()'s per-asset
"return_pct" divided by per_asset_capital with no zero-guard --
`round((final_balance - per_asset_capital) / per_asset_capital * 100, 2)`
-- while the AGGREGATE return_pct two lines below it already guards the
identical calculation (`... if capital > 0 else 0.0`). SimulateRequest's
`capital` field has no validation constraint (no gt=0), so a caller
passing capital=0 via /strategy/simulate hit an unhandled
ZeroDivisionError -- reproduced directly. Fixed by adding the same guard
already used one line below for the aggregate figure.
"""
import numpy as np
import pandas as pd
import pytest

from app.services.strategy_simulator import (
    StrategySimulator,
    _simulate_asset,
    _ema,
    _TIMEFRAME_CONFIG,
)


def _flat_df(n, price=100.0):
    return pd.DataFrame({"close": [price] * n})


def _trending_df(n, start=100.0, drift=0.3, noise_seed=7):
    """A price series with enough movement to actually produce EMA20/EMA50
    crossovers, so the simulator's entry/exit logic gets exercised."""
    rng = np.random.RandomState(noise_seed)
    steps = drift * np.sin(np.linspace(0, 6 * np.pi, n)) + rng.normal(0, 0.15, n)
    prices = start + np.cumsum(steps)
    prices = np.clip(prices, 1.0, None)
    return pd.DataFrame({"close": prices})


class TestSimulateAssetInsufficientData:
    """Regression guard for the T-048 KeyError fix."""

    def test_returns_final_balance_key_when_too_short(self):
        df = _flat_df(50)
        result = _simulate_asset(df, capital=500.0, signal_window=100)
        assert "final_balance" in result
        assert result["final_balance"] == 500.0

    def test_capital_is_preserved_unchanged(self):
        df = _flat_df(10)
        result = _simulate_asset(df, capital=1234.56, signal_window=100)
        assert result["final_balance"] == 1234.56
        assert result["profit"] == 0.0
        assert result["loss"] == 0.0
        assert result["trades"] == 0

    def test_exactly_at_the_boundary_is_still_insufficient(self):
        # len(df) == signal_window + 10 - 1 must still hit the early return
        df = _flat_df(109)
        result = _simulate_asset(df, capital=500.0, signal_window=100)
        assert result["trades"] == 0
        assert result["final_balance"] == 500.0


class TestSimulateAssetPnLMath:
    def test_flat_price_produces_no_trades(self):
        df = _flat_df(200)
        result = _simulate_asset(df, capital=500.0, signal_window=100)
        # EMA20 never crosses EMA50 on a perfectly flat series
        assert result["trades"] == 0
        assert result["final_balance"] == 500.0

    def test_trending_data_can_produce_trades_with_consistent_math(self):
        df = _trending_df(300)
        result = _simulate_asset(df, capital=1000.0, signal_window=100)
        # win/loss counts must reconcile with trades, and final_balance must
        # equal capital + net pnl (profit - loss) to within rounding.
        assert result["wins"] + result["losses"] == result["trades"]
        expected_balance = round(1000.0 + result["profit"] - result["loss"], 2)
        assert result["final_balance"] == pytest.approx(expected_balance, abs=0.05)

    def test_final_balance_never_negative_for_a_single_full_loss_trade(self):
        # A position can lose at most 100% of the balance it was opened
        # with (no leverage, no shorting in this model) -- final_balance
        # should never go negative.
        df = _trending_df(300, drift=0.8, noise_seed=3)
        result = _simulate_asset(df, capital=500.0, signal_window=100)
        assert result["final_balance"] >= 0.0


class TestEmaHelper:
    def test_ema_output_length_matches_input(self):
        s = pd.Series([1.0, 2.0, 3.0, 4.0, 5.0])
        out = _ema(s, span=3)
        assert len(out) == len(s)

    def test_ema_first_value_equals_first_price(self):
        s = pd.Series([10.0, 20.0, 30.0])
        out = _ema(s, span=2)
        assert out.iloc[0] == 10.0


class TestStrategySimulatorAggregation:
    async def test_failed_fetch_falls_back_to_flat_result(self, monkeypatch):
        sim = StrategySimulator()

        async def fake_fetch(asset, interval, limit):
            return None  # simulates a fetch failure

        monkeypatch.setattr(sim._dp, "fetch_market_data", fake_fetch)
        result = await sim.simulate(["BTCUSDT"], "7d", 500.0)
        assert result["per_asset"][0]["trades"] == 0
        assert result["final_balance"] == 500.0
        assert result["net_pnl"] == 0.0

    async def test_insufficient_data_asset_does_not_crash_the_whole_batch(self, monkeypatch):
        """Direct regression guard for T-048 at the StrategySimulator level:
        one asset with too-short history must not take down the response
        for assets that had plenty of data."""
        sim = StrategySimulator()
        short_df = _flat_df(20)

        async def fake_fetch(asset, interval, limit):
            return short_df

        monkeypatch.setattr(sim._dp, "fetch_market_data", fake_fetch)
        result = await sim.simulate(["BTCUSDT", "ETHUSDT"], "7d", 1000.0)  # must not raise
        assert result["assets_simulated"] == 2
        assert len(result["per_asset"]) == 2
        assert all(a["final_balance"] == 500.0 for a in result["per_asset"])

    async def test_unknown_timeframe_falls_back_to_7d_config(self, monkeypatch):
        sim = StrategySimulator()
        seen_intervals = []

        async def fake_fetch(asset, interval, limit):
            seen_intervals.append(interval)
            return _flat_df(300)

        monkeypatch.setattr(sim._dp, "fetch_market_data", fake_fetch)
        await sim.simulate(["BTCUSDT"], "not-a-real-timeframe", 500.0)
        assert seen_intervals == [_TIMEFRAME_CONFIG["7d"]["interval"]]

    async def test_capital_split_evenly_across_assets(self, monkeypatch):
        sim = StrategySimulator()

        async def fake_fetch(asset, interval, limit):
            return _flat_df(300)

        monkeypatch.setattr(sim._dp, "fetch_market_data", fake_fetch)
        result = await sim.simulate(["BTCUSDT", "ETHUSDT", "SOLUSDT"], "7d", 900.0)
        assert all(a["initial_capital"] == 300.0 for a in result["per_asset"])
        assert result["initial_balance"] == 900.0

    async def test_win_rate_matches_aggregated_wins_and_trades(self, monkeypatch):
        sim = StrategySimulator()

        async def fake_fetch(asset, interval, limit):
            return _trending_df(300, noise_seed=11)

        monkeypatch.setattr(sim._dp, "fetch_market_data", fake_fetch)
        result = await sim.simulate(["BTCUSDT"], "7d", 500.0)
        total_wins = sum(a["wins"] for a in result["per_asset"])
        if result["total_trades"] > 0:
            expected = round(total_wins / result["total_trades"] * 100, 1)
            assert result["win_rate"] == expected
        else:
            assert result["win_rate"] == 0.0

    async def test_zero_capital_does_not_raise(self, monkeypatch):
        sim = StrategySimulator()

        async def fake_fetch(asset, interval, limit):
            return _trending_df(300, noise_seed=5)

        monkeypatch.setattr(sim._dp, "fetch_market_data", fake_fetch)
        result = await sim.simulate(["BTCUSDT"], "7d", 0.0)  # must not raise ZeroDivisionError
        assert result["return_pct"] == 0.0
