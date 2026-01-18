import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { OnboardingCard } from '../components/onboarding/OnboardingCard'
import { getCustomFields, STORAGE_KEYS } from '../types/onboarding'

type VerifyState = 'verifying' | 'success' | 'error'

export function VerifyMagicLink() {
  const navigate = useNavigate()
  const { t } = useTranslation()
  const [state, setState] = useState<VerifyState>('verifying')
  const [email, setEmail] = useState<string | null>(null)
  const [name, setName] = useState<string | null>(null)
  const [hasCustomFields, setHasCustomFields] = useState(false)

  useEffect(() => {
    // Get stored email and name from localStorage
    const storedEmail = localStorage.getItem(STORAGE_KEYS.PENDING_EMAIL)
    const storedName = localStorage.getItem(STORAGE_KEYS.PENDING_NAME)

    setEmail(storedEmail)
    setName(storedName)

    // Check if there are custom fields to complete
    const customFields = getCustomFields()
    setHasCustomFields(customFields.length > 0)

    // Simulate verification process
    const verifyTimer = setTimeout(() => {
      if (storedEmail) {
        // Mark as verified
        localStorage.setItem(STORAGE_KEYS.USER_EMAIL, storedEmail)
        if (storedName) {
          localStorage.setItem(STORAGE_KEYS.USER_NAME, storedName)
        }
        // Clean up pending state
        localStorage.removeItem(STORAGE_KEYS.PENDING_EMAIL)
        localStorage.removeItem(STORAGE_KEYS.PENDING_NAME)

        setState('success')
      } else {
        setState('error')
      }
    }, 1500)

    return () => clearTimeout(verifyTimer)
  }, [])

  useEffect(() => {
    // Redirect after success
    if (state === 'success') {
      const redirectTimer = setTimeout(() => {
        // If custom fields exist, go to profile first
        if (hasCustomFields) {
          navigate('/profile')
        } else {
          navigate('/chat')
        }
      }, 2500)

      return () => clearTimeout(redirectTimer)
    }
  }, [state, navigate, hasCustomFields])

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
            {hasCustomFields ? t('onboarding.verify.completingProfile') : t('onboarding.verify.redirectingChat')}
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
