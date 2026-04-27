"""
Historical Signal Backtester
Replays market data through the full signal pipeline and measures performance.
Metrics: win rate, profit factor, max drawdown, Sharpe ratio, total return.
"""
import logging
import asyncio
from dataclasses import dataclass, field
from typing import List, Optional
from datetime import datetime, timezone

import numpy as np
import pandas as pd

from app.services.data_processor import DataProcessor

logger = logging.getLogger("ai-service.backtester")

INITIAL_CAPITAL   = 10_000.0     # USD
POSITION_SIZE_PCT = 0.10         # 10% of capital per trade
COMMISSION_PCT    = 0.001        # 0.1% (Binance taker fee)
SLIPPAGE_PCT      = 0.0005       # 0.05%
MAX_TRADES_OPEN   = 3


@dataclass
class Trade:
    asset:       str
    direction:   str            # BUY or SELL
    entry_price: float
    entry_time:  datetime
    stop_loss:   float
    take_profit: float
    size_usd:    float
    confidence:  float
    exit_price:  float = 0.0
    exit_time:   Optional[datetime] = None
    pnl_pct:     float = 0.0
    pnl_usd:     float = 0.0
    outcome:     str = "open"   # win / loss / breakeven


@dataclass
class BacktestResult:
    asset:            str
    interval:         str
    period_start:     datetime
    period_end:       datetime
    total_trades:     int      = 0
    wins:             int      = 0
    losses:           int      = 0
    win_rate:         float    = 0.0
    total_return_pct: float    = 0.0
    profit_factor:    float    = 0.0
    max_drawdown_pct: float    = 0.0
    sharpe_ratio:     float    = 0.0
    avg_win_pct:      float    = 0.0
    avg_loss_pct:     float    = 0.0
    total_pnl_usd:    float    = 0.0
    trades:           List[Trade] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "asset":            self.asset,
            "interval":         self.interval,
            "period_start":     self.period_start.isoformat(),
            "period_end":       self.period_end.isoformat(),
            "total_trades":     self.total_trades,
            "wins":             self.wins,
            "losses":           self.losses,
            "win_rate":         round(self.win_rate, 3),
            "total_return_pct": round(self.total_return_pct, 2),
            "profit_factor":    round(self.profit_factor, 3),
            "max_drawdown_pct": round(self.max_drawdown_pct, 2),
            "sharpe_ratio":     round(self.sharpe_ratio, 3),
            "avg_win_pct":      round(self.avg_win_pct, 3),
            "avg_loss_pct":     round(self.avg_loss_pct, 3),
            "total_pnl_usd":    round(self.total_pnl_usd, 2),
        }


class Backtester:
    def __init__(self, market_model, lstm_model=None):
        self.market_model = market_model
        self.lstm_model   = lstm_model
        self.processor    = DataProcessor()

    def _generate_signal(self, df: pd.DataFrame) -> dict:
        """Run market model on current window."""
        rf_result = self.market_model.predict(df)
        if self.lstm_model and self.lstm_model.is_trained:
            lstm_result = self.lstm_model.predict(df)
            # Average RF and LSTM
            dir_votes = {"BUY": 0, "SELL": 0, "HOLD": 0}
            dir_votes[rf_result["direction"]]   += rf_result["confidence"]
            dir_votes[lstm_result["direction"]] += lstm_result["confidence"]
            best_dir  = max(dir_votes, key=dir_votes.get)
            avg_conf  = dir_votes[best_dir] / 2
            return {"direction": best_dir, "confidence": avg_conf, "model": "RF+LSTM"}
        return rf_result

    def _simulate_trade(
        self, direction: str, entry: float, atr: float, future_prices: np.ndarray
    ) -> tuple:
        """
        Simulate trade execution on future_prices.
        Returns (exit_price, exit_idx, outcome).
        """
        sl = entry - 1.5 * atr if direction == "BUY" else entry + 1.5 * atr
        tp = entry + 2.5 * atr if direction == "BUY" else entry - 2.5 * atr

        adj_entry = entry * (1 + SLIPPAGE_PCT if direction == "BUY" else 1 - SLIPPAGE_PCT)

        for i, price in enumerate(future_prices):
            if direction == "BUY":
                if price <= sl: return sl, i, "loss"
                if price >= tp: return tp, i, "win"
            else:
                if price >= sl: return sl, i, "loss"
                if price <= tp: return tp, i, "win"

        # Timeout — close at last price
        final = future_prices[-1]
        if direction == "BUY":
            outcome = "win" if final > adj_entry else "loss"
        else:
            outcome = "win" if final < adj_entry else "loss"
        return final, len(future_prices) - 1, outcome

    async def run(
        self,
        asset:          str,
        interval:       str  = "1h",
        min_confidence: float = 65.0,
        max_candles:    int   = 1000,
        lookahead:      int   = 24,   # bars to simulate trade
    ) -> BacktestResult:
        logger.info(f"Backtesting {asset}/{interval} — {max_candles} candles, "
                    f"min_confidence={min_confidence}%")

        df = await self.processor.fetch_market_data(asset, interval, limit=max_candles)
        if df is None or len(df) < 100:
            logger.error(f"Insufficient data for backtest: {asset}")
            return BacktestResult(asset=asset, interval=interval,
                                  period_start=datetime.now(timezone.utc),
                                  period_end=datetime.now(timezone.utc))

        close    = df["close"].values
        atr_vals = df["atr"].values
        result   = BacktestResult(
            asset=asset, interval=interval,
            period_start=pd.Timestamp(df["timestamp"].iloc[0]).to_pydatetime(),
            period_end=pd.Timestamp(df["timestamp"].iloc[-1]).to_pydatetime(),
        )

        capital      = INITIAL_CAPITAL
        equity_curve = [capital]
        gross_wins   = 0.0
        gross_losses = 0.0
        win_pcts     = []
        loss_pcts    = []
        window_size  = 60   # min candles needed for RF + LSTM

        for i in range(window_size, len(df) - lookahead):
            window = df.iloc[i - window_size: i]
            sig    = self._generate_signal(window)

            if sig["direction"] == "HOLD":
                continue
            if sig["confidence"] < min_confidence:
                continue

            entry_price = float(close[i])
            atr         = float(atr_vals[i])
            future      = close[i + 1: i + 1 + lookahead]

            if len(future) == 0:
                continue

            exit_price, exit_idx, outcome = self._simulate_trade(
                sig["direction"], entry_price, atr, future
            )

            # P&L calculation
            size_usd   = capital * POSITION_SIZE_PCT
            commission = size_usd * COMMISSION_PCT * 2  # entry + exit

            if sig["direction"] == "BUY":
                pnl_pct = (exit_price - entry_price) / entry_price
            else:
                pnl_pct = (entry_price - exit_price) / entry_price

            pnl_usd = size_usd * pnl_pct - commission
            capital += pnl_usd
            equity_curve.append(capital)

            trade = Trade(
                asset=asset, direction=sig["direction"],
                entry_price=entry_price,
                entry_time=pd.Timestamp(df["timestamp"].iloc[i]).to_pydatetime(),
                stop_loss=entry_price - 1.5 * atr if sig["direction"] == "BUY" else entry_price + 1.5 * atr,
                take_profit=entry_price + 2.5 * atr if sig["direction"] == "BUY" else entry_price - 2.5 * atr,
                size_usd=size_usd,
                confidence=sig["confidence"],
                exit_price=exit_price,
                pnl_pct=round(pnl_pct * 100, 3),
                pnl_usd=round(pnl_usd, 2),
                outcome=outcome,
            )
            result.trades.append(trade)

            if outcome == "win":
                result.wins += 1
                gross_wins  += abs(pnl_usd)
                win_pcts.append(pnl_pct * 100)
            else:
                result.losses += 1
                gross_losses  += abs(pnl_usd)
                loss_pcts.append(pnl_pct * 100)

        result.total_trades     = len(result.trades)
        result.win_rate         = result.wins / result.total_trades if result.total_trades else 0
        result.total_return_pct = (capital - INITIAL_CAPITAL) / INITIAL_CAPITAL * 100
        result.total_pnl_usd    = capital - INITIAL_CAPITAL
        result.profit_factor    = gross_wins / gross_losses if gross_losses > 0 else float("inf")
        result.avg_win_pct      = float(np.mean(win_pcts))  if win_pcts  else 0
        result.avg_loss_pct     = float(np.mean(loss_pcts)) if loss_pcts else 0

        # Max drawdown
        eq = np.array(equity_curve)
        peak = np.maximum.accumulate(eq)
        dd   = (eq - peak) / peak
        result.max_drawdown_pct = float(np.min(dd) * 100)

        # Sharpe ratio (annualized, assuming 1h bars → 8760 bars/year)
        pnl_series = np.diff(equity_curve) / equity_curve[:-1]
        if len(pnl_series) > 1 and pnl_series.std() > 0:
            bars_per_year     = 8760 if interval == "1h" else (365 * 24 * 4 if interval == "15m" else 365)
            result.sharpe_ratio = float(
                pnl_series.mean() / pnl_series.std() * np.sqrt(bars_per_year)
            )

        logger.info(
            f"Backtest {asset}: {result.total_trades} trades | "
            f"WR={result.win_rate:.1%} | PF={result.profit_factor:.2f} | "
            f"Return={result.total_return_pct:.1f}% | DD={result.max_drawdown_pct:.1f}%"
        )
        return result
