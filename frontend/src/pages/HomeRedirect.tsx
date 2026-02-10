import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthFlow } from '../hooks/useAuthFlow'
import { fetchInstanceStatus } from '../utils/instanceStatus'

/**
 * Smart home redirect component.
 * Redirects users based on their authentication state:
 * - Admin → /chat
 * - Authenticated + approved → /chat
 * - Authenticated + not approved → /pending
 * - Not authenticated → /login
 */
export function HomeRedirect() {
  const navigate = useNavigate()
  const { redirectPath } = useAuthFlow()
  const [instanceInitialized, setInstanceInitialized] = useState<boolean | null>(null)

  useEffect(() => {
    let active = true

    const loadStatus = async () => {
      try {
        const status = await fetchInstanceStatus()
        if (!active) return
        setInstanceInitialized(status.initialized)
      } catch (error) {
        console.error('Failed to fetch instance status (home redirect):', error)
        if (!active) return
        // Fail open: proceed with normal auth flow on status failure.
        setInstanceInitialized(true)
      }
    }

    void loadStatus()

    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (instanceInitialized === null) return

    // If no admin exists yet, show the admin initiation flow.
    if (instanceInitialized === false) {
      navigate('/admin', { replace: true })
      return
    }

    if (redirectPath) {
      navigate(redirectPath, { replace: true })
    }
  }, [instanceInitialized, redirectPath, navigate])

  // Show loading state while redirecting
  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
        <p className="text-text-muted text-sm">
          {instanceInitialized === null ? 'Checking instance status...' : 'Loading...'}
        </p>
      </div>
    </div>
  )
}
