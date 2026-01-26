/**
 * Nostr NIP-07 Authentication Utilities
 * Handles creating and signing auth events for admin authentication.
 */

import type { Event, EventTemplate } from 'nostr-tools'
import type { WindowNostr } from 'nostr-tools/nip07'
import { API_BASE } from '../types/onboarding'

// Sanctum admin auth event kind (ephemeral auth event)
const AUTH_KIND = 22242

// Extend window type for NIP-07
declare global {
  interface Window {
    nostr?: WindowNostr
  }
}

export interface AdminInfo {
  id: number
  pubkey: string
  created_at: string | null
}

export interface AuthResult {
  admin: AdminInfo
  is_new: boolean
  instance_initialized: boolean
  session_token: string
}

/**
 * Create an event template for admin authentication.
 * The NIP-07 extension will add pubkey and sign it.
 */
export function createAuthEvent(): EventTemplate {
  return {
    kind: AUTH_KIND,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['action', 'admin_auth']],
    content: '',
  }
}

/**
 * Submit a signed event to the backend for verification.
 */
export async function submitAuthEvent(signedEvent: Event): Promise<AuthResult> {
  const response = await fetch(`${API_BASE}/admin/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event: signedEvent }),
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Authentication failed' }))
    throw new Error(error.detail || 'Authentication failed')
  }

  return response.json()
}

/**
 * Full NIP-07 authentication flow:
 * 1. Create unsigned event
 * 2. Sign with browser extension
 * 3. Submit to backend for verification
 * 4. Return admin info
 */
export async function authenticateWithNostr(): Promise<AuthResult> {
  if (!window.nostr) {
    throw new Error('No Nostr extension found')
  }

  // Create unsigned event
  const unsignedEvent = createAuthEvent()

  // Sign with NIP-07 extension (prompts user)
  const signedEvent = await window.nostr.signEvent(unsignedEvent)

  // Submit to backend for verification
  return submitAuthEvent(signedEvent)
}

/**
 * Check if a NIP-07 extension is available.
 */
export function hasNostrExtension(): boolean {
  return typeof window.nostr !== 'undefined'
}
