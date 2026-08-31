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
from app.services.data_processor import DataProcessor

settings = get_settings()

logging.basicConfig(
    level=getattr(logging, settings.log_level.upper(), logging.INFO),
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("ai-service")


async def auto_train_pipeline():
    """Full training pipeline on startup when no saved models found."""
    # T-081 (2026-08-31): transformer_model.train()/lstm_model.train() are
    # real, synchronous, CPU-bound training loops (PyTorch, up to 30
    # epochs) -- calling them directly here, un-awaited, blocked the
    # entire asyncio event loop for their full duration, including
    # trivial handlers like /health. Confirmed live: a fresh container's
    # cold-start auto-training made every request time out for 90+
    # seconds until Railway's edge gave up, reproducibly, on every fresh
    # deploy -- not a one-time cost, since this container had zero cached
    # models and always runs this path on first boot. Same class of bug
    # T-076 already fixed for FinBERT's model load, just a different call
    # site. Fixed the same way: run the blocking call in the default
    # executor thread pool so the event loop stays free the whole time.
    # trainer.train_multi_asset() (RF model, awaited below) already
    # internally makes an equivalent blocking call to
    # market_model.train() -- fixed at its source in trainer.py rather
    # than here, so every caller of it benefits, not just this one.
    loop = asyncio.get_event_loop()
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
                result = await loop.run_in_executor(None, lambda: transformer_model.train(df, epochs=30))
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
                result = await loop.run_in_executor(None, lambda: lstm_model.train(df, epochs=20))
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
    # BUG-002 follow-up: DataProcessor now keeps one shared aiohttp session
    # instead of one per request -- close it cleanly on shutdown rather
    # than leaking its connections when the process exits.
    await DataProcessor.close_session()
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

# allow_credentials=False is intentional, not an oversight: this service is
# called exclusively server-to-server by the backend (see backend/src/
# services/aiService.js, aiWorkerService.js, socialService.js) and has no
# cookie-based auth anywhere in this codebase -- no browser client is meant
# to hold a credentialed session against it. `allow_origins=["*"]` combined
# with `allow_credentials=True` is the CORS anti-pattern that made the
# backend's own ALLOWED_ORIGINS wildcard risky (see backend's CORS
# hardening, 2026-08-18) -- browsers actually reject that combination
# outright, or some CORS stacks silently echo back the request Origin
# instead of "*" to make it spec-compliant, which is more permissive than
# it looks. Fixed here by setting allow_credentials=False, which matches
# how this service is actually used: no cookies, no per-browser session.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
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
