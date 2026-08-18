"""
FRED connector -- wraps MacroDataService.get_fed_snapshot(). Returns no
items at all until FRED_API_KEY is configured (the underlying service call
already no-ops gracefully in that case) -- this connector doesn't need its
own key check, it just reflects whatever the service returns.
"""
import logging
from typing import List

from app.services.intel.connectors.base import SourceConnector
from app.services.intel.models import RawItem

logger = logging.getLogger("ai-service.intel.fred_source")


class FredSourceConnector(SourceConnector):
    name = "FRED"
    source_type = "api"

    def __init__(self, macro_service):
        self._macro = macro_service

    async def fetch(self) -> List[RawItem]:
        try:
            fed = await self._macro.get_fed_snapshot()
        except Exception as e:
            logger.warning(f"FRED fetch failed in connector: {e}")
            return []

        items: List[RawItem] = []
        for key, payload in fed.items():
            if not payload:
                continue
            items.append(RawItem(
                source="FRED", source_url="https://fred.stlouisfed.org/",
                source_type="api", language="en", text="",
                is_structured_data=True, structured_payload={key: payload},
                reliability_tier="official",
            ))
        return items
