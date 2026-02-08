import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Clock, LogOut } from 'lucide-react'
import { OnboardingCard } from '../components/onboarding/OnboardingCard'
import { STORAGE_KEYS } from '../types/onboarding'

export function PendingApproval() {
  const navigate = useNavigate()
  const { t } = useTranslation()
  const email = localStorage.getItem(STORAGE_KEYS.USER_EMAIL)

  const handleLogout = () => {
    // Clear all user data
    localStorage.removeItem(STORAGE_KEYS.SESSION_TOKEN)
    localStorage.removeItem(STORAGE_KEYS.USER_EMAIL)
    localStorage.removeItem(STORAGE_KEYS.USER_NAME)
    localStorage.removeItem(STORAGE_KEYS.USER_APPROVED)
    localStorage.removeItem(STORAGE_KEYS.USER_PROFILE)
    localStorage.removeItem(STORAGE_KEYS.USER_TYPE_ID)
    navigate('/auth')
  }

  return (
    <OnboardingCard title={t('onboarding.pending.title')}>
      <div className="text-center py-8 animate-fade-in">
        <div className="w-16 h-16 bg-warning/10 rounded-full flex items-center justify-center mx-auto mb-6">
          <Clock className="w-8 h-8 text-warning" />
        </div>
        <h2 className="text-xl font-semibold text-text mb-2">
          {t('onboarding.pending.heading')}
        </h2>
        <p className="text-sm text-text-muted mb-4">
          {t('onboarding.pending.message')}
        </p>
        {email && (
          <p className="inline-block bg-surface-overlay px-4 py-2 rounded-lg text-sm font-medium text-text mb-6">
            {email}
          </p>
        )}
        <p className="text-xs text-text-muted mb-6">
          {t('onboarding.pending.checkBack')}
        </p>
        <button
          onClick={handleLogout}
          className="btn btn-ghost btn-md inline-flex items-center gap-2"
        >
          <LogOut className="w-4 h-4" />
          {t('common.logout')}
        </button>
      </div>
    </OnboardingCard>
  )
}
