import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Check, Loader2, Users } from 'lucide-react'
import { OnboardingCard } from '../components/onboarding/OnboardingCard'
import {
  UserType,
  STORAGE_KEYS,
  saveSelectedUserTypeId,
  API_BASE,
} from '../types/onboarding'

interface UserTypeCardProps {
  userType: UserType
  isSelected: boolean
  onSelect: () => void
}

function UserTypeCard({ userType, isSelected, onSelect }: UserTypeCardProps) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={isSelected}
      aria-label={userType.name}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect()
        }
      }}
      className={`relative flex flex-col items-start p-8 rounded-xl border-2 transition-all text-left hover-lift cursor-pointer w-full ${
        isSelected
          ? 'border-accent bg-accent-subtle/30'
          : 'border-border bg-surface-raised hover:border-accent/50'
      }`}
    >
      {isSelected && (
        <div className="absolute top-3 right-3">
          <div className="w-6 h-6 bg-accent rounded-full flex items-center justify-center">
            <Check className="w-4 h-4 text-accent-text" strokeWidth={3} aria-hidden="true" />
          </div>
        </div>
      )}
      <div className="w-10 h-10 rounded-lg bg-accent/10 flex items-center justify-center mb-3">
        <Users className="w-5 h-5 text-accent" />
      </div>
      <span className="text-lg font-semibold text-text">{userType.name}</span>
      {userType.description && (
        <span className="text-sm text-text-muted mt-1">{userType.description}</span>
      )}
    </button>
  )
}

export function UserTypeSelection() {
  const navigate = useNavigate()
  const { t } = useTranslation()

  const [userTypes, setUserTypes] = useState<UserType[]>([])
  const [selectedTypeId, setSelectedTypeId] = useState<number | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Check if user is authenticated
  useEffect(() => {
    const email = localStorage.getItem(STORAGE_KEYS.USER_EMAIL)
    if (!email) {
      navigate('/auth')
      return
    }
  }, [navigate])

  // Fetch user types
  useEffect(() => {
    async function fetchUserTypes() {
      try {
        const response = await fetch(`${API_BASE}/user-types`)
        if (!response.ok) throw new Error('Failed to fetch user types')
        const data = await response.json()
        setUserTypes(data.types || [])

        // If no types or only one type, auto-proceed
        if (!data.types || data.types.length === 0) {
          // No types configured - proceed without selection
          saveSelectedUserTypeId(null)
          navigate('/profile')
        } else if (data.types.length === 1) {
          // Only one type - auto-select and proceed
          saveSelectedUserTypeId(data.types[0].id)
          navigate('/profile')
        }
      } catch (err) {
        console.error('Error fetching user types:', err)
        setError(t('onboarding.userType.loadError', 'Failed to load user types. Please try again.'))
      } finally {
        setIsLoading(false)
      }
    }

    fetchUserTypes()
  }, [navigate])

  const handleSelect = (typeId: number) => {
    setSelectedTypeId(typeId)
  }

  const handleContinue = () => {
    if (selectedTypeId !== null) {
      saveSelectedUserTypeId(selectedTypeId)
      navigate('/profile')
    }
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-accent animate-spin" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center p-4">
        <OnboardingCard
          title={t('common.error', 'Error')}
          subtitle={error}
        >
          <button
            onClick={() => window.location.reload()}
            className="w-full py-3 rounded-xl bg-accent text-accent-text font-medium transition-all hover:opacity-90"
          >
            {t('common.tryAgain', 'Try Again')}
          </button>
        </OnboardingCard>
      </div>
    )
  }

  // This shouldn't render if there are 0 or 1 types (handled in useEffect)
  return (
    <div className="min-h-screen bg-surface flex items-center justify-center p-4">
      <OnboardingCard
        title={t('onboarding.userType.title', 'What describes you best?')}
        subtitle={t('onboarding.userType.description', 'Select the option that best fits your needs')}
      >
        <div
          className="space-y-4 mb-10"
          role="radiogroup"
          aria-label={t('onboarding.userType.title', 'User type selection')}
        >
          {userTypes.map((userType) => (
            <UserTypeCard
              key={userType.id}
              userType={userType}
              isSelected={selectedTypeId === userType.id}
              onSelect={() => handleSelect(userType.id)}
            />
          ))}
        </div>

        <button
          onClick={handleContinue}
          disabled={selectedTypeId === null}
          className={`w-full py-4 rounded-xl font-medium transition-all flex items-center justify-center gap-2 ${
            selectedTypeId !== null
              ? 'bg-accent text-accent-text hover:opacity-90'
              : 'bg-border text-text-muted cursor-not-allowed'
          }`}
        >
          {t('common.continue', 'Continue')}
        </button>
      </OnboardingCard>
    </div>
  )
}
