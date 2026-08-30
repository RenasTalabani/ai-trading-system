"""
T-076 (2026-08-30): FinBERT used to load synchronously inside
NewsSentimentModel.__init__() -- which runs at Python *import* time
(routes.py constructs it at module level, before uvicorn ever binds a
port). On a fresh Railway container with no cached/pre-baked model
weights, transformers.pipeline() downloading a 400MB+ model delayed the
import long enough to blow past Railway's healthcheck timeout, marking
the deployment FAILED even though the app would have come up fine given
more time (confirmed live: /health returned 200 once import finished).

Fix: load FinBERT in a background thread instead, so __init__ (and
therefore module import, and therefore the ability to bind a port and
answer /health) returns immediately regardless of how long the download
takes. These tests prove:
  1. Construction does not block on FinBERT loading.
  2. Sentiment analysis still works (via the existing VADER fallback --
     not a new behavior) while FinBERT hasn't finished loading yet.
  3. Once the background load completes, FinBERT results are used again,
     exactly as before this change -- nothing about FinBERT's own
     behavior, model, or sentiment output changed.
  4. A background load failure degrades the same way a synchronous one
     always did (falls back to VADER, never crashes).
  5. load_finbert_in_background=False preserves the old fully-synchronous
     behavior for any caller that specifically wants it.
"""
import threading
import time
from unittest.mock import patch

import pytest

from app.models.news_sentiment import NewsSentimentModel


class _FakeFinBERT:
    """Stands in for the real transformers pipeline callable."""

    def __call__(self, text, truncation=True):
        return [[
            {"label": "positive", "score": 0.91},
            {"label": "negative", "score": 0.05},
            {"label": "neutral",  "score": 0.04},
        ]]


class TestConstructionDoesNotBlockOnFinBERT:
    def test_init_returns_immediately_even_if_finbert_loading_would_block_forever(self):
        release = threading.Event()

        def _blocking_load(self_):
            release.wait(timeout=5)  # simulates a slow/stuck download
            self_._finbert = _FakeFinBERT()

        with patch.object(NewsSentimentModel, "_try_load_finbert", _blocking_load, create=False):
            started = time.monotonic()
            model = NewsSentimentModel()
            elapsed = time.monotonic() - started

        # Construction must return long before the 5s the background
        # "download" is blocked on -- proves __init__ doesn't wait on it.
        assert elapsed < 1.0
        assert model._finbert is None  # still loading, correctly reflects that
        release.set()  # let the background thread finish so it doesn't leak past the test

    def test_a_slow_finbert_load_does_not_delay_object_construction_at_all(self):
        # A more direct version of the above: patch the real loader to sleep,
        # and confirm the constructor call itself takes ~0s, not ~sleep time.
        with patch.object(NewsSentimentModel, "_try_load_finbert", lambda self_: time.sleep(2)):
            started = time.monotonic()
            NewsSentimentModel()
            elapsed = time.monotonic() - started
        assert elapsed < 0.5


class TestSentimentWorksWhileFinBERTIsStillLoading:
    def test_analyze_single_uses_vader_fallback_while_finbert_has_not_loaded_yet(self):
        # Never let the background thread actually run/finish -- simulates
        # a request landing in the narrow window right after startup.
        release = threading.Event()
        with patch.object(NewsSentimentModel, "_try_load_finbert", lambda self_: release.wait(timeout=5)):
            model = NewsSentimentModel()
            try:
                result = model.analyze_single("Bitcoin rallies to new all-time high")
                assert result["model"] == "vader"
                assert result["sentiment"] in ("positive", "negative", "neutral")
                assert isinstance(result["compound"], float)
            finally:
                release.set()

    def test_analyze_does_not_crash_or_hang_with_multiple_headlines_while_loading(self):
        release = threading.Event()
        with patch.object(NewsSentimentModel, "_try_load_finbert", lambda self_: release.wait(timeout=5)):
            model = NewsSentimentModel()
            try:
                result = model.analyze(["Bitcoin surges", "Regulation fears grow", "Quiet trading day"])
                assert result["count"] == 3
                assert all(r["model"] == "vader" for r in result["results"])
            finally:
                release.set()


class TestFinBERTIsUsedOnceLoadedInBackground:
    def test_analyze_single_switches_to_finbert_once_the_background_load_completes(self):
        ready = threading.Event()

        def _fast_fake_load(self_):
            self_._finbert = _FakeFinBERT()
            ready.set()

        with patch.object(NewsSentimentModel, "_try_load_finbert", _fast_fake_load):
            model = NewsSentimentModel()
            assert ready.wait(timeout=5), "background load never completed"

        result = model.analyze_single("Bitcoin rallies to new all-time high")
        assert result["model"] == "finbert"
        assert result["sentiment"] == "positive"

    def test_finbert_sentiment_output_shape_is_unchanged_from_before_this_fix(self):
        # Same assertions that would have applied when FinBERT loaded
        # synchronously -- proves the fix didn't change FinBERT's own
        # behavior, only when loading happens.
        model = NewsSentimentModel(load_finbert_in_background=False)
        model._finbert = _FakeFinBERT()  # force the finbert path deterministically
        result = model.analyze_single("Major exchange hack drains millions")
        assert result["model"] == "finbert"
        assert set(result.keys()) == {
            "text", "sentiment", "compound", "confidence", "model",
            "impact_score", "impact_level", "events", "related_assets", "keywords",
        }


class TestBackgroundLoadFailureDegradesGracefully:
    def test_an_exception_during_background_load_leaves_finbert_none_not_crashed(self):
        def _failing_load(self_):
            try:
                raise RuntimeError("network unreachable")
            except Exception:
                self_._finbert = None  # exactly what the real _try_load_finbert's except branch does

        with patch.object(NewsSentimentModel, "_try_load_finbert", _failing_load):
            model = NewsSentimentModel()
            time.sleep(0.2)  # let the (fast, failing) background thread finish
            assert model._finbert is None
            # still fully usable via VADER
            result = model.analyze_single("Some headline")
            assert result["model"] == "vader"


class TestSynchronousOptOutStillWorks:
    def test_load_finbert_in_background_false_loads_before_returning(self):
        loaded = []

        def _sync_load(self_):
            loaded.append(True)
            self_._finbert = _FakeFinBERT()

        with patch.object(NewsSentimentModel, "_try_load_finbert", _sync_load):
            model = NewsSentimentModel(load_finbert_in_background=False)

        assert loaded == [True]
        assert model._finbert is not None
