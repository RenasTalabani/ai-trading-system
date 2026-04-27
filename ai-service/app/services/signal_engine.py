"""
Phase 8 — Unified AI Signal Engine
Central brain combining:
  - RandomForest market model    (technical indicators)
  - Transformer sequence model   (Phase 8 — replaces LSTM as primary)
  - News intelligence            (FinBERT + event detection)
  - Social intelligence          (Telegram + Twitter + Reddit)
  - Fusion GBM meta-learner      (17-feature Phase 8 vector)
  - Confidence calibrator        (isotonic regression)
  - Online learning feedback     (continuous self-improvement)
  - Model drift detector         (auto-triggers retraining alert)
"""
import logging
from typing import Optional
import pandas as pd

from app.config import get_settings
from app.services.news_analyzer import NewsAnalyzer
from app.services.social_analyzer import SocialAnalyzer

settings = get_settings()
logger = logging.getLogger("ai-service.signal_engine")

WEIGHTS = {"market": 0.45, "transformer": 0.25, "news": 0.20, "social": 0.10}

BEARISH_OVERRIDES = {"hack_exploit", "market_crash", "regulation"}
BULLISH_OVERRIDES = {"etf", "rally", "halving", "partnership"}


class SignalEngine:
    def __init__(self, market_model, news_model, social_model,
                 lstm_model=None, fusion_model=None, calibrator=None,
                 feedback_evaluator=None,
                 transformer_model=None, online_learner=None,
                 drift_detector=None, model_registry=None):
        self.market_model       = market_model
        self.news_model         = news_model
        self.social_model       = social_model
        self.lstm_model         = lstm_model          # kept for backward compat
        self.transformer_model  = transformer_model   # Phase 8 primary
        self.fusion_model       = fusion_model
        self.calibrator         = calibrator
        self.feedback_evaluator = feedback_evaluator
        self.online_learner     = online_learner
        self.drift_detector     = drift_detector
        self.model_registry     = model_registry
        self.news_analyzer      = NewsAnalyzer(news_model)
        self.social_analyzer    = SocialAnalyzer(social_model)

    # ── Helpers ────────────────────────────────────────────────────────────────

    def _compute_stop_take(self, entry: float, direction: str, atr: float) -> tuple:
        if direction == "BUY":
            return round(entry - 1.5 * atr, 6), round(entry + 2.5 * atr, 6)
        if direction == "SELL":
            return round(entry + 1.5 * atr, 6), round(entry - 2.5 * atr, 6)
        return None, None

    def _event_override(self, direction: str, confidence: float, events: list) -> tuple:
        bear = any(e in BEARISH_OVERRIDES for e in events)
        bull = any(e in BULLISH_OVERRIDES for e in events)
        if bear and direction == "BUY":   confidence = max(0, confidence - 15)
        if bear and direction == "SELL":  confidence = min(100, confidence + 10)
        if bull and direction == "SELL":  confidence = max(0, confidence - 15)
        if bull and direction == "BUY":   confidence = min(100, confidence + 10)
        return direction, confidence

    def _build_reason(self, asset, mkt, transformer_r, news_r, social_r, events) -> str:
        parts = [f"RF: {mkt.get('direction')} [{mkt.get('confidence',0):.0f}%]"]
        if transformer_r and transformer_r.get("model") not in ("transformer-unavailable",
                                                                  "transformer-insufficient-data"):
            parts.append(f"TF: {transformer_r.get('direction')} [{transformer_r.get('confidence',0):.0f}%]")
        if news_r.get("article_count", 0) > 0:
            parts.append(f"News: {news_r.get('sentiment','?')} ({news_r.get('article_count',0)} articles)")
        if events:
            parts.append(f"Events: {', '.join(events[:3])}")
        if social_r.get("count", 0) > 0:
            parts.append(f"Social: {social_r.get('overall','?')} "
                         f"(hype={social_r.get('hype_level',0):.2f})")
        return " | ".join(parts)

    # ── Main predict ────────────────────────────────────────────────────────────

    async def generate_signal(self, asset: str, candles: pd.DataFrame) -> dict:
        entry_price = float(candles.iloc[-1]["close"])
        atr         = float(candles.iloc[-1].get("atr", entry_price * 0.01))
        row         = candles.iloc[-1]

        # ── 1. RandomForest market model ───────────────────────────────────────
        rf_result = self.market_model.predict(candles)
        rf_proba  = rf_result.get("probabilities", {"BUY": 33, "SELL": 33, "HOLD": 34})

        # ── 2. Transformer model (primary sequence model, Phase 8) ─────────────
        transformer_result = {
            "direction": "HOLD", "confidence": 50,
            "model": "transformer-unavailable",
            "probabilities": {"BUY": 33.3, "HOLD": 33.3, "SELL": 33.3},
        }
        transformer_proba = transformer_result["probabilities"]

        if self.transformer_model and self.transformer_model.is_trained:
            try:
                transformer_result = self.transformer_model.predict(candles)
                transformer_proba  = transformer_result.get("probabilities", transformer_proba)
            except Exception as e:
                logger.debug(f"Transformer predict failed for {asset}: {e}")

        # ── 2b. LSTM fallback (if Transformer not trained yet) ─────────────────
        lstm_result = {"direction": "HOLD", "confidence": 50, "model": "lstm-unavailable",
                       "probabilities": {"BUY": 33, "SELL": 33, "HOLD": 34}}
        if (transformer_result["model"] == "transformer-unavailable" and
                self.lstm_model and self.lstm_model.is_trained):
            try:
                lstm_result = self.lstm_model.predict(candles)
                # Promote LSTM result as the sequence model result
                transformer_result = lstm_result
                transformer_proba  = lstm_result.get("probabilities", transformer_proba)
            except Exception as e:
                logger.debug(f"LSTM fallback failed for {asset}: {e}")

        lstm_proba = lstm_result.get("probabilities", {"BUY": 33, "SELL": 33, "HOLD": 34})

        # ── 3. News intelligence ───────────────────────────────────────────────
        try:
            news_cache  = await self.news_analyzer.refresh()
            asset_news  = news_cache.get("by_asset", {}).get(asset, {})
            news_score  = asset_news.get("market_score", 50)
            all_events  = list(set(
                asset_news.get("top_events", []) +
                news_cache.get("global", {}).get("detected_events", [])
            ))
            news_result = {
                "sentiment":     asset_news.get("sentiment", "neutral"),
                "article_count": asset_news.get("article_count", 0),
                "market_score":  news_score,
                "events":        all_events,
                "headlines":     news_cache.get("top_headlines", [])[:3],
            }
        except Exception as e:
            logger.warning(f"News failed for {asset}: {e}")
            news_score, all_events, news_result = 50, [], {
                "article_count": 0, "sentiment": "neutral",
                "market_score": 50, "events": [], "headlines": [],
            }

        # ── 4. Social intelligence ─────────────────────────────────────────────
        try:
            social_cache   = await self.social_analyzer.refresh()
            asset_social   = social_cache.get("by_asset", {}).get(asset, {})
            social_score   = asset_social.get("market_score", 50)
            manip_detected = (asset_social.get("manipulation_detected", False) or
                              asset_social.get("pump_detected", False))
            if manip_detected:
                logger.warning(f"[{asset}] Manipulation detected — social neutralized")
                social_score = 50
            social_result = {
                "overall":               asset_social.get("sentiment", "neutral"),
                "market_score":          social_score,
                "hype_level":            asset_social.get("hype_level", 0),
                "manipulation_detected": manip_detected,
                "count":                 asset_social.get("relevant_posts", 0),
            }
        except Exception as e:
            logger.warning(f"Social failed for {asset}: {e}")
            social_score, social_result = 50, {
                "overall": "neutral", "market_score": 50,
                "hype_level": 0, "manipulation_detected": False, "count": 0,
            }

        # ── 5. Fusion model (Phase 8 — 17-feature vector) ─────────────────────
        rsi    = float(row.get("rsi", 50))
        macd_h = float(row.get("macd_hist", 0))
        vol_r  = float(row.get("vol_ratio", 1))

        if self.fusion_model and self.fusion_model.is_trained:
            fv = self.fusion_model.build_feature_vector(
                rf_proba=rf_proba,
                lstm_proba=lstm_proba,
                news_score=news_score,
                news_impact=news_result.get("market_score", 50),
                social_score=social_score,
                social_hype=social_result.get("hype_level", 0),
                social_manip=social_result.get("manipulation_detected", False),
                rsi=rsi, macd_hist=macd_h, vol_ratio=vol_r,
                transformer_proba=transformer_proba,   # Phase 8
            )
            fusion_result = self.fusion_model.predict(fv)
            final_dir     = fusion_result["direction"]
            raw_conf      = fusion_result["confidence"]
        else:
            # Phase 8 weighted vote: RF 45%, Transformer 25%, News 20%, Social 10%
            tf_buy  = transformer_proba.get("BUY",  33.3) / 100.0
            tf_sell = transformer_proba.get("SELL", 33.3) / 100.0

            buy_s = (WEIGHTS["market"]      * rf_proba.get("BUY",  33) / 100 +
                     WEIGHTS["transformer"] * tf_buy +
                     WEIGHTS["news"]        * news_score / 100 +
                     WEIGHTS["social"]      * social_score / 100)
            sell_s = (WEIGHTS["market"]     * rf_proba.get("SELL", 33) / 100 +
                      WEIGHTS["transformer"] * tf_sell +
                      WEIGHTS["news"]        * (1 - news_score / 100) +
                      WEIGHTS["social"]      * (1 - social_score / 100))

            if   buy_s >= 0.58:  final_dir, raw_conf = "BUY",  round(buy_s  * 100, 1)
            elif sell_s >= 0.58: final_dir, raw_conf = "SELL", round(sell_s * 100, 1)
            else:                final_dir, raw_conf = "HOLD", round(50 + abs(buy_s - sell_s) * 50, 1)

        # ── 6. Event override ──────────────────────────────────────────────────
        final_dir, raw_conf = self._event_override(final_dir, raw_conf, all_events)

        # ── 7. Confidence calibration ──────────────────────────────────────────
        final_conf = (self.calibrator.calibrate(raw_conf)
                      if self.calibrator and self.calibrator.is_fitted
                      else raw_conf)

        stop_loss, take_profit = self._compute_stop_take(entry_price, final_dir, atr)
        reason = self._build_reason(asset, rf_result, transformer_result,
                                    news_result, social_result, all_events)

        signal_payload = {
            "asset":            asset,
            "direction":        final_dir,
            "confidence":       final_conf,
            "raw_confidence":   raw_conf,
            "entry_price":      entry_price,
            "stop_loss":        stop_loss,
            "take_profit":      take_profit,
            "reason":           reason,
            "sources": {
                "market": {
                    "rf":          {"direction": rf_result["direction"],          "confidence": rf_result["confidence"]},
                    "transformer": {"direction": transformer_result["direction"], "confidence": transformer_result["confidence"],
                                    "model": transformer_result.get("model")},
                    "indicators":  {"rsi": round(rsi, 2), "macd_hist": round(macd_h, 4),
                                    "ema20": round(float(row.get("ema20", 0)), 4)},
                },
                "news":   {"score": news_score, "headlines": news_result.get("headlines", []),
                           "events": all_events},
                "social": {"score": social_score, "sentiment": social_result.get("overall", "neutral"),
                           "hype_level": social_result.get("hype_level", 0),
                           "manipulation_detected": social_result.get("manipulation_detected", False)},
            },
            "model_versions": {
                "transformer": transformer_result.get("model", "unknown"),
                "fusion":      "fusion-gb-v2" if (self.fusion_model and self.fusion_model.is_trained) else "vote-fallback",
            },
        }

        # ── 8. Record for feedback loop + online learner ───────────────────────
        if final_dir != "HOLD":
            if self.feedback_evaluator:
                # Attach sequence snapshot for online learner
                seq_snapshot = None
                if self.transformer_model and self.transformer_model.is_trained:
                    seq_snapshot = self.transformer_model.get_sequence_for_replay(candles)
                signal_payload["_seq_snapshot"]     = seq_snapshot
                signal_payload["_transformer_proba"] = transformer_proba
                self.feedback_evaluator.record_signal(signal_payload)

        return signal_payload
