import { useState, useEffect, useRef } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  ArrowLeft,
  Loader2,
  Sliders,
  MessageSquare,
  FileText,
  Search,
  Save,
  Eye,
  ToggleLeft,
  ToggleRight,
  AlertCircle,
  HelpCircle,
  X,
  ChevronLeft,
  ChevronRight,
  Users,
  Undo2,
  Globe,
} from 'lucide-react'
import { OnboardingCard } from '../components/onboarding/OnboardingCard'
import { isAdminAuthenticated, adminFetch } from '../utils/adminApi'
import { useAIConfig, useDocumentDefaults } from '../hooks/useAdminConfig'
import type { AIConfigItem, AIConfigWithInheritance, DocumentDefaultItem, DocumentDefaultWithInheritance, PromptSectionKey, ParameterKey, DefaultKey } from '../types/config'
import { getPromptSectionMeta, getParameterMeta, getDefaultMeta } from '../types/config'
import type { UserType } from '../types/onboarding'

export function AdminAIConfig() {
  const { t } = useTranslation()
  const navigate = useNavigate()

  // User type selector state
  const [userTypes, setUserTypes] = useState<UserType[]>([])
  const [selectedUserTypeId, setSelectedUserTypeId] = useState<number | null>(null)
  const [userTypesLoading, setUserTypesLoading] = useState(true)

  // Fetch user types on mount
  useEffect(() => {
    const fetchUserTypes = async () => {
      try {
        setUserTypesLoading(true)
        const response = await adminFetch('/admin/user-types')
        if (response.ok) {
          const data = await response.json()
          setUserTypes(data.types || [])
        }
      } catch {
        // Silently fail - user types are optional
      } finally {
        setUserTypesLoading(false)
      }
    }
    fetchUserTypes()
  }, [])

  // Hooks for config data - pass selectedUserTypeId
  const {
    config: aiConfig,
    userTypeConfig: _userTypeConfig, // Used for inheritance info embedded in config items
    loading: aiLoading,
    error: aiError,
    updateConfig,
    setOverride: setAIConfigOverride,
    revertOverride: revertAIConfigOverride,
    previewPrompt,
  } = useAIConfig(selectedUserTypeId)
  void _userTypeConfig // Suppress unused warning - type info is embedded in config items

  const {
    documents,
    userTypeDocuments,
    loading: docsLoading,
    updateDocument,
    setOverride: setDocOverride,
    revertOverride: revertDocOverride,
  } = useDocumentDefaults(selectedUserTypeId)

  // Local state for editing
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [previewContent, setPreviewContent] = useState('')
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [toggleError, setToggleError] = useState<string | null>(null)
  const [authChecked, setAuthChecked] = useState(false)
  const modalRef = useRef<HTMLDivElement>(null)

  // Parameters help modal state
  const [showParametersHelpModal, setShowParametersHelpModal] = useState(false)
  const [parametersHelpPage, setParametersHelpPage] = useState(0)
  const parametersHelpModalRef = useRef<HTMLDivElement>(null)

  // Prompt templates help modal state
  const [showPromptHelpModal, setShowPromptHelpModal] = useState(false)
  const [promptHelpPage, setPromptHelpPage] = useState(0)
  const promptHelpModalRef = useRef<HTMLDivElement>(null)

  // Check if admin is logged in
  useEffect(() => {
    if (!isAdminAuthenticated()) {
      navigate('/admin')
    } else {
      setAuthChecked(true)
    }
  }, [navigate])

  // Clear edit state when user type changes to prevent stale edits being applied to wrong target
  useEffect(() => {
    setEditingKey(null)
    setEditValue('')
    setSaveError(null)
    setToggleError(null)
  }, [selectedUserTypeId])

  // Focus trap for modal
  useEffect(() => {
    if (previewOpen && modalRef.current) {
      const previousFocus = document.activeElement as HTMLElement
      modalRef.current.focus()
      return () => previousFocus?.focus()
    }
  }, [previewOpen])

  // Focus trap for parameters help modal
  useEffect(() => {
    if (showParametersHelpModal && parametersHelpModalRef.current) {
      parametersHelpModalRef.current.focus()
    }
  }, [showParametersHelpModal])

  // Focus trap for prompt help modal
  useEffect(() => {
    if (showPromptHelpModal && promptHelpModalRef.current) {
      promptHelpModalRef.current.focus()
    }
  }, [showPromptHelpModal])

  // Handle editing a config value
  const handleEdit = (item: AIConfigItem) => {
    setEditingKey(item.key)
    setEditValue(item.value)
    setSaveError(null)
  }

  // Handle saving a config value (global or override based on selectedUserTypeId)
  const handleSave = async () => {
    if (!editingKey) return

    // Find the config item to check its value_type
    const item = aiConfig?.prompt_sections.find(i => i.key === editingKey)
      || aiConfig?.parameters.find(i => i.key === editingKey)
      || aiConfig?.defaults.find(i => i.key === editingKey)

    // Validate JSON if applicable
    if (item?.value_type === 'json') {
      try {
        JSON.parse(editValue)
      } catch {
        setSaveError(t('adminAI.invalidJson', 'Invalid JSON format'))
        return
      }
    }

    setSaving(true)
    setSaveError(null)

    try {
      if (selectedUserTypeId !== null) {
        // Set override for user type
        await setAIConfigOverride(editingKey, editValue)
      } else {
        // Update global config
        await updateConfig(editingKey, editValue)
      }
      setEditingKey(null)
      setEditValue('')
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  // Handle reverting an AI config override
  const handleRevertOverride = async (key: string) => {
    setSaveError(null)
    setSaving(true)
    try {
      await revertAIConfigOverride(key)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to revert')
    } finally {
      setSaving(false)
    }
  }

  // Handle cancel editing
  const handleCancel = () => {
    setEditingKey(null)
    setEditValue('')
    setSaveError(null)
  }

  // Handle preview prompt
  const handlePreview = async () => {
    setPreviewError(null)
    try {
      const sampleQuestion = t('promptPreview.sampleQuestion', 'What should I know about this topic?')
      const result = await previewPrompt(sampleQuestion)
      setPreviewContent(result.assembled_prompt)
      setPreviewOpen(true)
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : t('errors.failedToPreviewPrompt'))
    }
  }

  // Handle document toggle (global or override based on selectedUserTypeId)
  const handleDocumentToggle = async (doc: DocumentDefaultItem | DocumentDefaultWithInheritance, field: 'is_available' | 'is_default_active') => {
    setToggleError(null)
    try {
      if (selectedUserTypeId !== null) {
        // Set override for user type
        await setDocOverride(doc.job_id, { [field]: !doc[field] })
      } else {
        // Update global
        await updateDocument(doc.job_id, { [field]: !doc[field] })
      }
    } catch (err) {
      setToggleError(err instanceof Error ? err.message : 'Toggle failed')
    }
  }

  // Handle reverting a document override
  const handleRevertDocOverride = async (jobId: string) => {
    setToggleError(null)
    try {
      await revertDocOverride(jobId)
    } catch (err) {
      setToggleError(err instanceof Error ? err.message : 'Revert failed')
    }
  }

  // Close parameters help modal
  const handleCloseParametersHelpModal = () => {
    setShowParametersHelpModal(false)
    setParametersHelpPage(0)
  }

  // Close prompt help modal
  const handleClosePromptHelpModal = () => {
    setShowPromptHelpModal(false)
    setPromptHelpPage(0)
  }

  // Parameters help pages data
  const PARAMETERS_HELP_PAGES = [
    {
      title: t('adminAI.parametersHelp.overviewTitle', 'Response Settings Overview'),
      content: 'overview',
    },
    {
      title: t('adminAI.parametersHelp.temperatureTitle', 'Temperature'),
      content: 'temperature',
    },
    {
      title: t('adminAI.parametersHelp.tokensTitle', 'Max Tokens & Sampling'),
      content: 'tokens',
    },
  ]

  // Prompt templates help pages data
  const PROMPT_HELP_PAGES = [
    {
      title: t('adminAI.promptHelp.overviewTitle', 'Prompt Template Overview'),
      content: 'overview',
    },
    {
      title: t('adminAI.promptHelp.placeholdersTitle', 'Available Placeholders'),
      content: 'placeholders',
    },
    {
      title: t('adminAI.promptHelp.tipsTitle', 'Tips & Best Practices'),
      content: 'tips',
    },
  ]

  // Get translated metadata
  const promptSectionMeta = getPromptSectionMeta(t)
  const parameterMeta = getParameterMeta(t)
  const defaultMeta = getDefaultMeta(t)

  // Render a config item editor (supports inheritance display)
  const renderConfigItem = (item: AIConfigItem | AIConfigWithInheritance) => {
    const isEditing = editingKey === item.key
    const sectionMeta = promptSectionMeta[item.key as PromptSectionKey]
    const paramMeta = parameterMeta[item.key as ParameterKey]
    const defMeta = defaultMeta[item.key as DefaultKey]
    const meta = sectionMeta || paramMeta || defMeta

    // Check if this is an override (has inheritance info)
    const isOverride = 'is_override' in item && item.is_override

    return (
      <div
        key={item.key}
        className={`bg-surface border rounded-xl p-4 hover:border-border-strong transition-all ${
          isOverride ? 'border-accent/50' : 'border-border'
        }`}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-sm font-medium text-text">
                {meta?.label || item.key}
              </p>
              {/* Inheritance indicator */}
              {selectedUserTypeId !== null && (
                <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${
                  isOverride
                    ? 'bg-accent/10 text-accent'
                    : 'bg-surface-overlay text-text-muted'
                }`}>
                  {isOverride ? (
                    <>
                      <Users className="w-2.5 h-2.5" />
                      {t('adminAI.override', 'Override')}
                    </>
                  ) : (
                    <>
                      <Globe className="w-2.5 h-2.5" />
                      {t('adminAI.inherited', 'Inherited')}
                    </>
                  )}
                </span>
              )}
            </div>
            <p className="text-xs text-text-muted mt-0.5">
              {meta?.description || item.description || ''}
            </p>
            {'hint' in (meta || {}) && (meta as { hint?: string })?.hint && (
              <p className="text-xs text-text-muted/70 mt-2 leading-relaxed">
                {(meta as { hint: string }).hint}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            {/* Revert button for overrides */}
            {!isEditing && isOverride && selectedUserTypeId !== null && (
              <button
                onClick={() => handleRevertOverride(item.key)}
                className="text-xs text-text-muted hover:text-accent transition-colors flex items-center gap-1"
                title={t('adminAI.revertToGlobal', 'Revert to global')}
                aria-label={t('adminAI.revertToGlobal', 'Revert to global')}
              >
                <Undo2 className="w-3 h-3" />
                {t('adminAI.revert', 'Revert')}
              </button>
            )}
            {!isEditing && (
              <button
                onClick={() => handleEdit(item)}
                className="text-xs text-accent hover:text-accent-hover transition-colors"
              >
                {t('common.edit')}
              </button>
            )}
          </div>
        </div>

        {isEditing ? (
          <div className="mt-3 space-y-3">
            {item.value_type === 'json' ? (
              <textarea
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                className="w-full border border-border rounded-lg px-3 py-2 bg-surface text-text placeholder:text-text-muted text-sm font-mono focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 min-h-[100px]"
                placeholder={sectionMeta?.placeholder || '[]'}
              />
            ) : item.value_type === 'boolean' ? (
              <button
                onClick={() => setEditValue(editValue === 'true' ? 'false' : 'true')}
                className="flex items-center gap-2 text-sm"
                role="switch"
                aria-checked={editValue === 'true'}
                aria-label={meta?.label || item.key}
              >
                {editValue === 'true' ? (
                  <ToggleRight className="w-8 h-5 text-accent" />
                ) : (
                  <ToggleLeft className="w-8 h-5 text-text-muted" />
                )}
                <span className="text-text">
                  {editValue === 'true' ? t('common.enabled', 'Enabled') : t('common.disabled', 'Disabled')}
                </span>
              </button>
            ) : item.value_type === 'number' && paramMeta ? (
              <div className="flex items-center gap-4">
                <input
                  type="range"
                  min={paramMeta.min}
                  max={paramMeta.max}
                  step={paramMeta.step}
                  value={parseFloat(editValue) || 0}
                  onChange={(e) => setEditValue(e.target.value)}
                  className="flex-1 accent-accent"
                />
                <span className="text-sm font-mono text-text w-12 text-right">
                  {(parseFloat(editValue) || 0).toFixed(item.key === 'temperature' ? 1 : 0)}
                </span>
              </div>
            ) : (
              <textarea
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                className="w-full border border-border rounded-lg px-3 py-2 bg-surface text-text placeholder:text-text-muted text-sm focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 min-h-[80px]"
                placeholder={sectionMeta?.placeholder || ''}
              />
            )}

            {saveError && (
              <div className="flex items-center gap-2 text-error text-xs">
                <AlertCircle className="w-3 h-3" />
                {saveError}
              </div>
            )}

            <div className="flex gap-2">
              <button
                onClick={handleCancel}
                className="flex-1 bg-surface-overlay border border-border text-text rounded-lg px-3 py-2 text-sm font-medium hover:bg-surface transition-all"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex-1 bg-accent text-accent-text rounded-lg px-3 py-2 text-sm font-medium hover:bg-accent-hover transition-all disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {saving ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Save className="w-4 h-4" />
                )}
                {t('common.save')}
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-2">
            {item.value_type === 'json' ? (
              <pre className="text-xs text-text-muted bg-surface-overlay rounded-lg p-2 overflow-x-auto">
                {item.value}
              </pre>
            ) : item.value_type === 'boolean' ? (
              <span className={`text-sm ${item.value === 'true' ? 'text-success' : 'text-text-muted'}`}>
                {item.value === 'true' ? t('common.enabled', 'Enabled') : t('common.disabled', 'Disabled')}
              </span>
            ) : (
              <p className="text-sm text-text-muted line-clamp-2">{item.value}</p>
            )}
          </div>
        )}
      </div>
    )
  }

  const footer = (
    <Link to="/admin/setup" className="text-text-muted hover:text-text transition-colors">
      {t('admin.setup.backToChat')}
    </Link>
  )

  if (!authChecked || aiLoading || docsLoading || userTypesLoading) {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-accent animate-spin" />
      </div>
    )
  }

  return (
    <OnboardingCard
      title={t('adminAI.title', 'AI Configuration')}
      subtitle={t('adminAI.subtitle', 'Configure AI behavior, prompts, and session defaults')}
      footer={footer}
    >
      <div className="space-y-6">
        {/* User Type Selector */}
        {userTypes.length > 0 && (
          <div className="bg-surface-overlay border border-border rounded-xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <Users className="w-4 h-4 text-text-muted" />
              <span className="text-sm font-medium text-text">
                {t('adminAI.configureFor', 'Configure For')}
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setSelectedUserTypeId(null)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                  selectedUserTypeId === null
                    ? 'bg-accent text-accent-text'
                    : 'bg-surface border border-border text-text-muted hover:border-accent/50 hover:text-text'
                }`}
              >
                <span className="flex items-center gap-1.5">
                  <Globe className="w-3.5 h-3.5" />
                  {t('adminAI.globalAllUsers', 'Global (All Users)')}
                </span>
              </button>
              {userTypes.map((type) => (
                <button
                  key={type.id}
                  onClick={() => setSelectedUserTypeId(type.id)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                    selectedUserTypeId === type.id
                      ? 'bg-accent text-accent-text'
                      : 'bg-surface border border-border text-text-muted hover:border-accent/50 hover:text-text'
                  }`}
                >
                  {type.name}
                </button>
              ))}
            </div>
            {selectedUserTypeId !== null && (
              <p className="text-xs text-text-muted mt-3">
                {t('adminAI.overrideHint', 'Changes made here will override global settings for this user type. Items marked "Override" have custom values; items marked "Inherited" use global defaults.')}
              </p>
            )}
          </div>
        )}

        {/* Error display */}
        {aiError && (
          <div className="bg-error/10 border border-error/20 rounded-xl p-4">
            <p className="text-sm text-error">{t(aiError)}</p>
          </div>
        )}

        {/* Preview error display */}
        {previewError && (
          <div className="bg-error/10 border border-error/20 rounded-xl p-4">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-error" />
              <p className="text-sm text-error">{previewError}</p>
            </div>
          </div>
        )}

        {/* Toggle error display */}
        {toggleError && (
          <div className="bg-error/10 border border-error/20 rounded-xl p-4">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-error" />
              <p className="text-sm text-error">{t(toggleError)}</p>
            </div>
          </div>
        )}

        {/* Prompt Template Section */}
        <div className="card card-sm p-5! bg-surface-overlay!">
          <div className="flex items-center justify-between mb-2">
            <h3 className="heading-sm flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-text-muted" />
              {t('adminAI.promptTemplate', 'Prompt Template')}
              <button
                onClick={() => setShowPromptHelpModal(true)}
                className="ml-1 text-text-muted hover:text-accent transition-colors"
                aria-label={t('adminAI.promptHelp.ariaLabel', 'Prompt template help')}
              >
                <HelpCircle className="w-5 h-5" />
              </button>
            </h3>
            <button
              onClick={handlePreview}
              className="flex items-center gap-1.5 text-xs text-accent hover:text-accent-hover transition-colors"
            >
              <Eye className="w-3.5 h-3.5" />
              {t('adminAI.preview', 'Preview')}
            </button>
          </div>
          <p className="text-sm text-text-secondary mb-1">
            {t('adminAI.promptTemplateDesc', 'Shape how the AI communicates with your users')}
          </p>
          <p className="text-xs text-text-muted mb-4">
            {t('adminAI.promptTemplateHint', 'These settings define the AI\'s personality and boundaries. Changes take effect immediately for new conversations.')}
          </p>

          <div className="space-y-3">
            {aiConfig?.prompt_sections.map(renderConfigItem)}
          </div>
        </div>

        {/* LLM Parameters Section */}
        <div className="card card-sm p-5! bg-surface-overlay!">
          <h3 className="heading-sm mb-2 flex items-center gap-2">
            <Sliders className="w-4 h-4 text-text-muted" />
            {t('adminAI.parameters', 'Response Settings')}
            <button
              onClick={() => setShowParametersHelpModal(true)}
              className="ml-1 text-text-muted hover:text-accent transition-colors"
              aria-label={t('adminAI.parametersHelp.ariaLabel', 'Response settings help')}
            >
              <HelpCircle className="w-5 h-5" />
            </button>
          </h3>
          <p className="text-sm text-text-secondary mb-1">
            {t('adminAI.parametersDesc', 'Fine-tune the AI\'s response quality')}
          </p>
          <p className="text-xs text-text-muted mb-4">
            {t('adminAI.parametersHint', 'These technical settings affect response speed and quality. The defaults work well for most use cases — only adjust if you notice issues.')}
          </p>

          <div className="space-y-3">
            {aiConfig?.parameters.map(renderConfigItem)}
          </div>
        </div>

        {/* Session Defaults Section */}
        <div className="card card-sm p-5! bg-surface-overlay!">
          <h3 className="heading-sm mb-2 flex items-center gap-2">
            <Search className="w-4 h-4 text-text-muted" />
            {t('adminAI.sessionDefaults', 'Feature Defaults')}
          </h3>
          <p className="text-sm text-text-secondary mb-1">
            {t('adminAI.sessionDefaultsDesc', 'Set which features are on by default')}
          </p>
          <p className="text-xs text-text-muted mb-4">
            {t('adminAI.sessionDefaultsHint', 'Control which AI capabilities are enabled when users start a new chat session.')}
          </p>

          <div className="space-y-3">
            {aiConfig?.defaults.map(renderConfigItem)}
          </div>
        </div>

        {/* Document Defaults Section */}
        <div className="card card-sm p-5! bg-surface-overlay!">
          <h3 className="heading-sm mb-2 flex items-center gap-2">
            <FileText className="w-4 h-4 text-text-muted" />
            {t('adminAI.documentDefaults', 'Document Access')}
          </h3>
          <p className="text-sm text-text-secondary mb-1">
            {t('adminAI.documentDefaultsDesc', 'Control which documents the AI can reference')}
          </p>
          <p className="text-xs text-text-muted mb-4">
            {t('adminAI.documentDefaultsHint', 'Documents marked "Available" can be selected by users. Documents marked "Active by Default" are automatically included in new conversations.')}
          </p>

          {documents.length > 0 ? (
            <div className="space-y-2">
              {(selectedUserTypeId ? userTypeDocuments : documents).map((doc: DocumentDefaultItem | DocumentDefaultWithInheritance) => {
                const isOverride = 'is_override' in doc && doc.is_override
                return (
                  <div
                    key={doc.job_id}
                    className={`bg-surface border rounded-xl p-3.5 hover:border-border-strong transition-all ${
                      isOverride ? 'border-accent/50' : 'border-border'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium text-text truncate">
                            {doc.filename || doc.job_id}
                          </p>
                          {/* Inheritance indicator for documents */}
                          {selectedUserTypeId !== null && (
                            <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium shrink-0 ${
                              isOverride
                                ? 'bg-accent/10 text-accent'
                                : 'bg-surface-overlay text-text-muted'
                            }`}>
                              {isOverride ? (
                                <>
                                  <Users className="w-2.5 h-2.5" />
                                  {t('adminAI.override', 'Override')}
                                </>
                              ) : (
                                <>
                                  <Globe className="w-2.5 h-2.5" />
                                  {t('adminAI.inherited', 'Inherited')}
                                </>
                              )}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-text-muted">
                          {doc.total_chunks} {t('adminAI.chunks')}
                          {doc.status && ` • ${doc.status}`}
                        </p>
                      </div>
                      <div className="flex items-center gap-4">
                        {/* Revert button for document overrides */}
                        {isOverride && selectedUserTypeId !== null && (
                          <button
                            type="button"
                            onClick={() => handleRevertDocOverride(doc.job_id)}
                            className="text-xs text-text-muted hover:text-accent transition-colors flex items-center gap-1"
                            title={t('adminAI.revertToGlobal', 'Revert to global')}
                            aria-label={t('adminAI.revertToGlobal', 'Revert to global')}
                          >
                            <Undo2 className="w-3 h-3" />
                          </button>
                        )}
                        <div className="flex items-center gap-2 text-xs">
                          <button
                            type="button"
                            onClick={() => handleDocumentToggle(doc, 'is_available')}
                            className="focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 rounded"
                            role="switch"
                            aria-checked={doc.is_available}
                            aria-label={`${doc.filename || doc.job_id} ${t('adminAI.available', 'Available')}`}
                          >
                            {doc.is_available ? (
                              <ToggleRight className="w-6 h-4 text-accent" />
                            ) : (
                              <ToggleLeft className="w-6 h-4 text-text-muted" />
                            )}
                          </button>
                          <span className="text-text-muted">{t('adminAI.available', 'Available')}</span>
                        </div>
                        <div className="flex items-center gap-2 text-xs">
                          <button
                            type="button"
                            onClick={() => handleDocumentToggle(doc, 'is_default_active')}
                            className="focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 rounded disabled:opacity-50 disabled:cursor-not-allowed"
                            disabled={!doc.is_available}
                            role="switch"
                            aria-checked={doc.is_default_active && doc.is_available}
                            aria-disabled={!doc.is_available}
                            aria-label={`${doc.filename || doc.job_id} ${t('adminAI.activeByDefault', 'Active by Default')}`}
                          >
                            {doc.is_default_active && doc.is_available ? (
                              <ToggleRight className="w-6 h-4 text-accent" />
                            ) : (
                              <ToggleLeft className="w-6 h-4 text-text-muted" />
                            )}
                          </button>
                          <span className="text-text-muted">{t('adminAI.activeByDefault', 'Active by Default')}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="text-center py-6 bg-surface border border-border border-dashed rounded-lg">
              <FileText className="w-8 h-8 text-text-muted mx-auto mb-2" strokeWidth={1.5} />
              <p className="text-xs text-text-muted">{t('adminAI.noDocuments', 'No documents uploaded yet')}</p>
              <Link
                to="/admin/upload"
                className="text-xs text-accent hover:text-accent-hover mt-2 inline-block"
              >
                {t('admin.setup.uploadDocuments', 'Upload Documents')}
              </Link>
            </div>
          )}
        </div>

        {/* Navigation */}
        <div className="flex gap-3">
          <Link
            to="/admin/setup"
            className="flex-1 flex items-center justify-center gap-2 border border-border hover:border-accent/50 text-text rounded-xl px-4 py-3 text-sm font-medium transition-all hover:bg-surface"
          >
            <ArrowLeft className="w-4 h-4" />
            {t('common.back', 'Back')}
          </Link>
        </div>
      </div>

      {/* Preview Modal */}
      {previewOpen && (
        <div
          ref={modalRef}
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          onClick={(e) => e.target === e.currentTarget && setPreviewOpen(false)}
          onKeyDown={(e) => e.key === 'Escape' && setPreviewOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="preview-modal-title"
          tabIndex={-1}
        >
          <div className="bg-surface border border-border rounded-xl max-w-2xl w-full max-h-[80vh] overflow-hidden">
            <div className="flex items-center justify-between p-4 border-b border-border">
              <h3 id="preview-modal-title" className="font-semibold text-text">{t('adminAI.promptPreview', 'Prompt Preview')}</h3>
              <button
                onClick={() => setPreviewOpen(false)}
                className="text-text-muted hover:text-text transition-colors"
              >
                {t('common.close', 'Close')}
              </button>
            </div>
            <div className="p-4 overflow-y-auto max-h-[60vh]">
              <pre className="text-xs text-text whitespace-pre-wrap font-mono bg-surface-overlay rounded-lg p-4">
                {previewContent}
              </pre>
            </div>
          </div>
        </div>
      )}

      {/* Parameters Help Modal */}
      {showParametersHelpModal && (
        <div
          ref={parametersHelpModalRef}
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
          role="dialog"
          aria-modal="true"
          aria-labelledby="parameters-help-modal-title"
          onKeyDown={(e) => e.key === 'Escape' && handleCloseParametersHelpModal()}
          tabIndex={-1}
        >
          <div className="bg-surface border border-border rounded-xl p-6 w-full max-w-lg mx-4 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h3 id="parameters-help-modal-title" className="text-lg font-semibold text-text flex items-center gap-2">
                <HelpCircle className="w-5 h-5" />
                {PARAMETERS_HELP_PAGES[parametersHelpPage].title}
              </h3>
              <button
                onClick={handleCloseParametersHelpModal}
                className="text-text-muted hover:text-text transition-colors"
                aria-label={t('common.close', 'Close')}
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Content */}
            <div className="min-h-[280px]">
              {PARAMETERS_HELP_PAGES[parametersHelpPage].content === 'overview' ? (
                <div className="space-y-3">
                  <p className="text-sm text-text-muted mb-4">
                    {t('adminAI.parametersHelp.overviewDesc', 'These settings control how the AI generates responses. They affect creativity, length, and randomness of outputs.')}
                  </p>
                  <div className="bg-surface-overlay border border-border rounded-lg p-4">
                    <p className="text-sm font-medium text-text mb-2">{t('adminAI.parametersHelp.whenToChange', 'When to adjust these settings:')}</p>
                    <ul className="text-xs text-text-muted space-y-2 list-disc list-inside">
                      <li>{t('adminAI.parametersHelp.tip1', 'Responses too short? Increase max tokens')}</li>
                      <li>{t('adminAI.parametersHelp.tip2', 'Responses too random? Lower temperature')}</li>
                      <li>{t('adminAI.parametersHelp.tip3', 'Responses too repetitive? Raise temperature slightly')}</li>
                      <li>{t('adminAI.parametersHelp.tip4', 'Need consistent answers? Use temperature 0')}</li>
                    </ul>
                  </div>
                  <p className="text-xs text-text-muted">
                    {t('adminAI.parametersHelp.defaultNote', 'The defaults work well for most use cases. Only adjust if you notice specific issues.')}
                  </p>
                </div>
              ) : PARAMETERS_HELP_PAGES[parametersHelpPage].content === 'temperature' ? (
                <div className="space-y-3">
                  <p className="text-sm text-text-muted mb-4">
                    {t('adminAI.parametersHelp.temperatureDesc', 'Temperature controls creativity vs consistency. Think of it as a "randomness dial".')}
                  </p>
                  <div className="space-y-2">
                    <div className="bg-surface-overlay border border-border rounded-lg p-3">
                      <div className="flex items-center justify-between mb-1">
                        <p className="text-sm font-medium text-text">0.0</p>
                        <span className="text-xs text-accent">{t('adminAI.parametersHelp.deterministic', 'Deterministic')}</span>
                      </div>
                      <p className="text-xs text-text-muted">
                        {t('adminAI.parametersHelp.temp0', 'Always picks the most likely response. Use for factual Q&A, data extraction.')}
                      </p>
                    </div>
                    <div className="bg-surface-overlay border border-border rounded-lg p-3">
                      <div className="flex items-center justify-between mb-1">
                        <p className="text-sm font-medium text-text">0.3 - 0.7</p>
                        <span className="text-xs text-success">{t('adminAI.parametersHelp.balanced', 'Balanced')}</span>
                      </div>
                      <p className="text-xs text-text-muted">
                        {t('adminAI.parametersHelp.tempMid', 'Good balance of consistency and natural variation. Recommended for most uses.')}
                      </p>
                    </div>
                    <div className="bg-surface-overlay border border-border rounded-lg p-3">
                      <div className="flex items-center justify-between mb-1">
                        <p className="text-sm font-medium text-text">0.8 - 1.0</p>
                        <span className="text-xs text-warning">{t('adminAI.parametersHelp.creative', 'Creative')}</span>
                      </div>
                      <p className="text-xs text-text-muted">
                        {t('adminAI.parametersHelp.tempHigh', 'More creative, varied responses. Use for brainstorming, creative writing.')}
                      </p>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="text-sm text-text-muted mb-4">
                    {t('adminAI.parametersHelp.tokensDesc', 'These settings control response length and sampling behavior.')}
                  </p>
                  <div className="space-y-2">
                    <div className="bg-surface-overlay border border-border rounded-lg p-3">
                      <p className="text-sm font-medium text-text">max_tokens</p>
                      <p className="text-xs text-text-muted mt-1">
                        {t('adminAI.parametersHelp.maxTokensDesc', 'Maximum length of the response. 1 token is roughly 4 characters or 3/4 of a word. Higher values allow longer responses but cost more.')}
                      </p>
                    </div>
                    <div className="bg-surface-overlay border border-border rounded-lg p-3">
                      <p className="text-sm font-medium text-text">top_p</p>
                      <p className="text-xs text-text-muted mt-1">
                        {t('adminAI.parametersHelp.topPDesc', 'Nucleus sampling: only consider tokens whose cumulative probability is within this threshold. 0.9-1.0 is typical. Lower = more focused.')}
                      </p>
                    </div>
                    <div className="bg-surface-overlay border border-border rounded-lg p-3">
                      <p className="text-sm font-medium text-text">top_k</p>
                      <p className="text-xs text-text-muted mt-1">
                        {t('adminAI.parametersHelp.topKDesc', 'Only consider the top K most likely tokens. 0 = disabled (use top_p instead). Lower values = more focused responses.')}
                      </p>
                    </div>
                  </div>
                  <p className="text-xs text-text-muted mt-3">
                    {t('adminAI.parametersHelp.samplingNote', 'Tip: Adjust either temperature OR top_p, not both at once.')}
                  </p>
                </div>
              )}
            </div>

            {/* Pagination */}
            <div className="flex items-center justify-between mt-6 pt-4 border-t border-border">
              <button
                onClick={() => setParametersHelpPage((prev) => Math.max(0, prev - 1))}
                disabled={parametersHelpPage === 0}
                className="flex items-center gap-1 text-sm text-text-muted hover:text-text disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
                {t('common.previous', 'Previous')}
              </button>

              {/* Page indicators */}
              <div className="flex items-center gap-1.5">
                {PARAMETERS_HELP_PAGES.map((_, index) => (
                  <button
                    key={index}
                    onClick={() => setParametersHelpPage(index)}
                    className={`w-2 h-2 rounded-full transition-colors ${
                      index === parametersHelpPage
                        ? 'bg-accent'
                        : 'bg-border hover:bg-text-muted'
                    }`}
                    aria-label={`${t('common.goToPage', 'Go to page')} ${index + 1}`}
                  />
                ))}
              </div>

              <button
                onClick={() => setParametersHelpPage((prev) => Math.min(PARAMETERS_HELP_PAGES.length - 1, prev + 1))}
                disabled={parametersHelpPage === PARAMETERS_HELP_PAGES.length - 1}
                className="flex items-center gap-1 text-sm text-text-muted hover:text-text disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                {t('common.next', 'Next')}
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Prompt Templates Help Modal */}
      {showPromptHelpModal && (
        <div
          ref={promptHelpModalRef}
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
          role="dialog"
          aria-modal="true"
          aria-labelledby="prompt-help-modal-title"
          onKeyDown={(e) => e.key === 'Escape' && handleClosePromptHelpModal()}
          tabIndex={-1}
        >
          <div className="bg-surface border border-border rounded-xl p-6 w-full max-w-lg mx-4 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h3 id="prompt-help-modal-title" className="text-lg font-semibold text-text flex items-center gap-2">
                <HelpCircle className="w-5 h-5" />
                {PROMPT_HELP_PAGES[promptHelpPage].title}
              </h3>
              <button
                onClick={handleClosePromptHelpModal}
                className="text-text-muted hover:text-text transition-colors"
                aria-label={t('common.close', 'Close')}
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Content */}
            <div className="min-h-[280px]">
              {PROMPT_HELP_PAGES[promptHelpPage].content === 'overview' ? (
                <div className="space-y-3">
                  <p className="text-sm text-text-muted mb-4">
                    {t('adminAI.promptHelp.overviewDesc', 'Prompt templates define how the AI responds. They\'re the instructions that shape its personality and behavior.')}
                  </p>
                  <div className="space-y-2">
                    <div className="bg-surface-overlay border border-border rounded-lg p-3">
                      <p className="text-sm font-medium text-text">{t('adminAI.promptHelp.systemPrompt', 'System Prompt')}</p>
                      <p className="text-xs text-text-muted mt-1">
                        {t('adminAI.promptHelp.systemPromptDesc', 'The AI\'s core identity and rules. Defines personality, tone, and boundaries.')}
                      </p>
                    </div>
                    <div className="bg-surface-overlay border border-border rounded-lg p-3">
                      <p className="text-sm font-medium text-text">{t('adminAI.promptHelp.contextTemplate', 'Context Template')}</p>
                      <p className="text-xs text-text-muted mt-1">
                        {t('adminAI.promptHelp.contextTemplateDesc', 'How retrieved documents are formatted and presented to the AI.')}
                      </p>
                    </div>
                    <div className="bg-surface-overlay border border-border rounded-lg p-3">
                      <p className="text-sm font-medium text-text">{t('adminAI.promptHelp.queryTemplate', 'Query Template')}</p>
                      <p className="text-xs text-text-muted mt-1">
                        {t('adminAI.promptHelp.queryTemplateDesc', 'How user questions are formatted before sending to the AI.')}
                      </p>
                    </div>
                  </div>
                </div>
              ) : PROMPT_HELP_PAGES[promptHelpPage].content === 'placeholders' ? (
                <div className="space-y-3">
                  <p className="text-sm text-text-muted mb-4">
                    {t('adminAI.promptHelp.placeholdersDesc', 'Use these placeholders in your templates. They get replaced with actual values at runtime.')}
                  </p>
                  <div className="bg-surface-overlay border border-border rounded-lg p-3 font-mono text-xs space-y-2">
                    <div className="flex items-start gap-2">
                      <span className="text-accent shrink-0">{'{context}'}</span>
                      <span className="text-text-muted">{t('adminAI.promptHelp.contextPlaceholder', 'Retrieved document chunks relevant to the query')}</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <span className="text-accent shrink-0">{'{query}'}</span>
                      <span className="text-text-muted">{t('adminAI.promptHelp.queryPlaceholder', 'The user\'s current question')}</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <span className="text-accent shrink-0">{'{history}'}</span>
                      <span className="text-text-muted">{t('adminAI.promptHelp.historyPlaceholder', 'Previous messages in the conversation')}</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <span className="text-accent shrink-0">{'{user_info}'}</span>
                      <span className="text-text-muted">{t('adminAI.promptHelp.userInfoPlaceholder', 'Information collected during user onboarding')}</span>
                    </div>
                  </div>
                  <p className="text-xs text-text-muted mt-3">
                    {t('adminAI.promptHelp.placeholdersNote', 'Missing placeholders will be replaced with empty strings.')}
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="text-sm text-text-muted mb-4">
                    {t('adminAI.promptHelp.tipsDesc', 'Guidelines for modifying prompts safely and effectively:')}
                  </p>
                  <div className="space-y-2">
                    <div className="bg-success/10 border border-success/20 rounded-lg p-3">
                      <p className="text-sm font-medium text-success mb-1">{t('adminAI.promptHelp.safeChanges', 'Safe to change:')}</p>
                      <ul className="text-xs text-text-muted space-y-1 list-disc list-inside">
                        <li>{t('adminAI.promptHelp.safe1', 'Tone and personality descriptions')}</li>
                        <li>{t('adminAI.promptHelp.safe2', 'Adding domain-specific instructions')}</li>
                        <li>{t('adminAI.promptHelp.safe3', 'Response format preferences')}</li>
                        <li>{t('adminAI.promptHelp.safe4', 'Language and formality level')}</li>
                      </ul>
                    </div>
                    <div className="bg-warning/10 border border-warning/20 rounded-lg p-3">
                      <p className="text-sm font-medium text-warning mb-1">{t('adminAI.promptHelp.riskyChanges', 'Be careful with:')}</p>
                      <ul className="text-xs text-text-muted space-y-1 list-disc list-inside">
                        <li>{t('adminAI.promptHelp.risky1', 'Removing placeholders (context, query)')}</li>
                        <li>{t('adminAI.promptHelp.risky2', 'Changing the response structure significantly')}</li>
                        <li>{t('adminAI.promptHelp.risky3', 'Very long prompts (may hit token limits)')}</li>
                      </ul>
                    </div>
                  </div>
                  <p className="text-xs text-text-muted mt-3">
                    {t('adminAI.promptHelp.previewTip', 'Use the Preview button to see how your complete prompt looks before saving.')}
                  </p>
                </div>
              )}
            </div>

            {/* Pagination */}
            <div className="flex items-center justify-between mt-6 pt-4 border-t border-border">
              <button
                onClick={() => setPromptHelpPage((prev) => Math.max(0, prev - 1))}
                disabled={promptHelpPage === 0}
                className="flex items-center gap-1 text-sm text-text-muted hover:text-text disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
                {t('common.previous', 'Previous')}
              </button>

              {/* Page indicators */}
              <div className="flex items-center gap-1.5">
                {PROMPT_HELP_PAGES.map((_, index) => (
                  <button
                    key={index}
                    onClick={() => setPromptHelpPage(index)}
                    className={`w-2 h-2 rounded-full transition-colors ${
                      index === promptHelpPage
                        ? 'bg-accent'
                        : 'bg-border hover:bg-text-muted'
                    }`}
                    aria-label={`${t('common.goToPage', 'Go to page')} ${index + 1}`}
                  />
                ))}
              </div>

              <button
                onClick={() => setPromptHelpPage((prev) => Math.min(PROMPT_HELP_PAGES.length - 1, prev + 1))}
                disabled={promptHelpPage === PROMPT_HELP_PAGES.length - 1}
                className="flex items-center gap-1 text-sm text-text-muted hover:text-text disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                {t('common.next', 'Next')}
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}
    </OnboardingCard>
  )
}
