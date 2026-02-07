import { useState, useEffect, FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Loader2 } from 'lucide-react'
import { OnboardingCard } from '../components/onboarding/OnboardingCard'
import { DynamicField } from '../components/onboarding/DynamicField'
import {
  CustomField,
  UserProfile as UserProfileType,
  saveUserProfile,
  getSelectedUserTypeId,
  STORAGE_KEYS,
  API_BASE,
} from '../types/onboarding'

function validateEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

function validateUrl(url: string): boolean {
  try {
    new URL(url)
    return true
  } catch {
    return false
  }
}

export function UserProfile() {
  const navigate = useNavigate()
  const { t } = useTranslation()
  const [fields, setFields] = useState<CustomField[]>([])
  const [values, setValues] = useState<Record<string, string | boolean>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isLoading, setIsLoading] = useState(true)

  // Load fields from API and check user is logged in
  useEffect(() => {
    const email = localStorage.getItem(STORAGE_KEYS.USER_EMAIL)
    if (!email) {
      navigate('/login')
      return
    }

    async function fetchFields() {
      try {
        const userTypeId = getSelectedUserTypeId()
        // Fetch fields - include global fields and type-specific if type selected
        const url = userTypeId !== null
          ? `${API_BASE}/user-fields?user_type_id=${userTypeId}&include_global=true`
          : `${API_BASE}/user-fields`

        const response = await fetch(url)
        if (!response.ok) throw new Error(t('errors.failedToFetchFields'))

        const data = await response.json()
        const fetchedFields: CustomField[] = (data.fields || []).map((f: any) => ({
          id: String(f.id),
          name: f.field_name,
          type: f.field_type as any,
          required: f.required,
          placeholder: f.placeholder,
          options: f.options,
          user_type_id: f.user_type_id,
        }))

        if (fetchedFields.length === 0) {
          // No fields to complete, go to chat
          navigate('/chat')
          return
        }

        setFields(fetchedFields)

        // Initialize values with empty strings or false for checkboxes
        // Use field.name as key since backend expects field names, not IDs
        const initialValues: Record<string, string | boolean> = {}
        fetchedFields.forEach((field) => {
          initialValues[field.name] = field.type === 'checkbox' ? false : ''
        })
        setValues(initialValues)
      } catch (err) {
        console.error(t('errors.errorFetchingFields'), err)
        // On error, proceed to chat (graceful degradation)
        navigate('/chat')
      } finally {
        setIsLoading(false)
      }
    }

    fetchFields()
  }, [navigate])

  const handleValueChange = (fieldId: string, value: string | boolean) => {
    setValues((prev) => ({ ...prev, [fieldId]: value }))
    if (errors[fieldId]) {
      setErrors((prev) => {
        const newErrors = { ...prev }
        delete newErrors[fieldId]
        return newErrors
      })
    }
  }

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {}

    fields.forEach((field) => {
      const value = values[field.name]

      // Required check
      if (field.required) {
        if (field.type === 'checkbox') {
          // Checkbox doesn't need to be checked for required
        } else if (!value || (typeof value === 'string' && !value.trim())) {
          newErrors[field.name] = t('onboarding.profile.fieldRequired', { field: field.name })
          return
        }
      }

      // Type-specific validation
      if (value && typeof value === 'string' && value.trim()) {
        switch (field.type) {
          case 'email':
            if (!validateEmail(value)) {
              newErrors[field.name] = t('onboarding.profile.invalidEmail')
            }
            break
          case 'url':
            if (!validateUrl(value)) {
              newErrors[field.name] = t('onboarding.profile.invalidUrl')
            }
            break
          case 'number':
            if (isNaN(Number(value))) {
              newErrors[field.name] = t('onboarding.profile.invalidNumber')
            }
            break
        }
      }
    })

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()

    if (!validate()) return

    setIsSubmitting(true)

    try {
      const userTypeId = getSelectedUserTypeId()

      // Save profile locally
      const profile: UserProfileType = {
        email: localStorage.getItem(STORAGE_KEYS.USER_EMAIL) || '',
        name: localStorage.getItem(STORAGE_KEYS.USER_NAME) || undefined,
        user_type_id: userTypeId,
        completedAt: new Date().toISOString(),
        fields: values,
      }
      saveUserProfile(profile)

      // Also save to backend
      const sessionToken = localStorage.getItem(STORAGE_KEYS.SESSION_TOKEN)
      const response = await fetch(`${API_BASE}/users`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
        },
        body: JSON.stringify({
          email: localStorage.getItem(STORAGE_KEYS.USER_EMAIL) || undefined,
          name: localStorage.getItem(STORAGE_KEYS.USER_NAME) || undefined,
          user_type_id: userTypeId,
          fields: values,
        }),
      })

      if (!response.ok) {
        throw new Error(`Failed to save profile: ${response.status}`)
      }

      // Navigate to chat
      navigate('/chat')
    } catch (err) {
      console.error('Error saving profile:', err)
      // Still navigate on error (profile saved locally)
      navigate('/chat')
    }
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-accent animate-spin" />
      </div>
    )
  }

  if (fields.length === 0) {
    return null // Will redirect in useEffect
  }

  return (
    <OnboardingCard
      title={t('onboarding.profile.title')}
      subtitle={t('onboarding.profile.subtitle')}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {fields.map((field) => (
          <DynamicField
            key={field.id}
            field={field}
            value={values[field.name]}
            onChange={(value) => handleValueChange(field.name, value)}
            error={errors[field.name]}
          />
        ))}

        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full flex items-center justify-center gap-2 bg-accent text-accent-text rounded-xl px-6 py-3.5 font-medium hover:bg-accent-hover transition-all active-press disabled:opacity-50 disabled:cursor-not-allowed mt-6"
        >
          {isSubmitting ? (
            <>
              <div className="w-4 h-4 border-2 border-accent-text/30 border-t-accent-text rounded-full animate-spin" />
              {t('onboarding.profile.saving')}
            </>
          ) : (
            <>
              {t('onboarding.profile.continue')}
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
              </svg>
            </>
          )}
        </button>
      </form>
    </OnboardingCard>
  )
}
