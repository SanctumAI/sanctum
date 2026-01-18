"""Web search tool using SearXNG."""

import os
from typing import List

import httpx

from .base import BaseTool, ToolDefinition, ToolResult


class WebSearchTool(BaseTool):
    """SearXNG-powered web search tool."""

    def __init__(self, searxng_url: str | None = None):
        self.searxng_url = searxng_url or os.getenv(
            "SEARXNG_URL", "http://searxng:8080"
        )

    @property
    def definition(self) -> ToolDefinition:
        return ToolDefinition(
            name="web-search",
            description="Search the web for current information using SearXNG",
            parameters={
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "The search query"
                    },
                    "num_results": {
                        "type": "integer",
                        "description": "Number of results to return (default: 5)",
                        "default": 5
                    }
                },
                "required": ["query"]
            }
        )

    async def execute(self, query: str, num_results: int = 5) -> ToolResult:
        """Execute web search via SearXNG API."""
        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(
                    f"{self.searxng_url}/search",
                    params={
                        "q": query,
                        "format": "json",
                        "categories": "general",
                    },
                    timeout=15.0
                )
                response.raise_for_status()
                data = response.json()

            results = []
            for result in data.get("results", [])[:num_results]:
                results.append({
                    "title": result.get("title", ""),
                    "url": result.get("url", ""),
                    "content": result.get("content", ""),
                    "engine": result.get("engine", ""),
                })

            return ToolResult(success=True, data=results)

        except httpx.TimeoutException:
            return ToolResult(
                success=False,
                data=None,
                error="Search request timed out"
            )
        except httpx.HTTPStatusError as e:
            return ToolResult(
                success=False,
                data=None,
                error=f"Search request failed: {e.response.status_code}"
            )
        except Exception as e:
            return ToolResult(
                success=False,
                data=None,
                error=f"Search error: {str(e)}"
            )

    def _format_data(self, data: List[dict]) -> str:
        """Format search results for LLM context."""
        if not data:
            return "No search results found."

        formatted = ["Web search results:\n"]
        for i, result in enumerate(data, 1):
            formatted.append(f"{i}. {result['title']}")
            formatted.append(f"   URL: {result['url']}")
            if result.get('content'):
                formatted.append(f"   {result['content']}")
            formatted.append("")

        return "\n".join(formatted)
