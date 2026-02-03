/**
 * Public Configuration Utility
 *
 * Fetches runtime configuration settings from the backend.
 * These settings control simulation/development features and are
 * configurable via the admin panel without rebuilding the frontend.
 */

import { API_BASE } from '../types/onboarding'

export interface PublicConfig {
  simulateUserAuth: boolean
  simulateAdminAuth: boolean
}

// Default values (used if fetch fails or during initial load)
const DEFAULT_CONFIG: PublicConfig = {
  simulateUserAuth: false,
  simulateAdminAuth: false,
}

// Cache the config to avoid repeated fetches
let cachedConfig: PublicConfig | null = null
let fetchPromise: Promise<PublicConfig> | null = null
// Generation token to detect stale fetches after cache clear
let fetchGeneration = 0

/**
 * Fetch public configuration from the backend.
 * Results are cached to avoid repeated network requests.
 *
 * @returns Promise resolving to the public config settings
 */
export async function fetchPublicConfig(): Promise<PublicConfig> {
  // Return cached config if available
  if (cachedConfig !== null) {
    return cachedConfig
  }

  // If a fetch is already in progress, wait for it
  if (fetchPromise !== null) {
    return fetchPromise
  }

  // Capture current generation to detect stale fetches
  const currentGeneration = fetchGeneration

  // Start a new fetch
  fetchPromise = (async () => {
    try {
      const response = await fetch(`${API_BASE}/config/public`)

      if (!response.ok) {
        console.warn(`Failed to fetch public config: ${response.status}`)
        return DEFAULT_CONFIG
      }

      const data = await response.json()

      const result: PublicConfig = {
        simulateUserAuth: Boolean(data.simulate_user_auth),
        simulateAdminAuth: Boolean(data.simulate_admin_auth),
      }

      // Only update cache if generation hasn't changed (no cache clear during fetch)
      if (currentGeneration === fetchGeneration) {
        cachedConfig = result
      }

      return result
    } catch (error) {
      console.warn('Failed to fetch public config:', error)
      return DEFAULT_CONFIG
    } finally {
      // Only clear fetchPromise if generation matches
      if (currentGeneration === fetchGeneration) {
        fetchPromise = null
      }
    }
  })()

  return fetchPromise
}

/**
 * Clear the cached config.
 * Useful for testing or when settings may have changed.
 */
export function clearPublicConfigCache(): void {
  cachedConfig = null
  fetchPromise = null
  fetchGeneration++
}

/**
 * Get the cached config synchronously, or null if not yet fetched.
 * Use fetchPublicConfig() for async access with automatic fetching.
 */
export function getCachedPublicConfig(): PublicConfig | null {
  return cachedConfig
}
