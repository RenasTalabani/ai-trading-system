"""
TradeQualityScorer — score a trade before execution.
All inputs are 0–100 scores. Output is 0–100.
Only execute if score >= QUALITY_THRESHOLD.
"""
import logging

logger = logging.getLogger("ai-service.trade_quality_scorer")

QUALITY_THRESHOLD = 75   # minimum score to allow trade execution

# Weights for each component
_W_TECHNICAL  = 0.40
_W_SENTIMENT  = 0.25
_W_MACRO      = 0.25
_W_VOLUME     = 0.10


def compute_quality_score(
    technical_strength: float,     # 0–100
    sentiment_alignment: float,    # 0–100
    macro_alignment: float,        # 0–100
    volume_confirmation: float,    # 0–100
) -> float:
    """Returns a weighted quality score 0–100."""
    score = (
        technical_strength  * _W_TECHNICAL +
        sentiment_alignment * _W_SENTIMENT +
        macro_alignment     * _W_MACRO +
        volume_confirmation * _W_VOLUME
    )
    return round(min(100.0, max(0.0, score)), 1)


def _clamp_0_100(value: float) -> float:
    """Clamp a value into the [0, 100] range this module's inputs promise."""
    return min(100.0, max(0.0, value))


def build_quality_inputs(opp: dict, macro_sentiment: str) -> dict:
    """
    Derive quality inputs from a scored opportunity dict.
    opp keys expected: fused_score, confidence, rsi, trend, news_score, vol_ratio
    macro_sentiment: 'bullish' | 'neutral' | 'bearish' | 'strong_bull' | 'strong_bear'
    """
    action = opp.get("action", "HOLD")

    # 1. Technical strength — from fused_score (already 0–100)
    #
    # T-040 (2026-08-22): this module's own docstring promises "All inputs
    # are 0-100 scores", and compute_quality_score()'s final *output* is
    # clamped to [0, 100] -- but this individual input was not, and the
    # value that actually reaches it here can genuinely exceed 100 in
    # production. Traced the real call chain in
    # GlobalAnalyzer._score_crypto()/._score_multi_asset(): `fused_score`
    # passed in here is `adj_score = round(fs * modifier, 1)`, where
    # `fs = _action_to_score(action, confidence)` and `modifier` comes from
    # `RegimeDetector.regime_score_modifier()`. `_score_to_action()` in
    # unified_analyzer.py caps `confidence` at `min(95, int(score))`, so for
    # a BUY, `fs` (== confidence) tops out at 95 -- but
    # `regime_score_modifier()` returns 1.10 for a TRENDING-regime BUY,
    # so any BUY with confidence in (~91, 95] produces
    # `adj_score` up to 95 * 1.10 = 104.5, well above the documented 0-100
    # bound, on a routine (not exotic) combination of inputs.
    # Because this per-component overflow happens *before*
    # compute_quality_score()'s final clamp, it is not reliably masked: the
    # weighted sum (`technical_strength * 0.40 + ...`) can land under 100
    # even while `technical_strength` itself is over 100 (e.g. technical=
    # 104.5, sentiment=macro=volume=50 -> weighted score 71.8 instead of
    # the correct 70.0) -- a real, silent inflation of quality_score that
    # is large enough to flip trades across the QUALITY_THRESHOLD=75 gate
    # right at the boundary. Fixed by clamping technical_strength (the
    # proven overflow source) and, defensively and for the same documented
    # contract, sentiment_alignment (built from the same kind of
    # externally-sourced, not-independently-bounded `news_score` input) to
    # [0, 100] before they enter the weighted sum. macro_alignment is
    # already inherently bounded by the fixed macro_map table and
    # volume_confirmation was already clamped, so this closes the gap for
    # every component without changing any already-in-bounds value.
    technical = _clamp_0_100(float(opp.get("fused_score", 50)))

    # 2. Sentiment alignment — news_score aligned with action direction
    news_score = float(opp.get("news_score", 50))
    if action == "BUY":
        sentiment = news_score            # high news_score = bullish = good
    elif action == "SELL":
        sentiment = 100 - news_score      # low news_score = bearish = good for SELL
    else:
        sentiment = 50
    sentiment = _clamp_0_100(sentiment)

    # 3. Macro alignment
    macro_map = {
        "strong_bull": 90, "bullish": 70, "mild_bull": 65,
        "neutral": 50,
        "mild_bear": 35, "bearish": 30, "strong_bear": 10,
    }
    macro_base = macro_map.get(macro_sentiment, 50)
    if action == "BUY":
        macro_align = macro_base
    elif action == "SELL":
        macro_align = 100 - macro_base
    else:
        macro_align = 50

    # 4. Volume confirmation
    vol_ratio = float(opp.get("vol_ratio", 1.0))
    vol_score = min(100, max(0, (vol_ratio - 0.5) / 1.5 * 100))

    return {
        "technical_strength":  round(technical,   1),
        "sentiment_alignment": round(sentiment,   1),
        "macro_alignment":     round(macro_align, 1),
        "volume_confirmation": round(vol_score,   1),
    }


def passes_quality_gate(score: float) -> bool:
    return score >= QUALITY_THRESHOLD
