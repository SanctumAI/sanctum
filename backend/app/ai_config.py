"""
Sanctum AI Configuration Router
Handles AI/LLM settings including prompt templates, parameters, and session defaults.
"""

import json
import logging
from fastapi import APIRouter, HTTPException, Depends

import auth
import database
from models import (
    AIConfigItem,
    AIConfigResponse,
    AIConfigUpdate,
    AIConfigWithInheritance,
    AIConfigUserTypeResponse,
    AIConfigOverrideUpdate,
    PromptPreviewRequest,
    PromptPreviewResponse,
)

logger = logging.getLogger("sanctum.ai_config")

router = APIRouter(prefix="/admin/ai-config", tags=["ai-config"])


def _config_to_item(config: dict) -> AIConfigItem:
    """Convert database row to AIConfigItem"""
    return AIConfigItem(
        key=config["key"],
        value=config["value"],
        value_type=config["value_type"],
        category=config["category"],
        description=config.get("description"),
        updated_at=config.get("updated_at"),
    )


def _config_to_inheritance_item(config: dict) -> AIConfigWithInheritance:
    """Convert database row to AIConfigWithInheritance"""
    return AIConfigWithInheritance(
        key=config["key"],
        value=config["value"],
        value_type=config["value_type"],
        category=config["category"],
        description=config.get("description"),
        updated_at=config.get("updated_at"),
        is_override=config.get("is_override", False),
        override_user_type_id=config.get("override_user_type_id"),
    )


@router.get("", response_model=AIConfigResponse)
async def get_ai_config(admin: dict = Depends(auth.require_admin)):
    """
    Get all AI configuration grouped by category.
    Requires admin authentication.
    """
    all_config = database.get_all_ai_config()

    response = AIConfigResponse()
    for config in all_config:
        item = _config_to_item(config)
        if config["category"] == "prompt_section":
            response.prompt_sections.append(item)
        elif config["category"] == "parameter":
            response.parameters.append(item)
        elif config["category"] == "default":
            response.defaults.append(item)

    return response


@router.get("/{key}", response_model=AIConfigItem)
async def get_ai_config_by_key(key: str, admin: dict = Depends(auth.require_admin)):
    """
    Get a single AI config value by key.
    Requires admin authentication.
    """
    config = database.get_ai_config(key)
    if not config:
        raise HTTPException(status_code=404, detail=f"Config key not found: {key}")

    return _config_to_item(config)


@router.put("/{key}", response_model=AIConfigItem)
async def update_ai_config_value(
    key: str,
    update: AIConfigUpdate,
    admin: dict = Depends(auth.require_admin)
):
    """
    Update an AI config value.
    Requires admin authentication.
    """
    # Verify key exists
    existing = database.get_ai_config(key)
    if not existing:
        raise HTTPException(status_code=404, detail=f"Config key not found: {key}")

    # Null check first - value cannot be null
    if update.value is None:
        raise HTTPException(status_code=400, detail="Value cannot be null")

    # Validate value based on type
    value_type = existing["value_type"]
    try:
        if value_type == "number":
            float(update.value)  # Validate it's a number
        elif value_type == "boolean":
            if update.value.lower() not in ("true", "false"):
                raise ValueError("Boolean must be 'true' or 'false'")
        elif value_type == "json":
            parsed = json.loads(update.value)  # Validate it's valid JSON
            # Additional validation for list-type keys
            if key in {"prompt_rules", "prompt_forbidden"}:
                if not isinstance(parsed, list):
                    raise ValueError(f"{key} must be a JSON array")
                if not all(isinstance(item, str) for item in parsed):
                    raise ValueError(f"{key} must be an array of strings")
    except (ValueError, json.JSONDecodeError, AttributeError) as e:
        logger.warning(f"Invalid value for type {value_type}: {e}")
        raise HTTPException(
            status_code=400,
            detail=f"Invalid value for type '{value_type}': {str(e)}" if key in {"prompt_rules", "prompt_forbidden"} else f"Invalid value for type '{value_type}'"
        )

    # Additional validation for specific keys
    try:
        if key == "temperature":
            temp = float(update.value)
            if temp < 0.0 or temp > 1.0:
                raise HTTPException(
                    status_code=400,
                    detail="Temperature must be between 0.0 and 1.0"
                )
        elif key == "top_k":
            top_k_float = float(update.value)
            if not top_k_float.is_integer():
                raise HTTPException(
                    status_code=400,
                    detail="Top-K must be a whole number"
                )
            top_k = int(top_k_float)
            if top_k < 1 or top_k > 100:
                raise HTTPException(
                    status_code=400,
                    detail="Top-K must be between 1 and 100"
                )
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Invalid numeric value for {key}")

    # Validate prompt sections length
    if existing["category"] == "prompt_section" and len(update.value) > 5000:
        raise HTTPException(
            status_code=400,
            detail="Prompt section must be 5000 characters or less"
        )

    # Get admin pubkey for audit log - fail if missing (auth integrity check)
    admin_pubkey = admin.get("pubkey")
    if not admin_pubkey:
        logger.error("Admin pubkey missing from authenticated context")
        raise HTTPException(status_code=500, detail="Authentication context incomplete")

    # Update the config
    success = database.update_ai_config(key, update.value, changed_by=admin_pubkey)
    if not success:
        raise HTTPException(status_code=500, detail="Failed to update config")

    # Return updated config
    updated = database.get_ai_config(key)
    if not updated:
        raise HTTPException(status_code=500, detail="Config updated but could not be retrieved")
    return _config_to_item(updated)


@router.get("/user-type/{user_type_id}", response_model=AIConfigUserTypeResponse)
async def get_ai_config_for_user_type(
    user_type_id: int,
    admin: dict = Depends(auth.require_admin)
):
    """
    Get AI configuration with inheritance applied for a user type.
    Shows which values are overridden vs inherited from global defaults.
    Requires admin authentication.
    """
    # Verify user type exists
    user_type = database.get_user_type(user_type_id)
    if not user_type:
        raise HTTPException(status_code=404, detail=f"User type not found: {user_type_id}")

    # Get effective config with inheritance
    effective_config = database.get_effective_ai_config(user_type_id)

    response = AIConfigUserTypeResponse(
        user_type_id=user_type_id,
        user_type_name=user_type.get("name"),
    )

    for config in effective_config:
        item = _config_to_inheritance_item(config)
        if config["category"] == "prompt_section":
            response.prompt_sections.append(item)
        elif config["category"] == "parameter":
            response.parameters.append(item)
        elif config["category"] == "default":
            response.defaults.append(item)

    return response


@router.put("/user-type/{user_type_id}/{key}", response_model=AIConfigWithInheritance)
async def set_ai_config_override(
    user_type_id: int,
    key: str,
    update: AIConfigOverrideUpdate,
    admin: dict = Depends(auth.require_admin)
):
    """
    Set an AI config override for a user type.
    This value will override the global default for users of this type.
    Requires admin authentication.
    """
    # Verify user type exists
    user_type = database.get_user_type(user_type_id)
    if not user_type:
        raise HTTPException(status_code=404, detail=f"User type not found: {user_type_id}")

    # Verify config key exists in global config
    existing = database.get_ai_config(key)
    if not existing:
        raise HTTPException(status_code=404, detail=f"Config key not found: {key}")

    # Validate value is not null
    if update.value is None:
        raise HTTPException(status_code=400, detail="Value cannot be null")

    # Validate value based on type (same logic as global update)
    value_type = existing["value_type"]
    try:
        if value_type == "number":
            float(update.value)
        elif value_type == "boolean":
            if update.value.lower() not in ("true", "false"):
                raise ValueError("Boolean must be 'true' or 'false'")
        elif value_type == "json":
            parsed = json.loads(update.value)
            if key in {"prompt_rules", "prompt_forbidden"}:
                if not isinstance(parsed, list):
                    raise ValueError(f"{key} must be a JSON array")
                if not all(isinstance(item, str) for item in parsed):
                    raise ValueError(f"{key} must be an array of strings")
    except (ValueError, json.JSONDecodeError, AttributeError) as e:
        logger.warning(f"Invalid override value for type {value_type}: {e}")
        raise HTTPException(
            status_code=400,
            detail=f"Invalid value for type '{value_type}': {str(e)}" if key in {"prompt_rules", "prompt_forbidden"} else f"Invalid value for type '{value_type}'"
        )

    # Additional validation for specific keys
    try:
        if key == "temperature":
            temp = float(update.value)
            if temp < 0.0 or temp > 1.0:
                raise HTTPException(status_code=400, detail="Temperature must be between 0.0 and 1.0")
        elif key == "top_k":
            top_k_float = float(update.value)
            if not top_k_float.is_integer():
                raise HTTPException(status_code=400, detail="Top-K must be a whole number")
            top_k = int(top_k_float)
            if top_k < 1 or top_k > 100:
                raise HTTPException(status_code=400, detail="Top-K must be between 1 and 100")
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Invalid numeric value for {key}")

    # Validate prompt sections length
    if existing["category"] == "prompt_section" and len(update.value) > 5000:
        raise HTTPException(status_code=400, detail="Prompt section must be 5000 characters or less")

    # Get admin pubkey for audit log
    admin_pubkey = admin.get("pubkey")
    if not admin_pubkey:
        logger.error("Admin pubkey missing from authenticated context")
        raise HTTPException(status_code=500, detail="Authentication context incomplete")

    # Create/update the override
    success = database.upsert_ai_config_override(key, user_type_id, update.value, changed_by=admin_pubkey)
    if not success:
        raise HTTPException(status_code=500, detail="Failed to create/update override")

    # Return updated config item with inheritance info
    return AIConfigWithInheritance(
        key=key,
        value=update.value,
        value_type=existing["value_type"],
        category=existing["category"],
        description=existing.get("description"),
        is_override=True,
        override_user_type_id=user_type_id,
    )


@router.delete("/user-type/{user_type_id}/{key}")
async def delete_ai_config_override(
    user_type_id: int,
    key: str,
    admin: dict = Depends(auth.require_admin)
):
    """
    Remove an AI config override for a user type (revert to global default).
    Requires admin authentication.
    """
    # Verify user type exists
    user_type = database.get_user_type(user_type_id)
    if not user_type:
        raise HTTPException(status_code=404, detail=f"User type not found: {user_type_id}")

    # Get admin pubkey for audit log - fail if missing (auth integrity check)
    admin_pubkey = admin.get("pubkey")
    if not admin_pubkey:
        logger.error("Admin pubkey missing from authenticated context")
        raise HTTPException(status_code=500, detail="Authentication context incomplete")

    # Delete the override
    deleted = database.delete_ai_config_override(key, user_type_id, changed_by=admin_pubkey)

    if not deleted:
        raise HTTPException(status_code=404, detail=f"No override found for key '{key}' and user type {user_type_id}")

    return {"success": True, "message": f"Override for '{key}' reverted to global default"}


@router.post("/user-type/{user_type_id}/prompts/preview", response_model=PromptPreviewResponse)
async def preview_prompt_for_user_type(
    user_type_id: int,
    request: PromptPreviewRequest,
    admin: dict = Depends(auth.require_admin)
):
    """
    Preview assembled prompt with sample data for a specific user type.
    Shows how the prompt appears with user-type overrides applied.
    Requires admin authentication.
    """
    # Verify user type exists
    user_type = database.get_user_type(user_type_id)
    if not user_type:
        raise HTTPException(status_code=404, detail=f"User type not found: {user_type_id}")

    # Get prompt sections with inheritance for this user type
    prompt_sections = get_prompt_sections(user_type_id=user_type_id)

    # Build the assembled prompt (same logic as global preview)
    parts = []
    sections_used = list(prompt_sections.keys())

    # Known facts section
    if request.sample_facts:
        facts_lines = [f"  - {k}: {v}" for k, v in request.sample_facts.items() if v]
        if facts_lines:
            parts.append("=== CONFIRMED FACTS (do NOT re-ask these) ===")
            parts.append("\n".join(facts_lines))
        else:
            parts.append("=== NO FACTS CONFIRMED YET ===")
            parts.append("Ask about location and context early, but only once per conversation.")

    # Tone section
    if prompt_sections.get("prompt_tone"):
        parts.append("")
        parts.append("=== STYLE ===")
        parts.append(prompt_sections["prompt_tone"])

    # Rules section
    rules = prompt_sections.get("prompt_rules", [])
    if rules:
        parts.append("")
        parts.append("=== RULES ===")
        for i, rule in enumerate(rules, 1):
            parts.append(f"{i}. {rule}")

    # Forbidden topics
    forbidden = prompt_sections.get("prompt_forbidden", [])
    if forbidden:
        parts.append("")
        parts.append("=== FORBIDDEN TOPICS ===")
        parts.append("If asked about these topics, politely decline:")
        for topic in forbidden:
            parts.append(f"- {topic}")

    # Question
    parts.append("")
    parts.append("=== QUESTION ===")
    parts.append(request.sample_question)

    parts.append("")
    parts.append("=== RESPOND ===")

    assembled = "\n".join(parts)

    return PromptPreviewResponse(
        assembled_prompt=assembled,
        sections_used=sections_used
    )


@router.post("/prompts/preview", response_model=PromptPreviewResponse)
async def preview_prompt(
    request: PromptPreviewRequest,
    admin: dict = Depends(auth.require_admin)
):
    """
    Preview assembled prompt with sample data.
    Shows how the prompt sections combine into the final system prompt.
    Requires admin authentication.
    """
    # Get prompt sections from config
    prompt_sections = database.get_ai_config_by_category("prompt_section")

    # Build sections dict
    sections = {}
    sections_used = []
    for config in prompt_sections:
        key = config["key"]
        value = config["value"]
        value_type = config["value_type"]

        # Parse JSON values
        if value_type == "json":
            try:
                value = json.loads(value)
            except json.JSONDecodeError:
                value = []

        sections[key] = value
        sections_used.append(key)

    # Build the assembled prompt
    parts = []

    # Known facts section
    if request.sample_facts:
        facts_lines = [f"  - {k}: {v}" for k, v in request.sample_facts.items() if v]
        if facts_lines:
            parts.append("=== CONFIRMED FACTS (do NOT re-ask these) ===")
            parts.append("\n".join(facts_lines))
        else:
            parts.append("=== NO FACTS CONFIRMED YET ===")
            parts.append("Ask about location and context early, but only once per conversation.")

    # Tone section
    if sections.get("prompt_tone"):
        parts.append("")
        parts.append("=== STYLE ===")
        parts.append(sections["prompt_tone"])

    # Rules section
    rules = sections.get("prompt_rules", [])
    if rules:
        parts.append("")
        parts.append("=== RULES ===")
        for i, rule in enumerate(rules, 1):
            parts.append(f"{i}. {rule}")

    # Forbidden topics
    forbidden = sections.get("prompt_forbidden", [])
    if forbidden:
        parts.append("")
        parts.append("=== FORBIDDEN TOPICS ===")
        parts.append("If asked about these topics, politely decline:")
        for topic in forbidden:
            parts.append(f"- {topic}")

    # Question
    parts.append("")
    parts.append("=== QUESTION ===")
    parts.append(request.sample_question)

    parts.append("")
    parts.append("=== RESPOND ===")

    assembled = "\n".join(parts)

    return PromptPreviewResponse(
        assembled_prompt=assembled,
        sections_used=sections_used
    )


# Helper functions for use by other modules

def get_prompt_sections(user_type_id: int | None = None) -> dict:
    """
    Get all prompt sections as a dictionary.
    Used by query.py to build prompts.

    Args:
        user_type_id: If provided, returns values with user-type overrides applied.
    """
    if user_type_id is not None:
        # Use inheritance-aware query
        all_config = database.get_effective_ai_config(user_type_id)
        prompt_configs = [c for c in all_config if c["category"] == "prompt_section"]
    else:
        prompt_configs = database.get_ai_config_by_category("prompt_section")

    sections = {}

    for config in prompt_configs:
        key = config["key"]
        value = config["value"]
        value_type = config["value_type"]

        # Parse JSON values
        if value_type == "json":
            try:
                value = json.loads(value)
            except json.JSONDecodeError:
                # Explicit mapping of JSON keys that should default to list
                list_keys = {"prompt_rules", "prompt_forbidden"}
                value = [] if key in list_keys else ""

        sections[key] = value

    return sections


def get_llm_parameters(user_type_id: int | None = None) -> dict:
    """
    Get LLM parameters (temperature, top_k, etc).
    Returns parsed values.

    Args:
        user_type_id: If provided, returns values with user-type overrides applied.
    """
    if user_type_id is not None:
        all_config = database.get_effective_ai_config(user_type_id)
        params = [c for c in all_config if c["category"] == "parameter"]
    else:
        params = database.get_ai_config_by_category("parameter")

    result = {}

    for config in params:
        key = config["key"]
        value = config["value"]
        value_type = config["value_type"]

        if value_type == "number":
            try:
                result[key] = float(value)
            except (ValueError, TypeError):
                logger.warning(f"Invalid numeric value for config key {key}: {value}")
                # Provide safe defaults for critical parameters instead of omitting
                critical_defaults = {"temperature": 0.7, "top_k": 40, "max_tokens": 2048}
                if key in critical_defaults:
                    result[key] = critical_defaults[key]
                    logger.warning(f"Using default value {critical_defaults[key]} for {key}")
                continue
        else:
            result[key] = value

    return result


def get_session_defaults(user_type_id: int | None = None) -> dict:
    """
    Get session default settings (web_search_default, etc).
    Returns parsed values.

    Args:
        user_type_id: If provided, returns values with user-type overrides applied.
    """
    if user_type_id is not None:
        all_config = database.get_effective_ai_config(user_type_id)
        defaults = [c for c in all_config if c["category"] == "default"]
    else:
        defaults = database.get_ai_config_by_category("default")

    result = {}

    for config in defaults:
        key = config["key"]
        value = config["value"]
        value_type = config["value_type"]

        try:
            if value_type == "boolean":
                result[key] = value.lower() == "true" if value else False
            elif value_type == "number":
                result[key] = float(value)
            else:
                result[key] = value
        except (ValueError, TypeError, AttributeError) as e:
            logger.warning(f"Invalid value for config key {key}: {value} - {e}")
            continue

    return result


def build_chat_prompt(
    message: str,
    context: str = "",
    user_type_id: int | None = None,
    user_profile_context: dict[str, str] | None = None
) -> str:
    """
    Build a chat prompt using AI config settings.
    Assembles the prompt from configured sections.

    Args:
        message: The user's message/question
        context: Optional tool context (search results, database results, etc.)
        user_type_id: If provided, uses user-type-specific prompt sections.
        user_profile_context: Optional dict of {field_name: value} for user profile
            data to include in the prompt for personalization.

    Returns:
        Assembled prompt string for the LLM
    """
    sections = get_prompt_sections(user_type_id=user_type_id)
    parts = []

    # Style/tone section
    if sections.get("prompt_tone"):
        parts.append("=== STYLE ===")
        parts.append(sections["prompt_tone"])

    # User profile section (if any profile data is available)
    if user_profile_context:
        parts.append("")
        parts.append("=== USER PROFILE ===")
        parts.append("The following information is known about the user:")
        for field_name, value in user_profile_context.items():
            parts.append(f"- {field_name}: {value}")

    # Rules section
    rules = sections.get("prompt_rules", [])
    if rules:
        parts.append("")
        parts.append("=== RULES ===")
        for i, rule in enumerate(rules, 1):
            parts.append(f"{i}. {rule}")

    # Forbidden topics
    forbidden = sections.get("prompt_forbidden", [])
    if forbidden:
        parts.append("")
        parts.append("=== FORBIDDEN TOPICS ===")
        parts.append("If asked about these topics, politely decline:")
        for topic in forbidden:
            parts.append(f"- {topic}")

    # Context from tools (if provided)
    if context:
        parts.append("")
        parts.append("=== REFERENCE INFORMATION ===")
        parts.append("Use the following information to help answer the question:")
        parts.append(context)

    # The question
    parts.append("")
    parts.append("=== QUESTION ===")
    parts.append(message)

    parts.append("")
    parts.append("=== RESPOND ===")

    return "\n".join(parts)
