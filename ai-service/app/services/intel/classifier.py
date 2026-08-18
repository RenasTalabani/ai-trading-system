"""
Rule-based content classifier for the intelligence layer.

Important honesty note: this is keyword/regex heuristics, not an LLM. There
is no language-understanding model wired into this backend (no Anthropic/
OpenAI API key configured anywhere in this project), so "separate fact from
prediction" here means "matches known linguistic patterns for each," not
genuine comprehension. It's deliberately conservative: content that doesn't
clearly match a pattern defaults to "opinion" (the least actionable
category) rather than being over-confidently labeled a fact or signal.
"""
import re
from typing import List

from app.models.social_sentiment import ASSET_KEYWORDS

# ── Pattern banks ───────────────────────────────────────────────────────────

PREDICTION_MARKERS = [
    "will reach", "could reach", "could hit", "expect", "expected to",
    "forecast", "projected", "target for", "next cycle", "aiming for",
    "likely to", "should reach", "by next week", "by next month",
    "in the coming", "going to", "will rise", "will fall", "will drop",
    "potential to", "on track for",
]

FACT_MARKERS = [
    "announced", "reported", "confirmed", "released", "published",
    "closed at", "opened at", "moved to", "was launched", "acquired",
    "shut down", "closure of", "filed", "approved", "rejected",
]

OPINION_MARKERS = [
    "i think", "i believe", "in my opinion", "imo", "personally",
    "looks strong", "looks weak", "feels like", "seems like",
    "my take", "not financial advice",
]

SIGNAL_MARKERS = [
    "buy", "sell", "long", "short", "enter", "exit", "accumulate",
    "take profit", "stop loss", "entry at", "avoid", "reduce exposure",
]

WARNING_MARKERS = [
    "warning", "caution", "risky", "volatile", "be careful", "scam",
    "rug pull", "exit scam", "suspicious",
]

BUY_WORDS  = {"buy", "long", "accumulate", "enter"}
SELL_WORDS = {"sell", "short", "exit", "avoid", "reduce exposure"}

# $65,000 / $65k / 65000 / 65k -- price-like numbers
PRICE_PATTERN = re.compile(r"\$?\s?(\d[\d,]{1,9}(?:\.\d+)?)\s?(k|K|m|M)?")

TARGET_CONTEXT   = re.compile(r"target|aiming for|next cycle", re.IGNORECASE)
SUPPORT_CONTEXT  = re.compile(r"support|floor|bounce off", re.IGNORECASE)
RESISTANCE_CONTEXT = re.compile(r"resistance|ceiling|breakout|breakdown", re.IGNORECASE)


def _normalize_number(raw: str, suffix: str) -> float:
    val = float(raw.replace(",", ""))
    if suffix and suffix.lower() == "k":
        val *= 1_000
    elif suffix and suffix.lower() == "m":
        val *= 1_000_000
    return val


def extract_price_targets(text: str) -> List[dict]:
    """Finds price-like numbers and tags them by nearby context. Best-effort:
    a number with no nearby keyword is tagged 'level' rather than discarded,
    since even an untagged price mention is useful context."""
    targets = []
    for m in PRICE_PATTERN.finditer(text):
        raw, suffix = m.group(1), m.group(2)
        # Skip tiny bare numbers with no currency/suffix -- too likely to be
        # noise (percentages, dates, list numbers) rather than a price.
        if not suffix and "$" not in text[max(0, m.start() - 1):m.start() + 1] and float(raw.replace(",", "")) < 100:
            continue
        value = _normalize_number(raw, suffix)
        window = text[max(0, m.start() - 25):m.start() + 25]
        if TARGET_CONTEXT.search(window):
            kind = "target"
        elif SUPPORT_CONTEXT.search(window):
            kind = "support"
        elif RESISTANCE_CONTEXT.search(window):
            kind = "resistance"
        else:
            kind = "level"
        targets.append({"kind": kind, "value": value})
    return targets


def detect_assets(text: str) -> List[str]:
    lower = text.lower()
    return [a for a, kws in ASSET_KEYWORDS.items() if any(k in lower for k in kws)]


def detect_direction(text: str) -> str | None:
    lower = text.lower()
    buy_hit  = any(w in lower for w in BUY_WORDS)
    sell_hit = any(w in lower for w in SELL_WORDS)
    if buy_hit and not sell_hit:
        return "BUY"
    if sell_hit and not buy_hit:
        return "SELL"
    return None


def classify_text(text: str) -> dict:
    """
    Returns the multi-dimensional classification for one piece of content.
    A single post can be several things at once (state a fact, then predict,
    then suggest a trade) -- this returns flags for each, plus a single
    `kind` for the most actionable dimension present, in priority order
    signal > prediction > fact > opinion (a concrete trade suggestion is
    more actionable than a general prediction, which is more actionable
    than a bare fact, which is more actionable than an opinion).
    """
    lower = text.lower()

    is_prediction = any(m in lower for m in PREDICTION_MARKERS)
    is_fact       = any(m in lower for m in FACT_MARKERS)
    is_opinion    = any(m in lower for m in OPINION_MARKERS)
    is_warning    = any(m in lower for m in WARNING_MARKERS)

    direction = detect_direction(lower)
    is_signal = direction is not None or any(m in lower for m in SIGNAL_MARKERS)

    price_targets = extract_price_targets(text)
    if price_targets and not (is_fact or is_prediction or is_opinion):
        # A bare price level with no other marker reads as a prediction/target
        # far more often than a neutral fact in this domain.
        is_prediction = True

    # Conservative default: if nothing matched, call it an opinion (the
    # least actionable label) rather than guessing fact or signal.
    if not (is_fact or is_prediction or is_opinion or is_signal):
        is_opinion = True

    if is_signal:
        kind = "signal"
    elif is_prediction:
        kind = "prediction"
    elif is_fact:
        kind = "fact"
    else:
        kind = "opinion"

    category = "market_warning" if is_warning else "crypto_analysis"

    # Confidence in the EXTRACTION (how clearly the text matched a pattern),
    # not confidence that the claim itself is true.
    marker_hits = sum([is_prediction, is_fact, is_opinion, is_signal, bool(price_targets)])
    confidence = min(1.0, 0.3 + 0.2 * marker_hits)

    return {
        "kind": kind,
        "is_fact": is_fact,
        "is_opinion": is_opinion,
        "is_prediction": is_prediction,
        "is_signal": is_signal,
        "is_warning": is_warning,
        "category": category,
        "direction": direction,
        "price_targets": price_targets,
        "related_assets": detect_assets(text),
        "confidence": round(confidence, 2),
    }


def classify_structured_data(payload: dict) -> dict:
    """Structured API data (CoinGecko/FRED numbers) is treated as fact with
    full extraction confidence -- it's official/aggregated data, not text
    requiring interpretation."""
    return {
        "kind": "fact",
        "is_fact": True,
        "is_opinion": False,
        "is_prediction": False,
        "is_signal": False,
        "is_warning": False,
        "category": "macro",
        "direction": None,
        "price_targets": [],
        "related_assets": [],
        "confidence": 1.0,
    }
