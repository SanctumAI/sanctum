import { useState, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { Paintbrush, FileText, ChevronUp, ChevronDown, Pencil, Trash2, FilePlus, Plus, Database, Upload, SquareTerminal, Users, Loader2 } from 'lucide-react'
import { OnboardingCard } from '../components/onboarding/OnboardingCard'
import { FieldEditor } from '../components/onboarding/FieldEditor'
import { ColorPicker } from '../components/onboarding/ColorPicker'
import { IconPicker } from '../components/onboarding/IconPicker'
import { CustomField, UserType } from '../types/onboarding'
import { adminFetch, isAdminAuthenticated } from '../utils/adminApi'
import { useInstanceConfig } from '../context/InstanceConfigContext'
import { AccentColor } from '../types/instance'

const FIELD_TYPE_LABELS: Record<string, string> = {
  text: 'Text',
  email: 'Email',
  number: 'Number',
  textarea: 'Text Area',
  select: 'Dropdown',
  checkbox: 'Checkbox',
  date: 'Date',
  url: 'URL',
}

export function AdminSetup() {
  const navigate = useNavigate()
  const { config, updateConfig } = useInstanceConfig()
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
    if (typeId === null || typeId === undefined) return 'Global'
    const userType = userTypes.find((t) => t.id === typeId)
    return userType?.name || 'Unknown'
  }

  const handleSave = () => {
    // Save instance config
    updateConfig({ name: instanceName.trim() || 'Sanctum', accentColor, icon })
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
      Back to Chat
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
      title="Configure Your Instance"
      subtitle="Customize the branding and user onboarding experience"
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
        <div className="space-y-6">
          {/* Instance Branding Section */}
          <div className="bg-surface-overlay border border-border rounded-xl p-5">
            <h3 className="text-sm font-semibold text-text mb-4 flex items-center gap-2">
              <Paintbrush className="w-4 h-4 text-text-muted" />
              Instance Branding
            </h3>

            <div className="space-y-4">
              {/* Instance Name */}
              <div>
                <label className="text-sm font-medium text-text mb-1.5 block">
                  Display Name
                </label>
                <div className="border border-border rounded-xl px-4 py-3 bg-surface focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/20 transition-all">
                  <input
                    type="text"
                    value={instanceName}
                    onChange={(e) => setInstanceName(e.target.value)}
                    placeholder="Sanctum"
                    className="w-full bg-transparent outline-none text-text placeholder:text-text-muted text-sm"
                  />
                </div>
                <p className="text-xs text-text-muted mt-1.5">
                  This name appears in the header and onboarding screens
                </p>
              </div>

              {/* Icon */}
              <div>
                <label className="text-sm font-medium text-text mb-2 block">
                  Icon
                </label>
                <IconPicker value={icon} onChange={handleIconChange} />
              </div>

              {/* Accent Color */}
              <div>
                <label className="text-sm font-medium text-text mb-2 block">
                  Accent Color
                </label>
                <ColorPicker value={accentColor} onChange={handleColorChange} />
              </div>
            </div>
          </div>

          {/* User Types Section */}
          <div className="bg-surface-overlay border border-border rounded-xl p-5">
            <h3 className="text-sm font-semibold text-text mb-4 flex items-center gap-2">
              <Users className="w-4 h-4 text-text-muted" />
              User Types
            </h3>
            <p className="text-xs text-text-muted mb-4">
              Define different user types to show type-specific onboarding questions. If you have more than one type, users will choose their type during onboarding.
            </p>

            {/* Types List */}
            {userTypes.length > 0 && (
              <div className="space-y-2 mb-4">
                {userTypes.map((userType) => (
                  <div
                    key={userType.id}
                    className="bg-surface border border-border rounded-lg p-3 flex items-center justify-between"
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
                      title="Remove"
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
                  <label className="text-xs font-medium text-text mb-1 block">Type Name</label>
                  <input
                    type="text"
                    value={newTypeName}
                    onChange={(e) => setNewTypeName(e.target.value)}
                    placeholder="e.g., Researcher, Student"
                    className="w-full border border-border rounded-lg px-3 py-2 bg-surface text-text placeholder:text-text-muted text-sm focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-text mb-1 block">Description (optional)</label>
                  <input
                    type="text"
                    value={newTypeDescription}
                    onChange={(e) => setNewTypeDescription(e.target.value)}
                    placeholder="e.g., For academic researchers"
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
                    Cancel
                  </button>
                  <button
                    onClick={handleAddUserType}
                    disabled={!newTypeName.trim()}
                    className="flex-1 bg-accent text-accent-text rounded-lg px-3 py-2 text-sm font-medium hover:bg-accent-hover transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Add Type
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setIsAddingType(true)}
                className="w-full flex items-center justify-center gap-2 border border-dashed border-border hover:border-accent text-text-muted hover:text-accent rounded-lg px-3 py-2 text-sm transition-all"
              >
                <Plus className="w-4 h-4" />
                Add User Type
              </button>
            )}
          </div>

          {/* User Fields Section */}
          <div className="bg-surface-overlay border border-border rounded-xl p-5">
            <h3 className="text-sm font-semibold text-text mb-4 flex items-center gap-2">
              <FileText className="w-4 h-4 text-text-muted" />
              User Onboarding Fields
            </h3>

            {/* Fields List */}
            {fields.length > 0 ? (
              <div className="space-y-2 mb-4">
                {fields.map((field, index) => (
                  <div
                    key={field.id}
                    className="bg-surface border border-border rounded-lg p-3 animate-fade-in"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium text-text">{field.name}</p>
                          {field.required && (
                            <span className="text-[10px] bg-error/10 text-error px-1.5 py-0.5 rounded">
                              Required
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                          <span className="text-xs text-text-muted">
                            {FIELD_TYPE_LABELS[field.type] || field.type}
                          </span>
                          {field.type === 'select' && field.options && (
                            <span className="text-xs text-text-muted">
                              • {field.options.length} options
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
                          title="Move up"
                        >
                          <ChevronUp className="w-4 h-4" />
                        </button>
                        {/* Move Down */}
                        <button
                          onClick={() => handleMoveField(index, 'down')}
                          disabled={index === fields.length - 1}
                          className="p-1 text-text-muted hover:text-text disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                          title="Move down"
                        >
                          <ChevronDown className="w-4 h-4" />
                        </button>
                        {/* Edit */}
                        <button
                          onClick={() => handleEditField(field)}
                          className="p-1 text-text-muted hover:text-accent transition-colors"
                          title="Edit"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        {/* Remove */}
                        <button
                          onClick={() => handleRemoveField(field.id)}
                          className="p-1 text-text-muted hover:text-error transition-colors"
                          title="Remove"
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
                <p className="text-xs text-text-muted">No custom fields</p>
              </div>
            )}

            {/* Add Field Button */}
            <button
              onClick={() => setIsEditing(true)}
              className="w-full flex items-center justify-center gap-2 border border-dashed border-border hover:border-accent text-text-muted hover:text-accent rounded-lg px-3 py-2 text-sm transition-all"
            >
              <Plus className="w-4 h-4" />
              Add Field
            </button>
          </div>

          {/* Knowledge Base Section */}
          <div className="bg-surface-overlay border border-border rounded-xl p-5">
            <h3 className="text-sm font-semibold text-text mb-4 flex items-center gap-2">
              <Database className="w-4 h-4 text-text-muted" />
              Knowledge Base
            </h3>
            <p className="text-xs text-text-muted mb-4">
              Upload documents to build your RAG knowledge base for AI-powered responses.
            </p>
            <Link
              to="/admin/upload"
              className="w-full flex items-center justify-center gap-2 border border-dashed border-border hover:border-accent text-text-muted hover:text-accent rounded-lg px-3 py-2.5 text-sm transition-all"
            >
              <Upload className="w-4 h-4" />
              Upload Documents
            </Link>
          </div>

          {/* Database Section */}
          <div className="bg-surface-overlay border border-border rounded-xl p-5">
            <h3 className="text-sm font-semibold text-text mb-4 flex items-center gap-2">
              <Database className="w-4 h-4 text-text-muted" />
              Database
            </h3>
            <p className="text-xs text-text-muted mb-4">
              View and manage your instance data directly in the SQLite database.
            </p>
            <Link
              to="/admin/database"
              className="w-full flex items-center justify-center gap-2 border border-dashed border-border hover:border-accent text-text-muted hover:text-accent rounded-lg px-3 py-2.5 text-sm transition-all"
            >
              <SquareTerminal className="w-4 h-4" />
              Open Database Explorer
            </Link>
          </div>

          {/* Save */}
          <button
            onClick={handleSave}
            className="w-full bg-accent text-accent-text rounded-xl px-6 py-3.5 font-medium hover:bg-accent-hover transition-all active-press"
          >
            Save Configuration
          </button>
        </div>
      )}
    </OnboardingCard>
  )
}
