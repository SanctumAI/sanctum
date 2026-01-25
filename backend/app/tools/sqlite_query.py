"""SQLite query tool for admin database access."""

import re
from typing import List, Dict, Any

from .base import BaseTool, ToolDefinition, ToolResult


# Tables that can be queried (same as /admin/db/query endpoint)
ALLOWED_TABLES = {
    'admins', 'instance_settings', 'user_types',
    'user_field_definitions', 'users', 'user_field_values'
}

# Dangerous SQL keywords to block
DANGEROUS_PATTERNS = [
    r'\bDROP\b', r'\bDELETE\b', r'\bINSERT\b', r'\bUPDATE\b',
    r'\bALTER\b', r'\bCREATE\b', r'\bTRUNCATE\b', r'\bATTACH\b',
    r'\bDETACH\b', r'\bPRAGMA\b'
]

# Prompt for text-to-SQL conversion
TEXT_TO_SQL_PROMPT = """You are a SQL query generator for a SQLite database. Convert the natural language question into a SELECT query.

DATABASE SCHEMA:

1. users - Main user records
   Columns: id, pubkey, encrypted_email, ephemeral_pubkey_email, email_blind_index,
            encrypted_name, ephemeral_pubkey_name, email, name, user_type_id,
            approved (1=yes, 0=no), created_at
   Notes:
   - encrypted_* columns store ciphertext (NIP-04)
   - email/name are legacy and always NULL
   - use email_blind_index for exact email lookups
   - pubkey is a Nostr public key (hex string), may be NULL

2. user_types - Categories of users (e.g., "Developer", "Designer")
   Columns: id, name, description, display_order, created_at

3. user_field_definitions - Custom field definitions for user profiles
   Columns: id, field_name, field_type, required, display_order, user_type_id, created_at
   Note: user_type_id NULL means global field shown for all user types

4. user_field_values - Custom field values (EAV pattern)
   Columns: id, user_id, field_id, encrypted_value, ephemeral_pubkey, value
   Notes:
   - encrypted_value stores ciphertext (NIP-04)
   - value is legacy and always NULL
   - Links users to their custom field values via field_id -> user_field_definitions.id

5. admins - Admin accounts (Nostr pubkeys)
   Columns: id, pubkey, created_at

6. instance_settings - Key-value configuration
   Columns: key, value, updated_at
   Common keys: instance_name, primary_color, description, auto_approve_users

COMMON QUERY PATTERNS:

-- List users with names and emails:
SELECT id, encrypted_name, ephemeral_pubkey_name, encrypted_email, ephemeral_pubkey_email, approved, created_at FROM users

-- Get user with their type name:
SELECT u.id, u.encrypted_name, u.ephemeral_pubkey_name, u.encrypted_email, u.ephemeral_pubkey_email, ut.name as user_type FROM users u LEFT JOIN user_types ut ON u.user_type_id = ut.id

-- Get custom field values for users:
SELECT u.encrypted_name, u.ephemeral_pubkey_name, fd.field_name, fv.encrypted_value, fv.ephemeral_pubkey
FROM users u
JOIN user_field_values fv ON u.id = fv.user_id
JOIN user_field_definitions fd ON fv.field_id = fd.id

-- Find a user by email (exact match via blind index):
SELECT id, encrypted_email, ephemeral_pubkey_email, encrypted_name, ephemeral_pubkey_name, approved, created_at
FROM users
WHERE email_blind_index = '<computed_blind_index>'

RULES:
1. Output ONLY the SQL query, no explanations
2. SELECT queries only
3. Always add LIMIT 100 unless counting
4. PII is encrypted: use encrypted_* columns; do NOT use legacy email/name/value
5. When selecting encrypted_* columns, also select their ephemeral_pubkey_* columns
6. Use email_blind_index for exact email lookups when provided
7. For user questions, prefer showing encrypted_name/encrypted_email over pubkey
8. Use JOINs to get human-readable data (e.g., user_type name instead of just user_type_id)

{extra_context}

Question: {question}

SQL:"""


class SQLiteQueryTool(BaseTool):
    """Read-only SQLite query tool for database exploration."""

    @property
    def definition(self) -> ToolDefinition:
        return ToolDefinition(
            name="db-query",
            description="Query the SQLite database using natural language. "
                        f"Available tables: {', '.join(sorted(ALLOWED_TABLES))}",
            parameters={
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Natural language question about the database"
                    }
                },
                "required": ["query"]
            }
        )

    def _validate_query(self, sql: str) -> tuple[bool, str]:
        """Validate that the query is safe to execute."""
        sql = sql.strip()

        # Must be a SELECT query
        if not sql.upper().startswith("SELECT"):
            return False, "Only SELECT queries are allowed"

        # Block dangerous keywords
        for pattern in DANGEROUS_PATTERNS:
            if re.search(pattern, sql, re.IGNORECASE):
                return False, f"Query contains forbidden keyword"

        return True, ""

    def _extract_emails(self, natural_query: str) -> List[str]:
        """Extract email addresses from a natural language query."""
        return re.findall(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}", natural_query)

    def _build_extra_context(self, natural_query: str) -> str:
        """Build extra prompt context (e.g., computed blind indexes)."""
        from encryption import compute_blind_index

        emails = self._extract_emails(natural_query)
        if not emails:
            return ""

        lines = ["EMAIL LOOKUP HELP:", "If the question includes one of these emails, use the blind index for exact matching:"]
        for email in sorted(set(emails)):
            blind_index = compute_blind_index(email)
            lines.append(f"- {email} -> {blind_index}")
        return "\n".join(lines)

    def _generate_sql(self, natural_query: str) -> str:
        """Use LLM to convert natural language to SQL."""
        from llm import get_provider

        provider = get_provider()
        extra_context = self._build_extra_context(natural_query)
        prompt = TEXT_TO_SQL_PROMPT.format(question=natural_query, extra_context=extra_context)
        response = provider.complete(prompt)

        # Extract SQL from response (strip whitespace and any markdown)
        sql = response.content.strip()

        # Remove markdown code blocks if present
        if sql.startswith("```sql"):
            sql = sql[6:]
        if sql.startswith("```"):
            sql = sql[3:]
        if sql.endswith("```"):
            sql = sql[:-3]

        return sql.strip()

    async def execute(self, query: str) -> ToolResult:
        """Execute a natural language query against the database."""
        # Import here to avoid circular imports
        import database

        try:
            # Step 1: Convert natural language to SQL
            sql = self._generate_sql(query)

            # Step 2: Validate the generated SQL
            is_valid, error = self._validate_query(sql)
            if not is_valid:
                return ToolResult(success=False, data=None, error=f"Generated invalid SQL: {error}")

            # Step 3: Execute the query
            conn = database.get_connection()
            cursor = conn.cursor()
            cursor.execute(sql)

            # Get column names
            columns = [desc[0] for desc in cursor.description] if cursor.description else []

            # Fetch all rows (limit to prevent huge results)
            rows = cursor.fetchmany(100)  # Max 100 rows
            cursor.close()

            return ToolResult(
                success=True,
                data={
                    "sql": sql,  # Include generated SQL for transparency
                    "columns": columns,
                    "rows": [dict(zip(columns, row)) for row in rows],
                    "row_count": len(rows),
                    "truncated": len(rows) == 100
                }
            )

        except Exception as e:
            return ToolResult(
                success=False,
                data=None,
                error=f"Query execution failed: {str(e)}"
            )

    def _format_data(self, data: Dict[str, Any]) -> str:
        """Format query results for LLM context."""
        if not data:
            return "Query returned no results."

        lines = []

        # Include the generated SQL for transparency
        if data.get("sql"):
            lines.append(f"Executed SQL: {data['sql']}")
            lines.append("")

        if not data.get("rows"):
            lines.append("Query returned no results.")
            return "\n".join(lines)

        columns = data["columns"]
        rows = data["rows"]

        encrypted_columns = [col for col in columns if col.startswith("encrypted_")]
        if encrypted_columns:
            lines.append(
                "Note: encrypted_* columns are ciphertext. Decrypt client-side with NIP-07 using the matching ephemeral_pubkey_* columns."
            )
            lines.append("")

        # Build formatted table
        lines.append(f"Database query results ({data['row_count']} rows):")

        if data.get("truncated"):
            lines.append("(Results truncated to 100 rows)")

        lines.append("")

        # Header
        lines.append(" | ".join(columns))
        lines.append("-" * (len(" | ".join(columns))))

        # Rows
        for row in rows:
            values = [str(row.get(col, "")) for col in columns]
            lines.append(" | ".join(values))

        return "\n".join(lines)
