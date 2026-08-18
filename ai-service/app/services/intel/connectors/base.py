"""
SourceConnector -- the interface every source (Telegram channel, API, RSS
feed, future website) implements. Adding a new source means writing one
small connector class and registering it; nothing in the pipeline,
classifier, or storage layer needs to change.
"""
from abc import ABC, abstractmethod
from typing import List

from app.services.intel.models import RawItem


class SourceConnector(ABC):
    name: str = "unnamed_source"
    source_type: str = "api"   # "telegram" | "api" | "rss"

    @abstractmethod
    async def fetch(self) -> List[RawItem]:
        """Return the current batch of content from this source. Must not
        raise on network/parse failure -- return [] and let the pipeline's
        own per-connector try/except be the safety net, but connectors
        should still catch their own known failure modes where practical."""
        raise NotImplementedError
