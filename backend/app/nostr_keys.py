"""
Nostr key utilities (npub/hex normalization).
"""

import re
from bech32 import bech32_decode, convertbits

_HEX_PUBKEY_RE = re.compile(r"^[0-9a-f]{64}$")


def is_hex_pubkey(pubkey: str) -> bool:
    """Return True if the string is a 32-byte hex pubkey."""
    return bool(_HEX_PUBKEY_RE.match(pubkey.lower()))


def decode_npub(npub: str) -> str:
    """Decode npub (bech32) to hex pubkey."""
    hrp, data = bech32_decode(npub)
    if hrp != "npub" or data is None:
        raise ValueError("Invalid npub")

    decoded = convertbits(data, 5, 8, False)
    if decoded is None:
        raise ValueError("Invalid npub data")

    raw = bytes(decoded)
    if len(raw) != 32:
        raise ValueError("Invalid npub length")

    return raw.hex()


def normalize_pubkey(pubkey: str) -> str:
    """Normalize a pubkey as 32-byte hex (accepts npub or hex)."""
    key = pubkey.strip().lower() if pubkey else ""
    if not key:
        raise ValueError("Missing pubkey")
    if key.startswith("npub"):
        return decode_npub(key)

    if is_hex_pubkey(key):
        return key

    raise ValueError("Invalid pubkey format")
