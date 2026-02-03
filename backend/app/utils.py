"""
Sanctum Shared Utilities

Common utility functions used across multiple modules.
"""


def sanitize_profile_value(value: str) -> str:
    """
    Sanitize user profile values before prompt interpolation.
    Collapses newlines and normalizes whitespace to prevent prompt structure breakage.
    """
    if not isinstance(value, str):
        value = str(value)
    return " ".join(value.split())
