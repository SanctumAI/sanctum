import { useEffect, useState, type ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { fetchInstanceStatus } from '../../utils/instanceStatus'

interface InitiationGateProps {
  children: ReactNode
}

type GateState = 'checking' | 'initiated' | 'uninitiated'

/**
 * Public route gate.
 *
 * If the instance has not been initiated (no admin exists yet), redirect users
 * to the admin initiation flow at /admin.
 */
export function InitiationGate({ children }: InitiationGateProps) {
  const [state, setState] = useState<GateState>('checking')

  useEffect(() => {
    let active = true

    const check = async () => {
      try {
        const status = await fetchInstanceStatus()
        if (!active) return
        setState(status.initialized ? 'initiated' : 'uninitiated')
      } catch (error) {
        console.error('Failed to fetch instance status (initiation gate):', error)
        if (!active) return
        // Fail open: don't block access if status can't be determined.
        setState('initiated')
      }
    }

    void check()

    return () => {
      active = false
    }
  }, [])

  if (state === 'checking') {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
          <p className="text-text-muted text-sm">Checking instance status...</p>
        </div>
      </div>
    )
  }

  if (state === 'uninitiated') {
    return <Navigate to="/admin" replace />
  }

  return <>{children}</>
}
