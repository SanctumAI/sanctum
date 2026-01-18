import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthFlow } from '../hooks/useAuthFlow'

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

  useEffect(() => {
    if (redirectPath) {
      navigate(redirectPath, { replace: true })
    }
  }, [redirectPath, navigate])

  // Show loading state while redirecting
  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
        <p className="text-text-muted text-sm">Loading...</p>
      </div>
    </div>
  )
}
