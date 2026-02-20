"""
LLM Provider Base Class and Factory

Provides an abstract interface for the Maple OpenAI-compatible LLM service.
"""

import os
import logging
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Optional

logger = logging.getLogger("sanctum.llm.provider")


@dataclass
class LLMResponse:
    """Unified response from the configured Maple-backed LLM service."""
    content: str
    model: str
    provider: str
    usage: Optional[dict] = None


class LLMProvider(ABC):
    """Abstract base class for OpenAI-compatible LLM services."""

    @property
    @abstractmethod
    def name(self) -> str:
        """Service identifier (currently always 'maple')."""
        pass

    @abstractmethod
    def health_check(self) -> bool:
        """Check if the service is reachable."""
        pass

    @abstractmethod
    def complete(self, prompt: str, model: Optional[str] = None, temperature: float = 0.1) -> LLMResponse:
        """Generate a completion from the given prompt."""
        pass


def get_provider(provider_name: Optional[str] = None) -> LLMProvider:
    """
    Factory function to get the configured LLM service.

    Args:
        provider_name: Optional service name override.

    Returns:
        Configured LLMProvider instance.
    """
    requested = (provider_name or os.getenv("LLM_PROVIDER", "maple")).strip().lower()
    if requested and requested != "maple":
        logger.warning("Unsupported LLM provider %r requested; forcing maple", requested)

    from .maple import MapleProvider
    return MapleProvider()


def get_maple_provider() -> LLMProvider:
    """Explicit Maple-only provider accessor."""
    return get_provider("maple")
