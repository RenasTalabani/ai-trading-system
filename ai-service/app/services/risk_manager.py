"""
RiskManager — ATR-based dynamic SL/TP and position sizing.
Replaces the fixed 2% / 4% offsets used in Phase 17.
"""
import logging

logger = logging.getLogger("ai-service.risk_manager")

# Multipliers per market regime
_REGIME_PARAMS = {
    "TRENDING":  {"sl": 1.5, "tp": 3.0},
    "VOLATILE":  {"sl": 2.0, "tp": 4.0},
    "DOWNTREND": {"sl": 1.2, "tp": 2.4},
    "SIDEWAYS":  {"sl": 1.0, "tp": 2.0},
}
_DEFAULT_PARAMS = {"sl": 1.5, "tp": 3.0}

RISK_PCT     = 0.02   # 2 % of account per trade
MAX_POS_CAP  = 0.10   # never exceed 10 % of account


class RiskManager:

    def compute_sl_tp(
        self,
        entry: float,
        atr: float,
        direction: str,
        regime: str = "TRENDING",
    ) -> tuple[float | None, float | None, str]:
        """
        Returns (stop_loss, take_profit, risk_reward_label).
        Always 1:2 dynamic (tp = 2 × sl distance).
        """
        if entry <= 0 or atr <= 0:
            return None, None, "N/A"

        p = _REGIME_PARAMS.get(regime, _DEFAULT_PARAMS)
        sl_dist = atr * p["sl"]
        tp_dist = atr * p["tp"]

        if direction == "BUY":
            sl = round(entry - sl_dist, 8)
            tp = round(entry + tp_dist, 8)
        elif direction == "SELL":
            sl = round(entry + sl_dist, 8)
            tp = round(entry - tp_dist, 8)
        else:
            return None, None, "N/A"

        rr = round(tp_dist / sl_dist, 1) if sl_dist > 0 else 2.0
        return sl, tp, f"1:{rr}"

    def compute_position_size(
        self,
        account_balance: float,
        atr: float,
        entry_price: float,
        risk_pct: float = RISK_PCT,
        max_cap: float = MAX_POS_CAP,
    ) -> float:
        """
        Kelly-lite: size = balance × (risk_pct / atr_normalized).
        Capped at max_cap of account.

        T-038 (2026-08-22) NOTE ON ACTUAL BEHAVIOR: with the current
        defaults (risk_pct=2%, max_cap=10%), the raw formula only produces
        a value BELOW the cap when atr_normalized (ATR as a fraction of
        entry_price) exceeds risk_pct / max_cap = 20%. That is a far more
        extreme ATR/price ratio than any tracked asset class realistically
        sustains (crypto typically runs well under 5%, even during sharp
        moves) -- confirmed by computing the formula across atr_normalized
        = 0.1% .. 19%: every value returns exactly `account_balance *
        max_cap`, identical regardless of how volatile the asset actually
        is. In practice this function is currently a flat `max_cap` of
        account balance, not an ATR-scaled size -- both call sites
        (global_analyzer.py's `_score_crypto`/`_score_multi_asset`, which
        feed the `position_size` field shown for every scan result) use
        the defaults, so every single recommended position size is
        `capital * 0.10` regardless of the asset's real volatility. This
        is left unchanged pending an explicit owner decision on the
        intended risk_pct/max_cap relationship (see PROJECT_STATUS.md
        T-038) -- changing either constant is a real risk-policy choice,
        not a bug fix with one obviously correct answer, so this pass only
        documents and tests the actual behavior rather than picking new
        values unilaterally.
        """
        if entry_price <= 0 or atr <= 0:
            return round(account_balance * risk_pct, 2)

        atr_norm = atr / entry_price          # ATR as % of price
        if atr_norm <= 0:
            return round(account_balance * risk_pct, 2)

        raw_size = account_balance * (risk_pct / atr_norm)
        capped   = min(raw_size, account_balance * max_cap)
        return round(max(capped, 1.0), 2)
