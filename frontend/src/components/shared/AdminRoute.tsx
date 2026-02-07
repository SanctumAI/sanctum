import { useEffect, useState, type ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { isAdminAuthenticated, validateAdminSession, type AdminSessionValidationState } from '../../utils/adminApi'

interface AdminRouteProps {
  children: ReactNode
}

type GuardState = 'checking' | AdminSessionValidationState

/**
 * Route guard for admin pages.
 * - Redirects to /admin on missing/expired credentials (401)
 * - Shows a retry screen for backend/network errors (5xx/unreachable)
 */
export function AdminRoute({ children }: AdminRouteProps) {
  const [state, setState] = useState<GuardState>('checking')
  const [retryNonce, setRetryNonce] = useState(0)

  useEffect(() => {
    let active = true

    const checkSession = async () => {
      if (!isAdminAuthenticated()) {
        if (active) setState('unauthenticated')
        return
      }

      try {
        const result = await validateAdminSession()
        if (active) setState(result)
      } catch (error) {
        // Defensive fallback: if validateAdminSession throws unexpectedly,
        // treat as unavailable (backend unreachable/error) rather than
        // leaving stuck in 'checking' state
        console.error('Unexpected error in admin session validation:', error)
        if (active) setState('unavailable')
      }
    }

    void checkSession()

    return () => {
      active = false
    }
  }, [retryNonce])

  if (state === 'checking') {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
          <p className="text-text-muted text-sm">Verifying admin session...</p>
        </div>
      </div>
    )
  }

  if (state === 'unauthenticated') {
    return <Navigate to="/admin" replace />
  }

  if (state === 'unavailable') {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <div className="card max-w-md w-full space-y-4">
          <h1 className="text-lg font-semibold text-text">Unable to verify admin session</h1>
          <p className="text-sm text-text-muted">
            The backend returned an error while validating authentication. This is not treated as a logout.
          </p>
          <button
            onClick={() => {
              setState('checking')
              setRetryNonce((prev) => prev + 1)
            }}
            className="w-full bg-accent text-accent-text rounded-xl px-4 py-2.5 text-sm font-medium hover:bg-accent-hover transition-colors"
          >
            Retry
          </button>
        </div>
      </div>
    )
  }

  return <>{children}</>
}
