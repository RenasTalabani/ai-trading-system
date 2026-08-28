"""
T-066 (2026-08-29): the Guide home-screen pipeline (globalScanJob ->
GlobalAnalyzer.scan_all() -> UnifiedAnalyzer.analyze(), for crypto; the
sibling GlobalAnalyzer._score_multi_asset() for gold/oil/forex) had no
equivalent of the WAIT/AVOID `decision` label T-065 added to
SignalEngine.generate_signal() (the module /predict calls) -- the two AI
pipelines disagreed on how they express a non-actionable or risky call,
even though both fundamentally support the same underlying concept.

Traced exactly what data was actually available before deciding what to
add (see the two functions' own comments for the full reasoning):

- SocialAnalyzer.refresh()'s manipulation_detected/pump_detected fields
  are real data ALREADY fetched by UnifiedAnalyzer.analyze() (it calls
  self._social.refresh() unconditionally) but were previously discarded
  -- only market_score was read. Surfacing it costs zero new I/O calls
  and zero new external data sources, so it was safe to wire through.
- Multi-timeframe-fights and funding-rate-conflict data are NOT
  available in this pipeline without new async calls per asset per scan
  cycle (13 assets, every 30 minutes) -- a real architectural addition,
  not just wiring existing data through. Deliberately NOT added; both
  UnifiedAnalyzer.analyze() and _score_multi_asset() pass mtf_fights and
  funding_against as hardcoded False into _decision_label(), same
  function T-065 already uses (reused, not reimplemented, so both AI
  pipelines share one WAIT/AVOID definition) -- documented as a
  follow-up requiring new I/O, not guessed at.
- _score_multi_asset() (gold/oil/forex) has no social/manipulation
  source of ANY kind (confirmed: no SocialAnalyzer call anywhere in that
  method) -- so for that asset class, `decision` can only ever equal
  `action` (or WAIT for a HOLD), never AVOID. That's an honest reflection
  of what this pipeline actually knows for those assets, not a gap.

None of this changes `action`/`confidence`/trading eligibility/
notification triggers anywhere -- decision is purely additive, exactly
like T-065's SignalEngine change.
"""
from app.services.unified_analyzer import UnifiedAnalyzer
from app.services.global_analyzer import GlobalAnalyzer


class FakeStrategyEngine:
    def __init__(self, recs=None):
        self._recs = recs if recs is not None else []

    async def analyze_multi(self, assets, timeframe):
        return self._recs


class FakeOrderBlockEngine:
    def __init__(self, result=None):
        self._result = result if result is not None else {"success": False}

    async def analyze(self, asset, timeframe):
        return self._result


class FakeSocialAnalyzer:
    """Distinct from news -- carries a manipulation_detected flag per asset,
    matching SocialAnalyzer.refresh()'s real shape."""
    def __init__(self, by_asset=None):
        self._by_asset = by_asset if by_asset is not None else {}

    async def refresh(self):
        return {"by_asset": self._by_asset}


class FakeNewsAnalyzer:
    def __init__(self, data=None):
        self._data = data if data is not None else {"by_asset": {}}

    async def refresh(self):
        return self._data


def _ob_result(current_price=100.0, action="BUY", confidence=90):
    return {
        "success": True,
        "current_price": current_price,
        "ema50": current_price, "ema200": current_price,
        "rsi": 60.0, "trend": "up",
        "order_blocks": [],
        "signal": {
            "action": action, "confidence": confidence,
            "entry_zone": None, "stop_loss": None,
            "take_profit": None, "risk_reward": None,
            "reason": "synthetic OB",
        },
    }


class TestUnifiedAnalyzerSurfacesManipulationAndDecision:
    async def test_no_manipulation_buy_stays_buy(self):
        analyzer = UnifiedAnalyzer(
            FakeStrategyEngine([{"recommendation": "BUY", "confidence": 90, "expected_move_percent": 2.0, "reasoning": "x"}]),
            FakeOrderBlockEngine(_ob_result(action="BUY", confidence=90)),
            FakeNewsAnalyzer(),
            FakeSocialAnalyzer({"BTC": {"market_score": 55, "manipulation_detected": False}}),
        )
        result = await analyzer.analyze("BTCUSDT", "1h")
        assert result["signal"]["action"] == "BUY"
        assert result["signal"]["decision"] == "BUY"
        assert result["sentiment"]["manipulation_detected"] is False

    async def test_manipulation_detected_downgrades_buy_to_avoid_without_touching_action(self):
        analyzer = UnifiedAnalyzer(
            FakeStrategyEngine([{"recommendation": "BUY", "confidence": 90, "expected_move_percent": 2.0, "reasoning": "x"}]),
            FakeOrderBlockEngine(_ob_result(action="BUY", confidence=90)),
            FakeNewsAnalyzer(),
            FakeSocialAnalyzer({"BTC": {"market_score": 55, "manipulation_detected": True}}),
        )
        result = await analyzer.analyze("BTCUSDT", "1h")
        assert result["signal"]["action"] == "BUY"       # unchanged -- trading eligibility untouched
        assert result["signal"]["decision"] == "AVOID"   # display-only label reacts
        assert result["sentiment"]["manipulation_detected"] is True

    async def test_pump_detected_alone_also_triggers_avoid(self):
        analyzer = UnifiedAnalyzer(
            FakeStrategyEngine([{"recommendation": "SELL", "confidence": 90, "expected_move_percent": 2.0, "reasoning": "x"}]),
            FakeOrderBlockEngine(_ob_result(action="SELL", confidence=90)),
            FakeNewsAnalyzer(),
            FakeSocialAnalyzer({"BTC": {"market_score": 45, "pump_detected": True}}),
        )
        result = await analyzer.analyze("BTCUSDT", "1h")
        assert result["signal"]["decision"] == "AVOID"

    async def test_hold_with_no_manipulation_is_wait(self):
        analyzer = UnifiedAnalyzer(
            FakeStrategyEngine([]), FakeOrderBlockEngine(),
            FakeNewsAnalyzer(), FakeSocialAnalyzer(),
        )
        result = await analyzer.analyze("BTCUSDT", "1h")
        assert result["signal"]["action"] == "HOLD"
        assert result["signal"]["decision"] == "WAIT"

    async def test_hold_with_manipulation_is_avoid_not_wait(self):
        analyzer = UnifiedAnalyzer(
            FakeStrategyEngine([]), FakeOrderBlockEngine(),
            FakeNewsAnalyzer(),
            FakeSocialAnalyzer({"BTC": {"market_score": 50, "manipulation_detected": True}}),
        )
        result = await analyzer.analyze("BTCUSDT", "1h")
        assert result["signal"]["action"] == "HOLD"
        assert result["signal"]["decision"] == "AVOID"


class TestGlobalAnalyzerCryptoPassesThroughUnifiedAnalyzersDecision:
    async def test_score_crypto_decision_matches_unified_analyzer_signal_decision(self):
        class FakeUnified:
            async def analyze(self, asset, timeframe, capital):
                return {
                    "success": True,
                    "signal": {"action": "BUY", "confidence": 80, "decision": "AVOID",
                               "entry_zone": None, "stop_loss": None, "take_profit": None,
                               "risk_reward": None, "reason": "x"},
                    "technical": {"current_price": 100.0, "ema50": 100.0, "ema200": 100.0, "atr": 1.0, "rsi": 50, "trend": "up"},
                    "sentiment": {"news_score": 50, "social_score": 50},
                }

        analyzer = GlobalAnalyzer(FakeUnified(), None, None)
        result = await analyzer._score_crypto("BTCUSDT", "1h", 500.0, "neutral")
        assert result["action"] == "BUY"          # unchanged
        assert result["decision"] == "AVOID"      # passed through from UnifiedAnalyzer, not recomputed

    async def test_score_crypto_falls_back_to_action_if_unified_analyzer_omits_decision(self):
        # Backward-compat: if UnifiedAnalyzer's response is ever missing the
        # key (e.g. a rolling deploy mismatch), don't crash or silently
        # produce None -- fall back to the real action.
        class FakeUnified:
            async def analyze(self, asset, timeframe, capital):
                return {
                    "success": True,
                    "signal": {"action": "SELL", "confidence": 75,
                               "entry_zone": None, "stop_loss": None, "take_profit": None,
                               "risk_reward": None, "reason": "x"},
                    "technical": {"current_price": 100.0, "ema50": 100.0, "ema200": 100.0, "atr": 1.0, "rsi": 50, "trend": "down"},
                    "sentiment": {"news_score": 50, "social_score": 50},
                }

        analyzer = GlobalAnalyzer(FakeUnified(), None, None)
        result = await analyzer._score_crypto("BTCUSDT", "1h", 500.0, "neutral")
        assert result["decision"] == "SELL"


class TestGlobalAnalyzerMultiAssetHasNoManipulationSourceSoNeverAvoids(object):
    async def test_multi_asset_hold_is_wait_never_avoid(self, monkeypatch):
        async def _fake_fetch_asset_data(symbol):
            return None  # forces the no-data fallback (HOLD-shaped defaults)

        monkeypatch.setattr(
            "app.services.global_analyzer.fetch_asset_data",
            _fake_fetch_asset_data,
        )
        analyzer = GlobalAnalyzer(None, None, None)
        result = await analyzer._score_multi_asset("XAUUSD", 500.0, "neutral")
        assert result["decision"] in ("WAIT",)  # never AVOID -- no social source exists for this class
