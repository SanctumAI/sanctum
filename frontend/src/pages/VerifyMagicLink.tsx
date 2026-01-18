import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { OnboardingCard } from '../components/onboarding/OnboardingCard'
import { STORAGE_KEYS, API_BASE } from '../types/onboarding'

// DEV_MODE enables token-less verification for testing without real emails
const DEV_MODE = import.meta.env.VITE_DEV_MODE === 'true'

type VerifyState = 'verifying' | 'success' | 'error'

export function VerifyMagicLink() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { t } = useTranslation()
  const [state, setState] = useState<VerifyState>('verifying')
  const [email, setEmail] = useState<string | null>(null)
  const [name, setName] = useState<string | null>(null)
  const [hasOnboarding, setHasOnboarding] = useState(false)
  const [isApproved, setIsApproved] = useState(true)

  useEffect(() => {
    const token = searchParams.get('token')

    // Check if there are user types or custom fields to complete
    async function checkOnboarding() {
      try {
        const [typesRes, fieldsRes] = await Promise.all([
          fetch(`${API_BASE}/user-types`),
          fetch(`${API_BASE}/user-fields`),
        ])

        const typesData = typesRes.ok ? await typesRes.json() : { types: [] }
        const fieldsData = fieldsRes.ok ? await fieldsRes.json() : { fields: [] }

        // Has onboarding if there are types (>1) or fields to complete
        const hasTypes = (typesData.types?.length || 0) > 1
        const hasFields = (fieldsData.fields?.length || 0) > 0
        setHasOnboarding(hasTypes || hasFields)
      } catch {
        setHasOnboarding(false)
      }
    }

    async function verifyToken() {
      if (!token) {
        // No token - only allow in DEV_MODE for testing
        if (DEV_MODE) {
          const storedEmail = localStorage.getItem(STORAGE_KEYS.PENDING_EMAIL)
          if (storedEmail) {
            setEmail(storedEmail)
            setName(localStorage.getItem(STORAGE_KEYS.PENDING_NAME))
            // For testing without real token, just mark as verified
            localStorage.setItem(STORAGE_KEYS.USER_EMAIL, storedEmail)
            const storedName = localStorage.getItem(STORAGE_KEYS.PENDING_NAME)
            if (storedName) {
              localStorage.setItem(STORAGE_KEYS.USER_NAME, storedName)
            }
            localStorage.removeItem(STORAGE_KEYS.PENDING_EMAIL)
            localStorage.removeItem(STORAGE_KEYS.PENDING_NAME)
            setState('success')
            return
          }
        }
        // No token and not in DEV_MODE (or no pending email) = error
        setState('error')
        return
      }

      try {
        // Verify the token with the backend
        const response = await fetch(`${API_BASE}/auth/verify?token=${encodeURIComponent(token)}`)

        if (!response.ok) {
          let errorMessage = 'Verification failed'
          try {
            const contentType = response.headers.get('content-type')
            if (contentType && contentType.includes('application/json')) {
              const error = await response.json()
              errorMessage = error.detail || error.message || errorMessage
            } else {
              const text = await response.text()
              errorMessage = text || errorMessage
            }
          } catch (parseError) {
            errorMessage = response.statusText || errorMessage
          }
          console.error('Verification failed:', errorMessage)
          setState('error')
          return
        }

        const data = await response.json()

        // Store session token and user info
        localStorage.setItem(STORAGE_KEYS.SESSION_TOKEN, data.session_token)
        localStorage.setItem(STORAGE_KEYS.USER_EMAIL, data.user.email)
        if (data.user.name) {
          localStorage.setItem(STORAGE_KEYS.USER_NAME, data.user.name)
        }

        // Store approval status
        const approved = data.user.approved !== false
        localStorage.setItem(STORAGE_KEYS.USER_APPROVED, String(approved))
        setIsApproved(approved)

        // Clean up pending state
        localStorage.removeItem(STORAGE_KEYS.PENDING_EMAIL)
        localStorage.removeItem(STORAGE_KEYS.PENDING_NAME)

        setEmail(data.user.email)
        setName(data.user.name)
        setState('success')
      } catch (error) {
        console.error('Verification error:', error)
        setState('error')
      }
    }

    checkOnboarding()
    verifyToken()
  }, [searchParams])

  useEffect(() => {
    // Redirect after success
    if (state === 'success') {
      const redirectTimer = setTimeout(() => {
        // If not approved, go to pending page
        if (!isApproved) {
          navigate('/pending')
        } else if (hasOnboarding) {
          // If onboarding needed, go to user-type selection (which auto-skips if needed)
          navigate('/user-type')
        } else {
          navigate('/chat')
        }
      }, 2500)

      return () => clearTimeout(redirectTimer)
    }
  }, [state, navigate, hasOnboarding, isApproved])

  return (
    <OnboardingCard>
      {/* Verifying State */}
      {state === 'verifying' && (
        <div className="text-center py-8 animate-fade-in">
          <div className="w-12 h-12 border-2 border-accent/30 border-t-accent rounded-full animate-spin mx-auto mb-6" />
          <h2 className="text-lg font-semibold text-text mb-2">{t('onboarding.verify.verifying')}</h2>
          <p className="text-sm text-text-muted">{t('onboarding.verify.pleaseWait')}</p>
        </div>
      )}

      {/* Success State */}
      {state === 'success' && (
        <div className="text-center py-8 animate-fade-in">
          <div className="w-16 h-16 bg-success/10 rounded-full flex items-center justify-center mx-auto mb-6">
            <svg className="w-8 h-8 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-xl font-semibold text-text mb-2">
            {name ? t('onboarding.verify.welcomeName', { name }) : t('onboarding.verify.welcomeBack')}
          </h2>
          <p className="text-sm text-text-muted mb-4">
            {t('onboarding.verify.signedInAs')}
          </p>
          <p className="inline-block bg-surface-overlay px-4 py-2 rounded-lg text-sm font-medium text-text">
            {email}
          </p>
          <p className="text-xs text-text-muted mt-6">
            {hasOnboarding ? t('onboarding.verify.completingProfile') : t('onboarding.verify.redirectingChat')}
          </p>
        </div>
      )}

      {/* Error State */}
      {state === 'error' && (
        <div className="text-center py-8 animate-fade-in">
          <div className="w-16 h-16 bg-error/10 rounded-full flex items-center justify-center mx-auto mb-6">
            <svg className="w-8 h-8 text-error" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <h2 className="text-xl font-semibold text-text mb-2">{t('onboarding.verify.linkExpired')}</h2>
          <p className="text-sm text-text-muted mb-6">
            {t('onboarding.verify.linkExpiredMessage')}
          </p>
          <button
            onClick={() => navigate('/login')}
            className="bg-accent text-accent-text rounded-xl px-6 py-3 font-medium hover:bg-accent-hover transition-all active-press"
          >
            {t('onboarding.verify.requestNewLink')}
          </button>
        </div>
      )}
    </OnboardingCard>
  )
}
