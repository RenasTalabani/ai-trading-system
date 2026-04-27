import logging
import re
from typing import List, Dict, Any

from vaderSentiment.vaderSentiment import SentimentIntensityAnalyzer

from app.config import get_settings

settings = get_settings()
logger = logging.getLogger("ai-service.social_sentiment")

# ─── Keyword banks ─────────────────────────────────────────────────────────────

SPAM_KEYWORDS    = {"free", "giveaway", "100x guaranteed", "get rich", "pump incoming",
                    "earn daily", "passive income", "secret signal", "dm for signal",
                    "click link", "join now", "limited spots", "guaranteed profit"}

HYPE_KEYWORDS    = {"moon", "rocket", "bullrun", "to the moon", "lambo", "100x",
                    "ath", "all time high", "parabolic", "insane gains", "send it",
                    "wagmi", "ngmi", "up only", "infinite money glitch"}

BEAR_KEYWORDS    = {"crash", "dump", "rug", "scam", "dead", "bear", "panic sell",
                    "capitulation", "rekt", "liquidated", "going to zero", "ponzi",
                    "fraud", "rug pull", "exit scam"}

MANIPULATION_SIGNALS = {"coordinated", "pump group", "whale manipulation", "market makers",
                        "manipulation", "artificial", "bot trading", "wash trading",
                        "fake volume", "paid promotion", "shill"}

ASSET_KEYWORDS: Dict[str, List[str]] = {
    "BTCUSDT":  ["bitcoin", "btc", "$btc", "#bitcoin"],
    "ETHUSDT":  ["ethereum", "eth", "$eth", "#ethereum", "ether"],
    "BNBUSDT":  ["binance", "bnb", "$bnb", "bsc"],
    "SOLUSDT":  ["solana", "sol", "$sol", "#solana"],
    "XRPUSDT":  ["ripple", "xrp", "$xrp", "#xrp"],
    "ADAUSDT":  ["cardano", "ada", "$ada"],
    "DOGEUSDT": ["dogecoin", "doge", "$doge", "#doge"],
    "AVAXUSDT": ["avalanche", "avax", "$avax"],
    "LINKUSDT": ["chainlink", "link", "$link"],
    "MATICUSDT":["polygon", "matic", "$matic"],
}

# High-engagement thresholds (platform-relative)
INFLUENCER_THRESHOLDS = {
    "twitter": {"followers": 10000, "likes": 500},
    "reddit":  {"likes": 1000, "replies": 100},
    "telegram":{"likes": 200},
}


class SocialSentimentModel:
    """
    Phase 4 Social Sentiment Analyzer.
    Features:
    - Spam & manipulation detection
    - Hype / fear signal detection
    - Influencer detection & engagement weighting
    - Per-asset sentiment mapping
    - Coordinated pump detection
    """

    def __init__(self):
        self.analyzer = SentimentIntensityAnalyzer()
        self.is_loaded = True
        logger.info("Social sentiment model (Phase 4) loaded.")

    # ─── Text helpers ──────────────────────────────────────────────────────────

    def _clean(self, text: str) -> str:
        text = re.sub(r"http\S+|www\S+", "", text)
        text = re.sub(r"[@#]\w+", "", text)
        text = re.sub(r"\s+", " ", text).strip()
        return text.lower()

    def _flags(self, raw: str, clean: str) -> Dict[str, bool]:
        lower = clean
        return {
            "is_spam":         any(kw in lower for kw in SPAM_KEYWORDS),
            "is_hype":         any(kw in lower for kw in HYPE_KEYWORDS),
            "is_fear":         any(kw in lower for kw in BEAR_KEYWORDS),
            "is_manipulation": any(kw in lower for kw in MANIPULATION_SIGNALS),
        }

    def _detect_assets(self, text: str) -> List[str]:
        lower = text.lower()
        return [a for a, kws in ASSET_KEYWORDS.items() if any(k in lower for k in kws)]

    def _influence_weight(self, post: dict) -> float:
        """
        Compute influence weight 1.0–3.0 based on engagement metrics.
        Posts with high engagement count more toward the aggregate score.
        """
        platform = post.get("platform", "twitter")
        likes    = post.get("likes", 0)
        shares   = post.get("shares", 0)
        replies  = post.get("replies", 0)

        if platform == "twitter":
            if likes >= 5000 or shares >= 1000:  return 3.0
            if likes >= 1000 or shares >= 200:   return 2.0
            if likes >= 200:                      return 1.5
        elif platform == "reddit":
            if likes >= 3000 or replies >= 500:  return 3.0
            if likes >= 1000 or replies >= 100:  return 2.0
            if likes >= 200:                      return 1.5
        elif platform == "telegram":
            if likes >= 500:                      return 2.0
            if likes >= 100:                      return 1.5
        return 1.0

    def _detect_pump_group(self, posts: List[dict]) -> bool:
        """
        Detect coordinated pump patterns:
        - Same asset mentioned in > 70% of posts AND
        - > 60% bullish sentiment AND
        - > 30% contain hype keywords
        """
        if len(posts) < 5:
            return False
        hype_count = sum(1 for p in posts if p.get("is_hype"))
        bull_count = sum(1 for p in posts if p.get("sentiment") == "bullish")
        hype_ratio = hype_count / len(posts)
        bull_ratio = bull_count / len(posts)
        return hype_ratio > 0.30 and bull_ratio > 0.60

    # ─── Core analysis ─────────────────────────────────────────────────────────

    def analyze_single(self, post: dict) -> dict:
        """
        post: dict with keys: content, platform, likes, shares, replies, author_followers
        """
        text  = post.get("content", "")
        clean = self._clean(text)
        flags = self._flags(text, clean)

        if flags["is_spam"]:
            return {
                "sentiment": "spam", "compound": 0.0, "confidence": 0.0,
                "weight": 0.0, "assets": [], **flags,
            }

        scores   = self.analyzer.polarity_scores(clean)
        compound = scores["compound"]

        if flags["is_manipulation"]:
            compound *= 0.3  # severely discount manipulative content

        if compound >= 0.05:
            sentiment = "bullish"
        elif compound <= -0.05:
            sentiment = "bearish"
        else:
            sentiment = "neutral"

        weight   = self._influence_weight(post)
        assets   = self._detect_assets(text)
        conf     = round(abs(compound) * 100, 1)

        return {
            "sentiment":       sentiment,
            "compound":        round(compound, 4),
            "confidence":      conf,
            "weight":          weight,
            "assets":          assets,
            "is_influencer":   weight >= 2.0,
            **flags,
        }

    def analyze(self, posts: List[Any]) -> dict:
        """
        posts: list of dicts or strings.
        Returns aggregated social sentiment with hype/manipulation flags.
        """
        if not posts:
            return self._empty()

        # Normalize: allow plain strings (backward compat)
        normalized = []
        for p in posts:
            if isinstance(p, str):
                normalized.append({"content": p, "platform": "unknown", "likes": 0, "shares": 0, "replies": 0})
            else:
                normalized.append(p)

        results   = [self.analyze_single(p) for p in normalized]
        valid     = [r for r in results if r["sentiment"] != "spam"]
        spam_count = len(results) - len(valid)
        spam_ratio = round(spam_count / len(results), 3) if results else 0

        if not valid:
            return {
                "overall": "spam_dominated",
                "score": 0.0,
                "market_score": 50,
                "hype_level": 1.0,
                "spam_ratio": spam_ratio,
                "manipulation_detected": True,
                "count": len(results),
                "valid_count": 0,
                "warning": "All posts detected as spam or manipulation.",
            }

        # Weighted aggregation
        total_weight = sum(r["weight"] for r in valid)
        w_compound   = sum(r["compound"] * r["weight"] for r in valid) / total_weight

        bullish  = sum(1 for r in valid if r["sentiment"] == "bullish")
        bearish  = sum(1 for r in valid if r["sentiment"] == "bearish")
        hype_c   = sum(1 for r in valid if r.get("is_hype"))
        fear_c   = sum(1 for r in valid if r.get("is_fear"))
        manip_c  = sum(1 for r in valid if r.get("is_manipulation"))
        inf_c    = sum(1 for r in valid if r.get("is_influencer"))

        hype_level = round(hype_c / len(valid), 3)
        manip_flag = manip_c / len(valid) > 0.20

        # Pump group detection
        pump_detected = self._detect_pump_group([{**r, **p} for r, p in zip(results, normalized)])

        if w_compound >= 0.05:
            overall = "bullish"
        elif w_compound <= -0.05:
            overall = "bearish"
        else:
            overall = "neutral"

        # Dampen confidence if manipulation / pump detected
        if pump_detected or manip_flag:
            w_compound *= 0.5
            logger.warning(f"Social: Pump/manipulation detected — compound dampened to {w_compound:.3f}")

        market_score = round((w_compound + 1) / 2 * 100, 1)

        return {
            "overall":              overall,
            "score":                round(w_compound, 4),
            "market_score":         market_score,
            "hype_level":           hype_level,
            "spam_ratio":           spam_ratio,
            "manipulation_detected":manip_flag,
            "pump_detected":        pump_detected,
            "influencer_count":     inf_c,
            "breakdown": {
                "bullish": bullish,
                "bearish": bearish,
                "neutral": len(valid) - bullish - bearish,
                "hype":    hype_c,
                "fear":    fear_c,
            },
            "count":       len(results),
            "valid_count": len(valid),
        }

    def analyze_for_asset(self, posts: List[Any], asset: str) -> dict:
        """Filter posts mentioning a specific asset, then analyze."""
        kws = ASSET_KEYWORDS.get(asset, [])
        if kws:
            relevant = [p for p in posts
                        if any(k in (p if isinstance(p, str) else p.get("content","")).lower() for k in kws)]
        else:
            relevant = posts
        result = self.analyze(relevant if relevant else posts)
        result["asset"] = asset
        result["relevant_posts"] = len(relevant)
        return result

    def _empty(self) -> dict:
        return {
            "overall": "neutral", "score": 0.0, "market_score": 50,
            "hype_level": 0.0, "spam_ratio": 0.0,
            "manipulation_detected": False, "pump_detected": False,
            "influencer_count": 0,
            "breakdown": {"bullish": 0, "bearish": 0, "neutral": 0, "hype": 0, "fear": 0},
            "count": 0, "valid_count": 0,
        }
