"""
Data model for the market-intelligence layer.

Two distinct shapes on purpose:
  RawItem  -- what a connector hands back: one piece of content plus enough
              metadata to classify and store it. Ephemeral, never persisted
              as-is.
  Insight  -- what actually gets stored: a structured, attributed,
              classified conclusion. This is the "knowledge" the AI keeps;
              RawItem is just the raw material it's built from.
"""
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import List, Optional


@dataclass
class RawItem:
    """One unit of content from any connector, before classification."""
    source: str                 # e.g. "KurdishFinancial", "CoinGecko", "FRED"
    source_url: str
    source_type: str            # "telegram" | "api" | "rss"
    language: str                # "en" | "ar" | "ku"
    text: str                    # translated (English) content used for classification
    original_text: str = ""      # untranslated, kept for audit only
    published_at: Optional[datetime] = None
    collected_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    is_structured_data: bool = False  # True for API numbers (CoinGecko/FRED) -- treated as fact, skips text classification
    structured_payload: Optional[dict] = None  # the raw numeric payload, for structured_data items
    reliability_tier: str = "medium"  # "official" | "high" | "medium" | "low" -- baseline before adjustment

    def __post_init__(self):
        if self.published_at is None:
            self.published_at = self.collected_at


PRICE_TARGET_TYPES = ("target", "support", "resistance", "level")
INSIGHT_KINDS = ("fact", "opinion", "prediction", "signal")


@dataclass
class PriceTarget:
    kind: str    # one of PRICE_TARGET_TYPES
    value: float


@dataclass
class Insight:
    """A structured, attributed conclusion -- what actually gets stored and
    reused, never a raw message dump."""
    source: str
    source_url: str
    source_type: str
    timestamp: datetime          # publication time
    collected_at: datetime
    language: str
    category: str                 # e.g. "crypto_analysis", "macro", "market_warning"
    kind: str                     # primary INSIGHT_KINDS value
    is_fact: bool
    is_opinion: bool
    is_prediction: bool
    is_signal: bool
    content_summary: str          # short, not the full raw post
    market_relevance: float       # 0-1
    confidence: float             # 0-1 -- extraction confidence, not "this is true"
    source_reliability: float     # 0-1, source's score at time of storage
    related_assets: List[str] = field(default_factory=list)
    related_insights: List[str] = field(default_factory=list)  # ids of cross-referenced insights
    direction: Optional[str] = None            # BUY / SELL / None
    price_targets: List[dict] = field(default_factory=list)    # [{"kind": "target", "value": 65000}]
    is_promotional: bool = False
    content_hash: str = ""        # for duplicate detection

    def to_doc(self) -> dict:
        d = self.__dict__.copy()
        return d
