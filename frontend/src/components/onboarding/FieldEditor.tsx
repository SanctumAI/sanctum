import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CustomField, FieldType, UserType } from '../../types/onboarding'

interface FieldEditorProps {
  onSave: (field: CustomField) => void
  onCancel: () => void
  initialField?: CustomField
  userTypes?: UserType[]
}

const FIELD_TYPE_VALUES: FieldType[] = ['text', 'email', 'number', 'textarea', 'select', 'checkbox', 'date', 'url']

export function FieldEditor({ onSave, onCancel, initialField, userTypes = [] }: FieldEditorProps) {
  const { t } = useTranslation()

  const FIELD_TYPES = FIELD_TYPE_VALUES.map((value) => ({
    value,
    label: t(`admin.fieldTypes.${value}`),
    description: t(`admin.fieldTypes.${value}Desc`),
  }))
  const [name, setName] = useState(initialField?.name || '')
  const [type, setType] = useState<FieldType>(initialField?.type || 'text')
  const [required, setRequired] = useState(initialField?.required ?? true)
  const [placeholder, setPlaceholder] = useState(initialField?.placeholder || '')
  const [options, setOptions] = useState<string[]>(initialField?.options || [''])
  const [userTypeId, setUserTypeId] = useState<number | null>(initialField?.user_type_id ?? null)
  const [encryptionEnabled, setEncryptionEnabled] = useState(initialField?.encryption_enabled ?? true)
  const [includeInChat, setIncludeInChat] = useState(initialField?.include_in_chat ?? false)
  const [errors, setErrors] = useState<{ name?: string; options?: string }>({})

  const handleAddOption = () => {
    setOptions([...options, ''])
  }

  const handleRemoveOption = (index: number) => {
    setOptions(options.filter((_, i) => i !== index))
  }

  const handleOptionChange = (index: number, value: string) => {
    const newOptions = [...options]
    newOptions[index] = value
    setOptions(newOptions)
  }

  const validate = (): boolean => {
    const newErrors: { name?: string; options?: string } = {}

    if (!name.trim()) {
      newErrors.name = t('admin.fields.nameRequired')
    }

    if (type === 'select') {
      const validOptions = options.filter((o) => o.trim())
      if (validOptions.length < 2) {
        newErrors.options = t('admin.fields.optionsRequired')
      }
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSave = () => {
    if (!validate()) return

    const field: CustomField = {
      id: initialField?.id || `field_${Date.now()}`,
      name: name.trim(),
      type,
      required,
      placeholder: placeholder.trim() || undefined,
      options: type === 'select' ? options.filter((o) => o.trim()) : undefined,
      user_type_id: userTypeId,
      encryption_enabled: encryptionEnabled,
      // Only include in chat if not encrypted
      include_in_chat: encryptionEnabled ? false : includeInChat,
    }

    onSave(field)
  }

  // Auto-disable include_in_chat when encryption is enabled
  const handleEncryptionToggle = () => {
    const newEncryption = !encryptionEnabled
    setEncryptionEnabled(newEncryption)
    // If enabling encryption, auto-disable include_in_chat
    if (newEncryption) {
      setIncludeInChat(false)
    }
  }

  return (
    <div className="card card-sm animate-fade-in p-6">
      <h3 className="heading-lg mb-4">
        {initialField ? t('admin.fields.editField') : t('admin.fields.addField')}
      </h3>

      <div className="space-y-4">
        {/* Field Name */}
        <div>
          <label className="text-sm font-medium text-text mb-1.5 block">
            {t('admin.fields.fieldName')} <span className="text-error">*</span>
          </label>
          <div className={`input-container px-4 py-3 ${errors.name ? 'has-error' : ''}`}>
            <input
              type="text"
              value={name}
              onChange={(e) => {
                setName(e.target.value)
                if (errors.name) setErrors((prev) => ({ ...prev, name: undefined }))
              }}
              placeholder={t('admin.fields.fieldNamePlaceholder')}
              className="input-field text-sm"
            />
          </div>
          {errors.name && <p className="text-xs text-error mt-1.5">{errors.name}</p>}
        </div>

        {/* User Type Selector - only show if there are user types */}
        {userTypes.length > 0 && (
          <div>
            <label className="text-sm font-medium text-text mb-1.5 block">
              {t('admin.fields.applyTo')}
            </label>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setUserTypeId(null)}
                className={`px-3 py-2 rounded-lg border text-sm transition-all ${
                  userTypeId === null
                    ? 'border-accent bg-accent/10 text-text'
                    : 'border-border hover:border-accent/50 text-text-secondary hover:text-text'
                }`}
              >
                {t('admin.fields.allUsers')}
              </button>
              {userTypes.map((ut) => (
                <button
                  key={ut.id}
                  type="button"
                  onClick={() => setUserTypeId(ut.id)}
                  className={`px-3 py-2 rounded-lg border text-sm transition-all ${
                    userTypeId === ut.id
                      ? 'border-accent bg-accent/10 text-text'
                      : 'border-border hover:border-accent/50 text-text-secondary hover:text-text'
                  }`}
                >
                  {ut.name}
                </button>
              ))}
            </div>
            <p className="text-xs text-text-muted mt-1.5">
              {t('admin.fields.globalHint')}
            </p>
          </div>
        )}

        {/* Field Type */}
        <div>
          <label className="text-sm font-medium text-text mb-1.5 block">{t('admin.fields.fieldType')}</label>
          <div className="grid grid-cols-2 gap-2">
            {FIELD_TYPES.map((ft) => (
              <button
                key={ft.value}
                type="button"
                onClick={() => setType(ft.value)}
                className={`text-left p-3 rounded-lg border transition-all ${
                  type === ft.value
                    ? 'border-accent bg-accent/10 text-text'
                    : 'border-border hover:border-accent/50 text-text-secondary hover:text-text'
                }`}
              >
                <p className="text-sm font-medium">{ft.label}</p>
                <p className="text-xs text-text-muted">{ft.description}</p>
              </button>
            ))}
          </div>
        </div>

        {/* Options for Select */}
        {type === 'select' && (
          <div>
            <label className="text-sm font-medium text-text mb-1.5 block">
              {t('admin.fields.options')} <span className="text-error">*</span>
            </label>
            <div className="space-y-2">
              {options.map((option, index) => (
                <div key={index} className="flex gap-2">
                  <div className="flex-1 border border-border rounded-xl px-4 py-2.5 bg-surface focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/20 transition-all">
                    <input
                      type="text"
                      value={option}
                      onChange={(e) => handleOptionChange(index, e.target.value)}
                      placeholder={t('admin.fields.optionPlaceholder', { number: index + 1 })}
                      className="w-full bg-transparent outline-none text-text placeholder:text-text-muted text-sm"
                    />
                  </div>
                  {options.length > 1 && (
                    <button
                      type="button"
                      onClick={() => handleRemoveOption(index)}
                      className="p-2.5 text-text-muted hover:text-error transition-colors"
                    >
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  )}
                </div>
              ))}
              <button
                type="button"
                onClick={handleAddOption}
                className="text-sm text-accent hover:text-accent-hover transition-colors"
              >
                {t('admin.fields.addOption')}
              </button>
            </div>
            {errors.options && <p className="text-xs text-error mt-1">{errors.options}</p>}
          </div>
        )}

        {/* Placeholder */}
        {type !== 'checkbox' && type !== 'select' && (
          <div>
            <label className="text-sm font-medium text-text mb-1.5 block">
              {t('admin.fields.placeholder')} <span className="text-text-muted">{t('admin.fields.placeholderOptional')}</span>
            </label>
            <div className="border border-border rounded-xl px-4 py-3 bg-surface focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/20 transition-all">
              <input
                type="text"
                value={placeholder}
                onChange={(e) => setPlaceholder(e.target.value)}
                placeholder={t('admin.fields.placeholderHint')}
                className="w-full bg-transparent outline-none text-text placeholder:text-text-muted text-sm"
              />
            </div>
          </div>
        )}

        {/* Required Toggle */}
        <label className="flex items-center gap-3 cursor-pointer py-2">
          <div
            onClick={() => setRequired(!required)}
            className={`w-5 h-5 rounded-md border-2 flex items-center justify-center transition-colors ${
              required ? 'bg-accent border-accent' : 'border-border hover:border-accent/50'
            }`}
          >
            {required && (
              <svg className="w-3 h-3 text-accent-text" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            )}
          </div>
          <span className="text-sm text-text">{t('admin.fields.requiredField')}</span>
        </label>

        {/* Encryption Toggle */}
        <div className="space-y-2">
          <label className="flex items-center gap-3 cursor-pointer py-2">
            <div
              onClick={handleEncryptionToggle}
              className={`w-5 h-5 rounded-md border-2 flex items-center justify-center transition-colors ${
                encryptionEnabled ? 'bg-green-600 border-green-600' : 'border-border hover:border-accent/50'
              }`}
            >
              {encryptionEnabled && (
                <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              )}
            </div>
            <div className="flex-1">
              <span className="text-sm text-text font-medium">
                {encryptionEnabled ? t('admin.fields.encryptEnabled') : t('admin.fields.encryptDisabled')}
              </span>
              <p className="text-xs text-text-muted">
                {encryptionEnabled
                  ? t('admin.fields.encryptedHint')
                  : t('admin.fields.plaintextHint')}
              </p>
            </div>
          </label>

          {!encryptionEnabled && (
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
              <div className="flex items-start gap-2">
                <svg className="w-4 h-4 text-yellow-600 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.582 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
                <div>
                  <p className="text-sm font-medium text-yellow-800">{t('admin.fields.securityWarning')}</p>
                  <p className="text-xs text-yellow-700 mt-1">
                    {t('admin.fields.securityWarningBody')}
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Include in AI Chat Toggle - only show for unencrypted fields */}
        {!encryptionEnabled && (
          <div className="space-y-2">
            <label className="flex items-center gap-3 cursor-pointer py-2">
              <div
                onClick={() => setIncludeInChat(!includeInChat)}
                className={`w-5 h-5 rounded-md border-2 flex items-center justify-center transition-colors ${
                  includeInChat ? 'bg-accent border-accent' : 'border-border hover:border-accent/50'
                }`}
              >
                {includeInChat && (
                  <svg className="w-3 h-3 text-accent-text" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </div>
              <div className="flex-1">
                <span className="text-sm text-text font-medium">
                  {t('admin.fields.includeInChat')}
                </span>
                <p className="text-xs text-text-muted">
                  {t('admin.fields.includeInChatHint')}
                </p>
              </div>
            </label>

            {includeInChat && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                <div className="flex items-start gap-2">
                  <svg className="w-4 h-4 text-blue-600 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <div>
                    <p className="text-sm font-medium text-blue-800">{t('admin.fields.aiPersonalization')}</p>
                    <p className="text-xs text-blue-700 mt-1">
                      {t('admin.fields.aiPersonalizationBody')}
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Note when encrypted - explain why include in chat is not available */}
        {encryptionEnabled && (
          <div className="bg-surface-overlay border border-border rounded-lg p-3">
            <p className="text-xs text-text-muted">
              {t('admin.fields.encryptedChatNote')}
            </p>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex gap-3 mt-6 pt-4 border-t border-border">
        <button
          type="button"
          onClick={onCancel}
          className="btn btn-secondary btn-md flex-1"
        >
          {t('common.cancel')}
        </button>
        <button
          type="button"
          onClick={handleSave}
          className="btn btn-primary btn-md flex-1"
        >
          {initialField ? t('common.saveChanges') : t('admin.fields.addField')}
        </button>
      </div>
    </div>
  )
}
