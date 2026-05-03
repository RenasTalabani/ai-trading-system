"""
SmartSimulator — backtest EMA crossover strategy on real Binance OHLCV data.
Runs per-asset simulations in parallel and returns a full P&L breakdown.
"""
import asyncio
import logging
from typing import List

import pandas as pd
import numpy as np

from app.services.data_processor import DataProcessor

logger = logging.getLogger("ai-service.smart_simulator")


def _compute_indicators(df: pd.DataFrame) -> pd.DataFrame:
    close = df["close"].copy()
    df["ema20"] = close.ewm(span=20, adjust=False).mean()
    df["ema50"] = close.ewm(span=50, adjust=False).mean()
    delta = close.diff()
    gain  = delta.clip(lower=0).rolling(14).mean()
    loss  = (-delta.clip(upper=0)).rolling(14).mean()
    rs    = gain / loss.replace(0, np.nan)
    df["rsi"] = 100 - (100 / (1 + rs))
    tr = pd.concat([
        df["high"] - df["low"],
        (df["high"] - close.shift()).abs(),
        (df["low"]  - close.shift()).abs(),
    ], axis=1).max(axis=1)
    df["atr"] = tr.rolling(14).mean()
    return df


def _simulate_asset(df: pd.DataFrame, capital: float, risk_pct: float) -> dict:
    df = df.dropna().reset_index(drop=True)

    balance   = capital
    in_trade  = False
    entry     = 0.0
    sl = tp   = 0.0
    direction = "BUY"
    trades    = []

    for i in range(2, len(df)):
        row   = df.iloc[i]
        prev  = df.iloc[i - 1]
        close = float(row["close"])
        atr   = float(row["atr"]) if float(row["atr"]) > 0 else close * 0.01

        if in_trade:
            hit_tp = (direction == "BUY" and close >= tp) or (direction == "SELL" and close <= tp)
            hit_sl = (direction == "BUY" and close <= sl) or (direction == "SELL" and close >= sl)
            if hit_tp or hit_sl:
                if hit_tp:
                    pnl_pct = abs(tp - entry) / entry
                else:
                    pnl_pct = -abs(sl - entry) / entry
                if direction == "SELL":
                    pnl_pct = -pnl_pct
                size     = balance * risk_pct / 100
                pnl      = size * pnl_pct
                balance += pnl
                trades.append({
                    "win":       hit_tp,
                    "pnl":       round(pnl, 4),
                    "direction": direction,
                    "entry":     round(entry, 6),
                    "exit":      round(close, 6),
                })
                in_trade = False

        else:
            ema20    = float(row["ema20"])
            ema50    = float(row["ema50"])
            prev_e20 = float(prev["ema20"])
            prev_e50 = float(prev["ema50"])
            rsi      = float(row["rsi"])

            bullish = prev_e20 <= prev_e50 and ema20 > ema50 and rsi < 65
            bearish = prev_e20 >= prev_e50 and ema20 < ema50 and rsi > 35

            if bullish:
                direction = "BUY"
                entry     = close
                sl        = round(close - atr * 1.5, 6)
                tp        = round(close + atr * 2.5, 6)
                in_trade  = True
            elif bearish:
                direction = "SELL"
                entry     = close
                sl        = round(close + atr * 1.5, 6)
                tp        = round(close - atr * 2.5, 6)
                in_trade  = True

    wins      = sum(1 for t in trades if t["win"])
    total_pnl = sum(t["pnl"] for t in trades)
    win_rate  = round(wins / len(trades) * 100, 1) if trades else 0.0

    return {
        "initial_capital": round(capital, 2),
        "final_balance":   round(balance, 2),
        "profit":          round(total_pnl, 2),
        "return_pct":      round(total_pnl / capital * 100, 2) if capital > 0 else 0,
        "trades":          len(trades),
        "win_trades":      wins,
        "loss_trades":     len(trades) - wins,
        "win_rate":        win_rate,
        "trade_log":       trades[:20],
    }


def _summary(profit_pct: float, win_rate: float, trades: int) -> str:
    if trades == 0:
        return "No trades triggered — market was in a tight range."
    if profit_pct > 15:
        return f"Excellent: +{profit_pct}% return, {win_rate}% win rate across {trades} trades."
    if profit_pct > 5:
        return f"Good: +{profit_pct}% return with {win_rate}% win rate."
    if profit_pct > 0:
        return f"Slight profit: +{profit_pct}% across {trades} trades."
    if profit_pct > -10:
        return f"Small loss: {profit_pct}% — market conditions were choppy."
    return f"High drawdown ({profit_pct}%) — unfavorable period for this strategy."


class SmartSimulator:
    def __init__(self):
        self._dp = DataProcessor()

    async def _simulate_one(self, asset: str, capital: float, risk_pct: float, duration_days: int) -> dict:
        try:
            limit = min(duration_days * 6 + 60, 500)
            df    = await self._dp.fetch_market_data(asset, "4h", limit)
            if df is None or len(df) < 30:
                return {"asset": asset, "error": "insufficient_data",
                        "initial_capital": round(capital, 2), "final_balance": round(capital, 2),
                        "profit": 0, "return_pct": 0, "trades": 0, "win_trades": 0,
                        "loss_trades": 0, "win_rate": 0, "trade_log": []}
            df = _compute_indicators(df)
            # Trim to duration
            candles_wanted = duration_days * 6
            if len(df) > candles_wanted:
                df = df.tail(candles_wanted)
            result = _simulate_asset(df, capital, risk_pct)
            return {"asset": asset, **result}
        except Exception as e:
            logger.warning(f"[Simulator] {asset} failed: {e}")
            return {"asset": asset, "error": str(e),
                    "initial_capital": round(capital, 2), "final_balance": round(capital, 2),
                    "profit": 0, "return_pct": 0, "trades": 0, "win_trades": 0,
                    "loss_trades": 0, "win_rate": 0, "trade_log": []}

    async def run(self, capital: float, assets: List[str],
                  duration_days: int, risk_pct: float) -> dict:
        capital       = max(10.0, capital)
        duration_days = max(1, min(90, duration_days))
        risk_pct      = max(1.0, min(20.0, risk_pct))
        assets        = [a.upper() for a in assets[:10]]

        per_capital = capital / max(len(assets), 1)
        tasks       = [
            self._simulate_one(a, per_capital, risk_pct, duration_days)
            for a in assets
        ]
        per_asset = await asyncio.gather(*tasks)

        total_profit  = sum(r.get("profit", 0) for r in per_asset)
        total_trades  = sum(r.get("trades", 0) for r in per_asset)
        total_wins    = sum(r.get("win_trades", 0) for r in per_asset)
        final_balance = capital + total_profit
        profit_pct    = round(total_profit / capital * 100, 2) if capital > 0 else 0
        win_rate      = round(total_wins / total_trades * 100, 1) if total_trades > 0 else 0

        return {
            "success":       True,
            "capital":       capital,
            "final_balance": round(final_balance, 2),
            "profit":        round(total_profit, 2),
            "profit_pct":    profit_pct,
            "total_trades":  total_trades,
            "win_rate":      win_rate,
            "duration_days": duration_days,
            "risk_pct":      risk_pct,
            "per_asset":     list(per_asset),
            "summary":       _summary(profit_pct, win_rate, total_trades),
        }
