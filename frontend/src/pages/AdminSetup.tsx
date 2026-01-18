import { useState, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { Paintbrush, FileText, ChevronUp, ChevronDown, Pencil, Trash2, FilePlus, Plus, Database, Upload, SquareTerminal } from 'lucide-react'
import { OnboardingCard } from '../components/onboarding/OnboardingCard'
import { FieldEditor } from '../components/onboarding/FieldEditor'
import { ColorPicker } from '../components/onboarding/ColorPicker'
import { IconPicker } from '../components/onboarding/IconPicker'
import { CustomField, getCustomFields, saveCustomFields, STORAGE_KEYS } from '../types/onboarding'
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
  const [isEditing, setIsEditing] = useState(false)
  const [editingField, setEditingField] = useState<CustomField | undefined>()

  // Check if admin is logged in
  useEffect(() => {
    const pubkey = localStorage.getItem(STORAGE_KEYS.ADMIN_PUBKEY)
    if (!pubkey) {
      navigate('/admin')
    }
  }, [navigate])

  // Load existing fields and sync config
  useEffect(() => {
    setFields(getCustomFields())
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

  const handleAddField = (field: CustomField) => {
    const newFields = [...fields, field]
    setFields(newFields)
    saveCustomFields(newFields)
    setIsEditing(false)
    setEditingField(undefined)
  }

  const handleUpdateField = (field: CustomField) => {
    const newFields = fields.map((f) => (f.id === field.id ? field : f))
    setFields(newFields)
    saveCustomFields(newFields)
    setIsEditing(false)
    setEditingField(undefined)
  }

  const handleRemoveField = (id: string) => {
    const newFields = fields.filter((f) => f.id !== id)
    setFields(newFields)
    saveCustomFields(newFields)
  }

  const handleMoveField = (index: number, direction: 'up' | 'down') => {
    const newIndex = direction === 'up' ? index - 1 : index + 1
    if (newIndex < 0 || newIndex >= fields.length) return

    const newFields = [...fields]
    const temp = newFields[index]
    newFields[index] = newFields[newIndex]
    newFields[newIndex] = temp
    setFields(newFields)
    saveCustomFields(newFields)
  }

  const handleEditField = (field: CustomField) => {
    setEditingField(field)
    setIsEditing(true)
  }

  const handleSaveAndContinue = () => {
    // Save instance config
    updateConfig({ name: instanceName.trim() || 'Sanctum', accentColor, icon })
    navigate('/')
  }

  const handleSkip = () => {
    navigate('/')
  }

  const footer = (
    <button
      onClick={handleSkip}
      className="text-text-muted hover:text-text transition-colors"
    >
      Skip for now
    </button>
  )

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
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-xs text-text-muted">
                            {FIELD_TYPE_LABELS[field.type] || field.type}
                          </span>
                          {field.type === 'select' && field.options && (
                            <span className="text-xs text-text-muted">
                              • {field.options.length} options
                            </span>
                          )}
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

          {/* Save and Continue */}
          <button
            onClick={handleSaveAndContinue}
            className="w-full bg-accent text-accent-text rounded-xl px-6 py-3.5 font-medium hover:bg-accent-hover transition-all active-press"
          >
            Save & Continue
          </button>
        </div>
      )}
    </OnboardingCard>
  )
}
