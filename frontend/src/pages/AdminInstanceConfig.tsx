import { useState, useEffect, useRef } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Paintbrush, FileText, ChevronUp, ChevronDown, Pencil, Trash2, FilePlus, Plus, Users, Loader2, ArrowLeft, HelpCircle, X, ChevronLeft, ChevronRight } from 'lucide-react'
import { OnboardingCard } from '../components/onboarding/OnboardingCard'
import { FieldEditor } from '../components/onboarding/FieldEditor'
import { ColorPicker } from '../components/onboarding/ColorPicker'
import { IconPicker } from '../components/onboarding/IconPicker'
import { CustomField, UserType, FieldType } from '../types/onboarding'
import { adminFetch, isAdminAuthenticated } from '../utils/adminApi'
import { useInstanceConfig } from '../context/InstanceConfigContext'
import { AccentColor } from '../types/instance'

const FIELD_TYPE_VALUES: FieldType[] = ['text', 'email', 'number', 'textarea', 'select', 'checkbox', 'date', 'url']

export function AdminInstanceConfig() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { config, updateConfig } = useInstanceConfig()

  const FIELD_TYPE_LABELS: Record<string, string> = Object.fromEntries(
    FIELD_TYPE_VALUES.map((type) => [type, t(`admin.fieldTypes.${type}`)])
  )
  const [instanceName, setInstanceName] = useState(config.name)
  // Preview state - only applies on save, not immediately
  const [previewAccentColor, setPreviewAccentColor] = useState<AccentColor>(config.accentColor)
  const [previewIcon, setPreviewIcon] = useState(config.icon)
  const [fields, setFields] = useState<CustomField[]>([])
  const [userTypes, setUserTypes] = useState<UserType[]>([])
  const [isEditing, setIsEditing] = useState(false)
  const [editingField, setEditingField] = useState<CustomField | undefined>()
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [newTypeName, setNewTypeName] = useState('')
  const [newTypeDescription, setNewTypeDescription] = useState('')
  const [isAddingType, setIsAddingType] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [addTypeError, setAddTypeError] = useState<string | null>(null)
  const [isAddingTypeLoading, setIsAddingTypeLoading] = useState(false)
  const [removeTypeError, setRemoveTypeError] = useState<string | null>(null)
  const [fieldSaving, setFieldSaving] = useState(false)
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [isReordering, setIsReordering] = useState(false)
  const [reorderError, setReorderError] = useState<string | null>(null)
  const [isDirty, setIsDirty] = useState(false)

  // User types & fields help modal state
  const [showUserHelpModal, setShowUserHelpModal] = useState(false)
  const [userHelpPage, setUserHelpPage] = useState(0)
  const userHelpModalRef = useRef<HTMLDivElement>(null)

  // Check if admin is logged in
  useEffect(() => {
    if (!isAdminAuthenticated()) {
      navigate('/admin')
    }
  }, [navigate])

  // Load user types and fields from API
  useEffect(() => {
    const abortController = new AbortController()

    async function fetchData() {
      // Don't fetch if not authenticated (prevents race with navigation)
      if (!isAdminAuthenticated()) return

      setLoadError(null)
      const errors: string[] = []

      try {
        const [typesRes, fieldsRes] = await Promise.all([
          adminFetch('/admin/user-types', { signal: abortController.signal }),
          adminFetch('/admin/user-fields', { signal: abortController.signal }),
        ])

        if (typesRes.ok) {
          const typesData = await typesRes.json()
          setUserTypes(typesData.types || [])
        } else {
          errors.push(t('admin.errors.loadTypesFailed', 'Failed to load user types'))
        }

        if (fieldsRes.ok) {
          const fieldsData = await fieldsRes.json()
          const fetchedFields: CustomField[] = (fieldsData.fields || []).map((f: any) => ({
            id: String(f.id),
            name: f.field_name,
            type: f.field_type,
            required: f.required,
            placeholder: f.placeholder,
            options: f.options,
            user_type_id: f.user_type_id,
            encryption_enabled: f.encryption_enabled ?? true,  // Default to true for security
          }))
          setFields(fetchedFields)
        } else {
          errors.push(t('admin.errors.loadFieldsFailed', 'Failed to load user fields'))
        }

        // Set accumulated errors if any
        if (errors.length > 0) {
          setLoadError(errors.join('. '))
        }
      } catch (err) {
        // Ignore abort errors
        if (err instanceof DOMException && err.name === 'AbortError') return
        console.error('Error fetching admin data:', err)
        setLoadError(err instanceof Error ? err.message : t('admin.errors.loadFailed', 'Failed to load data'))
      } finally {
        setIsLoading(false)
      }
    }

    fetchData()
    return () => abortController.abort()
  }, [t])

  // Sync config (only on initial load or external changes, skip if user has made edits)
  useEffect(() => {
    if (!isDirty) {
      setInstanceName(config.name)
      setPreviewAccentColor(config.accentColor)
      setPreviewIcon(config.icon)
    }
  }, [config, isDirty])

  // Preview handlers - only update local state, apply on save
  const handleColorChange = (color: AccentColor) => {
    setPreviewAccentColor(color)
    setIsDirty(true)
  }

  const handleIconChange = (newIcon: string) => {
    setPreviewIcon(newIcon)
    setIsDirty(true)
  }

  // User Type handlers
  const handleAddUserType = async () => {
    if (!newTypeName.trim()) return

    setIsAddingTypeLoading(true)
    setAddTypeError(null)

    try {
      const response = await adminFetch('/admin/user-types', {
        method: 'POST',
        body: JSON.stringify({
          name: newTypeName.trim(),
          description: newTypeDescription.trim() || null,
          display_order: userTypes.length,
        }),
      })

      if (response.ok) {
        const newType = await response.json()
        setUserTypes([...userTypes, newType])
        setNewTypeName('')
        setNewTypeDescription('')
        setIsAddingType(false)
      } else {
        setAddTypeError(t('admin.errors.addTypeFailed', 'Failed to add user type'))
      }
    } catch (err) {
      console.error('Error adding user type:', err)
      setAddTypeError(err instanceof Error ? err.message : t('admin.errors.addTypeFailed', 'Failed to add user type'))
    } finally {
      setIsAddingTypeLoading(false)
    }
  }

  const handleRemoveUserType = async (typeId: number) => {
    // Count fields that will be deleted
    const fieldCount = fields.filter((f) => f.user_type_id === typeId).length
    const userType = userTypes.find((ut) => ut.id === typeId)
    const typeName = userType?.name || t('common.unknown', 'Unknown')

    // Show confirmation dialog
    const message = fieldCount > 0
      ? t('admin.confirmDeleteTypeWithFields', {
          name: typeName,
          count: fieldCount,
          defaultValue: `Delete user type "${typeName}"? This will also delete ${fieldCount} associated field(s).`
        })
      : t('admin.confirmDeleteType', {
          name: typeName,
          defaultValue: `Delete user type "${typeName}"?`
        })

    if (!window.confirm(message)) {
      return
    }

    setRemoveTypeError(null)

    try {
      const response = await adminFetch(`/admin/user-types/${typeId}`, {
        method: 'DELETE',
      })

      if (response.ok) {
        setUserTypes(userTypes.filter((ut) => ut.id !== typeId))
        // Remove fields associated with this type from local state
        setFields(fields.filter((f) => f.user_type_id !== typeId))
      } else {
        setRemoveTypeError(t('admin.errors.removeTypeFailed', 'Failed to remove user type'))
      }
    } catch (err) {
      console.error('Error removing user type:', err)
      setRemoveTypeError(err instanceof Error ? err.message : t('admin.errors.removeTypeFailed', 'Failed to remove user type'))
    }
  }

  const handleAddField = async (field: CustomField) => {
    setFieldSaving(true)
    setFieldError(null)

    try {
      const response = await adminFetch('/admin/user-fields', {
        method: 'POST',
        body: JSON.stringify({
          field_name: field.name,
          field_type: field.type,
          required: field.required,
          display_order: fields.length,
          user_type_id: field.user_type_id,
          placeholder: field.placeholder || null,
          options: field.options || null,
          encryption_enabled: field.encryption_enabled ?? true,  // Secure default
        }),
      })

      if (response.ok) {
        const newField = await response.json()
        const addedField: CustomField = {
          id: String(newField.id),
          name: newField.field_name,
          type: newField.field_type,
          required: newField.required,
          placeholder: newField.placeholder,
          options: newField.options,
          user_type_id: newField.user_type_id,
          encryption_enabled: newField.encryption_enabled ?? true,
        }
        setFields([...fields, addedField])
        setIsEditing(false)
        setEditingField(undefined)
      } else {
        console.error('Failed to add field:', response.status)
        setFieldError(t('admin.errors.addFieldFailed', 'Failed to add field'))
        // Keep editor open for retry
      }
    } catch (err) {
      console.error('Error adding field:', err)
      setFieldError(err instanceof Error ? err.message : t('admin.errors.addFieldFailed', 'Failed to add field'))
      // Keep editor open for retry
    } finally {
      setFieldSaving(false)
    }
  }

  const handleUpdateField = async (field: CustomField) => {
    setFieldSaving(true)
    setFieldError(null)

    try {
      const response = await adminFetch(`/admin/user-fields/${field.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          field_name: field.name,
          field_type: field.type,
          required: field.required,
          user_type_id: field.user_type_id,
          placeholder: field.placeholder || null,
          options: field.options || null,
          encryption_enabled: field.encryption_enabled ?? true,  // Secure default
        }),
      })

      if (response.ok) {
        setFields(fields.map((f) => (f.id === field.id ? field : f)))
        setIsEditing(false)
        setEditingField(undefined)
      } else {
        console.error('Failed to update field:', response.status)
        setFieldError(t('admin.errors.updateFieldFailed', 'Failed to update field'))
        // Keep editor open for retry
      }
    } catch (err) {
      console.error('Error updating field:', err)
      setFieldError(err instanceof Error ? err.message : t('admin.errors.updateFieldFailed', 'Failed to update field'))
      // Keep editor open for retry
    } finally {
      setFieldSaving(false)
    }
  }

  const handleRemoveField = async (id: string) => {
    const field = fields.find((f) => f.id === id)
    const fieldName = field?.name || t('common.unknown', 'Unknown')

    if (!window.confirm(t('admin.confirmDeleteField', {
      name: fieldName,
      defaultValue: `Delete field "${fieldName}"?`
    }))) {
      return
    }

    setFieldError(null)  // Clear any previous error

    try {
      const response = await adminFetch(`/admin/user-fields/${id}`, {
        method: 'DELETE',
      })

      if (response.ok) {
        setFields(fields.filter((f) => f.id !== id))
      } else {
        setFieldError(t('admin.errors.removeFieldFailed', 'Failed to remove field'))
      }
    } catch (err) {
      console.error('Error removing field:', err)
      setFieldError(err instanceof Error ? err.message : t('admin.errors.removeFieldFailed', 'Failed to remove field'))
    }
  }

  const handleMoveField = async (index: number, direction: 'up' | 'down') => {
    const newIndex = direction === 'up' ? index - 1 : index + 1
    if (newIndex < 0 || newIndex >= fields.length) return

    setIsReordering(true)
    setReorderError(null)

    // Save previous state for rollback
    const previousFields = [...fields]

    // Compute new fields order
    const newFields = [...fields]
    const temp = newFields[index]
    newFields[index] = newFields[newIndex]
    newFields[newIndex] = temp

    // Persist display_order changes to backend sequentially to handle partial failures
    try {
      // First update
      const firstResponse = await adminFetch(`/admin/user-fields/${newFields[index].id}`, {
        method: 'PUT',
        body: JSON.stringify({ display_order: index }),
      })

      if (!firstResponse.ok) {
        setReorderError(t('admin.errors.reorderFailed', 'Failed to reorder field'))
        // No backend change happened, just keep previous UI state
        return
      }

      // Second update
      const secondResponse = await adminFetch(`/admin/user-fields/${newFields[newIndex].id}`, {
        method: 'PUT',
        body: JSON.stringify({ display_order: newIndex }),
      })

      if (!secondResponse.ok) {
        // First succeeded, second failed - try to revert the first one
        try {
          await adminFetch(`/admin/user-fields/${newFields[index].id}`, {
            method: 'PUT',
            body: JSON.stringify({ display_order: newIndex }), // Restore original order
          })
        } catch (revertErr) {
          // Revert failed - refetch fields to sync state
          const fieldsRes = await adminFetch('/admin/user-fields')
          if (fieldsRes.ok) {
            const fieldsData = await fieldsRes.json()
            const fetchedFields: CustomField[] = (fieldsData.fields || []).map((f: any) => ({
              id: String(f.id),
              name: f.field_name,
              type: f.field_type,
              required: f.required,
              placeholder: f.placeholder,
              options: f.options,
              user_type_id: f.user_type_id,
              encryption_enabled: f.encryption_enabled ?? true,  // Default to true for security
            }))
            setFields(fetchedFields)
            setReorderError(t('admin.errors.reorderFailed', 'Failed to reorder field'))
            return
          }
        }
        // Keep previous UI state since we reverted (or tried to)
        setReorderError(t('admin.errors.reorderFailed', 'Failed to reorder field'))
        return
      }

      // Both succeeded - update UI
      setFields(newFields)
    } catch (err) {
      // Network error - keep previous state (no backend change happened or partial)
      // Refetch to ensure UI is in sync
      try {
        const fieldsRes = await adminFetch('/admin/user-fields')
        if (fieldsRes.ok) {
          const fieldsData = await fieldsRes.json()
          const fetchedFields: CustomField[] = (fieldsData.fields || []).map((f: any) => ({
            id: String(f.id),
            name: f.field_name,
            type: f.field_type,
            required: f.required,
            placeholder: f.placeholder,
            options: f.options,
            user_type_id: f.user_type_id,
            encryption_enabled: f.encryption_enabled ?? true,  // Default to true for security
          }))
          setFields(fetchedFields)
        }
      } catch {
        // If refetch also fails, keep previous state
        setFields(previousFields)
      }
      setReorderError(t('admin.errors.reorderFailed', 'Failed to reorder field'))
    } finally {
      setIsReordering(false)
    }
  }

  const handleEditField = (field: CustomField) => {
    setEditingField(field)
    setIsEditing(true)
    setFieldError(null)
  }

  // Close user help modal
  const handleCloseUserHelpModal = () => {
    setShowUserHelpModal(false)
    setUserHelpPage(0)
  }

  // Focus trap for user help modal
  useEffect(() => {
    if (showUserHelpModal && userHelpModalRef.current) {
      userHelpModalRef.current.focus()
    }
  }, [showUserHelpModal])

  // User types & fields help pages data
  const USER_HELP_PAGES = [
    {
      title: t('admin.userHelp.overviewTitle', 'User Types & Fields Overview'),
      content: 'overview',
    },
    {
      title: t('admin.userHelp.typesTitle', 'Understanding User Types'),
      content: 'types',
    },
    {
      title: t('admin.userHelp.fieldsTitle', 'Field Types Explained'),
      content: 'fields',
    },
    {
      title: t('admin.userHelp.tipsTitle', 'Tips & Best Practices'),
      content: 'tips',
    },
  ]

  // Helper to get user type name by id
  const getUserTypeName = (typeId: number | null | undefined): string => {
    if (typeId === null || typeId === undefined) return t('admin.global')
    const userType = userTypes.find((ut) => ut.id === typeId)
    return userType?.name || t('common.unknown', 'Unknown')
  }

  const handleSave = async () => {
    // Save instance config to local context (for immediate UI updates)
    const name = instanceName.trim() || t('admin.setup.defaultName')

    setIsSaving(true)
    setSaveError(null)

    // Persist to backend API
    try {
      const response = await adminFetch('/admin/settings', {
        method: 'PUT',
        body: JSON.stringify({
          instance_name: name,
          primary_color: previewAccentColor,
          icon: previewIcon,
        }),
      })

      if (response.ok) {
        // Only update context after successful save
        updateConfig({ name, accentColor: previewAccentColor, icon: previewIcon })
        setIsDirty(false)
        navigate('/admin')
      } else {
        console.error('Failed to save settings:', response.status)
        setSaveError(t('admin.errors.saveFailed', 'Failed to save settings. Please try again.'))
      }
    } catch (err) {
      console.error('Error saving instance settings:', err)
      setSaveError(err instanceof Error ? err.message : t('admin.errors.saveFailed', 'Failed to save settings. Please try again.'))
    } finally {
      setIsSaving(false)
    }
  }

  const footer = (
    <Link to="/admin/setup" className="text-text-muted hover:text-text transition-colors">
      {t('common.back', 'Back to Dashboard')}
    </Link>
  )

  if (isLoading) {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-accent animate-spin" />
      </div>
    )
  }

  return (
    <OnboardingCard
      title={t('admin.setup.title')}
      subtitle={t('admin.setup.subtitle')}
      footer={footer}
    >
      {isEditing ? (
        <div className="space-y-4">
          {fieldError && (
            <div className="bg-error/10 border border-error/20 rounded-lg p-3">
              <p className="text-xs text-error">{fieldError}</p>
            </div>
          )}
          {fieldSaving && (
            <div className="flex items-center gap-2 text-text-muted text-sm">
              <Loader2 className="w-4 h-4 animate-spin" />
              {t('common.saving', 'Saving...')}
            </div>
          )}
          <FieldEditor
            onSave={editingField ? handleUpdateField : handleAddField}
            onCancel={() => {
              setIsEditing(false)
              setEditingField(undefined)
              setFieldError(null)
            }}
            initialField={editingField}
            userTypes={userTypes}
          />
        </div>
      ) : (
        <div className="space-y-6 stagger-children">
          {/* Load Error display */}
          {loadError && (
            <div className="bg-error/10 border border-error/20 rounded-xl p-4">
              <p className="text-sm text-error">{loadError}</p>
            </div>
          )}

          {/* Instance Branding Section */}
          <div className="card card-sm p-5! bg-surface-overlay!">
            <h3 className="heading-sm mb-4 flex items-center gap-2">
              <Paintbrush className="w-4 h-4 text-text-muted" />
              {t('admin.setup.branding')}
            </h3>

            <div className="space-y-4">
              {/* Instance Name */}
              <div>
                <label className="text-sm font-medium text-text mb-1.5 block">
                  {t('admin.setup.displayName')}
                </label>
                <div className="input-container px-4 py-3">
                  <input
                    type="text"
                    value={instanceName}
                    onChange={(e) => { setInstanceName(e.target.value); setIsDirty(true) }}
                    placeholder={t('admin.setup.defaultName')}
                    className="input-field text-sm"
                  />
                </div>
                <p className="text-xs text-text-muted mt-1.5">
                  {t('admin.setup.displayNameHint')}
                </p>
              </div>

              {/* Icon */}
              <div>
                <label className="text-sm font-medium text-text mb-2 block">
                  {t('admin.setup.icon')}
                </label>
                <IconPicker value={previewIcon} onChange={handleIconChange} />
              </div>

              {/* Accent Color */}
              <div>
                <label className="text-sm font-medium text-text mb-2 block">
                  {t('admin.setup.accentColor')}
                </label>
                <ColorPicker value={previewAccentColor} onChange={handleColorChange} />
              </div>
            </div>
          </div>

          {/* User Types Section */}
          <div className="card card-sm p-5! bg-surface-overlay!">
            <h3 className="heading-sm mb-4 flex items-center gap-2">
              <Users className="w-4 h-4 text-text-muted" />
              {t('admin.setup.userTypes')}
              <button
                onClick={() => setShowUserHelpModal(true)}
                className="ml-1 text-text-muted hover:text-accent transition-colors"
                aria-label={t('admin.userHelp.ariaLabel', 'User types and fields help')}
              >
                <HelpCircle className="w-5 h-5" />
              </button>
            </h3>
            <p className="text-xs text-text-muted mb-4">
              {t('admin.setup.userTypesHint')}
            </p>

            {/* Remove type error display */}
            {removeTypeError && (
              <div className="bg-error/10 border border-error/20 rounded-lg p-3 mb-4">
                <p className="text-xs text-error">{removeTypeError}</p>
              </div>
            )}

            {/* Types List */}
            {userTypes.length > 0 && (
              <div className="space-y-2 mb-4">
                {userTypes.map((userType) => (
                  <div
                    key={userType.id}
                    className="bg-surface border border-border rounded-xl p-3.5 flex items-center justify-between hover:border-border-strong hover:shadow-sm transition-all"
                  >
                    <div>
                      <p className="text-sm font-medium text-text">{userType.name}</p>
                      {userType.description && (
                        <p className="text-xs text-text-muted">{userType.description}</p>
                      )}
                    </div>
                    <button
                      onClick={() => handleRemoveUserType(userType.id)}
                      className="p-1 text-text-muted hover:text-error transition-colors"
                      title={t('common.remove')}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Add Type Form */}
            {isAddingType ? (
              <div className="bg-surface border border-border rounded-lg p-4 space-y-3">
                <div>
                  <label className="text-xs font-medium text-text mb-1 block">{t('admin.setup.typeName')}</label>
                  <input
                    type="text"
                    value={newTypeName}
                    onChange={(e) => setNewTypeName(e.target.value)}
                    placeholder={t('admin.setup.typeNamePlaceholder')}
                    className="w-full border border-border rounded-lg px-3 py-2 bg-surface text-text placeholder:text-text-muted text-sm focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-text mb-1 block">{t('admin.setup.typeDescription')}</label>
                  <input
                    type="text"
                    value={newTypeDescription}
                    onChange={(e) => setNewTypeDescription(e.target.value)}
                    placeholder={t('admin.setup.typeDescPlaceholder')}
                    className="w-full border border-border rounded-lg px-3 py-2 bg-surface text-text placeholder:text-text-muted text-sm focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
                  />
                </div>
                {addTypeError && (
                  <p className="text-xs text-error">{addTypeError}</p>
                )}
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      setIsAddingType(false)
                      setNewTypeName('')
                      setNewTypeDescription('')
                      setAddTypeError(null)
                    }}
                    className="flex-1 bg-surface-overlay border border-border text-text rounded-lg px-3 py-2 text-sm font-medium hover:bg-surface transition-all"
                  >
                    {t('common.cancel')}
                  </button>
                  <button
                    onClick={handleAddUserType}
                    disabled={!newTypeName.trim() || isAddingTypeLoading}
                    className="flex-1 bg-accent text-accent-text rounded-lg px-3 py-2 text-sm font-medium hover:bg-accent-hover transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    {isAddingTypeLoading && <Loader2 className="w-4 h-4 animate-spin" />}
                    {t('admin.setup.addType')}
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setIsAddingType(true)}
                className="w-full flex items-center justify-center gap-2 border border-dashed border-border hover:border-accent text-text-muted hover:text-accent rounded-lg px-3 py-2 text-sm transition-all"
              >
                <Plus className="w-4 h-4" />
                {t('admin.setup.addUserType')}
              </button>
            )}
          </div>

          {/* User Fields Section */}
          <div className="card card-sm p-5! bg-surface-overlay!">
            <h3 className="heading-sm mb-4 flex items-center gap-2">
              <FileText className="w-4 h-4 text-text-muted" />
              {t('admin.setup.onboardingFields')}
            </h3>

            {/* Field error display for deletion failures */}
            {fieldError && !isEditing && (
              <div className="bg-error/10 border border-error/20 rounded-lg p-3 mb-3">
                <p className="text-xs text-error">{fieldError}</p>
              </div>
            )}

            {/* Reorder error display */}
            {reorderError && (
              <div className="bg-error/10 border border-error/20 rounded-lg p-3 mb-3">
                <p className="text-xs text-error">{reorderError}</p>
              </div>
            )}

            {/* Fields List */}
            {fields.length > 0 ? (
              <div className="space-y-2 mb-4">
                {fields.map((field, index) => (
                  <div
                    key={field.id}
                    className="bg-surface border border-border rounded-xl p-3.5 animate-fade-in hover:border-border-strong hover:shadow-sm transition-all"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium text-text">{field.name}</p>
                          {field.required && (
                            <span className="text-[10px] bg-error/10 text-error px-1.5 py-0.5 rounded">
                              {t('common.required')}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                          <span className="text-xs text-text-muted">
                            {FIELD_TYPE_LABELS[field.type] || field.type}
                          </span>
                          {field.type === 'select' && field.options && (
                            <span className="text-xs text-text-muted">
                              • {t('admin.setup.optionsCount', { count: field.options.length })}
                            </span>
                          )}
                          <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                            field.encryption_enabled !== false
                              ? 'bg-green-100 text-green-800'
                              : 'bg-yellow-100 text-yellow-800'
                          }`}>
                            {field.encryption_enabled !== false ? '🔒 Encrypted' : '🔓 Plaintext'}
                          </span>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                            field.user_type_id === null || field.user_type_id === undefined
                              ? 'bg-accent/10 text-accent'
                              : 'bg-surface-overlay text-text-muted'
                          }`}>
                            {getUserTypeName(field.user_type_id)}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-0.5">
                        {/* Move Up */}
                        <button
                          onClick={() => handleMoveField(index, 'up')}
                          disabled={isReordering || index === 0}
                          className="p-1 text-text-muted hover:text-text disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                          title={t('common.moveUp')}
                        >
                          <ChevronUp className="w-4 h-4" />
                        </button>
                        {/* Move Down */}
                        <button
                          onClick={() => handleMoveField(index, 'down')}
                          disabled={isReordering || index === fields.length - 1}
                          className="p-1 text-text-muted hover:text-text disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                          title={t('common.moveDown')}
                        >
                          <ChevronDown className="w-4 h-4" />
                        </button>
                        {/* Edit */}
                        <button
                          onClick={() => handleEditField(field)}
                          className="p-1 text-text-muted hover:text-accent transition-colors"
                          title={t('common.edit')}
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        {/* Remove */}
                        <button
                          onClick={() => handleRemoveField(field.id)}
                          className="p-1 text-text-muted hover:text-error transition-colors"
                          title={t('common.remove')}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-6 bg-surface border border-border border-dashed rounded-lg mb-4">
                <FilePlus className="w-8 h-8 text-text-muted mx-auto mb-2" strokeWidth={1.5} />
                <p className="text-xs text-text-muted">{t('admin.setup.noFields')}</p>
              </div>
            )}

            {/* Add Field Button */}
            <button
              onClick={() => { setFieldError(null); setIsEditing(true) }}
              className="w-full flex items-center justify-center gap-2 border border-dashed border-border hover:border-accent text-text-muted hover:text-accent rounded-lg px-3 py-2 text-sm transition-all"
            >
              <Plus className="w-4 h-4" />
              {t('admin.setup.addField')}
            </button>
          </div>

          {/* Save Error display */}
          {saveError && (
            <div className="bg-error/10 border border-error/20 rounded-xl p-4">
              <p className="text-sm text-error">{saveError}</p>
            </div>
          )}

          {/* Navigation */}
          <div className="flex gap-3">
            <Link
              to="/admin/setup"
              className="flex-1 flex items-center justify-center gap-2 border border-border hover:border-accent/50 text-text rounded-xl px-4 py-3 text-sm font-medium transition-all hover:bg-surface"
            >
              <ArrowLeft className="w-4 h-4" />
              {t('common.back', 'Back')}
            </Link>
            <button
              onClick={handleSave}
              disabled={isSaving}
              className="flex-1 btn btn-primary disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {isSaving && <Loader2 className="w-4 h-4 animate-spin" />}
              {isSaving ? t('common.saving', 'Saving...') : t('admin.setup.save')}
            </button>
          </div>

          {/* User Types & Fields Help Modal */}
          {showUserHelpModal && (
            <div
              ref={userHelpModalRef}
              className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
              role="dialog"
              aria-modal="true"
              aria-labelledby="user-help-modal-title"
              onKeyDown={(e) => e.key === 'Escape' && handleCloseUserHelpModal()}
              tabIndex={-1}
            >
              <div className="bg-surface border border-border rounded-xl p-6 w-full max-w-lg mx-4 shadow-xl">
                <div className="flex items-center justify-between mb-4">
                  <h3 id="user-help-modal-title" className="text-lg font-semibold text-text flex items-center gap-2">
                    <HelpCircle className="w-5 h-5" />
                    {USER_HELP_PAGES[userHelpPage].title}
                  </h3>
                  <button
                    onClick={handleCloseUserHelpModal}
                    className="text-text-muted hover:text-text transition-colors"
                    aria-label={t('common.close', 'Close')}
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                {/* Content */}
                <div className="min-h-[280px]">
                  {USER_HELP_PAGES[userHelpPage].content === 'overview' ? (
                    <div className="space-y-3">
                      <p className="text-sm text-text-muted mb-4">
                        {t('admin.userHelp.overviewDesc', 'User Types and User Fields work together to create a customized onboarding experience for your users.')}
                      </p>
                      <div className="bg-surface-overlay border border-border rounded-lg p-4">
                        <p className="text-sm font-medium text-text mb-2">{t('admin.userHelp.twoTier', 'The two-tier system:')}</p>
                        <ul className="text-xs text-text-muted space-y-2 list-disc list-inside">
                          <li><strong>{t('admin.userHelp.userTypes', 'User Types')}</strong> - {t('admin.userHelp.userTypesExplain', 'Categories of users (e.g., "Student", "Teacher", "Researcher")')}</li>
                          <li><strong>{t('admin.userHelp.userFields', 'User Fields')}</strong> - {t('admin.userHelp.userFieldsExplain', 'Questions shown during onboarding (e.g., "Email", "Department")')}</li>
                        </ul>
                      </div>
                      <p className="text-xs text-text-muted">
                        {t('admin.userHelp.overviewNote', 'Fields can be global (shown to all users) or specific to a user type.')}
                      </p>
                    </div>
                  ) : USER_HELP_PAGES[userHelpPage].content === 'types' ? (
                    <div className="space-y-3">
                      <p className="text-sm text-text-muted mb-4">
                        {t('admin.userHelp.typesDesc', 'User Types let you segment your audience and customize their experience.')}
                      </p>
                      <div className="space-y-2">
                        <div className="bg-surface-overlay border border-border rounded-lg p-3">
                          <p className="text-sm font-medium text-text">{t('admin.userHelp.whenToUse', 'When to create user types:')}</p>
                          <ul className="text-xs text-text-muted mt-2 space-y-1 list-disc list-inside">
                            <li>{t('admin.userHelp.useCase1', 'Different user groups need different information collected')}</li>
                            <li>{t('admin.userHelp.useCase2', 'You want to personalize the AI\'s responses by user role')}</li>
                            <li>{t('admin.userHelp.useCase3', 'Analytics should be segmented by user category')}</li>
                          </ul>
                        </div>
                        <div className="bg-accent/10 border border-accent/20 rounded-lg p-3">
                          <p className="text-xs text-accent">
                            {t('admin.userHelp.typesExample', 'Example: A university might have "Student", "Faculty", and "Staff" types, each with different fields like "Year of Study" or "Department".')}
                          </p>
                        </div>
                      </div>
                    </div>
                  ) : USER_HELP_PAGES[userHelpPage].content === 'fields' ? (
                    <div className="space-y-3">
                      <p className="text-sm text-text-muted mb-4">
                        {t('admin.userHelp.fieldsDesc', 'Each field type serves a different purpose:')}
                      </p>
                      <div className="space-y-2 max-h-[200px] overflow-y-auto">
                        <div className="bg-surface-overlay border border-border rounded-lg p-2">
                          <p className="text-sm font-medium text-text">text</p>
                          <p className="text-xs text-text-muted">{t('admin.userHelp.fieldText', 'Short text input (name, title)')}</p>
                        </div>
                        <div className="bg-surface-overlay border border-border rounded-lg p-2">
                          <p className="text-sm font-medium text-text">email</p>
                          <p className="text-xs text-text-muted">{t('admin.userHelp.fieldEmail', 'Email with validation')}</p>
                        </div>
                        <div className="bg-surface-overlay border border-border rounded-lg p-2">
                          <p className="text-sm font-medium text-text">textarea</p>
                          <p className="text-xs text-text-muted">{t('admin.userHelp.fieldTextarea', 'Multi-line text (bio, notes)')}</p>
                        </div>
                        <div className="bg-surface-overlay border border-border rounded-lg p-2">
                          <p className="text-sm font-medium text-text">select</p>
                          <p className="text-xs text-text-muted">{t('admin.userHelp.fieldSelect', 'Dropdown with predefined options')}</p>
                        </div>
                        <div className="bg-surface-overlay border border-border rounded-lg p-2">
                          <p className="text-sm font-medium text-text">checkbox</p>
                          <p className="text-xs text-text-muted">{t('admin.userHelp.fieldCheckbox', 'Yes/no toggle (consent, preferences)')}</p>
                        </div>
                        <div className="bg-surface-overlay border border-border rounded-lg p-2">
                          <p className="text-sm font-medium text-text">number</p>
                          <p className="text-xs text-text-muted">{t('admin.userHelp.fieldNumber', 'Numeric input (age, quantity)')}</p>
                        </div>
                        <div className="bg-surface-overlay border border-border rounded-lg p-2">
                          <p className="text-sm font-medium text-text">date</p>
                          <p className="text-xs text-text-muted">{t('admin.userHelp.fieldDate', 'Date picker')}</p>
                        </div>
                        <div className="bg-surface-overlay border border-border rounded-lg p-2">
                          <p className="text-sm font-medium text-text">url</p>
                          <p className="text-xs text-text-muted">{t('admin.userHelp.fieldUrl', 'Website URL with validation')}</p>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <p className="text-sm text-text-muted mb-4">
                        {t('admin.userHelp.tipsDesc', 'Best practices for a great onboarding experience:')}
                      </p>
                      <div className="space-y-2">
                        <div className="bg-surface-overlay border border-border rounded-lg p-3">
                          <p className="text-sm font-medium text-text">{t('admin.userHelp.tipRequired', 'Required vs Optional')}</p>
                          <p className="text-xs text-text-muted mt-1">
                            {t('admin.userHelp.tipRequiredDesc', 'Only mark fields as required if you truly need them. More optional fields = higher completion rates.')}
                          </p>
                        </div>
                        <div className="bg-surface-overlay border border-border rounded-lg p-3">
                          <p className="text-sm font-medium text-text">{t('admin.userHelp.tipOrder', 'Field Ordering')}</p>
                          <p className="text-xs text-text-muted mt-1">
                            {t('admin.userHelp.tipOrderDesc', 'Put the most important fields first. Users are more likely to complete early fields.')}
                          </p>
                        </div>
                        <div className="bg-surface-overlay border border-border rounded-lg p-3">
                          <p className="text-sm font-medium text-text">{t('admin.userHelp.tipGlobal', 'Global Fields')}</p>
                          <p className="text-xs text-text-muted mt-1">
                            {t('admin.userHelp.tipGlobalDesc', 'Fields without a user type are shown to everyone. Use these for universal information like email.')}
                          </p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Pagination */}
                <div className="flex items-center justify-between mt-6 pt-4 border-t border-border">
                  <button
                    onClick={() => setUserHelpPage((prev) => Math.max(0, prev - 1))}
                    disabled={userHelpPage === 0}
                    className="flex items-center gap-1 text-sm text-text-muted hover:text-text disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  >
                    <ChevronLeft className="w-4 h-4" />
                    {t('common.previous', 'Previous')}
                  </button>

                  {/* Page indicators */}
                  <div className="flex items-center gap-1.5">
                    {USER_HELP_PAGES.map((_, index) => (
                      <button
                        key={index}
                        onClick={() => setUserHelpPage(index)}
                        className={`w-2 h-2 rounded-full transition-colors ${
                          index === userHelpPage
                            ? 'bg-accent'
                            : 'bg-border hover:bg-text-muted'
                        }`}
                        aria-label={`${t('common.goToPage', 'Go to page')} ${index + 1}`}
                      />
                    ))}
                  </div>

                  <button
                    onClick={() => setUserHelpPage((prev) => Math.min(USER_HELP_PAGES.length - 1, prev + 1))}
                    disabled={userHelpPage === USER_HELP_PAGES.length - 1}
                    className="flex items-center gap-1 text-sm text-text-muted hover:text-text disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  >
                    {t('common.next', 'Next')}
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </OnboardingCard>
  )
}
