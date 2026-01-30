/**
 * Admin API utilities
 * Provides authenticated fetch helper for admin endpoints.
 */

import { STORAGE_KEYS, API_BASE } from '../types/onboarding'

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

  if (options.body && !headers.has('Content-Type')) {
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
