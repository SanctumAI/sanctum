"""Base classes for tool definitions and execution."""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, Optional


@dataclass
class ToolDefinition:
    """Definition of a tool in OpenAI-compatible format."""

    name: str
    description: str
    parameters: dict = field(default_factory=lambda: {
        "type": "object",
        "properties": {},
        "required": []
    })

    def to_openai_format(self) -> dict:
        """Convert to OpenAI function calling format."""
        return {
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": self.parameters,
            }
        }


@dataclass
class ToolResult:
    """Result from executing a tool."""

    success: bool
    data: Any
    error: Optional[str] = None

    def __bool__(self) -> bool:
        return self.success


@dataclass
class ToolCallInfo:
    """Information about a tool that was called."""

    tool_id: str
    tool_name: str
    query: Optional[str] = None


class BaseTool(ABC):
    """Abstract base class for all tools."""

    @property
    @abstractmethod
    def definition(self) -> ToolDefinition:
        """Return the tool's definition."""
        pass

    @property
    def id(self) -> str:
        """Return the tool's ID (defaults to definition name)."""
        return self.definition.name

    @abstractmethod
    async def execute(self, **kwargs) -> ToolResult:
        """Execute the tool with given arguments."""
        pass

    def format_result(self, result: ToolResult) -> str:
        """Format the tool result for injection into LLM context."""
        if not result.success:
            return f"[{self.definition.name} error: {result.error}]"
        return self._format_data(result.data)

    def _format_data(self, data: Any) -> str:
        """Override this to customize data formatting."""
        return str(data)
