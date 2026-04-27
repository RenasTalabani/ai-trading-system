from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    # Service
    ai_service_port: int = 8000
    ai_service_host: str = "0.0.0.0"
    environment: str = "development"
    log_level: str = "INFO"

    # Database
    mongodb_uri: str = ""

    # Binance
    binance_api_key: str = ""
    binance_secret_key: str = ""

    # Twitter
    twitter_bearer_token: str = ""

    # Reddit
    reddit_client_id: str = ""
    reddit_client_secret: str = ""
    reddit_user_agent: str = "AiTradingBot/1.0"

    # Telegram
    telegram_bot_token: str = ""

    # Model
    model_path: str = "./saved_models"
    confidence_threshold: int = 70
    max_candles_history: int = 500
    default_interval: str = "1h"
    sentiment_model: str = "ProsusAI/finbert"

    class Config:
        env_file = ".env"
        case_sensitive = False


@lru_cache()
def get_settings() -> Settings:
    return Settings()
