/**
 * Admin API utilities
 * Provides authenticated fetch helper for admin endpoints.
 */

import { STORAGE_KEYS, API_BASE } from '../types/onboarding'

export type AdminSessionValidationState = 'authenticated' | 'unauthenticated' | 'unavailable'

/**
 * Make an authenticated admin API request.
 * Automatically adds Authorization header with admin session token.
 * Redirects to /admin on 401 (session expired).
 */
export async function adminFetch(
  endpoint: string,
  options: RequestInit = {}
): Promise<Response> {
  const token = localStorage.getItem(STORAGE_KEYS.ADMIN_SESSION_TOKEN)

  if (!token) {
    throw new Error('errors.notAuthenticatedAsAdmin')
  }

  const headers = new Headers(options.headers)
  headers.set('Authorization', `Bearer ${token}`)

  if (
    options.body &&
    !headers.has('Content-Type') &&
    !(typeof FormData !== 'undefined' && options.body instanceof FormData)
  ) {
    headers.set('Content-Type', 'application/json')
  }

  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers,
  })

  // Handle 401 - redirect to admin login
  if (response.status === 401) {
    localStorage.removeItem(STORAGE_KEYS.ADMIN_PUBKEY)
    localStorage.removeItem(STORAGE_KEYS.ADMIN_SESSION_TOKEN)
    window.location.href = '/admin'
    throw new Error('errors.adminSessionExpired')
  }

  return response
}

/**
 * Check if current session has valid admin authentication.
 */
export function isAdminAuthenticated(): boolean {
  return !!localStorage.getItem(STORAGE_KEYS.ADMIN_SESSION_TOKEN)
}

/**
 * Clear admin authentication state.
 */
export function clearAdminAuth(): void {
  localStorage.removeItem(STORAGE_KEYS.ADMIN_PUBKEY)
  localStorage.removeItem(STORAGE_KEYS.ADMIN_SESSION_TOKEN)
}

/**
 * Validate admin session token against the backend.
 * Returns:
 * - authenticated: token accepted by backend
 * - unauthenticated: token missing/expired/invalid (401)
 * - unavailable: backend error/unreachable (5xx/network)
 */
export async function validateAdminSession(): Promise<AdminSessionValidationState> {
  const token = localStorage.getItem(STORAGE_KEYS.ADMIN_SESSION_TOKEN)

  if (!token) {
    return 'unauthenticated'
  }

  try {
    const response = await fetch(`${API_BASE}/admin/session`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })

    if (response.status === 401) {
      clearAdminAuth()
      return 'unauthenticated'
    }

    if (response.ok) {
      return 'authenticated'
    }

    return 'unavailable'
  } catch {
    return 'unavailable'
  }
}
