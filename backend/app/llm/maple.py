"""
Maple Proxy LLM Provider

OpenAI-compatible provider for Maple's encrypted LLM service.
IMPORTANT: Maple Proxy only supports streaming responses.
"""

import os
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
        self.base_url = os.getenv("MAPLE_BASE_URL", "http://maple-proxy:8080/v1")
        self.api_key = os.getenv("MAPLE_API_KEY", "")
        self.default_model = os.getenv("MAPLE_MODEL", "gpt-oss-120b")

        # Initialize OpenAI client with Maple endpoint
        self.client = OpenAI(
            base_url=self.base_url,
            api_key=self.api_key or "not-required"
        )

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
        model = model or self.default_model

        # Must use streaming for Maple
        stream = self.client.chat.completions.create(
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
