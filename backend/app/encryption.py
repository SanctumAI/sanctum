"""
Sanctum NIP-04 Encryption Module
Implements Nostr NIP-04 encryption for encrypting sensitive database fields.

Architecture:
- Backend generates ephemeral keypairs and encrypts data to admin pubkey
- Frontend decrypts via NIP-07 extension (window.nostr.nip04.decrypt)
- Uses ECDH shared secret with AES-256-CBC

NIP-04 format: base64(ciphertext) + "?iv=" + base64(iv)
"""

import os
import hmac
import hashlib
import logging
import secrets
from base64 import b64encode, b64decode
from typing import Tuple, Optional

from coincurve import PrivateKey, PublicKey
from Crypto.Cipher import AES
from Crypto.Util.Padding import pad, unpad

logger = logging.getLogger("sanctum.encryption")

# AES-256-CBC block size
AES_BLOCK_SIZE = 16

# Cache the blind index key (derived from SECRET_KEY)
_blind_index_key: Optional[bytes] = None


def _get_blind_index_key() -> bytes:
    """
    Get the key used for computing blind indexes.
    Derived from SECRET_KEY to ensure consistency.
    """
    global _blind_index_key
    if _blind_index_key is None:
        # Import here to avoid circular imports
        from auth import SECRET_KEY
        # Derive a separate key for blind indexing using HKDF-like derivation
        _blind_index_key = hashlib.sha256(
            f"sanctum-blind-index:{SECRET_KEY}".encode()
        ).digest()
    return _blind_index_key


def generate_ephemeral_keypair() -> Tuple[bytes, str]:
    """
    Generate an ephemeral keypair for one-time encryption.

    Returns:
        (private_key_bytes, public_key_hex) tuple
        - private_key_bytes: 32-byte private key (discard after encryption!)
        - public_key_hex: hex-encoded x-only public key (store with ciphertext)
    """
    # Generate random 32-byte private key
    privkey_bytes = secrets.token_bytes(32)
    privkey = PrivateKey(privkey_bytes)

    # Get x-only public key (32 bytes, no prefix)
    # coincurve gives us 33-byte compressed format, we need x-only
    pubkey_compressed = privkey.public_key.format(compressed=True)
    # Remove the prefix byte (02 or 03) to get x-only
    pubkey_x_only = pubkey_compressed[1:]

    return privkey_bytes, pubkey_x_only.hex()


def compute_shared_secret(
    our_privkey_bytes: bytes,
    their_pubkey_hex: str
) -> bytes:
    """
    Compute ECDH shared secret for NIP-04.

    Args:
        our_privkey_bytes: Our 32-byte private key
        their_pubkey_hex: Their x-only public key (hex string)

    Returns:
        32-byte shared secret
    """
    # Validate their pubkey (x-only hex)
    if len(their_pubkey_hex) != 64:
        raise ValueError("Invalid pubkey length (expected 32-byte hex)")
    try:
        bytes.fromhex(their_pubkey_hex)
    except ValueError as e:
        raise ValueError("Invalid pubkey hex") from e

    # Parse their x-only pubkey - need to add prefix for coincurve
    # We assume even y-coordinate (02 prefix) as per BIP-340
    their_pubkey_bytes = bytes.fromhex("02" + their_pubkey_hex)
    their_pubkey = PublicKey(their_pubkey_bytes)

    # Compute ECDH: shared_point = their_pubkey * our_privkey
    shared_point = their_pubkey.multiply(our_privkey_bytes)

    # Extract x-coordinate as shared secret (32 bytes)
    # The shared point is in compressed format (33 bytes with prefix)
    shared_secret = shared_point.format(compressed=True)[1:]

    return shared_secret


def nip04_encrypt(plaintext: str, receiver_pubkey_hex: str) -> Tuple[str, str]:
    """
    Encrypt plaintext using NIP-04 encryption.

    Generates an ephemeral keypair, computes shared secret with receiver,
    and encrypts using AES-256-CBC.

    Args:
        plaintext: The text to encrypt
        receiver_pubkey_hex: Receiver's x-only public key (hex)

    Returns:
        (ciphertext, ephemeral_pubkey) tuple
        - ciphertext: NIP-04 format "base64(encrypted)?iv=base64(iv)"
        - ephemeral_pubkey: hex-encoded x-only pubkey (store with ciphertext)
    """
    # Generate ephemeral keypair
    ephemeral_privkey, ephemeral_pubkey = generate_ephemeral_keypair()

    # Compute shared secret
    shared_secret = compute_shared_secret(ephemeral_privkey, receiver_pubkey_hex)

    # Generate random IV
    iv = secrets.token_bytes(AES_BLOCK_SIZE)

    # Encrypt with AES-256-CBC
    cipher = AES.new(shared_secret, AES.MODE_CBC, iv)
    padded_plaintext = pad(plaintext.encode('utf-8'), AES_BLOCK_SIZE)
    encrypted = cipher.encrypt(padded_plaintext)

    # Format as NIP-04: base64(ciphertext)?iv=base64(iv)
    ciphertext = f"{b64encode(encrypted).decode()}?iv={b64encode(iv).decode()}"

    # Securely discard ephemeral private key (it's only needed once)
    # Python doesn't have secure memory wiping, but we ensure it's not stored
    del ephemeral_privkey

    return ciphertext, ephemeral_pubkey


def nip04_decrypt(
    ciphertext: str,
    sender_pubkey_hex: str,
    receiver_privkey_bytes: bytes
) -> str:
    """
    Decrypt NIP-04 ciphertext.

    Note: This is primarily for testing. In production, decryption happens
    client-side via NIP-07 extension.

    Args:
        ciphertext: NIP-04 format "base64(encrypted)?iv=base64(iv)"
        sender_pubkey_hex: Sender's x-only public key (the ephemeral pubkey)
        receiver_privkey_bytes: Receiver's 32-byte private key

    Returns:
        Decrypted plaintext
    """
    # Parse NIP-04 format
    if "?iv=" not in ciphertext:
        raise ValueError("Invalid NIP-04 ciphertext format")

    encrypted_b64, iv_part = ciphertext.split("?iv=")
    encrypted = b64decode(encrypted_b64)
    iv = b64decode(iv_part)

    # Compute shared secret (same as encryption, just swapped keys)
    shared_secret = compute_shared_secret(receiver_privkey_bytes, sender_pubkey_hex)

    # Decrypt with AES-256-CBC
    cipher = AES.new(shared_secret, AES.MODE_CBC, iv)
    decrypted_padded = cipher.decrypt(encrypted)
    decrypted = unpad(decrypted_padded, AES_BLOCK_SIZE)

    return decrypted.decode('utf-8')


def compute_blind_index(value: str) -> str:
    """
    Compute a blind index (keyed hash) for a value.

    Used for looking up encrypted fields without decrypting them.
    For example, finding a user by email when email is encrypted.

    Args:
        value: The plaintext value to index (will be normalized to lowercase)

    Returns:
        Hex-encoded HMAC-SHA256 hash
    """
    # Normalize: lowercase, strip whitespace
    normalized = value.lower().strip()

    # Compute HMAC-SHA256
    key = _get_blind_index_key()
    h = hmac.new(key, normalized.encode('utf-8'), hashlib.sha256)

    return h.hexdigest()


def serialize_field_value(value: object) -> str:
    """
    Serialize a field value to a string for encryption.

    Supports: str, bool, int, float. Raises for None or unsupported types.
    """
    if value is None:
        raise ValueError("Field value cannot be null")

    if isinstance(value, str):
        return value

    if isinstance(value, bool):
        return "true" if value else "false"

    if isinstance(value, (int, float)):
        return str(value)

    raise ValueError(f"Unsupported field value type: {type(value).__name__}")


def get_admin_pubkey() -> Optional[str]:
    """
    Get the admin's public key from the database.

    Returns:
        Admin's x-only pubkey (hex) or None if no admin exists
    """
    # Import here to avoid circular imports
    import database

    admins = database.list_admins()
    if not admins:
        return None

    # Return the first (and in v1, only) admin's pubkey
    return admins[0]["pubkey"]


def encrypt_for_admin(plaintext: str) -> Tuple[Optional[str], Optional[str]]:
    """
    Encrypt plaintext for the admin.

    Convenience function that gets admin pubkey and encrypts.

    Args:
        plaintext: The text to encrypt

    Returns:
        (ciphertext, ephemeral_pubkey) or (None, None) if no admin exists
    """
    admin_pubkey = get_admin_pubkey()
    if not admin_pubkey:
        logger.warning("Cannot encrypt: no admin pubkey found")
        return None, None

    return nip04_encrypt(plaintext, admin_pubkey)


def encrypt_for_admin_required(plaintext: str) -> Tuple[str, str]:
    """
    Encrypt plaintext for the admin, raising if no admin exists.
    """
    admin_pubkey = get_admin_pubkey()
    if not admin_pubkey:
        raise ValueError("No admin configured for encryption")

    return nip04_encrypt(plaintext, admin_pubkey)


def is_encrypted(value: Optional[str]) -> bool:
    """
    Check if a value appears to be NIP-04 encrypted.

    Args:
        value: The value to check

    Returns:
        True if the value looks like NIP-04 ciphertext
    """
    if not value:
        return False
    return "?iv=" in value and len(value) > 30
