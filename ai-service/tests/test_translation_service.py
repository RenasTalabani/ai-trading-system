"""
Tests for TranslationService's passthrough and timeout-fallback logic.
Does NOT load the real NLLB model (multi-GB download, slow) -- that was
verified manually (Arabic and Kurdish both translate correctly, see
project history). These tests cover the logic around the model: when it's
skipped entirely, and what happens when generation is too slow.
"""
import asyncio
import time

import pytest

from app.services.translation_service import TranslationService, TRANSLATE_TIMEOUT_SECONDS


class TestSyncPassthrough:
    def test_english_text_returned_unchanged_without_loading_model(self):
        svc = TranslationService()
        result = svc.translate("hello world", "en")
        assert result == "hello world"
        assert svc._model is None  # never even tried to load -- en is a no-op

    def test_empty_text_returned_unchanged(self):
        svc = TranslationService()
        assert svc.translate("", "ar") == ""
        assert svc._model is None

    def test_unrecognized_language_code_returned_unchanged(self):
        svc = TranslationService()
        assert svc.translate("some text", "xx") == "some text"
        assert svc._model is None

    def test_model_load_failure_falls_back_to_original_text(self, monkeypatch):
        svc = TranslationService()

        def _boom():
            raise RuntimeError("simulated model load failure")

        monkeypatch.setattr(svc, "_ensure_loaded", lambda: setattr(svc, "_load_failed", True))
        result = svc.translate("نص عربي", "ar")
        assert result == "نص عربي"  # unchanged, no exception raised


class TestAsyncTimeout:
    @pytest.mark.asyncio
    async def test_slow_translation_falls_back_to_original_text_within_timeout_budget(self, monkeypatch):
        """
        Simulates the exact failure mode discovered during development: a
        generation call that runs far longer than acceptable. translate_async
        must return the original text well within a bounded time, not hang.
        """
        svc = TranslationService()

        def _slow_translate(text, src_lang, max_chars=800):
            time.sleep(5)  # shorter than the real 15s prod timeout, but proves the wrapper works
            return "should never be returned"

        import app.services.translation_service as ts
        monkeypatch.setattr(svc, "translate", _slow_translate)
        monkeypatch.setattr(ts, "TRANSLATE_TIMEOUT_SECONDS", 0.5)

        start = time.time()
        result = await svc.translate_async("نص عربي طويل", "ar")
        elapsed = time.time() - start

        assert result == "نص عربي طويل"  # fell back to original, not the slow result
        assert elapsed < 2.0  # bounded by the (shortened) timeout, not the 5s sleep

    @pytest.mark.asyncio
    async def test_fast_translation_returns_translated_result(self, monkeypatch):
        svc = TranslationService()
        monkeypatch.setattr(svc, "translate", lambda text, src_lang, max_chars=800: "translated!")
        result = await svc.translate_async("نص", "ar")
        assert result == "translated!"

    @pytest.mark.asyncio
    async def test_english_never_touches_the_model_even_in_async_path(self):
        svc = TranslationService()
        result = await svc.translate_async("already english", "en")
        assert result == "already english"
        assert svc._model is None


class TestTranslateConcurrencyIsBounded:
    """
    T-093 (2026-09-01, production incident): translate_async() used to run
    fully unbounded -- telegram_collector.py fetches its ~3 configured
    non-English channels concurrently via asyncio.gather, each independently
    calling this. Unlike news_analyzer.py's FinBERT calls (bounded by both a
    semaphore AND a refresh_lock that serializes callers), nothing here
    stopped multiple NLLB-200 .generate() calls from running at once, each
    spawning its own native OpenMP thread team -- a real contributor to the
    production libgomp thread-exhaustion crash (see run.py's T-093 comment
    for the full root-cause writeup). Mirrors
    test_news_analyzer_finbert_concurrency_cap.py's proof pattern exactly.
    """
    @pytest.mark.asyncio
    async def test_no_more_than_two_translations_run_at_once_across_many_concurrent_callers(self, monkeypatch):
        svc = TranslationService()

        in_flight = {"n": 0}
        max_seen  = {"n": 0}

        def _tracked_translate(text, src_lang, max_chars=800):
            # Runs inside run_in_executor -- a real OS thread. Same
            # GIL-makes-this-safe-enough reasoning as the FinBERT version
            # of this test: any lost update only ever makes max_seen
            # *lower* than reality, never produces a false failure.
            in_flight["n"] += 1
            max_seen["n"] = max(max_seen["n"], in_flight["n"])
            time.sleep(0.08)
            in_flight["n"] -= 1
            return "translated"

        monkeypatch.setattr(svc, "translate", _tracked_translate)

        # 6 concurrent callers, far more than the cap of 2 -- proves the
        # semaphore is real, not just coincidentally never hit.
        await asyncio.gather(*(
            svc.translate_async(f"نص رقم {i}", "ar") for i in range(6)
        ))

        assert max_seen["n"] <= 2, (
            f"expected at most 2 concurrent translations, observed {max_seen['n']} at once"
        )
        assert max_seen["n"] >= 2, (
            f"expected genuine concurrency up to the cap, observed only {max_seen['n']} at once"
        )

    @pytest.mark.asyncio
    async def test_a_timeout_releases_its_semaphore_slot_for_the_next_caller(self, monkeypatch):
        """
        The semaphore is acquired around the whole wait_for(), including the
        timeout path -- a slow call that times out must not permanently hold
        its slot and starve callers queued behind it.
        """
        svc = TranslationService()
        import app.services.translation_service as ts
        monkeypatch.setattr(ts, "TRANSLATE_TIMEOUT_SECONDS", 0.3)
        monkeypatch.setattr(svc, "translate", lambda text, src_lang, max_chars=800: (
            time.sleep(5) or "should never be returned"
        ))

        start = time.time()
        # 3 calls, cap of 2 -- if a timeout ever leaked its slot, the 3rd
        # call would never get to run and this would hang past the test
        # timeout instead of completing quickly.
        results = await asyncio.gather(*(
            svc.translate_async(f"نص {i}", "ar") for i in range(3)
        ))
        elapsed = time.time() - start

        assert results == ["نص 0", "نص 1", "نص 2"]  # all fell back to original text
        assert elapsed < 2.0
