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


def build_quality_inputs(opp: dict, macro_sentiment: str) -> dict:
    """
    Derive quality inputs from a scored opportunity dict.
    opp keys expected: fused_score, confidence, rsi, trend, news_score, vol_ratio
    macro_sentiment: 'bullish' | 'neutral' | 'bearish' | 'strong_bull' | 'strong_bear'
    """
    action = opp.get("action", "HOLD")

    # 1. Technical strength — from fused_score (already 0–100)
    technical = float(opp.get("fused_score", 50))

    # 2. Sentiment alignment — news_score aligned with action direction
    news_score = float(opp.get("news_score", 50))
    if action == "BUY":
        sentiment = news_score            # high news_score = bullish = good
    elif action == "SELL":
        sentiment = 100 - news_score      # low news_score = bearish = good for SELL
    else:
        sentiment = 50

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
