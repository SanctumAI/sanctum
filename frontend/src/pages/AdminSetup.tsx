import { useState, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Paintbrush, FileText, ChevronUp, ChevronDown, Pencil, Trash2, FilePlus, Plus, Database, Upload, SquareTerminal, Users, Loader2 } from 'lucide-react'
import { OnboardingCard } from '../components/onboarding/OnboardingCard'
import { FieldEditor } from '../components/onboarding/FieldEditor'
import { ColorPicker } from '../components/onboarding/ColorPicker'
import { IconPicker } from '../components/onboarding/IconPicker'
import { CustomField, UserType, FieldType } from '../types/onboarding'
import { adminFetch, isAdminAuthenticated } from '../utils/adminApi'
import { useInstanceConfig } from '../context/InstanceConfigContext'
import { AccentColor } from '../types/instance'

const FIELD_TYPE_VALUES: FieldType[] = ['text', 'email', 'number', 'textarea', 'select', 'checkbox', 'date', 'url']

export function AdminSetup() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { config, updateConfig } = useInstanceConfig()

  const FIELD_TYPE_LABELS: Record<string, string> = Object.fromEntries(
    FIELD_TYPE_VALUES.map((type) => [type, t(`admin.fieldTypes.${type}`)])
  )
  const [instanceName, setInstanceName] = useState(config.name)
  const [accentColor, setAccentColor] = useState<AccentColor>(config.accentColor)
  const [icon, setIcon] = useState(config.icon)
  const [fields, setFields] = useState<CustomField[]>([])
  const [userTypes, setUserTypes] = useState<UserType[]>([])
  const [isEditing, setIsEditing] = useState(false)
  const [editingField, setEditingField] = useState<CustomField | undefined>()
  const [isLoading, setIsLoading] = useState(true)
  const [newTypeName, setNewTypeName] = useState('')
  const [newTypeDescription, setNewTypeDescription] = useState('')
  const [isAddingType, setIsAddingType] = useState(false)

  // Check if admin is logged in
  useEffect(() => {
    if (!isAdminAuthenticated()) {
      navigate('/')
    }
  }, [navigate])

  // Load user types and fields from API
  useEffect(() => {
    async function fetchData() {
      try {
        const [typesRes, fieldsRes] = await Promise.all([
          adminFetch('/admin/user-types'),
          adminFetch('/admin/user-fields'),
        ])

        if (typesRes.ok) {
          const typesData = await typesRes.json()
          setUserTypes(typesData.types || [])
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
          }))
          setFields(fetchedFields)
        }
      } catch (err) {
        console.error('Error fetching admin data:', err)
      } finally {
        setIsLoading(false)
      }
    }

    fetchData()
  }, [])

  // Sync config
  useEffect(() => {
    setInstanceName(config.name)
    setAccentColor(config.accentColor)
    setIcon(config.icon)
  }, [config])

  // Live preview of accent color
  const handleColorChange = (color: AccentColor) => {
    setAccentColor(color)
    updateConfig({ accentColor: color })
  }

  // Live preview of icon
  const handleIconChange = (newIcon: string) => {
    setIcon(newIcon)
    updateConfig({ icon: newIcon })
  }

  // User Type handlers
  const handleAddUserType = async () => {
    if (!newTypeName.trim()) return

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
      }
    } catch (err) {
      console.error('Error adding user type:', err)
    }
  }

  const handleRemoveUserType = async (typeId: number) => {
    try {
      const response = await adminFetch(`/admin/user-types/${typeId}`, {
        method: 'DELETE',
      })

      if (response.ok) {
        setUserTypes(userTypes.filter((t) => t.id !== typeId))
        // Remove fields associated with this type from local state
        setFields(fields.filter((f) => f.user_type_id !== typeId))
      }
    } catch (err) {
      console.error('Error removing user type:', err)
    }
  }

  const handleAddField = async (field: CustomField) => {
    try {
      const response = await adminFetch('/admin/user-fields', {
        method: 'POST',
        body: JSON.stringify({
          field_name: field.name,
          field_type: field.type,
          required: field.required,
          display_order: fields.length,
          user_type_id: field.user_type_id,
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
        }
        setFields([...fields, addedField])
      }
    } catch (err) {
      console.error('Error adding field:', err)
    }

    setIsEditing(false)
    setEditingField(undefined)
  }

  const handleUpdateField = async (field: CustomField) => {
    try {
      const response = await adminFetch(`/admin/user-fields/${field.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          field_name: field.name,
          field_type: field.type,
          required: field.required,
          user_type_id: field.user_type_id,
        }),
      })

      if (response.ok) {
        setFields(fields.map((f) => (f.id === field.id ? field : f)))
      }
    } catch (err) {
      console.error('Error updating field:', err)
    }

    setIsEditing(false)
    setEditingField(undefined)
  }

  const handleRemoveField = async (id: string) => {
    try {
      const response = await adminFetch(`/admin/user-fields/${id}`, {
        method: 'DELETE',
      })

      if (response.ok) {
        setFields(fields.filter((f) => f.id !== id))
      }
    } catch (err) {
      console.error('Error removing field:', err)
    }
  }

  const handleMoveField = (index: number, direction: 'up' | 'down') => {
    const newIndex = direction === 'up' ? index - 1 : index + 1
    if (newIndex < 0 || newIndex >= fields.length) return

    const newFields = [...fields]
    const temp = newFields[index]
    newFields[index] = newFields[newIndex]
    newFields[newIndex] = temp
    setFields(newFields)
    // Note: In a full implementation, you'd update display_order on the server
  }

  const handleEditField = (field: CustomField) => {
    setEditingField(field)
    setIsEditing(true)
  }

  // Helper to get user type name by id
  const getUserTypeName = (typeId: number | null | undefined): string => {
    if (typeId === null || typeId === undefined) return t('admin.global')
    const userType = userTypes.find((ut) => ut.id === typeId)
    return userType?.name || 'Unknown'
  }

  const handleSave = () => {
    // Save instance config
    updateConfig({ name: instanceName.trim() || t('admin.setup.defaultName'), accentColor, icon })
    navigate('/chat')
  }

  const handleBack = () => {
    navigate('/chat')
  }

  const footer = (
    <button
      onClick={handleBack}
      className="text-text-muted hover:text-text transition-colors"
    >
      {t('admin.setup.backToChat')}
    </button>
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
        <FieldEditor
          onSave={editingField ? handleUpdateField : handleAddField}
          onCancel={() => {
            setIsEditing(false)
            setEditingField(undefined)
          }}
          initialField={editingField}
          userTypes={userTypes}
        />
      ) : (
        <div className="space-y-6 stagger-children">
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
                    onChange={(e) => setInstanceName(e.target.value)}
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
                <IconPicker value={icon} onChange={handleIconChange} />
              </div>

              {/* Accent Color */}
              <div>
                <label className="text-sm font-medium text-text mb-2 block">
                  {t('admin.setup.accentColor')}
                </label>
                <ColorPicker value={accentColor} onChange={handleColorChange} />
              </div>
            </div>
          </div>

          {/* User Types Section */}
          <div className="card card-sm p-5! bg-surface-overlay!">
            <h3 className="heading-sm mb-4 flex items-center gap-2">
              <Users className="w-4 h-4 text-text-muted" />
              {t('admin.setup.userTypes')}
            </h3>
            <p className="text-xs text-text-muted mb-4">
              {t('admin.setup.userTypesHint')}
            </p>

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
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      setIsAddingType(false)
                      setNewTypeName('')
                      setNewTypeDescription('')
                    }}
                    className="flex-1 bg-surface-overlay border border-border text-text rounded-lg px-3 py-2 text-sm font-medium hover:bg-surface transition-all"
                  >
                    {t('common.cancel')}
                  </button>
                  <button
                    onClick={handleAddUserType}
                    disabled={!newTypeName.trim()}
                    className="flex-1 bg-accent text-accent-text rounded-lg px-3 py-2 text-sm font-medium hover:bg-accent-hover transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
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
                          disabled={index === 0}
                          className="p-1 text-text-muted hover:text-text disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                          title={t('common.moveUp')}
                        >
                          <ChevronUp className="w-4 h-4" />
                        </button>
                        {/* Move Down */}
                        <button
                          onClick={() => handleMoveField(index, 'down')}
                          disabled={index === fields.length - 1}
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
              onClick={() => setIsEditing(true)}
              className="w-full flex items-center justify-center gap-2 border border-dashed border-border hover:border-accent text-text-muted hover:text-accent rounded-lg px-3 py-2 text-sm transition-all"
            >
              <Plus className="w-4 h-4" />
              {t('admin.setup.addField')}
            </button>
          </div>

          {/* Knowledge Base Section */}
          <div className="card card-sm p-5! bg-surface-overlay!">
            <h3 className="heading-sm mb-4 flex items-center gap-2">
              <Database className="w-4 h-4 text-text-muted" />
              {t('admin.setup.knowledgeBase')}
            </h3>
            <p className="text-xs text-text-muted mb-4">
              {t('admin.setup.knowledgeBaseHint')}
            </p>
            <Link
              to="/admin/upload"
              className="w-full flex items-center justify-center gap-2 border border-dashed border-border hover:border-accent text-text-muted hover:text-accent rounded-lg px-3 py-2.5 text-sm transition-all"
            >
              <Upload className="w-4 h-4" />
              {t('admin.setup.uploadDocuments')}
            </Link>
          </div>

          {/* Database Section */}
          <div className="card card-sm p-5! bg-surface-overlay!">
            <h3 className="heading-sm mb-4 flex items-center gap-2">
              <Database className="w-4 h-4 text-text-muted" />
              {t('admin.setup.database')}
            </h3>
            <p className="text-xs text-text-muted mb-4">
              {t('admin.setup.databaseHint')}
            </p>
            <Link
              to="/admin/database"
              className="w-full flex items-center justify-center gap-2 border border-dashed border-border hover:border-accent text-text-muted hover:text-accent rounded-lg px-3 py-2.5 text-sm transition-all"
            >
              <SquareTerminal className="w-4 h-4" />
              {t('admin.setup.openDatabase')}
            </Link>
          </div>

          {/* Save */}
          <button
            onClick={handleSave}
            className="btn btn-primary btn-lg w-full"
          >
            {t('admin.setup.save')}
          </button>
        </div>
      )}
    </OnboardingCard>
  )
}
