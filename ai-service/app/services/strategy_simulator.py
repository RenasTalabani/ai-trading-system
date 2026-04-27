"""
Strategy Simulator — back-simulates what would have happened if the user
followed the strategy recommendations over the selected timeframe.
Pure add-on: reads Binance data only, writes nothing.
"""
import logging
from typing import List
import pandas as pd
import numpy as np

from app.services.data_processor import DataProcessor

logger = logging.getLogger("ai-service.strategy_simulator")

# How many candles to split into: simulation window + lookback window
_TIMEFRAME_CONFIG = {
    "1d":  {"interval": "15m", "total": 200, "signal_window": 100, "label": "1 day"},
    "7d":  {"interval": "1h",  "total": 300, "signal_window": 150, "label": "7 days"},
    "30d": {"interval": "4h",  "total": 250, "signal_window": 120, "label": "30 days"},
}


def _ema(series: pd.Series, span: int) -> pd.Series:
    return series.ewm(span=span, adjust=False).mean()


def _simulate_asset(df: pd.DataFrame, capital: float, signal_window: int) -> dict:
    """Run a simple EMA/RSI trend-following simulation on the given candles."""
    if len(df) < signal_window + 10:
        return {"profit": 0.0, "loss": 0.0, "wins": 0, "losses": 0, "trades": 0}

    close    = df["close"].reset_index(drop=True)
    ema50    = _ema(close, min(50, len(close)//2))
    ema20    = _ema(close, min(20, len(close)//4))

    position  = 0.0   # units held (0 = flat)
    entry     = 0.0
    balance   = capital
    wins      = 0
    losses    = 0
    profit    = 0.0
    loss      = 0.0

    for i in range(signal_window, len(close) - 1):
        price = close.iloc[i]
        e20   = ema20.iloc[i]
        e50   = ema50.iloc[i]

        # Entry signal: EMA20 crosses above EMA50 → BUY
        if position == 0 and e20 > e50 and ema20.iloc[i - 1] <= ema50.iloc[i - 1]:
            position = balance / price
            entry    = price

        # Exit signal: EMA20 crosses below EMA50 → SELL
        elif position > 0 and e20 < e50 and ema20.iloc[i - 1] >= ema50.iloc[i - 1]:
            exit_price = price
            pnl        = (exit_price - entry) / entry * balance
            balance   += pnl
            if pnl >= 0:
                wins   += 1
                profit += pnl
            else:
                losses += 1
                loss   += abs(pnl)
            position = 0.0

    # Close any open position at last candle
    if position > 0:
        exit_price = float(close.iloc[-1])
        pnl        = (exit_price - entry) / entry * balance
        balance   += pnl
        if pnl >= 0:
            wins += 1; profit += pnl
        else:
            losses += 1; loss += abs(pnl)

    return {
        "profit":  round(profit, 2),
        "loss":    round(loss, 2),
        "wins":    wins,
        "losses":  losses,
        "trades":  wins + losses,
        "final_balance": round(balance, 2),
    }


class StrategySimulator:
    def __init__(self):
        self._dp = DataProcessor()

    async def simulate(self, assets: List[str], timeframe: str, capital: float) -> dict:
        import asyncio

        assets    = [a.upper() for a in assets]
        timeframe = timeframe.lower()
        cfg       = _TIMEFRAME_CONFIG.get(timeframe, _TIMEFRAME_CONFIG["7d"])

        per_asset_capital = capital / max(len(assets), 1)

        # Fetch all candles in parallel
        candle_tasks = [
            self._dp.fetch_market_data(a, cfg["interval"], limit=cfg["total"])
            for a in assets
        ]
        candle_results = await asyncio.gather(*candle_tasks, return_exceptions=True)

        asset_results = []
        total_profit  = 0.0
        total_loss    = 0.0
        total_wins    = 0
        total_trades  = 0
        final_balance = 0.0

        for asset, df_or_err in zip(assets, candle_results):
            if isinstance(df_or_err, Exception) or df_or_err is None:
                asset_results.append({
                    "asset": asset, "profit": 0.0, "loss": 0.0,
                    "wins": 0, "losses": 0, "trades": 0,
                    "initial_capital": round(per_asset_capital, 2),
                    "final_balance": round(per_asset_capital, 2),
                })
                final_balance += per_asset_capital
                continue

            sim = _simulate_asset(df_or_err, per_asset_capital, cfg["signal_window"])

            total_profit  += sim["profit"]
            total_loss    += sim["loss"]
            total_wins    += sim["wins"]
            total_trades  += sim["trades"]
            final_balance += sim["final_balance"]

            asset_results.append({
                "asset":           asset,
                "initial_capital": round(per_asset_capital, 2),
                "final_balance":   sim["final_balance"],
                "profit":          sim["profit"],
                "loss":            sim["loss"],
                "wins":            sim["wins"],
                "losses":          sim["losses"],
                "trades":          sim["trades"],
                "return_pct":      round((sim["final_balance"] - per_asset_capital) / per_asset_capital * 100, 2),
            })

        win_rate = round(total_wins / total_trades * 100, 1) if total_trades > 0 else 0.0
        net_pnl  = final_balance - capital

        return {
            "timeframe":       timeframe,
            "initial_balance": round(capital, 2),
            "final_balance":   round(final_balance, 2),
            "profit":          round(total_profit, 2),
            "loss":            round(total_loss, 2),
            "net_pnl":         round(net_pnl, 2),
            "return_pct":      round(net_pnl / capital * 100, 2) if capital > 0 else 0.0,
            "win_rate":        win_rate,
            "total_trades":    total_trades,
            "assets_simulated": len(assets),
            "per_asset":       asset_results,
        }
