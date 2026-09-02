"""
Tests for ob_intelligence_pipeline.py (Phase 12, Order Block Intelligence
Engine build-out, 2026-09-01). Plain-Python-runnable.

Fixtures build real, verified-shape OB dicts (matching exactly what
order_block_engine.py's analyze() produces: type/zone/strength/
freshness/impulse_index/structure_context/liquidity_context -- confirmed
by direct source inspection, not assumed) and compose them with the
REAL Phase 1/2/4/5 engines (all dependency-light, importable directly --
no live DataProcessor chain needed to test this module's own logic).
"""
import pandas as pd

from app.services.market_structure_engine import analyze_structure
from app.services.liquidity_engine import analyze_liquidity
from app.services.fvg_engine import analyze_fvgs, FairValueGap
from app.services.premium_discount_engine import analyze_premium_discount
from app.services.ob_intelligence_pipeline import (
    compute_fvg_confluence,
    map_premium_discount_fit,
    enrich_order_block,
    enrich_order_blocks,
)


def _ob(ob_type="bullish", zone_low=98.0, zone_high=100.0, strength=79,
        freshness="fresh", impulse_index=51, aligned_with_bias=None,
        swept_pool=None):
    return {
        "type": ob_type,
        "zone": {"low": zone_low, "high": zone_high},
        "strength": strength,
        "freshness": freshness,
        "timeframe": "1h",
        "timestamp": "t51",
        "ob_index": impulse_index - 1,
        "impulse_index": impulse_index,
        "structure_context": {"bias": "BULLISH" if aligned_with_bias else "UNKNOWN",
                               "aligned_with_bias": aligned_with_bias, "most_recent_break": None},
        "liquidity_context": {"swept_pool_before_formation": swept_pool},
    }


def _candles(rows):
    df = pd.DataFrame(rows, columns=["open", "high", "low", "close", "volume"])
    df["timestamp"] = [f"t{i}" for i in range(len(df))]
    return df


def _flat_rows(n, price=100.0, vol=10.0):
    return [(price, price + 0.5, price - 0.5, price, vol)] * n


class TestFvgConfluence:
    def test_no_fvgs_is_false(self):
        ob = _ob()
        assert compute_fvg_confluence(ob, []) is False

    def test_matching_direction_overlapping_fvg_before_impulse_is_true(self):
        ob = _ob(ob_type="bullish", zone_low=98.0, zone_high=100.0, impulse_index=51)
        gap = FairValueGap(index=40, kind="bullish", top=99.0, bottom=97.0)
        assert compute_fvg_confluence(ob, [gap]) is True

    def test_wrong_direction_fvg_is_false(self):
        ob = _ob(ob_type="bullish", zone_low=98.0, zone_high=100.0, impulse_index=51)
        gap = FairValueGap(index=40, kind="bearish", top=99.0, bottom=97.0)
        assert compute_fvg_confluence(ob, [gap]) is False

    def test_non_overlapping_fvg_is_false(self):
        ob = _ob(ob_type="bullish", zone_low=98.0, zone_high=100.0, impulse_index=51)
        gap = FairValueGap(index=40, kind="bullish", top=50.0, bottom=40.0)
        assert compute_fvg_confluence(ob, [gap]) is False

    def test_future_fvg_after_impulse_is_ignored(self):
        ob = _ob(ob_type="bullish", zone_low=98.0, zone_high=100.0, impulse_index=51)
        gap = FairValueGap(index=60, kind="bullish", top=99.0, bottom=97.0)  # after impulse
        assert compute_fvg_confluence(ob, [gap]) is False


class TestPremiumDiscountFit:
    def test_bullish_in_discount_is_favorable(self):
        assert map_premium_discount_fit("bullish", {"status": "OK", "zone": "DISCOUNT"}) == "FAVORABLE"

    def test_bullish_in_premium_is_unfavorable(self):
        assert map_premium_discount_fit("bullish", {"status": "OK", "zone": "PREMIUM"}) == "UNFAVORABLE"

    def test_bearish_in_premium_is_favorable(self):
        assert map_premium_discount_fit("bearish", {"status": "OK", "zone": "PREMIUM"}) == "FAVORABLE"

    def test_bearish_in_discount_is_unfavorable(self):
        assert map_premium_discount_fit("bearish", {"status": "OK", "zone": "DISCOUNT"}) == "UNFAVORABLE"

    def test_equilibrium_either_direction(self):
        assert map_premium_discount_fit("bullish", {"status": "OK", "zone": "EQUILIBRIUM"}) == "EQUILIBRIUM"
        assert map_premium_discount_fit("bearish", {"status": "OK", "zone": "EQUILIBRIUM"}) == "EQUILIBRIUM"

    def test_unavailable_is_none(self):
        assert map_premium_discount_fit("bullish", None) is None
        assert map_premium_discount_fit("bullish", {"status": "INSUFFICIENT_DATA"}) is None


class TestEnrichOrderBlock:
    def _base_df(self):
        rows = _flat_rows(50, price=100.0, vol=10.0)
        rows.append((100, 100.2, 98.0, 98.5, 10.0))
        rows.append((98.5, 115.0, 98.4, 114.5, 100.0))
        rows += _flat_rows(20, price=114.5, vol=10.0)
        return _candles(rows)

    def test_full_real_evidence_produces_a_real_grade_and_setup_or_wait(self):
        df = self._base_df()
        ob = _ob(ob_type="bullish", zone_low=98.0, zone_high=100.0, strength=79,
                 freshness="fresh", impulse_index=51, aligned_with_bias=True,
                 swept_pool={"kind": "sell_side"})
        gap = FairValueGap(index=45, kind="bullish", top=99.5, bottom=97.5)
        pd_result = {"status": "OK", "zone": "DISCOUNT"}
        result = enrich_order_block(ob, df, [gap], pd_result, pools=[],
                                     timeframe="1h", structure_bias="BULLISH", htf_biases={})
        assert result["quality"]["status"] == "OK"
        assert result["quality"]["score"] > 0
        assert result["state"]["status"] in (
            "FRESH", "APPROACHING", "EXPIRED", "TESTED", "MITIGATED", "REACTED", "INVALIDATED",
        )
        assert result["setup"]["verdict"] in ("SETUP", "WAIT")

    def test_missing_evidence_degrades_gracefully_not_an_error(self):
        df = self._base_df()
        ob = _ob(ob_type="bullish", zone_low=98.0, zone_high=100.0, strength=79,
                 freshness="fresh", impulse_index=51, aligned_with_bias=None, swept_pool=None)
        result = enrich_order_block(ob, df, [], None, pools=None)
        assert result["quality"]["status"] == "OK"
        assert result["quality"]["evidence_completeness_pct"] < 100.0

    def test_htf_confluence_wired_through_when_supplied(self):
        df = self._base_df()
        ob = _ob(ob_type="bullish", zone_low=98.0, zone_high=100.0, strength=79,
                 freshness="fresh", impulse_index=51)
        result = enrich_order_block(
            ob, df, [], None, pools=None,
            timeframe="1h", structure_bias="BULLISH", htf_biases={"4h": "BULLISH"},
        )
        assert result["quality"]["breakdown"]["htf_alignment"] == 10  # ALIGNED bonus

    def test_htf_conflicting_penalizes_quality(self):
        df = self._base_df()
        ob = _ob(ob_type="bullish", zone_low=98.0, zone_high=100.0, strength=79,
                 freshness="fresh", impulse_index=51)
        result = enrich_order_block(
            ob, df, [], None, pools=None,
            timeframe="1h", structure_bias="BULLISH", htf_biases={"4h": "BEARISH"},
        )
        assert result["quality"]["breakdown"]["htf_alignment"] == -15

    def test_malformed_ob_does_not_raise_returns_error_placeholder(self):
        df = self._base_df()
        bad_ob = {"type": "bullish"}  # missing zone/strength/impulse_index etc.
        result = enrich_order_block(bad_ob, df, [], None, pools=None)
        assert result["quality"]["status"] == "ERROR"
        assert result["setup"]["verdict"] == "WAIT"

    def test_never_creates_a_trade_or_touches_portfolio(self):
        # Structural guarantee, not a runtime one: the module has no
        # IMPORT of any trade/portfolio/execution service. Checking
        # actual import lines (not the whole file's prose) since this
        # module's own docstring legitimately discusses -- in English --
        # that it does NOT touch the portfolio, which a bare substring
        # search over the whole file would misfire on.
        import app.services.ob_intelligence_pipeline as mod
        with open(mod.__file__) as f:
            import_lines = [line for line in f if line.strip().startswith(("import ", "from "))]
        forbidden_modules = ("virtualTrackingService", "VirtualTrade", "budgetController", "trade_executor")
        for line in import_lines:
            for forbidden in forbidden_modules:
                assert forbidden not in line, f"forbidden import found: {line.strip()}"


class TestEnrichOrderBlocksBatch:
    def _base_df(self):
        rows = _flat_rows(50, price=100.0, vol=10.0)
        rows.append((100, 100.2, 98.0, 98.5, 10.0))
        rows.append((98.5, 115.0, 98.4, 114.5, 100.0))
        rows += _flat_rows(20, price=114.5, vol=10.0)
        return _candles(rows)

    def test_one_bad_ob_does_not_abort_the_batch(self):
        df = self._base_df()
        good_ob = _ob(impulse_index=51)
        bad_ob = {"type": "bullish"}
        results = enrich_order_blocks([good_ob, bad_ob], df, [], None, pools=None)
        assert len(results) == 2
        assert results[0]["quality"]["status"] == "OK"
        assert results[1]["quality"]["status"] == "ERROR"

    def test_real_composition_with_actual_engines(self):
        # Genuine end-to-end: real structure, real liquidity, real FVGs,
        # real premium/discount, all computed for real on one shared df,
        # then composed through the pipeline.
        rows = []
        price = 100.0
        for i in range(80):
            price += 0.3
            rows.append((price - 0.2, price + 0.3, price - 0.4, price, 10.0))
        rows.append((price, price + 0.2, price - 3.0, price - 2.5, 10.0))     # OB candle
        rows.append((price - 2.5, price + 20.0, price - 2.6, price + 19.0, 100.0))  # impulse
        rows += _flat_rows(10, price=price + 19.0, vol=10.0)
        df = _candles(rows)

        structure_result = analyze_structure(df)
        pools = analyze_liquidity(df, structure_result.swings) if structure_result.status == "OK" else []
        fvgs = analyze_fvgs(df)
        pd_result = analyze_premium_discount(structure_result.swings, float(df["close"].iloc[-1])) \
            if structure_result.status == "OK" else None

        ob = _ob(ob_type="bullish", zone_low=round(price - 3.0, 6), zone_high=round(price, 6),
                  strength=85, freshness="fresh", impulse_index=81)
        result = enrich_order_block(
            ob, df, fvgs, pd_result, pools,
            timeframe="1h", structure_bias=structure_result.bias if structure_result.status == "OK" else None,
        )
        assert result["quality"]["status"] == "OK"
        assert result["state"]["status"] is not None
        assert result["setup"]["verdict"] in ("SETUP", "WAIT")


if __name__ == "__main__":
    import inspect
    import sys

    classes = [obj for name, obj in list(globals().items())
               if inspect.isclass(obj) and name.startswith("Test")]
    total = 0
    failed = 0
    for cls in classes:
        instance = cls()
        for name, method in inspect.getmembers(instance, predicate=inspect.ismethod):
            if not name.startswith("test_"):
                continue
            total += 1
            try:
                method()
                print(f"PASS  {cls.__name__}.{name}")
            except AssertionError as e:
                failed += 1
                print(f"FAIL  {cls.__name__}.{name}: {e}")
            except Exception as e:
                failed += 1
                print(f"ERROR {cls.__name__}.{name}: {type(e).__name__}: {e}")

    print(f"\n{total - failed}/{total} passed, {failed} failed")
    sys.exit(1 if failed else 0)
