"""
GlobalAnalyzer — Phase 18 Institutional Grade.
Scans ALL asset classes with:
  - ATR-based dynamic SL/TP (RiskManager)
  - Market regime detection (RegimeDetector)
  - Confidence filter (min 70 %, macro contradiction block)
  - Trade quality scoring (TradeQualityScorer)
  - RL adaptive weights (RLWeightEngine)
"""
import asyncio
import logging
from typing import Any

from app.services.unified_analyzer import (
    UnifiedAnalyzer, _action_to_score, _score_to_action,
)
from app.services.signal_engine import _decision_label
from app.services.collectors.multi_asset_collector import (
    fetch_asset_data, ALL_MULTI_ASSETS,
)
from app.services.collectors.binance_collector import TRACKED_ASSETS
from app.services.risk_manager          import RiskManager
from app.services.regime_detector       import RegimeDetector
from app.services.rl_weight_engine      import RLWeightEngine
from app.services.trade_quality_scorer  import (
    compute_quality_score, build_quality_inputs, passes_quality_gate,
)
from app.services.macro_data_service    import MacroDataService

logger = logging.getLogger("ai-service.global_analyzer")

# ── Metadata ──────────────────────────────────────────────────────────────────

ASSET_CLASS_MAP: dict[str, str] = {
    **{a: "crypto"    for a in TRACKED_ASSETS},
    "XAUUSD": "commodity", "XAGUSD": "commodity",
    "WTI":    "commodity", "BRENT":  "commodity",
    "EURUSD": "forex",     "GBPUSD": "forex",
    "USDJPY": "forex",
}

ASSET_DISPLAY: dict[str, str] = {
    "BTCUSDT":  "Bitcoin",     "ETHUSDT":  "Ethereum",
    "BNBUSDT":  "BNB",         "SOLUSDT":  "Solana",
    "XRPUSDT":  "XRP",         "ADAUSDT":  "Cardano",
    "DOGEUSDT": "Dogecoin",    "AVAXUSDT": "Avalanche",
    "LINKUSDT": "Chainlink",   "MATICUSDT":"Polygon",
    "XAUUSD":   "Gold",        "XAGUSD":   "Silver",
    "WTI":      "Crude Oil",   "BRENT":    "Brent Oil",
    "EURUSD":   "EUR / USD",   "GBPUSD":   "GBP / USD",
    "USDJPY":   "USD / JPY",
}

_NEWS_KEYWORDS: dict[str, str] = {
    "XAUUSD": "gold",  "XAGUSD": "silver",
    "WTI":    "oil",   "BRENT":  "oil",
    "EURUSD": "euro",  "GBPUSD": "pound",
    "USDJPY": "japan",
}

_CRYPTO_SCAN_LIMIT = 6

# ── Phase 18 thresholds ───────────────────────────────────────────────────────
MIN_CONFIDENCE  = 70
MIN_FUSED_SCORE = 65

# Macro states that block contradicting actions
_STRONG_BEAR_BLOCKS_BUY  = {"strong_bear", "bearish"}
_STRONG_BULL_BLOCKS_SELL = {"strong_bull", "bullish"}

# T-068 (2026-08-29, root-caused after the overnight validation task list's
# BUG-002 fix was independently re-verified and /global/scan was found to
# still return 0/13 passing assets -- not resolved by that fix, as
# suspected). The 5-state vocabulary MacroDataService._macro_bias() (see
# macro_data_service.py) actually produces is strong_bull/mild_bull/
# neutral/mild_bear/strong_bear -- it never returns "bullish"/"bearish" at
# all. The macro_sc calculation below only ever matched "bullish"/
# "strong_bull" (bull) and "bearish"/"strong_bear" (bear), so "mild_bull"
# and "mild_bear" -- 2 of the 5 real states -- always fell through to the
# neutral default (50), regardless of which way the macro backdrop
# actually leaned. Combined with the RL-adaptive macro weight currently
# having drifted to ~72% of the fused-score formula (a separate, already-
# documented, deliberately-not-fixed issue -- see T-041's floor/ceiling
# gap), this made it mathematically impossible for ANY asset to reach
# MIN_FUSED_SCORE (65): with macro_sc pinned at 50 and only ~28% of the
# weight left for technical+news+social, the maximum achievable fused
# score even with every other signal at its ceiling (100) was ~28.3 (the
# non-macro weight sum) + 35.85 (0.5 * the macro weight) = ~64.15 --
# short by the threshold even in the best case. This function widens the
# match to the real 5-state vocabulary the code already receives, using
# the existing two extreme anchor values (70/30) with a graduated
# midpoint for the "mild" states. This does not touch the RL weight drift
# itself (T-041 remains an explicit owner decision, not silently
# resolved here) -- it removes one of two compounding causes, not both.
def _macro_sc_from_bias(macro_sentiment: str) -> float:
    return {
        "strong_bull": 70, "bullish":  70,
        "mild_bull":   60,
        "neutral":     50,
        "mild_bear":   40,
        "strong_bear": 30, "bearish":  30,
    }.get(macro_sentiment, 50)

# Singleton services (shared across calls)
_risk_mgr   = RiskManager()
_regime_det = RegimeDetector()
_rl_engine  = RLWeightEngine()


class GlobalAnalyzer:
    def __init__(self, unified_analyzer: UnifiedAnalyzer,
                 news_analyzer, social_analyzer, macro_service=None):
        self._unified = unified_analyzer
        self._news    = news_analyzer
        self._social  = social_analyzer
        # T-034 (2026-08-20): defaults to its own MacroDataService if the
        # caller doesn't pass one (keeps existing GlobalAnalyzer(a, b, c)
        # call sites, including this module's own tests, working
        # unchanged) -- see _get_macro_sentiment() below for why this is
        # needed at all.
        self._macro   = macro_service or MacroDataService()

    # ── Public ────────────────────────────────────────────────────────────────

    async def scan_all(self, capital: float = 500.0,
                       top_n: int = 5,
                       timeframe: str = "1h") -> dict:
        crypto_assets = TRACKED_ASSETS[:_CRYPTO_SCAN_LIMIT]
        multi_assets  = list(ALL_MULTI_ASSETS.keys())

        # Fetch macro sentiment once (used in filter + quality score)
        macro_sentiment = await self._get_macro_sentiment()

        tasks = (
            [self._score_crypto(a, timeframe, capital, macro_sentiment)
             for a in crypto_assets] +
            [self._score_multi_asset(sym, capital, macro_sentiment)
             for sym in multi_assets]
        )

        raw = await asyncio.gather(*tasks, return_exceptions=True)

        # RENO Phase 1 (2026-09-01): this used to hard-exclude (via
        # `continue`) any candidate below MIN_CONFIDENCE/MIN_FUSED_SCORE
        # before it ever reached `scored` -- confirmed live and documented
        # in guideController.js's own comments to reject nearly every
        # candidate in practice (0 qualifying picks across 10+ consecutive
        # scan cycles observed in normal operation), which is why Global
        # Scan / the "AI Brain" pick / Guide's global-scan branch usually
        # had nothing to show at all rather than an honestly-ranked list.
        #
        # This does NOT relax what's allowed to auto-trade real (paper)
        # capital: aiWorkerService.js's runAIWorkerCycle() re-applies its
        # own independent CONFIDENCE_THRESHOLD/MIN_FUSED_SCORE/
        # MIN_QUALITY_SCORE gate per-opportunity before opening any trade
        # (confirmed by reading that loop directly) -- that gate is
        # untouched by this change. What changes here is purely what gets
        # *ranked and shown* as `best`/`top_opportunities`: every
        # non-junk, non-macro-blocked candidate is now included and
        # sorted, each carrying an honest `meets_bar` flag (the original
        # confidence>=70 AND fused_score>=65 combination) so any caller
        # that wants "only the ones that would qualify for auto-trading"
        # can still filter on that -- instead of the scan silently
        # returning nothing at all whenever the bar isn't cleared.
        scored: list[dict] = []
        below_bar = 0
        macro_blocked = 0
        for r in raw:
            if isinstance(r, Exception):
                logger.warning(f"[Global] scorer error: {r}")
                continue
            if not isinstance(r, dict) or r.get("fused_score", 0) <= 0:
                continue

            action = r.get("action", "HOLD")
            # Macro direction blocks stay a hard exclusion -- these are a
            # safety/direction check (don't surface a BUY into a
            # strong-bear macro regime), not a quality-ranking threshold,
            # and are unrelated to the near-zero-results problem above.
            if macro_sentiment in _STRONG_BEAR_BLOCKS_BUY  and action == "BUY":
                macro_blocked += 1
                logger.info(f"[Filter] {r['asset']} BUY blocked — strong_bear macro")
                continue
            if macro_sentiment in _STRONG_BULL_BLOCKS_SELL and action == "SELL":
                macro_blocked += 1
                logger.info(f"[Filter] {r['asset']} SELL blocked — strong_bull macro")
                continue

            meets_bar = (
                r.get("confidence", 0)  >= MIN_CONFIDENCE
                and r.get("fused_score", 0) >= MIN_FUSED_SCORE
            )
            if not meets_bar:
                below_bar += 1
            r["meets_bar"] = meets_bar

            scored.append(r)

        if macro_blocked:
            logger.info(f"[Global] {macro_blocked} signals macro-blocked")
        if below_bar:
            logger.info(f"[Global] {below_bar} signals below the confidence/score bar (still ranked, not hidden)")

        scored.sort(key=lambda x: x.get("quality_score", x.get("fused_score", 50)),
                    reverse=True)

        best = scored[0] if scored else None
        for i, item in enumerate(scored):
            item["rank"] = i + 1

        weights = _rl_engine.get_weights()
        meets_bar_count = sum(1 for x in scored if x.get("meets_bar"))

        return {
            "success":           True,
            "scanned":           len(scored) + macro_blocked,
            "passed_filter":     meets_bar_count,
            "blocked":           macro_blocked,
            "below_bar":         below_bar,
            "capital":           capital,
            "timeframe":         timeframe,
            "macro_sentiment":   macro_sentiment,
            "signal_weights":    weights,
            "best":              best,
            "top_opportunities": scored[:top_n],
        }

    # ── Crypto scorer ─────────────────────────────────────────────────────────

    async def _score_crypto(self, asset: str, timeframe: str,
                            capital: float,
                            macro_sentiment: str) -> dict[str, Any]:
        try:
            # T-086 (2026-08-31): raised from 30s to match unified_analyzer
            # .py's own raised inner budgets (OB/news/social now 35-40s each,
            # run in parallel via asyncio.gather there) -- 30s was cutting
            # analyze() off before OB/news/social's real ~23-27.5s latency
            # could resolve, forcing every one of them to fall back to a
            # neutral vote. See unified_analyzer.py's T-086 comment for the
            # full evidence.
            result = await asyncio.wait_for(
                self._unified.analyze(asset, timeframe, capital),
                timeout=45,
            )
            if not result.get("success"):
                return {}

            sig  = result["signal"]
            tech = result.get("technical", {})
            sent = result.get("sentiment", {})
            fs   = _action_to_score(sig["action"], sig["confidence"])

            atr       = float(tech.get("atr", 0)) or (
                float(tech.get("current_price", 0)) * 0.015
            )
            entry     = float(tech.get("current_price") or 0)

            # T-028 (2026-08-18): unified_analyzer.analyze()'s response never
            # actually contains a "regime" key (confirmed by inspection --
            # no such field is ever set in its return dict), so
            # `result.get("regime", "TRENDING")` was silently falling back
            # to "TRENDING" on every single call. That meant every crypto
            # trade -- the app's primary, most-actively-scanned asset class
            # -- always got TRENDING's SL/TP width (1.5x/3.0x ATR) and
            # TRENDING's score modifier (permanent +10% on BUY, -20% on
            # SELL) regardless of real market conditions, silently
            # defeating regime-aware risk management for crypto specifically
            # (the non-crypto path in _score_multi_asset below was already
            # calling the real detector correctly). Fixed by deriving a real
            # regime from the ema50/ema200/atr this function already has on
            # hand, via the same classification logic detect() uses.
            ema50 = float(tech.get("ema50") or entry)
            ema200 = float(tech.get("ema200") or entry)
            regime = (
                _regime_det.detect_from_values(entry, ema50, ema200, atr)
                if entry > 0 else "TRENDING"
            )

            # ATR-based SL/TP
            sl, tp, rr = _risk_mgr.compute_sl_tp(entry, atr, sig["action"], regime)

            # Position size
            pos_size = _risk_mgr.compute_position_size(capital, atr, entry)

            # Regime score modifier
            modifier  = _regime_det.regime_score_modifier(regime, sig["action"])
            adj_score = round(fs * modifier, 1)

            # Trade quality
            quality_inputs = build_quality_inputs(
                {**sig, "fused_score": adj_score,
                 "news_score": sent.get("news_score", 50),
                 "vol_ratio":  tech.get("vol_ratio", 1.0)},
                macro_sentiment,
            )
            quality_score = compute_quality_score(**quality_inputs)

            # RL-weighted final score
            weights   = _rl_engine.get_weights()
            news_sc   = sent.get("news_score", 50)
            social_sc = sent.get("social_score", 50)
            macro_sc  = _macro_sc_from_bias(macro_sentiment)
            rl_score  = round(
                fs         * weights["technical"] +
                news_sc    * weights["news"] +
                social_sc  * weights["social"] +
                macro_sc   * weights["macro"],
                1,
            )

            return {
                "asset":          asset,
                "display_name":   ASSET_DISPLAY.get(asset, asset),
                "asset_class":    "crypto",
                "action":         sig["action"],
                "confidence":     sig["confidence"],
                # T-066: passthrough from UnifiedAnalyzer.analyze()'s own
                # signal.decision (computed there, not here -- see that
                # module for the WAIT/AVOID derivation). action/confidence
                # above are completely unchanged by this.
                "decision":       sig.get("decision", sig["action"]),
                "fused_score":    adj_score,
                "rl_score":       rl_score,
                "quality_score":  quality_score,
                "quality_inputs": quality_inputs,
                "quality_passed": passes_quality_gate(quality_score),
                "current_price":  entry or None,
                "rsi":            tech.get("rsi"),
                "trend":          tech.get("trend"),
                "regime":         regime,
                "news_score":     sent.get("news_score", 50),
                "vol_ratio":      tech.get("vol_ratio", 1.0),
                "atr":            round(atr, 6),
                "position_size":  pos_size,
                "entry_zone":     sig.get("entry_zone"),
                "stop_loss":      sl if sl else sig.get("stop_loss"),
                "take_profit":    tp if tp else sig.get("take_profit"),
                "risk_reward":    rr,
                "expected_return": sig.get("expected_return"),
                "reason":         sig.get("reason"),
            }
        except Exception as e:
            logger.warning(f"[Global] crypto score error {asset}: {e}")
            return {}

    # ── Non-crypto scorer ─────────────────────────────────────────────────────

    async def _score_multi_asset(self, symbol: str, capital: float,
                                 macro_sentiment: str) -> dict[str, Any]:
        symbol = symbol.upper()

        async def _safe_df():
            try:
                return await asyncio.wait_for(fetch_asset_data(symbol), timeout=15)
            except Exception:
                return None

        df, news_score = await asyncio.gather(
            _safe_df(),
            self._macro_news_score(_NEWS_KEYWORDS.get(symbol, symbol.lower())),
        )

        current_price = 0.0
        tech_score    = 50.0
        rsi_val       = 50.0
        trend         = "sideways"
        ema50_val     = None
        ema200_val    = None
        atr_val       = 0.0
        vol_ratio     = 1.0
        regime        = "SIDEWAYS"

        if df is not None and len(df) >= 50:
            row           = df.iloc[-1]
            current_price = float(row["close"])
            ema50_val     = float(row.get("ema50",  current_price))
            ema200_val    = float(row.get("ema200", current_price))
            rsi_val       = float(row.get("rsi",    50))
            atr_val       = float(row.get("atr",    current_price * 0.015))
            vol_ratio     = float(row.get("vol_ratio", 1.0))

            regime = _regime_det.detect(df)

            if current_price > ema50_val > ema200_val:
                trend      = "uptrend"
                tech_score = min(92, 60 + (rsi_val - 50) * 0.5)
            elif current_price < ema50_val < ema200_val:
                trend      = "downtrend"
                tech_score = max(8, 40 - (50 - rsi_val) * 0.5)
            else:
                tech_score = 50.0

            if rsi_val > 75:   tech_score = min(tech_score, 38)
            elif rsi_val < 25: tech_score = max(tech_score, 62)

        # RL-weighted fusion
        weights    = _rl_engine.get_weights()
        macro_sc   = _macro_sc_from_bias(macro_sentiment)
        fused = (
            tech_score            * (weights["technical"] + weights["social"]) +
            float(news_score)     * weights["news"] +
            macro_sc              * weights["macro"]
        )
        fused = round(fused, 1)

        action, confidence = _score_to_action(fused)

        # T-066: same WAIT/AVOID convention as _score_crypto/SignalEngine
        # (see unified_analyzer.py's docstring note for why this reuses
        # _decision_label() rather than a second implementation). This
        # scorer has no social/manipulation source at all (no
        # SocialAnalyzer call anywhere in this method) and no
        # MultiTimeframeAnalyzer/funding-rate call either -- so for
        # gold/oil/forex, decision can only ever equal `action` (HOLD ->
        # WAIT) or unchanged BUY/SELL, never AVOID. That's an honest
        # reflection of what this asset class's pipeline actually knows,
        # not a gap to paper over with an invented signal.
        decision = _decision_label(action, manip_detected=False, mtf_fights=False, funding_against=False)

        # Regime modifier
        modifier = _regime_det.regime_score_modifier(regime, action)
        adj_fused = round(fused * modifier, 1)

        # ATR-based SL/TP
        sl, tp, rr = _risk_mgr.compute_sl_tp(current_price, atr_val, action, regime)

        # Position size
        pos_size = _risk_mgr.compute_position_size(capital, atr_val, current_price)

        # Trade quality
        quality_inputs = build_quality_inputs(
            {"fused_score": adj_fused, "action": action,
             "news_score": news_score, "vol_ratio": vol_ratio},
            macro_sentiment,
        )
        quality_score = compute_quality_score(**quality_inputs)

        return {
            "asset":          symbol,
            "display_name":   ASSET_DISPLAY.get(symbol, symbol),
            "asset_class":    ASSET_CLASS_MAP.get(symbol, "other"),
            "action":         action,
            "confidence":     confidence,
            "decision":       decision,
            "fused_score":    adj_fused,
            "rl_score":       fused,
            "quality_score":  quality_score,
            "quality_inputs": quality_inputs,
            "quality_passed": passes_quality_gate(quality_score),
            "current_price":  round(current_price, 6) if current_price else None,
            "rsi":            round(rsi_val, 1),
            "ema50":          round(ema50_val, 6)  if ema50_val  else None,
            "ema200":         round(ema200_val, 6) if ema200_val else None,
            "atr":            round(atr_val, 6),
            "vol_ratio":      round(vol_ratio, 3),
            "trend":          trend,
            "regime":         regime,
            "news_score":     round(float(news_score), 1),
            "position_size":  pos_size,
            "entry_zone":     None,
            "stop_loss":      sl,
            "take_profit":    tp,
            "risk_reward":    rr,
            "expected_return": None,
            "reason": (
                f"{regime} regime | {trend.capitalize()} | "
                f"RSI {rsi_val:.0f} | News {news_score:.0f} | "
                f"Quality {quality_score:.0f}"
            ),
        }

    # ── Helpers ───────────────────────────────────────────────────────────────

    async def _get_macro_sentiment(self) -> str:
        """
        T-034 (2026-08-20): this used to call `self._news.refresh()` (the
        NewsAnalyzer -- headline sentiment) and read a "overall_sentiment"
        key. Two independent bugs stacked here:
          1. NewsAnalyzer.refresh() never actually returns a key called
             "overall_sentiment" inside "global" -- it's named "sentiment"
             (confirmed in news_analyzer.py: `"sentiment": analysis["overall_sentiment"]`
             renames it on the way out). So `.get("overall_sentiment", "neutral")`
             silently fell back to "neutral" on every single call, exactly
             like T-031's `key` vs `portfolioKey` bug.
          2. Even with the key fixed, the *value* vocabulary would still
             never match: NewsAnalyzer's "sentiment" field is one of
             "positive" / "negative" / "neutral" (headline polarity via
             news_sentiment.py's analyze()), never "bullish" / "bearish" /
             "strong_bull" / "strong_bear" -- the vocabulary this class's
             own `_STRONG_BEAR_BLOCKS_BUY` / `_STRONG_BULL_BLOCKS_SELL`
             sets and `macro_sc` checks below require. This was the wrong
             SERVICE, not just the wrong key: `macro_data_service.py`'s
             `_macro_bias()` is what actually produces that exact 5-state
             vocabulary (strong_bull/mild_bull/neutral/mild_bear/strong_bear),
             derived from Fear & Greed + 24h market-cap change + funding
             rates -- real macro backdrop, not news headline tone. It's
             also the vocabulary `trade_quality_scorer.py`'s
             `build_quality_inputs()` docstring documents expecting.
        Net effect before this fix: the Phase 18 "macro contradiction
        block" this module's own docstring advertises never fired (macro
        state was always "neutral"), and every macro_sc computation in
        _score_crypto/_score_multi_asset was always exactly 50 regardless
        of real bullish/bearish conditions -- a whole scoring dimension
        silently flattened on every /global/scan call.
        """
        try:
            result = await asyncio.wait_for(self._macro.get_macro_snapshot(), timeout=10)
            return result.get("macro_bias", "neutral")
        except Exception:
            return "neutral"

    async def _macro_news_score(self, keyword: str) -> float:
        """Per-asset headline sentiment (legitimately NewsAnalyzer's job,
        unlike _get_macro_sentiment above) -- fixed key name (was
        "overall_sentiment", the real field is "sentiment") and fixed
        vocabulary (NewsAnalyzer's sentiment is positive/negative/neutral,
        never bullish/bearish -- see _get_macro_sentiment's docstring)."""
        try:
            result = await asyncio.wait_for(self._news.refresh(), timeout=10)
            sentiment = result.get("global", {}).get("sentiment", "neutral")
            base      = {"positive": 62.0, "negative": 38.0}.get(sentiment, 50.0)
            headlines = [h.lower() for h in result.get("top_headlines", [])]
            hits      = sum(1 for h in headlines if keyword in h)
            return min(80.0, base + hits * 3.0)
        except Exception:
            return 50.0


# ── Module-level RL update helper (called by routes) ─────────────────────────

def rl_record_outcome(result: str, signal_contributions: dict) -> dict:
    return _rl_engine.record_outcome(result, signal_contributions)

def rl_get_weights() -> dict:
    return _rl_engine.get_weights()

def rl_stats() -> dict:
    return _rl_engine.stats()
