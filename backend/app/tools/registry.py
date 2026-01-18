"""Tool registry for managing available tools."""

from typing import Dict, List, Optional

from .base import BaseTool


class ToolRegistry:
    """Registry of available tools."""

    def __init__(self):
        self._tools: Dict[str, BaseTool] = {}

    def register(self, tool: BaseTool) -> None:
        """Register a tool in the registry."""
        self._tools[tool.id] = tool

    def get(self, tool_id: str) -> Optional[BaseTool]:
        """Get a tool by its ID."""
        return self._tools.get(tool_id)

    def get_all(self) -> List[BaseTool]:
        """Get all registered tools."""
        return list(self._tools.values())

    def get_definitions(self, tool_ids: Optional[List[str]] = None) -> List[dict]:
        """
        Get OpenAI-format definitions for specified tools.
        If tool_ids is None, returns definitions for all tools.
        """
        if tool_ids is None:
            tools = self._tools.values()
        else:
            tools = [self._tools[tid] for tid in tool_ids if tid in self._tools]

        return [tool.definition.to_openai_format() for tool in tools]

    def has(self, tool_id: str) -> bool:
        """Check if a tool is registered."""
        return tool_id in self._tools

    @property
    def tool_ids(self) -> List[str]:
        """Get list of all registered tool IDs."""
        return list(self._tools.keys())


# Global registry instance
_registry: Optional[ToolRegistry] = None


def get_registry() -> ToolRegistry:
    """Get the global tool registry instance."""
    global _registry
    if _registry is None:
        _registry = ToolRegistry()
    return _registry


def register_tool(tool: BaseTool) -> None:
    """Register a tool in the global registry."""
    get_registry().register(tool)
