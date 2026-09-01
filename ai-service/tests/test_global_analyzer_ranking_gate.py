"""
Regression test for RENO Phase 1 (2026-09-01).

Bug: GlobalAnalyzer.scan_all() hard-excluded (via `continue`) any
candidate below MIN_CONFIDENCE (70) or MIN_FUSED_SCORE (65) *before* it
ever reached the `scored` list that `best`/`top_opportunities` are built
from. Confirmed live and documented in guideController.js's own comments
to reject nearly every candidate in practice (0 qualifying picks across
10+ consecutive scan cycles observed in normal operation) -- meaning
Global Scan, the "AI Brain" pick, and Guide's global-scan branch usually
had nothing to show at all, rather than an honestly-ranked list.

Fix: every non-junk, non-macro-blocked candidate is now included and
ranked, each carrying an honest `meets_bar` boolean (the original
confidence>=70 AND fused_score>=65 combination) instead of being hidden
entirely. Macro direction blocks (don't surface a BUY into a
strong-bear regime) remain a real, hard exclusion -- unrelated safety
logic, untouched by this fix.

These tests drive the real scan_all() end to end (not a reimplementation)
against a small, fully-controlled fake universe, so they fail if the
real function regresses back to hard-excluding low-scoring candidates.
"""
import pytest

from app.services import global_analyzer as ga_module
from app.services.global_analyzer import GlobalAnalyzer


def _opp(asset, action, confidence, fused_score, quality_score):
    return {
        "asset": asset, "display_name": asset, "asset_class": "crypto",
        "action": action, "confidence": confidence, "decision": action,
        "fused_score": fused_score, "rl_score": fused_score,
        "quality_score": quality_score, "quality_inputs": {},
        "quality_passed": quality_score >= 75,
        "current_price": 100.0, "rsi": 50, "trend": "flat", "regime": "TRENDING",
        "news_score": 50, "vol_ratio": 1.0,
        "stop_loss": 95.0, "take_profit": 110.0, "atr": 1.0,
    }


class _FixedResults:
    """Feeds canned per-asset results back to scan_all() in the exact
    order it dispatches _score_crypto/_score_multi_asset calls, regardless
    of which of the two methods asks."""

    def __init__(self, results):
        self._results = list(results)

    async def __call__(self, *args, **kwargs):
        return self._results.pop(0)


def _wire_fake_universe(monkeypatch, analyzer, results):
    feeder = _FixedResults(results)
    monkeypatch.setattr(analyzer, "_score_crypto", feeder)
    # Route every "multi asset" call through the same feeder so the total
    # number of scan_all() tasks equals exactly len(results).
    monkeypatch.setattr(analyzer, "_score_multi_asset", _FixedResults([]))
    monkeypatch.setattr(ga_module, "TRACKED_ASSETS", [r["asset"] for r in results])
    monkeypatch.setattr(ga_module, "_CRYPTO_SCAN_LIMIT", len(results))
    monkeypatch.setattr(ga_module, "ALL_MULTI_ASSETS", {})
    monkeypatch.setattr(analyzer, "_get_macro_sentiment", _AsyncConst("neutral"))


class _AsyncConst:
    def __init__(self, value):
        self._value = value

    async def __call__(self):
        return self._value


class TestScanAllRanksInsteadOfHidingBelowBarCandidates:
    async def test_best_is_populated_even_when_nothing_meets_the_old_hard_gate(self, monkeypatch):
        analyzer = GlobalAnalyzer(None, None, None)
        results = [
            _opp("BTCUSDT", "BUY",  62, 58, 55),
            _opp("ETHUSDT", "SELL", 55, 50, 48),
        ]
        _wire_fake_universe(monkeypatch, analyzer, results)

        out = await analyzer.scan_all(capital=500.0, top_n=5, timeframe="1h")

        assert out["best"] is not None, (
            "best must not be None just because nothing clears the "
            "confidence/fused_score bar -- that was the reported bug"
        )
        assert out["best"]["asset"] == "BTCUSDT"  # higher quality_score wins the rank
        assert out["best"]["meets_bar"] is False
        assert out["passed_filter"] == 0  # honest: 0 *meet the bar*
        assert out["below_bar"] == 2
        assert len(out["top_opportunities"]) == 2

    async def test_higher_quality_ranks_first_and_meets_bar_flag_is_correct_per_item(self, monkeypatch):
        analyzer = GlobalAnalyzer(None, None, None)
        results = [
            _opp("SOLUSDT", "BUY", 80, 78, 82),   # clears the bar
            _opp("ADAUSDT", "BUY", 40, 30, 20),   # well below it
        ]
        _wire_fake_universe(monkeypatch, analyzer, results)

        out = await analyzer.scan_all(capital=500.0, top_n=5, timeframe="1h")

        assert out["best"]["asset"] == "SOLUSDT"
        assert out["best"]["meets_bar"] is True
        assert out["top_opportunities"][1]["asset"] == "ADAUSDT"
        assert out["top_opportunities"][1]["meets_bar"] is False
        assert out["passed_filter"] == 1
        assert out["below_bar"] == 1

    async def test_macro_direction_block_still_fully_excludes_regardless_of_score(self, monkeypatch):
        analyzer = GlobalAnalyzer(None, None, None)
        results = [_opp("XRPUSDT", "BUY", 90, 90, 90)]
        _wire_fake_universe(monkeypatch, analyzer, results)
        monkeypatch.setattr(analyzer, "_get_macro_sentiment", _AsyncConst("strong_bear"))

        out = await analyzer.scan_all(capital=500.0, top_n=5, timeframe="1h")

        assert out["best"] is None
        assert out["blocked"] == 1
        assert out["top_opportunities"] == []
