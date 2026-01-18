import { useState } from 'react'
import { CustomField, FieldType } from '../../types/onboarding'

interface FieldEditorProps {
  onSave: (field: CustomField) => void
  onCancel: () => void
  initialField?: CustomField
}

const FIELD_TYPES: { value: FieldType; label: string; description: string }[] = [
  { value: 'text', label: 'Text', description: 'Single-line text input' },
  { value: 'email', label: 'Email', description: 'Email with validation' },
  { value: 'number', label: 'Number', description: 'Numeric input' },
  { value: 'textarea', label: 'Text Area', description: 'Multi-line text' },
  { value: 'select', label: 'Dropdown', description: 'Select from options' },
  { value: 'checkbox', label: 'Checkbox', description: 'Yes/no toggle' },
  { value: 'date', label: 'Date', description: 'Date picker' },
  { value: 'url', label: 'URL', description: 'Website link' },
]

export function FieldEditor({ onSave, onCancel, initialField }: FieldEditorProps) {
  const [name, setName] = useState(initialField?.name || '')
  const [type, setType] = useState<FieldType>(initialField?.type || 'text')
  const [required, setRequired] = useState(initialField?.required ?? true)
  const [placeholder, setPlaceholder] = useState(initialField?.placeholder || '')
  const [options, setOptions] = useState<string[]>(initialField?.options || [''])
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
      newErrors.name = 'Field name is required'
    }

    if (type === 'select') {
      const validOptions = options.filter((o) => o.trim())
      if (validOptions.length < 2) {
        newErrors.options = 'At least 2 options required'
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
    }

    onSave(field)
  }

  return (
    <div className="bg-surface-raised border border-border rounded-xl p-6 animate-fade-in">
      <h3 className="text-lg font-semibold text-text mb-4">
        {initialField ? 'Edit Field' : 'Add New Field'}
      </h3>

      <div className="space-y-4">
        {/* Field Name */}
        <div>
          <label className="text-sm font-medium text-text mb-1.5 block">
            Field Name <span className="text-error">*</span>
          </label>
          <div
            className={`border rounded-xl px-4 py-3 bg-surface transition-all ${
              errors.name
                ? 'border-error focus-within:ring-2 focus-within:ring-error/20'
                : 'border-border focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/20'
            }`}
          >
            <input
              type="text"
              value={name}
              onChange={(e) => {
                setName(e.target.value)
                if (errors.name) setErrors((prev) => ({ ...prev, name: undefined }))
              }}
              placeholder="e.g., Company Name"
              className="w-full bg-transparent outline-none text-text placeholder:text-text-muted text-sm"
            />
          </div>
          {errors.name && <p className="text-xs text-error mt-1">{errors.name}</p>}
        </div>

        {/* Field Type */}
        <div>
          <label className="text-sm font-medium text-text mb-1.5 block">Field Type</label>
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
              Options <span className="text-error">*</span>
            </label>
            <div className="space-y-2">
              {options.map((option, index) => (
                <div key={index} className="flex gap-2">
                  <div className="flex-1 border border-border rounded-xl px-4 py-2.5 bg-surface focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/20 transition-all">
                    <input
                      type="text"
                      value={option}
                      onChange={(e) => handleOptionChange(index, e.target.value)}
                      placeholder={`Option ${index + 1}`}
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
                + Add option
              </button>
            </div>
            {errors.options && <p className="text-xs text-error mt-1">{errors.options}</p>}
          </div>
        )}

        {/* Placeholder */}
        {type !== 'checkbox' && type !== 'select' && (
          <div>
            <label className="text-sm font-medium text-text mb-1.5 block">
              Placeholder <span className="text-text-muted">(optional)</span>
            </label>
            <div className="border border-border rounded-xl px-4 py-3 bg-surface focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/20 transition-all">
              <input
                type="text"
                value={placeholder}
                onChange={(e) => setPlaceholder(e.target.value)}
                placeholder="Hint text shown in the input"
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
          <span className="text-sm text-text">Required field</span>
        </label>
      </div>

      {/* Actions */}
      <div className="flex gap-3 mt-6 pt-4 border-t border-border">
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 bg-surface-overlay border border-border text-text rounded-xl px-4 py-2.5 text-sm font-medium hover:bg-surface transition-all"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSave}
          className="flex-1 bg-accent text-accent-text rounded-xl px-4 py-2.5 text-sm font-medium hover:bg-accent-hover transition-all active-press"
        >
          {initialField ? 'Save Changes' : 'Add Field'}
        </button>
      </div>
    </div>
  )
}
