"""
Ollama LLM Provider

OpenAI-compatible provider for local Ollama inference.
"""

import os
import threading
from typing import Optional
import httpx
from openai import OpenAI

from .provider import LLMProvider, LLMResponse


class OllamaProvider(LLMProvider):
    """
    Ollama - local LLM inference via OpenAI-compatible API.

    Ollama runs models locally and exposes an OpenAI-compatible
    API at /v1 for chat completions.
    """

    def __init__(self):
        self._lock = threading.RLock()

        # Use config_loader for runtime config, with env fallback
        try:
            from config_loader import get_config
            self.base_url = get_config("LLM_API_URL") or get_config("OLLAMA_BASE_URL") or "http://ollama:11434/v1"
            self.default_model = get_config("LLM_MODEL") or get_config("OLLAMA_MODEL") or "llama3.2"
        except ImportError:
            # Fallback to env vars if config_loader not available
            self.base_url = os.getenv("OLLAMA_BASE_URL", "http://ollama:11434/v1")
            self.default_model = os.getenv("OLLAMA_MODEL", "llama3.2")

        # Initialize OpenAI client with Ollama endpoint
        self._init_client()

    def _init_client(self):
        """Initialize or reinitialize the OpenAI client"""
        # Ollama doesn't need API key but OpenAI client requires one
        self.client = OpenAI(
            base_url=self.base_url,
            api_key="ollama"
        )

    def _refresh_config(self):
        """Refresh config from config_loader if available"""
        with self._lock:
            try:
                from config_loader import get_config
                new_base_url = get_config("LLM_API_URL") or get_config("OLLAMA_BASE_URL") or self.base_url
                new_model = get_config("LLM_MODEL") or get_config("OLLAMA_MODEL") or self.default_model

                # Only reinitialize client if URL changed
                if new_base_url != self.base_url:
                    self.base_url = new_base_url
                    self._init_client()

                self.default_model = new_model
            except ImportError:
                pass

    @property
    def name(self) -> str:
        return "ollama"

    def health_check(self) -> bool:
        """Check if Ollama is reachable via /api/tags"""
        try:
            # Ollama health check at /api/tags - strip trailing /v1 only
            base = self.base_url
            if base.endswith("/v1"):
                base = base[:-3]
            resp = httpx.get(f"{base}/api/tags", timeout=5.0)
            return resp.status_code == 200
        except Exception:
            return False

    def complete(self, prompt: str, model: Optional[str] = None, temperature: float = 0.1, timeout: float = 120.0) -> LLMResponse:
        """Generate completion using Ollama (supports non-streaming)"""
        # Refresh config before each request to pick up runtime changes
        self._refresh_config()

        # Capture references under lock to avoid race conditions
        with self._lock:
            client = self.client
            model = model or self.default_model

        response = client.with_options(timeout=timeout).chat.completions.create(
            model=model,
            messages=[{"role": "user", "content": prompt}],
            temperature=temperature,
            stream=False
        )

        usage = None
        if response.usage:
            usage = {
                "prompt_tokens": response.usage.prompt_tokens,
                "completion_tokens": response.usage.completion_tokens
            }

        return LLMResponse(
            content=response.choices[0].message.content or "",
            model=model,
            provider=self.name,
            usage=usage
        )
