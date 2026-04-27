import logging
import os
from typing import List, Optional

from vaderSentiment.vaderSentiment import SentimentIntensityAnalyzer

from app.config import get_settings

settings = get_settings()
logger = logging.getLogger("ai-service.news_sentiment")

# ─── Event & keyword patterns ─────────────────────────────────────────────────

EVENT_PATTERNS = {
    "interest_rate":  ["fed", "federal reserve", "fomc", "interest rate", "rate hike", "rate cut", "inflation", "cpi", "monetary policy"],
    "regulation":     ["sec", "regulation", "ban", "illegal", "lawsuit", "court", "compliance", "sanction", "cbdc", "kyc"],
    "hack_exploit":   ["hack", "exploit", "breach", "stolen", "vulnerability", "attack", "rug pull", "exit scam"],
    "etf":            ["etf", "exchange traded fund", "blackrock", "grayscale", "spot bitcoin", "spot ethereum"],
    "partnership":    ["partnership", "collaboration", "integration", "deal", "agreement", "merger", "acquisition"],
    "earnings":       ["earnings", "revenue", "profit", "quarterly", "q1", "q2", "q3", "q4", "annual report"],
    "whale_movement": ["whale", "large transfer", "exchange inflow", "exchange outflow", "cold wallet", "on-chain"],
    "market_crash":   ["crash", "collapse", "plunge", "bloodbath", "bear market", "capitulation", "liquidation"],
    "rally":          ["rally", "surge", "all-time high", "ath", "bullrun", "breakout", "bull market", "moon"],
    "macro":          ["gdp", "unemployment", "jobs report", "treasury", "recession", "dollar index", "yield"],
    "halving":        ["halving", "halvening", "block reward", "mining reward"],
    "launch":         ["launch", "mainnet", "upgrade", "update", "v2", "protocol", "release"],
}

ASSET_KEYWORDS = {
    "BTCUSDT":  ["bitcoin", "btc", "satoshi"],
    "ETHUSDT":  ["ethereum", "eth", "ether", "defi", "smart contract", "layer 2", "l2"],
    "BNBUSDT":  ["binance", "bnb", "bsc", "binance smart chain"],
    "SOLUSDT":  ["solana", "sol"],
    "XRPUSDT":  ["ripple", "xrp"],
    "ADAUSDT":  ["cardano", "ada"],
    "DOGEUSDT": ["dogecoin", "doge", "meme coin", "meme token"],
    "AVAXUSDT": ["avalanche", "avax"],
    "LINKUSDT": ["chainlink", "link", "oracle"],
    "MATICUSDT":["polygon", "matic"],
}

STOP_WORDS = {"the","a","an","in","on","at","to","for","of","and","or","is","are","was","with","by","as","it","its","be","this","that","from","not","but","have","has","had","will","would","could","should"}


class NewsSentimentModel:
    """
    Phase 3 news sentiment — VADER fast analysis with FinBERT upgrade path.
    Includes event detection, asset mapping, impact scoring.
    """

    def __init__(self):
        self.vader = SentimentIntensityAnalyzer()
        self.is_loaded = True
        self._finbert = None
        self._try_load_finbert()
        logger.info(f"News sentiment model ready (FinBERT={'loaded' if self._finbert else 'not available, using VADER'})")

    def _try_load_finbert(self):
        """Try loading FinBERT. Falls back to VADER if unavailable."""
        try:
            from transformers import pipeline
            model_name = settings.sentiment_model  # ProsusAI/finbert
            logger.info(f"Loading FinBERT model: {model_name} ...")
            self._finbert = pipeline(
                "text-classification",
                model=model_name,
                top_k=None,
                device=-1,  # CPU; use 0 for GPU
            )
            logger.info("FinBERT loaded successfully.")
        except Exception as e:
            logger.warning(f"FinBERT not loaded ({e}). VADER will be used.")
            self._finbert = None

    def _vader_sentiment(self, text: str) -> dict:
        scores = self.vader.polarity_scores(text)
        compound = scores["compound"]
        if compound >= 0.05:
            label = "positive"
        elif compound <= -0.05:
            label = "negative"
        else:
            label = "neutral"
        return {
            "label": label,
            "score": round(compound, 4),
            "confidence": round(abs(compound) * 100, 1),
            "model": "vader",
        }

    def _finbert_sentiment(self, text: str) -> dict:
        try:
            result = self._finbert(text[:512], truncation=True)[0]
            label_map = {"positive": "positive", "negative": "negative", "neutral": "neutral"}
            best = max(result, key=lambda x: x["score"])
            label = label_map.get(best["label"].lower(), "neutral")
            # Map FinBERT score to -1..+1 compound
            compound = best["score"] if label == "positive" else (-best["score"] if label == "negative" else 0.0)
            return {
                "label": label,
                "score": round(compound, 4),
                "confidence": round(best["score"] * 100, 1),
                "model": "finbert",
            }
        except Exception as e:
            logger.debug(f"FinBERT inference failed: {e}")
            return self._vader_sentiment(text)

    def analyze_single(self, text: str) -> dict:
        sentiment = (
            self._finbert_sentiment(text)
            if self._finbert
            else self._vader_sentiment(text)
        )
        events   = self._detect_events(text)
        assets   = self._detect_assets(text)
        impact   = self._compute_impact(sentiment, events)
        keywords = self._extract_keywords(text)

        return {
            "text": text[:150],
            "sentiment": sentiment["label"],
            "compound": sentiment["score"],
            "confidence": sentiment["confidence"],
            "model": sentiment["model"],
            "impact_score": impact["score"],
            "impact_level": impact["level"],
            "events": events,
            "related_assets": assets,
            "keywords": keywords,
        }

    def analyze(self, headlines: List[str]) -> dict:
        if not headlines:
            return {
                "overall_sentiment": "neutral",
                "score": 0,
                "market_score": 50,
                "impact": 0,
                "count": 0,
                "results": [],
            }

        results = [self.analyze_single(h) for h in headlines]
        compounds = [r["compound"] for r in results]
        avg_compound = sum(compounds) / len(compounds)
        avg_impact = sum(r["impact_score"] for r in results) / len(results)

        if avg_compound >= 0.05:
            overall = "positive"
        elif avg_compound <= -0.05:
            overall = "negative"
        else:
            overall = "neutral"

        market_score = round((avg_compound + 1) / 2 * 100, 1)

        pos = sum(1 for r in results if r["sentiment"] == "positive")
        neg = sum(1 for r in results if r["sentiment"] == "negative")

        all_events = list({e for r in results for e in r["events"]})

        return {
            "overall_sentiment": overall,
            "score": round(avg_compound, 4),
            "market_score": market_score,
            "impact": round(avg_impact, 1),
            "count": len(results),
            "breakdown": {"positive": pos, "negative": neg, "neutral": len(results) - pos - neg},
            "detected_events": all_events,
            "results": results,
        }

    def analyze_for_asset(self, headlines: List[str], asset: str) -> dict:
        """Filter and analyze only headlines relevant to a specific asset."""
        keywords = ASSET_KEYWORDS.get(asset, [])
        if keywords:
            relevant = [h for h in headlines if any(k in h.lower() for k in keywords)]
        else:
            relevant = headlines
        result = self.analyze(relevant if relevant else headlines[:5])
        result["asset"] = asset
        result["relevant_count"] = len(relevant)
        return result

    def get_market_direction(self, headlines: List[str]) -> str:
        result = self.analyze(headlines)
        s = result["score"]
        return "bullish" if s >= 0.1 else "bearish" if s <= -0.1 else "neutral"

    # ─── Helpers ──────────────────────────────────────────────────────────────

    def _detect_events(self, text: str) -> List[str]:
        lower = text.lower()
        return [e for e, kws in EVENT_PATTERNS.items() if any(k in lower for k in kws)]

    def _detect_assets(self, text: str) -> List[str]:
        lower = text.lower()
        return [a for a, kws in ASSET_KEYWORDS.items() if any(k in lower for k in kws)]

    def _compute_impact(self, sentiment: dict, events: List[str]) -> dict:
        score = sentiment["confidence"] * 0.5

        HIGH_IMPACT = {"hack_exploit", "etf", "regulation", "market_crash", "rally", "halving"}
        if any(e in HIGH_IMPACT for e in events):
            score += 40
        elif events:
            score += 20

        score = min(round(score), 100)
        level = "critical" if score >= 75 else "high" if score >= 50 else "medium" if score >= 25 else "low"
        return {"score": score, "level": level}

    def _extract_keywords(self, text: str) -> List[str]:
        return [
            w for w in text.lower().replace("-", " ").split()
            if len(w) > 3 and w.isalpha() and w not in STOP_WORDS
        ][:8]
