import { useMemo } from 'react'
import { STORAGE_KEYS } from '../types/onboarding'
import { isAdminAuthenticated } from '../utils/adminApi'

export interface AuthFlowState {
  isAdmin: boolean
  isAuthenticated: boolean
  isApproved: boolean
  userEmail: string | null
  userName: string | null
  redirectPath: string | null
}

/**
 * Hook to manage authentication and user flow state.
 * Provides computed states for routing decisions.
 */
export function useAuthFlow(): AuthFlowState {
  return useMemo(() => {
    const isAdmin = isAdminAuthenticated()
    const userEmail = localStorage.getItem(STORAGE_KEYS.USER_EMAIL)
    const userName = localStorage.getItem(STORAGE_KEYS.USER_NAME)
    const approvedStr = localStorage.getItem(STORAGE_KEYS.USER_APPROVED)

    const isAuthenticated = !!(userEmail || isAdmin)
    const isApproved = approvedStr === 'true' || isAdmin

    // Determine redirect path based on auth state
    let redirectPath: string | null = null

    if (isAdmin) {
      // Admins go to chat
      redirectPath = '/chat'
    } else if (!userEmail) {
      // Not authenticated at all
      redirectPath = '/login'
    } else if (!isApproved) {
      // Authenticated but not approved
      redirectPath = '/pending'
    } else {
      // Authenticated and approved
      redirectPath = '/chat'
    }

    return {
      isAdmin,
      isAuthenticated,
      isApproved,
      userEmail,
      userName,
      redirectPath,
    }
  }, [])
}

/**
 * Clear all user authentication state (for logout).
 */
export function clearUserAuth(): void {
  localStorage.removeItem(STORAGE_KEYS.SESSION_TOKEN)
  localStorage.removeItem(STORAGE_KEYS.USER_EMAIL)
  localStorage.removeItem(STORAGE_KEYS.USER_NAME)
  localStorage.removeItem(STORAGE_KEYS.USER_APPROVED)
  localStorage.removeItem(STORAGE_KEYS.USER_PROFILE)
  localStorage.removeItem(STORAGE_KEYS.USER_TYPE_ID)
  localStorage.removeItem(STORAGE_KEYS.PENDING_EMAIL)
  localStorage.removeItem(STORAGE_KEYS.PENDING_NAME)
}

/**
 * Clear all authentication state (both user and admin).
 */
export function clearAllAuth(): void {
  clearUserAuth()
  localStorage.removeItem(STORAGE_KEYS.ADMIN_PUBKEY)
  localStorage.removeItem(STORAGE_KEYS.ADMIN_SESSION_TOKEN)
}
