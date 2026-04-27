import asyncio
import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.config import get_settings
from app.api.routes import (
    router, market_model, news_model, social_model,
    lstm_model, fusion_model, calibrator, feedback_evaluator, trainer,
    transformer_model, online_learner, drift_detector, model_registry,
)
from app.services.collectors.binance_collector import TRACKED_ASSETS

settings = get_settings()

logging.basicConfig(
    level=getattr(logging, settings.log_level.upper(), logging.INFO),
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("ai-service")


async def auto_train_pipeline():
    """Full training pipeline on startup when no saved models found."""
    try:
        # RF model
        if not market_model.is_trained:
            logger.info("Auto-training RandomForest market model...")
            result = await trainer.train_multi_asset(TRACKED_ASSETS, interval="1h")
            logger.info(f"RF training done: accuracy={result.get('accuracy', 'N/A')}")

        # Transformer model (Phase 8 primary)
        if transformer_model and not transformer_model.is_trained:
            logger.info("Auto-training Transformer model on BTCUSDT...")
            from app.services.data_processor import DataProcessor
            dp = DataProcessor()
            df = await dp.fetch_market_data("BTCUSDT", "1h", limit=1000)
            if df is not None and len(df) >= 100:
                result = transformer_model.train(df, epochs=30)
                logger.info(f"Transformer training done: {result}")
                if result.get("success") and model_registry:
                    model_registry.register(
                        "transformer",
                        file_path=os.path.join(settings.model_path, "transformer.pt"),
                        metrics={
                            "val_accuracy": result.get("val_accuracy"),
                            "sequences":    result.get("sequences"),
                        },
                        notes="auto-train-on-startup",
                    )
            else:
                logger.warning("Insufficient data for Transformer training.")

        # LSTM fallback (if Transformer failed)
        if lstm_model and not lstm_model.is_trained:
            logger.info("Auto-training LSTM fallback model on BTCUSDT...")
            from app.services.data_processor import DataProcessor
            dp = DataProcessor()
            df = await dp.fetch_market_data("BTCUSDT", "1h", limit=1000)
            if df is not None and len(df) >= 80:
                result = lstm_model.train(df, epochs=20)
                logger.info(f"LSTM training done: {result}")

    except Exception as e:
        logger.error(f"Auto-training failed: {e}. Rule-based fallback active.")


async def feedback_evaluation_loop():
    """Background task — evaluates pending signals every 30 minutes."""
    while True:
        await asyncio.sleep(1800)
        try:
            if feedback_evaluator:
                await feedback_evaluator.evaluate_pending()

                if feedback_evaluator.needs_retraining():
                    logger.warning(
                        "Feedback loop: retraining recommended — drift or low win rate detected. "
                        "POST /api/train to retrain."
                    )

                # Log online learner stats
                if online_learner:
                    stats = online_learner.stats()
                    logger.info(f"OnlineLearner: {stats}")

                # Log drift status
                if drift_detector:
                    status = drift_detector.status()
                    if status["drift_level"] != "none":
                        logger.warning(f"DriftDetector: {status}")

        except Exception as e:
            logger.error(f"Feedback loop error: {e}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("AI Trading Intelligence Service v8.0 starting up...")
    os.makedirs(settings.model_path, exist_ok=True)

    asyncio.create_task(auto_train_pipeline())
    asyncio.create_task(feedback_evaluation_loop())

    logger.info(f"Environment: {settings.environment} | Model path: {settings.model_path}")
    logger.info("Phase 8: Transformer + Online Learning + Drift Detection active.")
    yield
    logger.info("AI Service shutting down.")


app = FastAPI(
    title="AI Trading Intelligence Service",
    description=(
        "Phase 8 — Advanced AI: Transformer sequence model, "
        "online learning, model registry, drift detection."
    ),
    version="8.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(Exception)
async def global_exception_handler(request, exc):
    logger.error(f"Unhandled error: {exc}", exc_info=True)
    return JSONResponse(
        status_code=500,
        content={"success": False, "message": "Internal server error"},
    )


@app.get("/health")
async def root_health():
    return {"status": "ok"}

app.include_router(router, prefix="/api")
