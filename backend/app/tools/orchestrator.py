"""Tool orchestrator for executing tools and building context."""

import asyncio
from typing import List, Tuple

from .base import ToolCallInfo, ToolResult
from .registry import ToolRegistry


class ToolOrchestrator:
    """Orchestrates tool execution and context building."""

    def __init__(self, registry: ToolRegistry):
        self.registry = registry

    async def execute_tools(
        self,
        query: str,
        tool_ids: List[str]
    ) -> Tuple[str, List[ToolCallInfo]]:
        """
        Execute selected tools and return formatted context.

        Args:
            query: The user's query to use for tool execution
            tool_ids: List of tool IDs to execute

        Returns:
            Tuple of (formatted context string, list of tool call info)
        """
        if not tool_ids:
            return "", []

        tools_used: List[ToolCallInfo] = []
        results: List[Tuple[str, ToolResult]] = []

        # Execute tools in parallel
        async def run_tool(tool_id: str):
            tool = self.registry.get(tool_id)
            if tool is None:
                return tool_id, ToolResult(
                    success=False,
                    data=None,
                    error=f"Tool '{tool_id}' not found"
                )
            result = await tool.execute(query=query)
            return tool_id, result

        tasks = [run_tool(tid) for tid in tool_ids if self.registry.has(tid)]
        if tasks:
            completed = await asyncio.gather(*tasks, return_exceptions=True)

            for item in completed:
                if isinstance(item, Exception):
                    continue
                tool_id, result = item
                results.append((tool_id, result))

                tool = self.registry.get(tool_id)
                if tool:
                    tools_used.append(ToolCallInfo(
                        tool_id=tool_id,
                        tool_name=tool.definition.name,
                        query=query
                    ))

        # Format results into context
        context = self._format_context(results)

        return context, tools_used

    def _format_context(self, results: List[Tuple[str, ToolResult]]) -> str:
        """Format tool results into context for the LLM."""
        if not results:
            return ""

        context_parts = []

        for tool_id, result in results:
            tool = self.registry.get(tool_id)
            if tool is None:
                continue

            formatted = tool.format_result(result)
            if formatted:
                context_parts.append(formatted)

        if not context_parts:
            return ""

        return "\n\n".join(context_parts)
