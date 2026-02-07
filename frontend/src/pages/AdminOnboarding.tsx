import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router-dom'
import { Link2, AlertCircle, Check } from 'lucide-react'
import { OnboardingCard } from '../components/onboarding/OnboardingCard'
import { NostrInfo, NostrExtensionLinks } from '../components/onboarding/NostrInfo'
import { STORAGE_KEYS } from '../types/onboarding'
import { authenticateWithNostr, hasNostrExtension, type AuthResult } from '../utils/nostrAuth'
import { fetchPublicConfig } from '../utils/publicConfig'

type ConnectionState = 'idle' | 'connecting' | 'success' | 'no-extension' | 'error'

function NostrIcon() {
  return (
    <div className="w-16 h-16 mx-auto mb-6 rounded-2xl bg-gradient-to-br from-[var(--color-accent)] to-[var(--color-accent-hover)] flex items-center justify-center shadow-lg">
      <svg className="w-8 h-8 text-accent-text" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-1-13h2v6h-2zm0 8h2v2h-2z" />
      </svg>
    </div>
  )
}

function truncatePubkey(pubkey: string): string {
  if (pubkey.length <= 16) return pubkey
  return `${pubkey.slice(0, 8)}...${pubkey.slice(-8)}`
}

export function AdminOnboarding() {
  const navigate = useNavigate()
  const { t } = useTranslation()
  const [state, setState] = useState<ConnectionState>('idle')
  const [pubkey, setPubkey] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [simulateAdminAuth, setSimulateAdminAuth] = useState(false)

  // Fetch simulation setting on mount
  useEffect(() => {
    fetchPublicConfig().then((config) => {
      setSimulateAdminAuth(config.simulateAdminAuth)
    })
  }, [])

  const handleConnect = async () => {
    setState('connecting')
    setError(null)

    // Check if NIP-07 extension is available
    if (!hasNostrExtension()) {
      // Give extension time to inject
      await new Promise((resolve) => setTimeout(resolve, 800))
      if (!hasNostrExtension()) {
        setState('no-extension')
        return
      }
    }

    try {
      // Full auth flow: create event, sign with extension, verify on backend
      const result: AuthResult = await authenticateWithNostr()

      setPubkey(result.admin.pubkey)
      localStorage.setItem(STORAGE_KEYS.ADMIN_PUBKEY, result.admin.pubkey)
      localStorage.setItem(STORAGE_KEYS.ADMIN_SESSION_TOKEN, result.session_token)

      // Track if this is a new admin (first time setup)
      if (result.is_new) {
        localStorage.setItem('sanctum_admin_is_new', 'true')
      }

      setState('success')

      // Redirect after showing success
      setTimeout(() => {
        navigate('/admin/setup')
      }, 2000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect')
      setState('error')
    }
  }

  const handleMockConnect = async () => {
    setState('connecting')
    setError(null)

    // Simulate connection delay
    await new Promise((resolve) => setTimeout(resolve, 1200))

    // Generate mock pubkey (64 hex chars like a real nostr pubkey)
    const mockPubkey = Array.from({ length: 64 }, () =>
      '0123456789abcdef'[Math.floor(Math.random() * 16)]
    ).join('')

    setPubkey(mockPubkey)
    localStorage.setItem(STORAGE_KEYS.ADMIN_PUBKEY, mockPubkey)
    // Note: Mock mode has no valid session token - admin API calls will fail with 401
    // Use a real Nostr extension for full functionality
    localStorage.setItem('sanctum_admin_is_new', 'true')
    setState('success')

    // Redirect after showing success
    setTimeout(() => {
      navigate('/admin/setup')
    }, 2000)
  }

  const handleRetry = () => {
    setState('idle')
    setError(null)
    setPubkey(null)
  }

  const footer = (
    <>
      <span>{t('adminOnboarding.notAdmin')} </span>
      <Link to="/login" className="text-accent hover:text-accent-hover font-medium transition-colors">
        {t('adminOnboarding.signInAsUser')}
      </Link>
    </>
  )

  return (
    <OnboardingCard
      title={t('adminOnboarding.title')}
      subtitle={t('adminOnboarding.subtitle')}
      footer={footer}
    >
      <NostrIcon />

      {/* Idle State */}
      {state === 'idle' && (
        <div className="space-y-4">
          <button
            onClick={handleConnect}
            className="w-full flex items-center justify-center gap-2 bg-accent text-accent-text rounded-xl px-6 py-3.5 font-medium hover:bg-accent-hover transition-all active-press shadow-md"
          >
            <Link2 className="w-5 h-5" />
            {t('adminOnboarding.connectNostr')}
          </button>

          {/* Mock auth only available in simulateAdminAuth */}
          {simulateAdminAuth && (
            <>
              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-border" />
                </div>
                <div className="relative flex justify-center text-xs">
                  <span className="px-3 bg-surface-raised text-text-muted">{t('adminOnboarding.orForTesting')}</span>
                </div>
              </div>

              <button
                onClick={handleMockConnect}
                className="w-full text-sm text-text-muted hover:text-text py-2 transition-colors"
              >
                {t('adminOnboarding.continueMock')}
              </button>
            </>
          )}

          <NostrInfo />
        </div>
      )}

      {/* Connecting State */}
      {state === 'connecting' && (
        <div className="text-center py-4 animate-fade-in">
          <div className="w-8 h-8 border-2 border-accent/30 border-t-accent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-text-secondary">{t('adminOnboarding.connecting')}</p>
        </div>
      )}

      {/* No Extension State */}
      {state === 'no-extension' && (
        <div className="space-y-6 animate-fade-in">
          <div className="bg-warning-subtle border border-warning/20 rounded-xl p-4 text-center">
            <AlertCircle className="w-8 h-8 text-warning mx-auto mb-2" />
            <p className="text-sm text-text font-medium mb-1">{t('adminOnboarding.noExtension')}</p>
            <p className="text-xs text-text-muted">{t('adminOnboarding.installExtension')}</p>
          </div>

          <NostrExtensionLinks />

          <div className="flex gap-3">
            <button
              onClick={handleRetry}
              className={`${simulateAdminAuth ? 'flex-1' : 'w-full'} bg-surface-overlay border border-border text-text rounded-xl px-4 py-2.5 text-sm font-medium hover:bg-surface-raised transition-all`}
            >
              {t('common.tryAgain')}
            </button>
            {/* Mock auth only available in simulateAdminAuth */}
            {simulateAdminAuth && (
              <button
                onClick={handleMockConnect}
                className="flex-1 bg-accent text-accent-text rounded-xl px-4 py-2.5 text-sm font-medium hover:bg-accent-hover transition-all active-press"
              >
                {t('adminOnboarding.useMock')}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Success State */}
      {state === 'success' && pubkey && (
        <div className="text-center py-4 animate-fade-in">
          <div className="w-12 h-12 bg-success/10 rounded-full flex items-center justify-center mx-auto mb-4">
            <Check className="w-6 h-6 text-success" />
          </div>
          <h3 className="text-lg font-semibold text-text mb-2">{t('adminOnboarding.welcomeAdmin')}</h3>
          <p className="text-sm text-text-muted mb-3">{t('adminOnboarding.connectedAs')}</p>
          <code className="inline-block bg-surface-overlay px-3 py-1.5 rounded-lg text-xs font-mono text-text-secondary break-all">
            {truncatePubkey(pubkey)}
          </code>
          <p className="text-xs text-text-muted mt-4">{t('adminOnboarding.redirecting')}</p>
        </div>
      )}

      {/* Error State */}
      {state === 'error' && (
        <div className="space-y-4 animate-fade-in">
          <div className="bg-error/10 border border-error/20 rounded-xl p-5 text-center">
            <div className="w-10 h-10 bg-error/10 rounded-full flex items-center justify-center mx-auto mb-3">
              <AlertCircle className="w-5 h-5 text-error" />
            </div>
            <p className="text-sm text-text font-medium mb-1.5">{t('adminOnboarding.connectionFailed')}</p>
            <p className="text-xs text-text-muted leading-relaxed">{error || t('common.unexpectedError')}</p>
          </div>

          <button
            onClick={handleRetry}
            className="w-full bg-accent text-accent-text rounded-xl px-6 py-3 font-medium hover:bg-accent-hover transition-all active-press"
          >
            {t('common.tryAgain')}
          </button>
        </div>
      )}
    </OnboardingCard>
  )
}
