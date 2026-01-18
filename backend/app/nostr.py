"""
Nostr Event Verification Module
Implements BIP-340 Schnorr signature verification for Nostr events.
"""

import hashlib
import json
import time
import logging
from typing import Tuple

from coincurve import PublicKeyXOnly

logger = logging.getLogger("sanctum.nostr")

# Sanctum admin auth event kind
AUTH_EVENT_KIND = 22242

# Maximum age for auth events (5 minutes)
MAX_EVENT_AGE_SECONDS = 300


def compute_event_id(event: dict) -> str:
    """
    Compute the event ID (sha256 of serialized event).

    Per NIP-01, the ID is the sha256 hash of the serialized event:
    [0, pubkey, created_at, kind, tags, content]
    """
    serialized = json.dumps([
        0,                       # reserved for future use
        event["pubkey"],         # pubkey as hex string
        event["created_at"],     # unix timestamp
        event["kind"],           # event kind
        event["tags"],           # array of tags
        event["content"],        # content string
    ], separators=(',', ':'), ensure_ascii=False)

    return hashlib.sha256(serialized.encode('utf-8')).hexdigest()


def verify_event_signature(event: dict) -> bool:
    """
    Verify a Nostr event signature using BIP-340 Schnorr.

    Args:
        event: Nostr event with pubkey, id, sig, and other fields

    Returns:
        True if signature is valid, False otherwise
    """
    try:
        # 1. Verify the event ID matches computed hash
        computed_id = compute_event_id(event)
        if computed_id != event["id"]:
            logger.warning(f"Event ID mismatch: computed={computed_id}, got={event['id']}")
            return False

        # 2. Parse the public key (32 bytes, x-only)
        pubkey_bytes = bytes.fromhex(event["pubkey"])
        if len(pubkey_bytes) != 32:
            logger.warning(f"Invalid pubkey length: {len(pubkey_bytes)}")
            return False

        # 3. Parse the signature (64 bytes)
        sig_bytes = bytes.fromhex(event["sig"])
        if len(sig_bytes) != 64:
            logger.warning(f"Invalid signature length: {len(sig_bytes)}")
            return False

        # 4. Get the message (event ID as bytes)
        msg_bytes = bytes.fromhex(event["id"])

        # 5. Verify using coincurve's x-only pubkey (BIP-340 Schnorr)
        pubkey = PublicKeyXOnly(pubkey_bytes)
        return pubkey.verify(sig_bytes, msg_bytes)

    except Exception as e:
        logger.error(f"Signature verification error: {e}")
        return False


def verify_auth_event(event: dict) -> Tuple[bool, str]:
    """
    Verify a Sanctum admin auth event.

    Checks:
    1. Event kind is AUTH_EVENT_KIND (22242)
    2. Timestamp is within MAX_EVENT_AGE_SECONDS
    3. Has valid action tag
    4. Signature is valid

    Args:
        event: The signed Nostr event

    Returns:
        (success, error_message) tuple
    """
    # 1. Check event kind
    if event.get("kind") != AUTH_EVENT_KIND:
        return False, f"Invalid event kind: expected {AUTH_EVENT_KIND}, got {event.get('kind')}"

    # 2. Check timestamp (allow MAX_EVENT_AGE_SECONDS window)
    now = int(time.time())
    created_at = event.get("created_at", 0)
    age = abs(now - created_at)
    if age > MAX_EVENT_AGE_SECONDS:
        return False, f"Event timestamp out of range: {age}s old (max {MAX_EVENT_AGE_SECONDS}s)"

    # 3. Check required tags
    tags = event.get("tags", [])
    action_tag = None

    for tag in tags:
        if len(tag) >= 2 and tag[0] == "action":
            action_tag = tag[1]
            break

    if action_tag != "admin_auth":
        return False, f"Invalid or missing action tag: expected 'admin_auth', got '{action_tag}'"

    # 4. Verify signature
    if not verify_event_signature(event):
        return False, "Invalid signature"

    return True, ""


def get_pubkey_from_event(event: dict) -> str:
    """Extract the pubkey from a verified event."""
    return event.get("pubkey", "")
