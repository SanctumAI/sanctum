import { useState, useEffect, FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { OnboardingCard } from '../components/onboarding/OnboardingCard'
import { DynamicField } from '../components/onboarding/DynamicField'
import {
  CustomField,
  UserProfile as UserProfileType,
  getCustomFields,
  saveUserProfile,
  STORAGE_KEYS,
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

  // Load fields and check user is logged in
  useEffect(() => {
    const email = localStorage.getItem(STORAGE_KEYS.USER_EMAIL)
    if (!email) {
      navigate('/login')
      return
    }

    const customFields = getCustomFields()
    if (customFields.length === 0) {
      // No fields to complete, go to chat
      navigate('/chat')
      return
    }

    setFields(customFields)

    // Initialize values with empty strings or false for checkboxes
    const initialValues: Record<string, string | boolean> = {}
    customFields.forEach((field) => {
      initialValues[field.id] = field.type === 'checkbox' ? false : ''
    })
    setValues(initialValues)
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
      const value = values[field.id]

      // Required check
      if (field.required) {
        if (field.type === 'checkbox') {
          // Checkbox doesn't need to be checked for required
        } else if (!value || (typeof value === 'string' && !value.trim())) {
          newErrors[field.id] = t('onboarding.profile.fieldRequired', { field: field.name })
          return
        }
      }

      // Type-specific validation
      if (value && typeof value === 'string' && value.trim()) {
        switch (field.type) {
          case 'email':
            if (!validateEmail(value)) {
              newErrors[field.id] = t('onboarding.profile.invalidEmail')
            }
            break
          case 'url':
            if (!validateUrl(value)) {
              newErrors[field.id] = t('onboarding.profile.invalidUrl')
            }
            break
          case 'number':
            if (isNaN(Number(value))) {
              newErrors[field.id] = t('onboarding.profile.invalidNumber')
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

    // Simulate API call
    await new Promise((resolve) => setTimeout(resolve, 800))

    // Save profile
    const profile: UserProfileType = {
      email: localStorage.getItem(STORAGE_KEYS.USER_EMAIL) || '',
      name: localStorage.getItem(STORAGE_KEYS.USER_NAME) || undefined,
      completedAt: new Date().toISOString(),
      fields: values,
    }
    saveUserProfile(profile)

    // Navigate to chat
    navigate('/chat')
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
            value={values[field.id]}
            onChange={(value) => handleValueChange(field.id, value)}
            error={errors[field.id]}
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
