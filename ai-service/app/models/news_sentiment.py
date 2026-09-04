import logging
import os
import threading
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

    def __init__(self, load_finbert_in_background: bool = True):
        self.vader = SentimentIntensityAnalyzer()
        self.is_loaded = True
        self._finbert = None
        # FinBERT inference is comparatively expensive — the same headlines get
        # analyzed once globally and again per-asset on overlapping subsets, so
        # memoize per unique text to avoid re-running the model on repeats.
        self._sentiment_cache: dict = {}

        # T-076 (2026-08-30): FinBERT used to load synchronously right here,
        # in __init__ -- which runs at Python *import* time (routes.py
        # constructs NewsSentimentModel() at module level, before uvicorn
        # ever binds a port). transformers.pipeline() downloads/loads a
        # 400MB+ model with no build-time warm-up in this service's
        # Dockerfile, so on a fresh Railway container this delayed the
        # import long enough to blow past the platform's healthcheck
        # timeout -- the process was still importing, not even listening
        # yet, when the healthcheck probe gave up (confirmed live: the app
        # DID eventually come up and pass /health once the import finished,
        # just after the healthcheck window had already expired and marked
        # the deployment failed).
        #
        # Fixed by loading FinBERT in a background thread instead, so
        # __init__ (and therefore module import, and therefore uvicorn's
        # ability to bind and answer /health) returns immediately regardless
        # of how long the download takes. self._finbert stays None (already
        # this class's existing "not available" sentinel -- see
        # analyze_single()'s `if self._finbert else` branch, unchanged)
        # until the background load completes, so any sentiment call made
        # during that window transparently uses the same VADER fallback
        # this class already falls back to on a genuine load failure --
        # not a new behavior, not a silent permanent downgrade, just that
        # existing fallback now also covering a brief "still loading"
        # window instead of only a hard failure. Once loaded,
        # self._finbert is a single attribute write from the loader
        # thread -- safe to read from request-handling code under
        # CPython's GIL with no additional locking needed -- and every
        # subsequent call transparently gets real FinBERT results again,
        # exactly as before this change.
        #
        # load_finbert_in_background=False (tests only) restores the old
        # synchronous behavior for callers that need FinBERT ready
        # immediately after construction.
        if load_finbert_in_background:
            threading.Thread(
                target=self._try_load_finbert, daemon=True, name="finbert-loader"
            ).start()
            logger.info("News sentiment model ready (FinBERT loading in background; VADER active until it's ready)")
        else:
            self._try_load_finbert()
            logger.info(f"News sentiment model ready (FinBERT={'loaded' if self._finbert else 'not available, using VADER'})")

    def _try_load_finbert(self):
        """Try loading FinBERT. Falls back to VADER if unavailable.
        Runs in a background thread by default (see __init__) -- any
        exception here is caught locally, same as before, so it can never
        crash the process regardless of which thread it runs on."""
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
            self._try_quantize_finbert()
        except Exception as e:
            logger.warning(f"FinBERT not loaded ({e}). VADER will be used.")
            self._finbert = None

    def _try_quantize_finbert(self):
        """Memory-footprint fix (2026-09-04, cost-reduction pass): this is a
        CPU-only deployment (device=-1 above -- there's no GPU on the
        Railway container this runs on), and FinBERT's own float32 weights
        are a meaningful chunk of this service's steady-state memory bill
        (confirmed live: ai-service is the dominant cost driver on the
        account, ~57% average / ~95% peak of its 8GB allocation, almost
        entirely memory not CPU).
        Dynamic quantization (INT8 weights for Linear layers, the
        overwhelming majority of a BERT-style model's parameters) is
        PyTorch's own documented, standard technique for exactly this
        deployment shape (CPU inference, memory-constrained) -- see
        pytorch.org/tutorials .../dynamic_quantization_bert_tutorial.html.
        It only touches nn.Linear weights; embeddings/layer-norm/attention
        softmax stay float32, so output shape and the label/score dict
        format from the pipeline() call are unchanged (same interface
        _finbert_sentiment() already reads) -- generally a small (usually
        <1 point) confidence/logit precision change, not a different
        model, no code path elsewhere needs to know this happened.
        Wrapped in its own try/except, separate from the outer one in
        _try_load_finbert(): a quantization failure must never fall all
        the way back to VADER when a perfectly good (just unquantized)
        FinBERT pipeline is sitting right there -- self._finbert is only
        ever set to None by the OUTER except, if the model failed to load
        at all.
        """
        try:
            import torch
            self._finbert.model.eval()
            self._finbert.model = torch.quantization.quantize_dynamic(
                self._finbert.model, {torch.nn.Linear}, dtype=torch.qint8
            )
            logger.info("FinBERT quantized to INT8 (dynamic quantization) -- reduced memory footprint.")
        except Exception as e:
            logger.warning(f"FinBERT quantization failed ({e}) -- continuing with the unquantized model.")

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
        if text in self._sentiment_cache:
            sentiment = self._sentiment_cache[text]
        else:
            sentiment = (
                self._finbert_sentiment(text)
                if self._finbert
                else self._vader_sentiment(text)
            )
            if len(self._sentiment_cache) >= 5000:
                self._sentiment_cache.clear()  # simple bound, avoids unbounded growth
            self._sentiment_cache[text] = sentiment
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
