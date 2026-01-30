"""
Maple Proxy LLM Provider

OpenAI-compatible provider for Maple's encrypted LLM service.
IMPORTANT: Maple Proxy only supports streaming responses.
"""

import os
import threading
from typing import Optional
import httpx
from openai import OpenAI

from .provider import LLMProvider, LLMResponse


class MapleProvider(LLMProvider):
    """
    Maple Proxy - streaming-only OpenAI-compatible endpoint.

    Maple provides end-to-end encrypted LLM inference via hardware TEEs.
    The proxy exposes an OpenAI-compatible API at /v1.
    """

    def __init__(self):
        self._lock = threading.RLock()

        # Use config_loader for runtime config, with env fallback
        try:
            from ..config_loader import get_config
            self.base_url = get_config("LLM_API_URL") or get_config("MAPLE_BASE_URL") or "http://maple-proxy:8080/v1"
            self.api_key = get_config("LLM_API_KEY") or get_config("MAPLE_API_KEY") or ""
            self.default_model = get_config("LLM_MODEL") or get_config("MAPLE_MODEL") or "kimi-k2-thinking"
        except ImportError:
            # Fallback to env vars if config_loader not available
            # Use same order as try block: LLM_* first, then MAPLE_*
            self.base_url = os.getenv("LLM_API_URL") or os.getenv("MAPLE_BASE_URL", "http://maple-proxy:8080/v1")
            self.api_key = os.getenv("LLM_API_KEY") or os.getenv("MAPLE_API_KEY", "")
            self.default_model = os.getenv("LLM_MODEL") or os.getenv("MAPLE_MODEL", "kimi-k2-thinking")

        # Initialize OpenAI client with Maple endpoint
        self._init_client()

    def _init_client(self):
        """Initialize or reinitialize the OpenAI client"""
        self.client = OpenAI(
            base_url=self.base_url,
            api_key=self.api_key or "not-required"
        )

    def _refresh_config(self):
        """Refresh config from config_loader if available"""
        with self._lock:
            try:
                from ..config_loader import get_config
                new_base_url = get_config("LLM_API_URL") or get_config("MAPLE_BASE_URL") or self.base_url
                new_api_key = get_config("LLM_API_KEY") or get_config("MAPLE_API_KEY") or self.api_key
                new_model = get_config("LLM_MODEL") or get_config("MAPLE_MODEL") or self.default_model

                # Only reinitialize client if URL or key changed
                if new_base_url != self.base_url or new_api_key != self.api_key:
                    self.base_url = new_base_url
                    self.api_key = new_api_key
                    self._init_client()

                self.default_model = new_model
            except Exception as e:
                # Config loader unavailable or failed - keep existing config
                if not isinstance(e, ImportError):
                    import logging
                    logging.getLogger("sanctum.llm.maple").warning(f"Config refresh failed, using cached values: {e}")

    @property
    def name(self) -> str:
        return "maple"

    def health_check(self) -> bool:
        """Check Maple Proxy health endpoint at /health"""
        try:
            # Health endpoint is at base URL without /v1
            base = self.base_url.replace("/v1", "")
            resp = httpx.get(f"{base}/health", timeout=5.0)
            return resp.status_code == 200
        except Exception:
            return False

    def complete(self, prompt: str, model: Optional[str] = None, temperature: float = 0.1) -> LLMResponse:
        """
        Generate completion using Maple Proxy.

        IMPORTANT: Maple requires stream=True - it only supports streaming responses.
        This method collects the streamed chunks into a single response.
        """
        # Refresh config before each request to pick up runtime changes
        self._refresh_config()

        # Capture references under lock to avoid race conditions
        with self._lock:
            client = self.client
            model = model or self.default_model

        # Must use streaming for Maple
        stream = client.chat.completions.create(
            model=model,
            messages=[{"role": "user", "content": prompt}],
            stream=True,
            temperature=temperature,
        )

        # Collect streamed chunks
        content_parts = []
        for chunk in stream:
            if chunk.choices and chunk.choices[0].delta.content:
                content_parts.append(chunk.choices[0].delta.content)

        return LLMResponse(
            content="".join(content_parts),
            model=model,
            provider=self.name,
            usage=None  # Streaming doesn't provide usage stats
        )
