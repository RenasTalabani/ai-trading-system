"""
CoinGecko connector -- wraps the existing MacroDataService (already has the
free, no-key CoinGecko calls) and adapts global market + trending-coin data
into structured RawItems. Official/aggregated data, so these always get the
"official" reliability tier -- never a social/community source.
"""
import logging
from typing import List

from app.services.intel.connectors.base import SourceConnector
from app.services.intel.models import RawItem

logger = logging.getLogger("ai-service.intel.coingecko_source")


class CoinGeckoSourceConnector(SourceConnector):
    name = "CoinGecko"
    source_type = "api"

    def __init__(self, macro_service):
        self._macro = macro_service

    async def fetch(self) -> List[RawItem]:
        items: List[RawItem] = []
        try:
            global_crypto = await self._macro.get_global_crypto()
            if global_crypto:
                items.append(RawItem(
                    source="CoinGecko", source_url="https://api.coingecko.com/api/v3/global",
                    source_type="api", language="en", text="",
                    is_structured_data=True, structured_payload=global_crypto,
                    reliability_tier="official",
                ))
        except Exception as e:
            logger.warning(f"CoinGecko global fetch failed in connector: {e}")

        try:
            trending = await self._macro.get_trending_coins()
            if trending.get("coins"):
                items.append(RawItem(
                    source="CoinGecko", source_url="https://api.coingecko.com/api/v3/search/trending",
                    source_type="api", language="en", text="",
                    is_structured_data=True, structured_payload=trending,
                    reliability_tier="official",
                ))
        except Exception as e:
            logger.warning(f"CoinGecko trending fetch failed in connector: {e}")

        return items
