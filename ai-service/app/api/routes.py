import logging
from fastapi import APIRouter, HTTPException, BackgroundTasks
from pydantic import BaseModel
from typing import List, Optional

from app.config import get_settings
from app.models.market_model import MarketModel
from app.models.news_sentiment import NewsSentimentModel
from app.models.social_sentiment import SocialSentimentModel
from app.models.fusion.lstm_model import LSTMModel
from app.models.fusion.fusion_model import FusionModel
from app.models.fusion.confidence_calibrator import ConfidenceCalibrator
from app.models.transformer_model import TransformerModel          # Phase 8
from app.models.online_learner import OnlineLearner                # Phase 8
from app.services.signal_engine import SignalEngine
from app.services.data_processor import DataProcessor
from app.services.trainer import ModelTrainer
from app.services.news_analyzer import NewsAnalyzer
from app.services.social_analyzer import SocialAnalyzer
from app.services.feedback_loop import SignalOutcomeEvaluator
from app.services.model_registry import ModelRegistry              # Phase 8
from app.services.drift_detector import DriftDetector              # Phase 8
from app.services.backtest.backtester import Backtester
from app.services.collectors.binance_collector import (
    TRACKED_ASSETS, fetch_all_prices, fetch_current_price
)
from app.services.strategy_engine import StrategyEngine
from app.services.strategy_simulator import StrategySimulator
from app.services.order_block_engine import OrderBlockEngine

settings = get_settings()
logger = logging.getLogger("ai-service.routes")
router = APIRouter()

# ─── Singleton instances ───────────────────────────────────────────────────────
market_model       = MarketModel()
news_model         = NewsSentimentModel()
social_model       = SocialSentimentModel()
lstm_model         = LSTMModel(model_path=settings.model_path)
fusion_model       = FusionModel(model_path=settings.model_path)
calibrator         = ConfidenceCalibrator(model_path=settings.model_path)
transformer_model  = TransformerModel(model_path=settings.model_path)   # Phase 8
model_registry     = ModelRegistry(model_path=settings.model_path)      # Phase 8
drift_detector     = DriftDetector()                                     # Phase 8
online_learner     = OnlineLearner(                                      # Phase 8
    transformer=transformer_model,
    calibrator=calibrator,
    registry=model_registry,
)
feedback_evaluator = SignalOutcomeEvaluator(
    calibrator=calibrator,
    online_learner=online_learner,       # Phase 8
    drift_detector=drift_detector,       # Phase 8
)

signal_engine = SignalEngine(
    market_model=market_model,
    news_model=news_model,
    social_model=social_model,
    lstm_model=lstm_model,
    fusion_model=fusion_model,
    calibrator=calibrator,
    feedback_evaluator=feedback_evaluator,
    transformer_model=transformer_model,   # Phase 8
    online_learner=online_learner,         # Phase 8
    drift_detector=drift_detector,         # Phase 8
    model_registry=model_registry,         # Phase 8
)

news_analyzer    = signal_engine.news_analyzer
social_analyzer  = signal_engine.social_analyzer
data_processor   = DataProcessor()
trainer          = ModelTrainer(market_model)
backtester       = Backtester(market_model=market_model, lstm_model=lstm_model)
strategy_engine_svc  = StrategyEngine()
strategy_simulator   = StrategySimulator()
order_block_engine   = OrderBlockEngine()


# ─── Request schemas ───────────────────────────────────────────────────────────

class PredictRequest(BaseModel):
    asset: str
    interval: str = "1h"

class NewsAnalyzeRequest(BaseModel):
    headlines: List[str]
    asset: Optional[str] = None

class SocialAnalyzeRequest(BaseModel):
    posts: List[str]
    asset: Optional[str] = None

class TrainRequest(BaseModel):
    asset: Optional[str] = None
    interval: str = "1h"
    multi_asset: bool = True
    train_lstm: bool = False

class BacktestRequest(BaseModel):
    asset: str = "BTCUSDT"
    interval: str = "1h"
    min_confidence: float = 65.0
    max_candles: int = 1000

class FeedbackRequest(BaseModel):
    signal_id: str
    asset: str
    direction: str
    entry_price: float
    exit_price: float
    outcome: str   # "win" / "loss"
    confidence: float


# ─── Health & Status ───────────────────────────────────────────────────────────

@router.get("/health")
async def health():
    return {
        "success": True,
        "status":  "operational",
        "version": "8.0.0",
        "models": {
            "random_forest": market_model.is_trained,
            "transformer":   transformer_model.is_trained,
            "lstm_fallback": lstm_model.is_trained,
            "fusion":        fusion_model.is_trained,
            "calibrator":    calibrator.is_fitted,
            "news_nlp":      news_model.is_loaded,
            "social_nlp":    social_model.is_loaded,
        },
        "phase8": {
            "online_learning": online_learner.stats(),
            "drift":           drift_detector.status(),
        },
    }

@router.get("/status")
async def status():
    prices = await fetch_all_prices()
    return {
        "success": True,
        "service": "ai-trading-intelligence",
        "version": "8.0.0",
        "models_ready":      market_model.is_trained,
        "transformer_ready": transformer_model.is_trained,
        "lstm_ready":        lstm_model.is_trained,
        "fusion_ready":      fusion_model.is_trained,
        "calibrator_ready":  calibrator.is_fitted,
        "tracked_assets":    TRACKED_ASSETS,
        "live_prices":       prices,
        "feedback_stats":    feedback_evaluator.get_stats(),
        "drift_status":      drift_detector.status(),
        "registry_summary":  model_registry.summary(),
    }


# ─── Prediction ────────────────────────────────────────────────────────────────

@router.post("/predict")
async def predict(req: PredictRequest):
    try:
        asset = req.asset.upper()
        candles = await data_processor.fetch_market_data(asset, req.interval)
        if candles is None or len(candles) < 60:
            raise HTTPException(status_code=422, detail=f"Insufficient market data for {asset}")
        result = await signal_engine.generate_signal(asset, candles)
        return {"success": True, **result}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Prediction failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


# ─── Training ──────────────────────────────────────────────────────────────────

async def _run_training(asset, interval, multi_asset, train_lstm):
    try:
        if multi_asset or asset is None:
            result = await trainer.train_multi_asset(TRACKED_ASSETS, interval)
        else:
            result = await trainer.train(asset.upper(), interval)
        logger.info(f"RF training complete: {result}")

        if train_lstm:
            from app.services.data_processor import DataProcessor
            dp = DataProcessor()
            df = await dp.fetch_market_data("BTCUSDT", interval, limit=1000)
            if df is not None and len(df) >= 80:
                r = lstm_model.train(df, epochs=30)
                logger.info(f"LSTM training complete: {r}")
    except Exception as e:
        logger.error(f"Training failed: {e}", exc_info=True)

@router.post("/train")
async def train_model(req: TrainRequest, background_tasks: BackgroundTasks):
    background_tasks.add_task(_run_training, req.asset, req.interval, req.multi_asset, req.train_lstm)
    return {
        "success": True,
        "message": "Training started in background.",
        "asset": req.asset or "all",
        "train_lstm": req.train_lstm,
    }

@router.get("/train/status")
async def train_status():
    return {
        "success": True,
        "rf_trained":          market_model.is_trained,
        "transformer_trained": transformer_model.is_trained,
        "lstm_trained":        lstm_model.is_trained,
        "fusion_trained":      fusion_model.is_trained,
        "calibrator_fitted":   calibrator.is_fitted,
    }


# ─── Phase 8 — Transformer training ───────────────────────────────────────────

class TransformerTrainRequest(BaseModel):
    asset:  str = "BTCUSDT"
    epochs: int = 30

async def _run_transformer_training(asset: str, epochs: int):
    try:
        from app.services.data_processor import DataProcessor
        dp = DataProcessor()
        df = await dp.fetch_market_data(asset.upper(), "1h", limit=1000)
        if df is None or len(df) < 100:
            logger.error(f"Insufficient data to train Transformer on {asset}")
            return
        result = transformer_model.train(df, epochs=epochs)
        logger.info(f"Transformer training complete: {result}")
        if result.get("success") and model_registry:
            import os
            model_registry.register(
                "transformer",
                file_path=os.path.join(settings.model_path, "transformer.pt"),
                metrics={
                    "val_accuracy": result.get("val_accuracy"),
                    "sequences":    result.get("sequences"),
                    "asset":        asset,
                },
                notes=f"trained-on-{asset}",
            )
    except Exception as e:
        logger.error(f"Transformer training failed: {e}", exc_info=True)

@router.post("/train/transformer")
async def train_transformer(req: TransformerTrainRequest, background_tasks: BackgroundTasks):
    background_tasks.add_task(_run_transformer_training, req.asset, req.epochs)
    return {
        "success": True,
        "message": f"Transformer training started in background on {req.asset}",
        "epochs":  req.epochs,
    }


# ─── Phase 8 — Model registry ─────────────────────────────────────────────────

@router.get("/models/registry")
async def get_registry():
    return {"success": True, "registry": model_registry.summary()}

@router.get("/models/registry/{model_name}")
async def get_model_versions(model_name: str):
    versions = model_registry.get_all_versions(model_name)
    return {"success": True, "model": model_name, "versions": versions}

@router.post("/models/rollback/{model_name}")
async def rollback_model(model_name: str):
    prev = model_registry.rollback(model_name)
    if prev is None:
        raise HTTPException(status_code=400, detail=f"No previous version to roll back to for {model_name}")
    return {"success": True, "rolled_back_to": prev}


# ─── Phase 8 — Drift & online learning ────────────────────────────────────────

@router.get("/models/drift")
async def get_drift_status():
    return {"success": True, **drift_detector.status()}

@router.get("/models/online-learner")
async def get_online_learner_stats():
    return {"success": True, **online_learner.stats()}

@router.post("/models/online-learner/force-update")
async def force_online_update():
    result = online_learner.force_update()
    return {"success": True, "result": result}


# ─── Backtesting ───────────────────────────────────────────────────────────────

@router.post("/backtest")
async def run_backtest(req: BacktestRequest):
    try:
        logger.info(f"Backtest requested: {req.asset}/{req.interval}")
        result = await backtester.run(
            asset=req.asset.upper(),
            interval=req.interval,
            min_confidence=req.min_confidence,
            max_candles=req.max_candles,
        )
        return {"success": True, **result.to_dict()}
    except Exception as e:
        logger.error(f"Backtest failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/backtest/multi")
async def run_multi_backtest(background_tasks: BackgroundTasks):
    """Run backtests for all tracked assets in background."""
    async def _run_all():
        results = {}
        for asset in TRACKED_ASSETS[:5]:   # top 5 to limit runtime
            try:
                r = await backtester.run(asset=asset, interval="1h", min_confidence=65.0)
                results[asset] = r.to_dict()
            except Exception as e:
                results[asset] = {"error": str(e)}
        logger.info(f"Multi-backtest complete: {list(results.keys())}")
    background_tasks.add_task(_run_all)
    return {"success": True, "message": "Multi-asset backtest started in background."}


# ─── Feedback loop ─────────────────────────────────────────────────────────────

@router.get("/feedback/stats")
async def feedback_stats():
    return {"success": True, **feedback_evaluator.get_stats()}

@router.post("/feedback/evaluate")
async def trigger_evaluation(background_tasks: BackgroundTasks):
    background_tasks.add_task(feedback_evaluator.evaluate_pending)
    return {"success": True, "message": "Feedback evaluation triggered."}


# ─── Indicators ────────────────────────────────────────────────────────────────

@router.get("/indicators/{asset}")
async def get_indicators(asset: str, interval: str = "1h"):
    try:
        candles = await data_processor.fetch_market_data(asset.upper(), interval)
        if candles is None:
            raise HTTPException(status_code=404, detail=f"No data for {asset}")
        row = candles.iloc[-1]
        return {
            "success": True,
            "asset": asset.upper(),
            "interval": interval,
            "price": round(float(row["close"]), 6),
            "indicators": {
                "rsi":        round(float(row.get("rsi",        0)), 2),
                "macd":       round(float(row.get("macd",       0)), 6),
                "macd_signal":round(float(row.get("macd_signal",0)), 6),
                "macd_hist":  round(float(row.get("macd_hist",  0)), 6),
                "ema20":      round(float(row.get("ema20",      0)), 6),
                "ema50":      round(float(row.get("ema50",      0)), 6),
                "ema200":     round(float(row.get("ema200",     0)), 6),
                "atr":        round(float(row.get("atr",        0)), 6),
                "bb_upper":   round(float(row.get("bb_upper",   0)), 6),
                "bb_lower":   round(float(row.get("bb_lower",   0)), 6),
                "vol_ratio":  round(float(row.get("vol_ratio",  1)), 3),
            },
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ─── Live prices ───────────────────────────────────────────────────────────────

@router.get("/prices")
async def get_all_prices():
    prices = await fetch_all_prices()
    return {"success": True, "prices": prices, "count": len(prices)}

@router.get("/prices/{asset}")
async def get_price(asset: str):
    price = await fetch_current_price(asset.upper())
    if price is None:
        raise HTTPException(status_code=404, detail=f"Price unavailable for {asset.upper()}")
    return {"success": True, "asset": asset.upper(), "price": price}


# ─── News Intelligence ─────────────────────────────────────────────────────────

@router.get("/news/analysis")
async def get_news_analysis():
    try:
        result = await news_analyzer.refresh()
        return {"success": True, **result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/news/asset/{asset}")
async def get_news_for_asset(asset: str):
    try:
        result = await news_analyzer.refresh()
        data = result.get("by_asset", {}).get(asset.upper())
        if not data:
            raise HTTPException(status_code=404, detail=f"No news for {asset.upper()}")
        return {"success": True, "asset": asset.upper(), **data}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/news/analyze")
async def analyze_news(req: NewsAnalyzeRequest):
    try:
        result = (news_model.analyze_for_asset(req.headlines, req.asset.upper())
                  if req.asset else news_model.analyze(req.headlines))
        return {"success": True, **result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/news/events")
async def get_news_events():
    try:
        result = await news_analyzer.refresh()
        return {
            "success": True,
            "events":    result.get("global", {}).get("detected_events", []),
            "headlines": result.get("top_headlines", []),
            "sources":   result.get("sources_used", []),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ─── Social Intelligence ───────────────────────────────────────────────────────

@router.get("/social/analysis")
async def get_social_analysis():
    try:
        result = await social_analyzer.refresh()
        return {"success": True, **result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/social/asset/{asset}")
async def get_social_for_asset(asset: str):
    try:
        result = await social_analyzer.refresh()
        data = result.get("by_asset", {}).get(asset.upper())
        if not data:
            raise HTTPException(status_code=404, detail=f"No social data for {asset.upper()}")
        return {"success": True, "asset": asset.upper(), **data}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/social/platform/{platform}")
async def get_social_by_platform(platform: str):
    try:
        result = await social_analyzer.refresh()
        data = result.get("by_platform", {}).get(platform.lower())
        if not data:
            raise HTTPException(status_code=404, detail=f"No data for {platform}")
        return {"success": True, "platform": platform.lower(), **data}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/social/analyze")
async def analyze_social(req: SocialAnalyzeRequest):
    try:
        posts = [{"content": p, "platform": "custom", "likes": 0, "shares": 0, "replies": 0}
                 for p in req.posts]
        result = (social_model.analyze_for_asset(posts, req.asset.upper())
                  if req.asset else social_model.analyze(posts))
        return {"success": True, **result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/social/alerts")
async def get_social_alerts():
    try:
        result = await social_analyzer.refresh()
        alerts = [
            {"asset": a, **{k: v for k, v in d.items()
             if k in ("pump_detected","manipulation_detected","hype_level","sentiment")}}
            for a, d in result.get("by_asset", {}).items()
            if d.get("pump_detected") or d.get("manipulation_detected")
        ]
        return {
            "success":     True,
            "alert_count": len(alerts),
            "alerts":      alerts,
            "global_pump": result.get("global", {}).get("pump_detected", False),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ─── Strategy & Holding Intelligence (add-on) ─────────────────────────────────

class StrategyRequest(BaseModel):
    asset: str
    timeframe: str = "7d"   # 1d | 7d | 30d

class HoldingRequest(BaseModel):
    assets:    List[str]
    timeframe: str   = "7d"
    capital:   float = 500.0

class SimulateRequest(BaseModel):
    assets:    List[str]
    timeframe: str   = "7d"
    capital:   float = 500.0


@router.post("/strategy/analyze")
async def strategy_analyze(req: StrategyRequest):
    try:
        result = await strategy_engine_svc.analyze(req.asset, req.timeframe)
        return {"success": True, "data": result}
    except Exception as e:
        logger.error(f"Strategy analyze failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/strategy/holding")
async def strategy_holding(req: HoldingRequest):
    try:
        assets = [a.upper() for a in req.assets[:10]]  # cap at 10
        recs   = await strategy_engine_svc.analyze_multi(assets, req.timeframe)

        best = max(recs, key=lambda r: r["confidence"]) if recs else None

        # Simple expected profit/loss from confidence & expected_move
        expected_profit = 0.0
        expected_loss   = 0.0
        per_capital     = req.capital / max(len(assets), 1)

        for r in recs:
            em = r["expected_move_percent"] / 100
            if r["recommendation"] in ("BUY", "HOLD"):
                expected_profit += per_capital * em * (r["confidence"] / 100)
            else:
                expected_loss   -= per_capital * em * ((100 - r["confidence"]) / 100)

        win_rate = round(
            sum(1 for r in recs if r["recommendation"] == "BUY") / max(len(recs), 1) * 100, 1
        )

        return {
            "success": True,
            "data": {
                "best_asset":      best["asset"]          if best else None,
                "best_rec":        best["recommendation"] if best else "HOLD",
                "recommendations": recs,
                "expected_profit": round(expected_profit, 2),
                "expected_loss":   round(expected_loss, 2),
                "win_rate":        win_rate,
                "capital":         req.capital,
                "timeframe":       req.timeframe,
            }
        }
    except Exception as e:
        logger.error(f"Strategy holding failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/strategy/simulate")
async def strategy_simulate(req: SimulateRequest):
    try:
        assets = [a.upper() for a in req.assets[:10]]
        result = await strategy_simulator.simulate(assets, req.timeframe, req.capital)
        return {"success": True, "data": result}
    except Exception as e:
        logger.error(f"Strategy simulate failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


# ─── Order Block Detection ─────────────────────────────────────────────────────

class OrderBlockRequest(BaseModel):
    asset:     str = "BTCUSDT"
    timeframe: str = "1h"  # 15m | 1h | 4h | 1d

@router.post("/order-blocks/analyze")
async def analyze_order_blocks(req: OrderBlockRequest):
    try:
        result = await order_block_engine.analyze(req.asset, req.timeframe)
        return result
    except Exception as e:
        logger.error(f"Order block analysis failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))
