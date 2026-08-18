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
