"""
Regression test: GlobalAnalyzer._score_multi_asset() hardcoded 500 as the
account balance passed into RiskManager.compute_position_size(), ignoring
the real `capital` argument that scan_all() receives and correctly threads
through to _score_crypto() (the crypto sibling scorer, same file). Found
during a post-T-035 audit pass over global_analyzer.py.

Net effect before this fix: every non-crypto asset's (oil/forex; gold
has since moved to the crypto path as PAXGUSDT, decision #18)
"position_size" field in a /global/scan response was silently wrong
whenever the caller's real capital wasn't exactly $500 -- e.g.
aiWorkerService.js calls /global/scan with the real portfolio balance
(portfolio.currentBalance), so a $2,000 portfolio would still get a
oil/forex position_size sized as if the account only held $500.

No live trading impact: confirmed (same as T-028's note on this field)
that the backend never reads `position_size` for real order sizing -- it
computes its own `sizeUsd` independently -- and mobile never displays it
either. This is still a real, demonstrable correctness bug in a field the
API contract advertises, and a trivial one-line fix, so worth closing now
rather than leaving it for whenever the field's consumer situation
changes.
"""
from app.services.global_analyzer import GlobalAnalyzer


class TestScoreMultiAssetUsesRealCapital:
    async def test_position_size_scales_with_the_real_capital_argument(self, monkeypatch):
        # Force the no-data fallback path (current_price stays 0.0), which
        # makes compute_position_size() take its entry_price<=0 early-return
        # branch: round(account_balance * RISK_PCT, 2) -- a direct,
        # unambiguous probe of which `capital` value actually reached
        # RiskManager, independent of any market-data mocking.
        async def _fake_fetch_asset_data(symbol):
            return None

        monkeypatch.setattr(
            "app.services.global_analyzer.fetch_asset_data",
            _fake_fetch_asset_data,
        )

        analyzer = GlobalAnalyzer(None, None, None)

        result_500 = await analyzer._score_multi_asset("EURUSD", 500.0, "neutral")
        result_2000 = await analyzer._score_multi_asset("EURUSD", 2000.0, "neutral")

        assert result_500["position_size"] == 10.0    # 500 * 0.02
        assert result_2000["position_size"] == 40.0   # 2000 * 0.02 -- regression: used to also be 10.0

    async def test_scan_all_passes_its_real_capital_argument_through_to_multi_asset_scoring(self, monkeypatch):
        class FakeMacroService:
            async def get_macro_snapshot(self):
                return {"macro_bias": "neutral"}

        async def _fake_fetch_asset_data(symbol):
            return None

        monkeypatch.setattr(
            "app.services.global_analyzer.fetch_asset_data",
            _fake_fetch_asset_data,
        )

        seen_capitals = []
        analyzer = GlobalAnalyzer(None, None, None, macro_service=FakeMacroService())

        original = analyzer._score_multi_asset

        async def _spy(symbol, capital, macro_sentiment):
            seen_capitals.append(capital)
            return await original(symbol, capital, macro_sentiment)

        async def _skip_crypto(*a, **kw):
            return {}  # skip crypto side, not under test here

        analyzer._score_multi_asset = _spy
        analyzer._score_crypto = _skip_crypto

        await analyzer.scan_all(capital=1500.0, top_n=5, timeframe="1h")

        assert seen_capitals, "expected _score_multi_asset to have been called"
        assert all(c == 1500.0 for c in seen_capitals)  # regression: used to always be 500 internally
