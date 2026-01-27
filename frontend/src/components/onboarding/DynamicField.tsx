import { useTranslation } from 'react-i18next'
import { CustomField } from '../../types/onboarding'

interface DynamicFieldProps {
  field: CustomField
  value: string | boolean
  onChange: (value: string | boolean) => void
  error?: string
}

export function DynamicField({ field, value, onChange, error }: DynamicFieldProps) {
  const { t } = useTranslation()
  const baseInputClasses = `input-field text-sm`
  const containerClasses = `input-container px-4 py-3 ${error ? 'has-error' : ''}`

  const renderInput = () => {
    switch (field.type) {
      case 'text':
      case 'email':
      case 'url':
        return (
          <div className={containerClasses}>
            <input
              type={field.type}
              value={value as string}
              onChange={(e) => onChange(e.target.value)}
              placeholder={field.placeholder || t('onboarding.profile.enterField', { field: field.name.toLowerCase() })}
              className={baseInputClasses}
            />
          </div>
        )

      case 'number':
        return (
          <div className={containerClasses}>
            <input
              type="number"
              value={value as string}
              onChange={(e) => onChange(e.target.value)}
              placeholder={field.placeholder || t('onboarding.profile.enterField', { field: field.name.toLowerCase() })}
              className={baseInputClasses}
            />
          </div>
        )

      case 'date':
        return (
          <div className={containerClasses}>
            <input
              type="date"
              value={value as string}
              onChange={(e) => onChange(e.target.value)}
              className={baseInputClasses}
            />
          </div>
        )

      case 'textarea':
        return (
          <div className={containerClasses}>
            <textarea
              value={value as string}
              onChange={(e) => onChange(e.target.value)}
              placeholder={field.placeholder || t('onboarding.profile.enterField', { field: field.name.toLowerCase() })}
              rows={3}
              className={`${baseInputClasses} resize-none`}
            />
          </div>
        )

      case 'select':
        return (
          <div className={containerClasses}>
            <select
              value={value as string}
              onChange={(e) => onChange(e.target.value)}
              className={`${baseInputClasses} cursor-pointer`}
            >
              <option value="">{t('onboarding.profile.selectOption')}</option>
              {field.options?.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </div>
        )

      case 'checkbox':
        return (
          <label className="flex items-center gap-3 cursor-pointer py-2">
            <div
              className={`w-5 h-5 rounded-md border-2 flex items-center justify-center transition-colors ${
                value
                  ? 'bg-accent border-accent'
                  : 'border-border hover:border-accent/50'
              }`}
              onClick={() => onChange(!value)}
            >
              {value && (
                <svg
                  className="w-3 h-3 text-accent-text"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={3}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              )}
            </div>
            <span className="text-sm text-text">{field.placeholder || field.name}</span>
          </label>
        )

      default:
        return null
    }
  }

  return (
    <div className="space-y-1.5">
      {field.type !== 'checkbox' && (
        <label className="text-sm font-medium text-text block">
          {field.name}
          {field.required && <span className="text-error ml-1">*</span>}
        </label>
      )}
      {renderInput()}
      {error && <p className="text-xs text-error">{error}</p>}
    </div>
  )
}
