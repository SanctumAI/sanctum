/**
 * NIP-04 Decryption Utilities
 * Uses the browser's NIP-07 extension (Alby, nos2x, etc.) to decrypt data.
 *
 * The backend encrypts sensitive data using ephemeral keypairs to the admin pubkey.
 * The admin can decrypt via their NIP-07 extension.
 */

import type { WindowNostr } from 'nostr-tools/nip07'

// Extend window type for NIP-07 (WindowNostr already includes nip04 support)
declare global {
  interface Window {
    nostr?: WindowNostr
  }
}

export interface EncryptedField {
  ciphertext: string // NIP-04 format: base64(encrypted)?iv=base64(iv)
  ephemeral_pubkey: string // x-only pubkey (hex) for ECDH
}

/**
 * Check if NIP-04 decryption is supported by the browser extension.
 */
export function hasNip04Support(): boolean {
  return (
    typeof window.nostr !== 'undefined' &&
    typeof window.nostr.nip04?.decrypt === 'function'
  )
}

/**
 * Decrypt a NIP-04 encrypted field using the browser extension.
 *
 * @param encrypted - The encrypted field data from the API
 * @returns The decrypted plaintext, or null if decryption fails
 */
export async function decryptField(
  encrypted: EncryptedField | null | undefined
): Promise<string | null> {
  if (!encrypted) {
    return null
  }

  if (!hasNip04Support()) {
    console.warn('NIP-04 decryption not available (no extension or no nip04 support)')
    return null
  }

  try {
    // The ephemeral_pubkey is the "sender" from the extension's perspective
    // It will use our private key to compute shared secret with the ephemeral pubkey
    const plaintext = await window.nostr!.nip04!.decrypt(
      encrypted.ephemeral_pubkey,
      encrypted.ciphertext
    )
    return plaintext
  } catch (error) {
    console.error('Failed to decrypt field:', error)
    return null
  }
}

/**
 * Decrypt multiple encrypted fields in parallel.
 *
 * @param fields - Object mapping field names to encrypted data
 * @returns Object mapping field names to decrypted values (or null if failed)
 */
export async function decryptFields(
  fields: Record<string, EncryptedField | null | undefined>
): Promise<Record<string, string | null>> {
  const entries = Object.entries(fields)
  const decrypted = await Promise.all(
    entries.map(async ([name, encrypted]) => {
      const value = await decryptField(encrypted)
      return [name, value] as [string, string | null]
    })
  )
  return Object.fromEntries(decrypted)
}

/**
 * Helper to decrypt user data from the API response.
 * Decrypts email, name, and any encrypted custom fields.
 */
export interface UserWithEncryption {
  id: number
  pubkey?: string | null
  email?: string | null
  name?: string | null
  email_encrypted?: EncryptedField | null
  name_encrypted?: EncryptedField | null
  fields?: Record<string, string | null>
  fields_encrypted?: Record<string, EncryptedField | null>
  approved?: boolean
  user_type_id?: number | null
  created_at?: string | null
}

export interface DecryptedUser {
  id: number
  pubkey?: string | null
  email: string | null
  name: string | null
  fields: Record<string, string | null>
  approved: boolean
  user_type_id?: number | null
  created_at?: string | null
  email_encrypted?: EncryptedField | null
  name_encrypted?: EncryptedField | null
  fields_encrypted?: Record<string, EncryptedField | null>
  decrypted: boolean // true if data was decrypted, false if plaintext
}

/**
 * Decrypt a user object from the API.
 *
 * If encrypted fields exist, attempts to decrypt them.
 * Falls back to plaintext fields for legacy data.
 */
export async function decryptUser(user: UserWithEncryption): Promise<DecryptedUser> {
  let email = user.email ?? null
  let name = user.name ?? null
  let decrypted = false

  // Decrypt email if encrypted
  if (user.email_encrypted) {
    const decryptedEmail = await decryptField(user.email_encrypted)
    if (decryptedEmail !== null) {
      email = decryptedEmail
      decrypted = true
    }
  }

  // Decrypt name if encrypted
  if (user.name_encrypted) {
    const decryptedName = await decryptField(user.name_encrypted)
    if (decryptedName !== null) {
      name = decryptedName
      decrypted = true
    }
  }

  // Decrypt custom fields
  const fields: Record<string, string | null> = { ...(user.fields ?? {}) }
  if (user.fields_encrypted) {
    const decryptedFields = await decryptFields(user.fields_encrypted)
    for (const [fieldName, value] of Object.entries(decryptedFields)) {
      if (value !== null) {
        fields[fieldName] = value
        decrypted = true
      }
    }
  }

  return {
    id: user.id,
    pubkey: user.pubkey,
    email,
    name,
    fields,
    approved: user.approved ?? true,
    user_type_id: user.user_type_id,
    created_at: user.created_at,
    email_encrypted: user.email_encrypted ?? null,
    name_encrypted: user.name_encrypted ?? null,
    fields_encrypted: user.fields_encrypted ?? {},
    decrypted,
  }
}

/**
 * Decrypt multiple users in parallel.
 */
export async function decryptUsers(
  users: UserWithEncryption[]
): Promise<DecryptedUser[]> {
  return Promise.all(users.map(decryptUser))
}

/**
 * Format a value for display when it might be encrypted.
 * Shows "[Encrypted]" placeholder if decryption is not available.
 */
export function formatEncryptedValue(
  plaintext: string | null | undefined,
  encrypted: EncryptedField | null | undefined
): string {
  if (plaintext != null) {
    return plaintext
  }
  if (encrypted) {
    return '[Encrypted]'
  }
  return ''
}
