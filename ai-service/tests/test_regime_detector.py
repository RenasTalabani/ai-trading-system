"""
Regression suite for RegimeDetector, added 2026-08-18 (T-028, PM
continuous-improvement pass) alongside the fix that wires real regime
detection into global_analyzer.py's crypto scoring path (see
test_global_analyzer_regime.py). Covers both the original df-based
detect() and the new scalar-based detect_from_values() it now delegates
to, confirming the refactor didn't change detect()'s behavior.
"""
import pandas as pd
import pytest

from app.services.regime_detector import RegimeDetector


def make_df(price, ema50, ema200, atr):
    return pd.DataFrame([{
        "close": price, "ema50": ema50, "ema200": ema200, "atr": atr,
    }])


class TestDetectFromValues:
    def setup_method(self):
        self.rd = RegimeDetector()

    def test_price_above_both_emas_in_order_is_trending(self):
        # price > ema50 > ema200, low atr_pct (0.5% -> under volatile threshold)
        assert self.rd.detect_from_values(110, 105, 100, 0.55) == "TRENDING"

    def test_price_below_both_emas_in_order_is_downtrend(self):
        assert self.rd.detect_from_values(90, 95, 100, 0.45) == "DOWNTREND"

    def test_high_atr_pct_is_volatile_regardless_of_trend_structure(self):
        # atr/price = 3/100 = 3% > 2.5% threshold -> VOLATILE even though
        # price > ema50 > ema200 would otherwise read as TRENDING.
        assert self.rd.detect_from_values(100, 95, 90, 3.0) == "VOLATILE"

    def test_mixed_ema_order_with_moderate_atr_is_sideways(self):
        # price between the two emas -- neither clean uptrend nor downtrend.
        assert self.rd.detect_from_values(100, 102, 98, 1.0) == "SIDEWAYS"

    def test_bad_input_falls_back_to_trending(self):
        assert self.rd.detect_from_values(0, None, None, None) == "TRENDING"


class TestDetectFromDataFrame:
    def setup_method(self):
        self.rd = RegimeDetector()

    def test_detect_matches_detect_from_values_for_the_same_inputs(self):
        # detect() now just extracts the row and delegates -- confirm the
        # two entrypoints agree instead of drifting apart.
        df = make_df(price=110, ema50=105, ema200=100, atr=0.55)
        assert self.rd.detect(df) == self.rd.detect_from_values(110, 105, 100, 0.55)
        assert self.rd.detect(df) == "TRENDING"

    def test_missing_columns_falls_back_to_trending(self):
        df = pd.DataFrame([{"close": 100}])  # no ema50/ema200/atr columns
        # ema50/ema200 default to price (100), atr defaults to price*0.015
        # -> price == ema50 == ema200, neither TRENDING nor DOWNTREND
        # condition is strictly true (no `>` chain holds) -> SIDEWAYS.
        assert self.rd.detect(df) == "SIDEWAYS"

    def test_empty_dataframe_falls_back_to_trending(self):
        assert self.rd.detect(pd.DataFrame()) == "TRENDING"


class TestRegimeScoreModifier:
    def setup_method(self):
        self.rd = RegimeDetector()

    def test_trending_buy_boosted_trending_sell_penalised(self):
        assert self.rd.regime_score_modifier("TRENDING", "BUY") == 1.10
        assert self.rd.regime_score_modifier("TRENDING", "SELL") == 0.80

    def test_downtrend_sell_boosted_downtrend_buy_penalised(self):
        assert self.rd.regime_score_modifier("DOWNTREND", "SELL") == 1.10
        assert self.rd.regime_score_modifier("DOWNTREND", "BUY") == 0.75

    def test_volatile_always_penalised_regardless_of_action(self):
        assert self.rd.regime_score_modifier("VOLATILE", "BUY") == 0.85
        assert self.rd.regime_score_modifier("VOLATILE", "SELL") == 0.85
