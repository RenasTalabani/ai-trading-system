import os
import uvicorn
from app.config import get_settings

settings = get_settings()

if __name__ == "__main__":
    port = int(os.environ.get("PORT", settings.ai_service_port))
    uvicorn.run(
        "app.main:app",
        host=settings.ai_service_host,
        port=port,
        reload=(settings.environment == "development"),
        log_level=settings.log_level.lower(),
        workers=1,
    )
