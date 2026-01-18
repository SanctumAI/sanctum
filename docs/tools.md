# AI Tools System

Sanctum supports tool calling for the AI chat, allowing the LLM to access external data sources. Tools can be used independently or combined with RAG (knowledge base queries).

## Available Tools

| Tool ID | Name | Description | Access |
|---------|------|-------------|--------|
| `web-search` | Web Search | Search the web via self-hosted SearXNG | All users |
| `db-query` | Database | Execute read-only SQL queries | Admin only |

## Architecture

```
User message + selectedTools
        │
        ▼
┌─────────────────────┐
│  Tool Orchestrator  │
│  - Execute tools    │
│  - Format results   │
└─────────────────────┘
        │
        ▼
┌─────────────────────┐
│  Build Prompt       │
│  - Tool context     │
│  - RAG context (if) │
│  - User message     │
└─────────────────────┘
        │
        ▼
┌─────────────────────┐
│  LLM Provider       │
└─────────────────────┘
```

Tools are executed **before** the LLM call. Results are injected into the prompt as context, following the same pattern as RAG retrieval.

## Usage

### Frontend

In the chat interface, click the **"Web"** button in the toolbar to enable web search. The tool can be used:
- **Alone**: Pure LLM chat with web search context
- **With RAG**: Combined with knowledge base documents

### API

Both `/llm/chat` and `/query` endpoints accept an optional `tools` array:

```bash
# Pure LLM chat with web search
curl -X POST http://localhost:8000/llm/chat \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{
    "message": "What is the latest Bitcoin price?",
    "tools": ["web-search"]
  }'

# RAG + web search combined
curl -X POST http://localhost:8000/query \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{
    "question": "How does this relate to current events?",
    "tools": ["web-search"],
    "top_k": 5
  }'
```

### Response Format

Responses include a `tools_used` array showing which tools were executed:

```json
{
  "message": "Based on current search results...",
  "model": "gpt-oss-120b",
  "provider": "maple",
  "tools_used": [
    {
      "tool_id": "web-search",
      "tool_name": "web-search",
      "query": "Bitcoin price"
    }
  ]
}
```

## SearXNG Configuration

SearXNG is a privacy-respecting metasearch engine that aggregates results from multiple search engines.

### Docker Service

SearXNG runs as a Docker container on the internal network (not exposed to host):

```yaml
# docker-compose.yml
searxng:
  image: searxng/searxng:latest
  container_name: sanctum-searxng
  volumes:
    - ./searxng:/etc/searxng:ro
  environment:
    - SEARXNG_BASE_URL=http://searxng:8080/
```

### Settings

Configuration is in `searxng/settings.yml`:

```yaml
search:
  formats:
    - html
    - json  # Required for API access

server:
  limiter: false  # Disabled for internal use

engines:
  - name: google
    disabled: false
  - name: duckduckgo
    disabled: false
  - name: bing
    disabled: false
  - name: wikipedia
    disabled: false
```

### Environment Variable

The backend connects via:
```
SEARXNG_URL=http://searxng:8080
```

## SQLite Query Tool (Admin Only)

The `db-query` tool allows admins to ask natural language questions about the database. The AI will generate and execute SQL queries, then explain the results.

### Security

This tool is **read-only** with multiple layers of protection:

1. **SELECT Only**: Queries must start with `SELECT`
2. **Dangerous Keywords Blocked**: DROP, DELETE, INSERT, UPDATE, ALTER, CREATE, TRUNCATE, ATTACH, DETACH, PRAGMA
3. **Table Whitelist**: Only allowed tables can be queried:
   - `admins` - Admin accounts
   - `instance_settings` - Instance configuration
   - `user_types` - User type definitions
   - `user_field_definitions` - Custom field schemas
   - `users` - User accounts
   - `user_field_values` - User custom field data
4. **Row Limit**: Results capped at 100 rows
5. **Frontend Gating**: Tool button only visible to authenticated admins

### Usage

The Database tool button only appears in the chat toolbar when logged in as an admin.

Example queries:
- "How many users are registered?"
- "Show me all user types"
- "List the most recent users"

### API

```bash
curl -X POST http://localhost:8000/llm/chat \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <admin-token>" \
  -d '{
    "message": "How many users are in the system?",
    "tools": ["db-query"]
  }'
```

## Adding New Tools

Tools are defined in `backend/app/tools/`. To add a new tool:

### 1. Create Tool Class

```python
# backend/app/tools/my_tool.py
from .base import BaseTool, ToolDefinition, ToolResult

class MyTool(BaseTool):
    @property
    def definition(self) -> ToolDefinition:
        return ToolDefinition(
            name="my-tool",
            description="Description for the LLM",
            parameters={
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "The query"}
                },
                "required": ["query"]
            }
        )

    async def execute(self, query: str) -> ToolResult:
        # Implement tool logic
        try:
            data = await fetch_data(query)
            return ToolResult(success=True, data=data)
        except Exception as e:
            return ToolResult(success=False, data=None, error=str(e))

    def _format_data(self, data) -> str:
        # Format data for LLM context
        return f"Results:\n{data}"
```

### 2. Register Tool

```python
# backend/app/tools/__init__.py
from .my_tool import MyTool

def init_tools() -> ToolRegistry:
    registry = get_registry()
    registry.register(WebSearchTool())
    registry.register(MyTool())  # Add here
    return registry
```

### 3. Add Frontend Button

```typescript
// frontend/src/components/chat/ToolSelector.tsx
const defaultTools: Tool[] = [
  {
    id: 'web-search',
    name: 'Web',
    description: 'Search the web',
    icon: <SearchIcon />,
  },
  {
    id: 'my-tool',
    name: 'My Tool',
    description: 'Description',
    icon: <MyIcon />,
  },
]
```

## File Structure

```
backend/app/tools/
├── __init__.py      # Module exports, init_tools()
├── base.py          # BaseTool, ToolDefinition, ToolResult
├── registry.py      # ToolRegistry, get_registry()
├── orchestrator.py  # ToolOrchestrator
├── web_search.py    # WebSearchTool (SearXNG)
└── sqlite_query.py  # SQLiteQueryTool (admin only)

searxng/
└── settings.yml     # SearXNG configuration
```

## Troubleshooting

### SearXNG not responding

Check if the container is healthy:
```bash
docker compose logs searxng
docker exec sanctum-backend curl -s "http://searxng:8080/search?q=test&format=json"
```

### Tool not appearing in frontend

Ensure the tool ID in `ToolSelector.tsx` matches the tool's `definition.name`.

### 500 errors on /query with tools

Check backend logs for the actual error:
```bash
docker compose logs backend --tail 50
```

Common issues:
- SearXNG not reachable (check network)
- Tool execution timeout (increase httpx timeout)
