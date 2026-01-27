import { useState, FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Mail } from 'lucide-react'
import { OnboardingCard } from '../components/onboarding/OnboardingCard'
import { API_BASE, STORAGE_KEYS } from '../types/onboarding'
import { useInstanceConfig } from '../context/InstanceConfigContext'

type TabType = 'signup' | 'login'
type FormState = 'idle' | 'submitting' | 'success' | 'error'

interface FormData {
  name: string
  email: string
}

function validateEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

function TabSwitcher({
  activeTab,
  onTabChange,
  signUpLabel,
  logInLabel,
}: {
  activeTab: TabType
  onTabChange: (tab: TabType) => void
  signUpLabel: string
  logInLabel: string
}) {
  return (
    <div className="flex bg-surface-overlay rounded-xl p-1.5 mb-6">
      <button
        onClick={() => onTabChange('signup')}
        className={`flex-1 px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${
          activeTab === 'signup'
            ? 'bg-surface text-text shadow-md'
            : 'text-text-muted hover:text-text'
        }`}
      >
        {signUpLabel}
      </button>
      <button
        onClick={() => onTabChange('login')}
        className={`flex-1 px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${
          activeTab === 'login'
            ? 'bg-surface text-text shadow-md'
            : 'text-text-muted hover:text-text'
        }`}
      >
        {logInLabel}
      </button>
    </div>
  )
}

function InputField({
  label,
  type,
  value,
  onChange,
  placeholder,
  required,
  error,
}: {
  label: string
  type: string
  value: string
  onChange: (value: string) => void
  placeholder: string
  required?: boolean
  error?: string
}) {
  return (
    <div>
      <label className="text-sm font-medium text-text mb-1.5 block">
        {label}
        {required && <span className="text-error ml-1">*</span>}
      </label>
      <div className={`input-container px-4 py-3 ${error ? 'has-error' : ''}`}>
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="input-field text-sm"
          required={required}
        />
      </div>
      {error && <p className="text-xs text-error mt-1.5">{error}</p>}
    </div>
  )
}

interface SuccessMessageProps {
  email: string
  checkEmailTitle: string
  sentMagicLink: string
  clickLink: string
  checkSpam: string
  forTesting: string
  simulateMagicLink: string
}

function SuccessMessage({
  email,
  checkEmailTitle,
  sentMagicLink,
  clickLink,
  checkSpam,
  forTesting,
  simulateMagicLink,
}: SuccessMessageProps) {
  return (
    <div className="text-center py-6 animate-fade-in">
      <div className="w-16 h-16 bg-success/10 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg ring-1 ring-success/20">
        <Mail className="w-8 h-8 text-success" />
      </div>
      <h3 className="heading-lg mb-2">{checkEmailTitle}</h3>
      <p className="text-sm text-text-muted mb-4">{sentMagicLink}</p>
      <p className="inline-block bg-surface-overlay px-5 py-2.5 rounded-xl text-sm font-medium text-text border border-border">
        {email}
      </p>
      <p className="text-xs text-text-muted mt-4">
        {clickLink}
        <br />
        {checkSpam}
      </p>

      {/* For testing: Link to mock verification */}
      <div className="mt-6 pt-4 border-t border-border">
        <p className="text-xs text-text-muted mb-2">{forTesting}</p>
        <Link
          to="/verify"
          className="text-sm text-accent hover:text-accent-hover font-medium transition-colors"
        >
          {simulateMagicLink}
        </Link>
      </div>
    </div>
  )
}

export function UserAuth() {
  const { t } = useTranslation()
  const { config } = useInstanceConfig()
  const [activeTab, setActiveTab] = useState<TabType>('signup')
  const [formState, setFormState] = useState<FormState>('idle')
  const [formData, setFormData] = useState<FormData>({ name: '', email: '' })
  const [errors, setErrors] = useState<Partial<FormData>>({})
  const [submittedEmail, setSubmittedEmail] = useState<string>('')

  const handleTabChange = (tab: TabType) => {
    setActiveTab(tab)
    setErrors({})
    setFormState('idle')
  }

  const validate = (): boolean => {
    const newErrors: Partial<FormData> = {}

    if (activeTab === 'signup' && !formData.name.trim()) {
      newErrors.name = t('onboarding.auth.nameRequired')
    }

    if (!formData.email.trim()) {
      newErrors.email = t('onboarding.auth.emailRequired')
    } else if (!validateEmail(formData.email)) {
      newErrors.email = t('onboarding.auth.emailInvalid')
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()

    if (!validate()) return

    setFormState('submitting')

    try {
      // Call the magic link API
      const response = await fetch(`${API_BASE}/auth/magic-link`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: formData.email,
          name: activeTab === 'signup' ? formData.name : '',
        }),
      })

      if (!response.ok) {
        let errorMessage = 'Failed to send magic link'
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
          // If JSON parsing fails, use status text or default message
          errorMessage = response.statusText || errorMessage
        }
        throw new Error(errorMessage)
      }

      // Store email for verification page
      localStorage.setItem(STORAGE_KEYS.PENDING_EMAIL, formData.email)
      if (activeTab === 'signup') {
        localStorage.setItem(STORAGE_KEYS.PENDING_NAME, formData.name)
      }

      setSubmittedEmail(formData.email)
      setFormState('success')
    } catch (error) {
      console.error('Magic link error:', error)
      setFormState('error')
    }
  }

  const footer = (
    <>
      <span>{t('common.adminQuestion')} </span>
      <Link to="/admin" className="text-accent hover:text-accent-hover font-medium transition-colors">
        {t('common.signInNostr')}
      </Link>
    </>
  )

  const title = activeTab === 'signup'
    ? t('onboarding.auth.createAccountTitle')
    : t('onboarding.auth.welcomeBackTitle')
  const subtitle = activeTab === 'signup'
    ? t('onboarding.auth.createAccountSubtitle', { instanceName: config.name })
    : t('onboarding.auth.welcomeBackSubtitle')

  return (
    <OnboardingCard title={title} subtitle={subtitle} footer={footer}>
      {formState === 'success' ? (
        <SuccessMessage
          email={submittedEmail}
          checkEmailTitle={t('onboarding.auth.checkEmail')}
          sentMagicLink={t('onboarding.auth.sentMagicLink')}
          clickLink={t('onboarding.auth.clickLink')}
          checkSpam={t('onboarding.auth.checkSpam')}
          forTesting={t('onboarding.auth.forTesting')}
          simulateMagicLink={t('onboarding.auth.simulateMagicLink')}
        />
      ) : (
        <>
          <TabSwitcher
            activeTab={activeTab}
            onTabChange={handleTabChange}
            signUpLabel={t('onboarding.auth.signUp')}
            logInLabel={t('onboarding.auth.logIn')}
          />

          <form onSubmit={handleSubmit} className="space-y-4">
            {activeTab === 'signup' && (
              <InputField
                label={t('onboarding.auth.nameLabel')}
                type="text"
                value={formData.name}
                onChange={(name) => {
                  setFormData((prev) => ({ ...prev, name }))
                  if (errors.name) setErrors((prev) => ({ ...prev, name: undefined }))
                }}
                placeholder={t('onboarding.auth.namePlaceholder')}
                required
                error={errors.name}
              />
            )}

            <InputField
              label={t('onboarding.auth.emailLabel')}
              type="email"
              value={formData.email}
              onChange={(email) => {
                setFormData((prev) => ({ ...prev, email }))
                if (errors.email) setErrors((prev) => ({ ...prev, email: undefined }))
              }}
              placeholder={t('onboarding.auth.emailPlaceholder')}
              required
              error={errors.email}
            />

            <button
              type="submit"
              disabled={formState === 'submitting'}
              className="btn btn-primary btn-lg w-full mt-6 flex items-center justify-center gap-2"
            >
              {formState === 'submitting' ? (
                <>
                  <div className="w-4 h-4 border-2 border-accent-text/30 border-t-accent-text rounded-full animate-spin" />
                  {t('onboarding.auth.sendingLink')}
                </>
              ) : (
                <>
                  <Mail className="w-5 h-5" />
                  {t('onboarding.auth.continueWithEmail')}
                </>
              )}
            </button>

            <p className="text-xs text-text-muted text-center mt-4">
              {t('onboarding.auth.magicLinkHelp')}
            </p>
          </form>
        </>
      )}
    </OnboardingCard>
  )
}
