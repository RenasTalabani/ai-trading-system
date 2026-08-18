"""
TranslationService — local, offline translation for non-English source
content (Telegram channels, etc.) before it reaches the English-only
sentiment models (VADER's lexicon is English words; untranslated Arabic or
Kurdish text would just score as flat neutral every time).

Uses Meta's NLLB-200 (No Language Left Behind), the same family of model
already available through the `transformers` library already installed for
FinBERT — no new external service, no API key, nothing leaves this machine.
Chosen specifically because it covers low-resource languages like Kurdish
(Sorani) far better than the bilingual Helsinki-NLP opus-mt models, which
don't have a direct Kurdish->English pair at all.

Load is lazy and best-effort: if the model can't load (offline first run,
low memory, etc.) translation silently no-ops and returns the original
text, mirroring news_sentiment.py's FinBERT-with-VADER-fallback pattern —
a translation outage should degrade the pipeline, never crash it.

Generation is wrapped in a hard wall-clock timeout (translate_async): a
slow or pathological generation for one post (observed during testing —
some inputs on some language pairs run far slower than others on CPU)
must never be allowed to hang the whole collection cycle, the same lesson
learned from the MongoDB DNS outage earlier in this project's history
(see feedback_store.py). Sync generate() is also genuinely CPU-bound, so
translate_async runs it in a thread instead of blocking the event loop,
same pattern news_analyzer.py already uses for FinBERT.
"""
import asyncio
import logging

logger = logging.getLogger("ai-service.translation")

TRANSLATE_TIMEOUT_SECONDS = 15.0

MODEL_NAME = "facebook/nllb-200-distilled-600M"

# FLORES-200 language codes NLLB expects, keyed by the short codes used
# throughout this codebase's source configs.
LANG_CODES = {
    "ar": "arb_Arab",   # Arabic
    "ku": "ckb_Arab",   # Central Kurdish (Sorani)
    "en": "eng_Latn",
}


class TranslationService:
    def __init__(self):
        self._tokenizer = None
        self._model = None
        self._load_failed = False

    def _ensure_loaded(self):
        if self._model is not None or self._load_failed:
            return
        try:
            from transformers import AutoTokenizer, AutoModelForSeq2SeqLM
            logger.info(f"Loading translation model: {MODEL_NAME} (first use, may take a while)...")
            self._tokenizer = AutoTokenizer.from_pretrained(MODEL_NAME)
            self._model = AutoModelForSeq2SeqLM.from_pretrained(MODEL_NAME)
            logger.info("Translation model loaded.")
        except Exception as e:
            logger.warning(f"Translation model failed to load — non-English content will pass through untranslated: {e}")
            self._load_failed = True

    def translate(self, text: str, src_lang: str, max_chars: int = 800) -> str:
        """
        Translate `text` from `src_lang` (short code: 'ar', 'ku') to English.
        Returns the original text unchanged if src_lang is already English,
        unrecognized, or the model isn't available -- never raises.
        """
        if not text or src_lang == "en":
            return text
        src_code = LANG_CODES.get(src_lang)
        if not src_code:
            return text

        self._ensure_loaded()
        if self._model is None:
            return text

        try:
            self._tokenizer.src_lang = src_code
            trimmed = text[:max_chars]
            inputs = self._tokenizer(trimmed, return_tensors="pt")
            tgt_id = self._tokenizer.convert_tokens_to_ids(LANG_CODES["en"])
            generated = self._model.generate(
                **inputs, forced_bos_token_id=tgt_id, max_new_tokens=60,
            )
            return self._tokenizer.batch_decode(generated, skip_special_tokens=True)[0]
        except Exception as e:
            logger.debug(f"Translation failed for a snippet ({src_lang}->en): {e}")
            return text

    async def translate_async(self, text: str, src_lang: str, max_chars: int = 800) -> str:
        """
        Non-blocking version for use from async collectors: runs the
        CPU-bound translate() off the event loop, and hard-bounds it to
        TRANSLATE_TIMEOUT_SECONDS so one slow post can never stall an
        entire collection cycle. Falls back to the original text on
        timeout, exactly like every other failure mode here.
        """
        if not text or src_lang == "en" or src_lang not in LANG_CODES:
            return text
        loop = asyncio.get_event_loop()
        try:
            return await asyncio.wait_for(
                loop.run_in_executor(None, self.translate, text, src_lang, max_chars),
                timeout=TRANSLATE_TIMEOUT_SECONDS,
            )
        except asyncio.TimeoutError:
            logger.warning(f"Translation timed out after {TRANSLATE_TIMEOUT_SECONDS}s ({src_lang}->en) — using original text.")
            return text


_instance: "TranslationService | None" = None


def get_translation_service() -> TranslationService:
    global _instance
    if _instance is None:
        _instance = TranslationService()
    return _instance
