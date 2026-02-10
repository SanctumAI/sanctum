/**
 * Instance Status Utility
 *
 * Fetches the instance status (initialized/setup state) from the backend.
 * Used to gate the app when an instance has not yet been initiated by an admin.
 */

import { API_BASE } from '../types/onboarding'

export interface InstanceStatus {
  initialized: boolean
  setup_complete: boolean
  ready_for_users: boolean
  settings: Record<string, unknown>
}

// Conservative default: if status can't be fetched, don't hard-block the app.
const DEFAULT_STATUS: InstanceStatus = {
  initialized: true,
  setup_complete: true,
  ready_for_users: true,
  settings: {},
}

let cachedStatus: InstanceStatus | null = null
let fetchPromise: Promise<InstanceStatus> | null = null
let fetchGeneration = 0

export async function fetchInstanceStatus(): Promise<InstanceStatus> {
  if (cachedStatus !== null) return cachedStatus
  if (fetchPromise !== null) return fetchPromise

  const currentGeneration = fetchGeneration

  fetchPromise = (async () => {
    try {
      const response = await fetch(`${API_BASE}/instance/status`)
      if (!response.ok) {
        console.warn(`Failed to fetch instance status: ${response.status}`)
        return DEFAULT_STATUS
      }

      const data = await response.json()
      const result: InstanceStatus = {
        initialized: Boolean(data.initialized),
        setup_complete: Boolean(data.setup_complete),
        ready_for_users: Boolean(data.ready_for_users),
        settings: (data.settings && typeof data.settings === 'object') ? data.settings : {},
      }

      if (currentGeneration === fetchGeneration) {
        cachedStatus = result
      }

      return result
    } catch (error) {
      console.warn('Failed to fetch instance status:', error)
      return DEFAULT_STATUS
    } finally {
      if (currentGeneration === fetchGeneration) {
        fetchPromise = null
      }
    }
  })()

  return fetchPromise
}

export function clearInstanceStatusCache(): void {
  cachedStatus = null
  fetchPromise = null
  fetchGeneration++
}

export function getCachedInstanceStatus(): InstanceStatus | null {
  return cachedStatus
}

