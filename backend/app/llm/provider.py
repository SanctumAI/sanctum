"""
LLM Provider Base Class and Factory

Provides an abstract interface for OpenAI-compatible LLM providers.
"""

import os
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Optional


@dataclass
class LLMResponse:
    """Unified response from any LLM provider"""
    content: str
    model: str
    provider: str
    usage: Optional[dict] = None


class LLMProvider(ABC):
    """Abstract base class for OpenAI-compatible LLM providers"""

    @property
    @abstractmethod
    def name(self) -> str:
        """Provider identifier (e.g., 'maple', 'ollama')"""
        pass

    @abstractmethod
    def health_check(self) -> bool:
        """Check if the provider is reachable"""
        pass

    @abstractmethod
    def complete(self, prompt: str, model: Optional[str] = None) -> LLMResponse:
        """Generate a completion from the given prompt"""
        pass


def get_provider(provider_name: Optional[str] = None) -> LLMProvider:
    """
    Factory function to get the configured LLM provider.

    Args:
        provider_name: Provider to use. Defaults to LLM_PROVIDER env var or 'maple'.

    Returns:
        Configured LLMProvider instance.

    Raises:
        ValueError: If provider name is unknown.
    """
    name = provider_name or os.getenv("LLM_PROVIDER", "maple")

    if name == "maple":
        from .maple import MapleProvider
        return MapleProvider()
    elif name == "ollama":
        from .ollama import OllamaProvider
        return OllamaProvider()
    else:
        raise ValueError(f"Unknown LLM provider: {name}")
