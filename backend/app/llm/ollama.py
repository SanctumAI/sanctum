"""
Ollama LLM Provider

OpenAI-compatible provider for local Ollama inference.
"""

import os
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
        self.base_url = os.getenv("OLLAMA_BASE_URL", "http://ollama:11434/v1")
        self.default_model = os.getenv("OLLAMA_MODEL", "llama3.2")

        # Ollama doesn't need API key but OpenAI client requires one
        self.client = OpenAI(
            base_url=self.base_url,
            api_key="ollama"
        )

    @property
    def name(self) -> str:
        return "ollama"

    def health_check(self) -> bool:
        """Check if Ollama is reachable via /api/tags"""
        try:
            # Ollama health check at /api/tags
            base = self.base_url.replace("/v1", "")
            resp = httpx.get(f"{base}/api/tags", timeout=5.0)
            return resp.status_code == 200
        except Exception:
            return False

    def complete(self, prompt: str, model: Optional[str] = None) -> LLMResponse:
        """Generate completion using Ollama (supports non-streaming)"""
        model = model or self.default_model

        response = self.client.chat.completions.create(
            model=model,
            messages=[{"role": "user", "content": prompt}],
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
