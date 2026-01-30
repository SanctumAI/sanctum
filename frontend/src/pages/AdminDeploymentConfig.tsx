import { useState, useEffect, useRef } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  ArrowLeft,
  Loader2,
  Server,
  Database,
  Mail,
  Shield,
  Search,
  Download,
  RefreshCw,
  CheckCircle,
  XCircle,
  AlertCircle,
  Clock,
  Eye,
  EyeOff,
  Save,
  History,
  Send,
  X,
  HelpCircle,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react'
import { OnboardingCard } from '../components/onboarding/OnboardingCard'
import { isAdminAuthenticated } from '../utils/adminApi'
import { useDeploymentConfig, useServiceHealth, useConfigAuditLog } from '../hooks/useAdminConfig'
import type { DeploymentConfigItem, ServiceHealthItem, ConfigCategory, DeploymentConfigItemKey } from '../types/config'
import { getConfigCategories, getDeploymentConfigItemMeta } from '../types/config'
import { STORAGE_KEYS } from '../types/onboarding'

export function AdminDeploymentConfig() {
  const { t } = useTranslation()
  const navigate = useNavigate()

  // Hooks for config data
  const {
    config: deploymentConfig,
    loading: configLoading,
    error: configError,
    updateConfig,
    exportEnv,
    validate,
    revealSecret,
  } = useDeploymentConfig()

  const {
    health,
    loading: healthLoading,
    refresh: refreshHealth,
  } = useServiceHealth()

  const {
    log: auditLog,
    loading: auditLoading,
    refresh: refreshAudit,
  } = useConfigAuditLog('deployment_config', 20)

  // Local state
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [showSecret, setShowSecret] = useState<string | null>(null)
  const [revealedSecrets, setRevealedSecrets] = useState<Record<string, string>>({})
  const [revealingSecret, setRevealingSecret] = useState<string | null>(null)
  const [revealError, setRevealError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [validationResult, setValidationResult] = useState<{ valid: boolean; errors: string[]; warnings: string[] } | null>(null)
  const [showAuditLog, setShowAuditLog] = useState(false)
  const [authChecked, setAuthChecked] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)

  // Test email modal state
  const [showTestEmailModal, setShowTestEmailModal] = useState(false)
  const [testEmailAddress, setTestEmailAddress] = useState('')
  const [testEmailSending, setTestEmailSending] = useState(false)
  const [testEmailResult, setTestEmailResult] = useState<{ success: boolean; message: string; error?: string } | null>(null)

  // Email help modal state
  const [showEmailHelpModal, setShowEmailHelpModal] = useState(false)
  const [emailHelpPage, setEmailHelpPage] = useState(0)
  const emailHelpModalRef = useRef<HTMLDivElement>(null)

  // LLM help modal state
  const [showLlmHelpModal, setShowLlmHelpModal] = useState(false)
  const [llmHelpPage, setLlmHelpPage] = useState(0)
  const llmHelpModalRef = useRef<HTMLDivElement>(null)

  // Embedding help modal state
  const [showEmbeddingHelpModal, setShowEmbeddingHelpModal] = useState(false)
  const [embeddingHelpPage, setEmbeddingHelpPage] = useState(0)
  const embeddingHelpModalRef = useRef<HTMLDivElement>(null)

  // Check if admin is logged in
  useEffect(() => {
    if (!isAdminAuthenticated()) {
      navigate('/admin')
    } else {
      setAuthChecked(true)
    }
  }, [navigate])

  // Handle editing a config value
  const handleEdit = (item: DeploymentConfigItem) => {
    setEditingKey(item.key)
    setEditValue(item.is_secret ? '' : (item.value || ''))
    setSaveError(null)
  }

  // Handle saving a config value
  const handleSave = async () => {
    if (!editingKey) return

    // Find the config item being edited
    const item = Object.values(deploymentConfig || {})
      .flat()
      .find((c) => c.key === editingKey)

    // Don't save empty secret values - this prevents wiping existing credentials
    if (item?.is_secret && editValue === '') {
      setEditingKey(null)
      setEditValue('')
      return
    }

    setSaving(true)
    setSaveError(null)

    try {
      await updateConfig(editingKey, editValue)
      // Clear revealed secret cache for this key if it was updated
      setRevealedSecrets(prev => {
        const { [editingKey]: _, ...rest } = prev
        return rest
      })
      setShowSecret(null)
      setEditingKey(null)
      setEditValue('')
      // Refresh health after config change
      refreshHealth()
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save')
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

  // Handle toggling secret visibility
  const handleToggleSecret = async (key: string) => {
    if (showSecret === key) {
      // Hide the secret
      setShowSecret(null)
      return
    }

    // Check if we already have the revealed value cached
    if (revealedSecrets[key] !== undefined) {
      setShowSecret(key)
      return
    }

    // Fetch the actual secret value
    setRevealingSecret(key)
    setRevealError(null)
    try {
      const value = await revealSecret(key)
      setRevealedSecrets(prev => ({ ...prev, [key]: value }))
      setShowSecret(key)
    } catch (err) {
      const message = err instanceof Error ? err.message : t('adminDeployment.revealFailed', 'Failed to reveal secret')
      setRevealError(message)
      console.error('Failed to reveal secret:', err)
    } finally {
      setRevealingSecret(null)
    }
  }

  // Handle export .env
  const handleExport = async () => {
    setExportError(null)
    try {
      const content = await exportEnv()
      const blob = new Blob([content], { type: 'text/plain' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = '.env'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (err) {
      const message = err instanceof Error ? err.message : t('adminDeployment.exportFailed', 'Export failed')
      setExportError(message)
      console.error('Export failed:', err)
    }
  }

  // Handle validate
  const handleValidate = async () => {
    try {
      const result = await validate()
      setValidationResult(result)
    } catch (err) {
      console.error('Validation failed:', err)
      setValidationResult({
        valid: false,
        errors: [err instanceof Error ? err.message : t('adminDeployment.validationFailed', 'Validation request failed')],
        warnings: [],
      })
    }
  }

  // Handle send test email
  const handleSendTestEmail = async () => {
    if (!testEmailAddress.trim()) return

    setTestEmailSending(true)
    setTestEmailResult(null)

    try {
      const token = localStorage.getItem(STORAGE_KEYS.ADMIN_SESSION_TOKEN)
      if (!token) {
        setTestEmailResult({
          success: false,
          message: t('adminDeployment.testEmailResult.requestFailed', 'Request failed'),
          error: t('adminDeployment.testEmailResult.notAuthenticated', 'Not authenticated'),
        })
        setTestEmailSending(false)
        return
      }
      const response = await fetch('/api/auth/test-email', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ email: testEmailAddress.trim() }),
      })

      // Check response.ok before attempting to parse JSON
      if (!response.ok) {
        let errorDetail = `HTTP ${response.status}`
        try {
          const errorData = await response.json()
          errorDetail = errorData.detail || errorDetail
        } catch {
          // Response body isn't JSON (e.g., HTML error page), use status code
        }
        setTestEmailResult({
          success: false,
          message: t('errors.requestFailed'),
          error: errorDetail,
        })
        return
      }

      let data
      try {
        data = await response.json()
      } catch {
        setTestEmailResult({
          success: false,
          message: t('errors.requestFailed'),
          error: t('errors.invalidServerResponse'),
        })
        return
      }

      setTestEmailResult(data)

      // Refresh health to show updated SMTP status (green after success)
      if (data.success) {
        refreshHealth()
      }
    } catch (err) {
      console.error('Test email failed:', err)
      setTestEmailResult({
        success: false,
        message: t('errors.requestFailed'),
        error: err instanceof Error ? err.message : t('errors.unknownError'),
      })
    } finally {
      setTestEmailSending(false)
    }
  }

  // Close test email modal
  const handleCloseTestEmailModal = () => {
    setShowTestEmailModal(false)
    setTestEmailAddress('')
    setTestEmailResult(null)
  }

  // Close email help modal
  const handleCloseEmailHelpModal = () => {
    setShowEmailHelpModal(false)
    setEmailHelpPage(0)
  }

  // Close LLM help modal
  const handleCloseLlmHelpModal = () => {
    setShowLlmHelpModal(false)
    setLlmHelpPage(0)
  }

  // Close embedding help modal
  const handleCloseEmbeddingHelpModal = () => {
    setShowEmbeddingHelpModal(false)
    setEmbeddingHelpPage(0)
  }

  // Focus trap for email help modal
  useEffect(() => {
    if (showEmailHelpModal && emailHelpModalRef.current) {
      emailHelpModalRef.current.focus()
    }
  }, [showEmailHelpModal])

  // Focus trap for LLM help modal
  useEffect(() => {
    if (showLlmHelpModal && llmHelpModalRef.current) {
      llmHelpModalRef.current.focus()
    }
  }, [showLlmHelpModal])

  // Focus trap for embedding help modal
  useEffect(() => {
    if (showEmbeddingHelpModal && embeddingHelpModalRef.current) {
      embeddingHelpModalRef.current.focus()
    }
  }, [showEmbeddingHelpModal])

  // Email help pages data
  const EMAIL_HELP_PAGES = [
    {
      title: t('adminDeployment.emailHelp.overviewTitle', 'SMTP Field Reference'),
      content: 'overview',
    },
    {
      title: 'Gmail',
      hint: t('adminDeployment.emailHelp.gmailHint', 'Requires App Password from myaccount.google.com/apppasswords'),
      config: {
        SMTP_HOST: 'smtp.gmail.com',
        SMTP_PORT: '587',
        SMTP_USER: 'yourname@gmail.com',
        SMTP_PASS: 'xxxx-xxxx-xxxx-xxxx',
        SMTP_FROM: 'Sanctum <yourname@gmail.com>',
      },
    },
    {
      title: 'Mailgun',
      hint: t('adminDeployment.emailHelp.mailgunHint', 'Use your domain-specific SMTP credentials'),
      config: {
        SMTP_HOST: 'smtp.mailgun.org',
        SMTP_PORT: '587',
        SMTP_USER: 'postmaster@mg.yourdomain.com',
        SMTP_PASS: 'your-mailgun-smtp-password',
        SMTP_FROM: 'Sanctum <noreply@mg.yourdomain.com>',
      },
    },
    {
      title: 'SendGrid',
      hint: t('adminDeployment.emailHelp.sendgridHint', 'SMTP_USER is literally "apikey" (not your email)'),
      config: {
        SMTP_HOST: 'smtp.sendgrid.net',
        SMTP_PORT: '587',
        SMTP_USER: 'apikey',
        SMTP_PASS: 'SG.your-sendgrid-api-key',
        SMTP_FROM: 'Sanctum <noreply@yourdomain.com>',
      },
    },
    {
      title: 'Amazon SES',
      hint: t('adminDeployment.emailHelp.sesHint', 'Use your region (e.g., us-east-1). FROM address must be verified.'),
      config: {
        SMTP_HOST: 'email-smtp.us-east-1.amazonaws.com',
        SMTP_PORT: '587',
        SMTP_USER: 'your-ses-smtp-username',
        SMTP_PASS: 'your-ses-smtp-password',
        SMTP_FROM: 'Sanctum <noreply@yourdomain.com>',
      },
    },
    {
      title: 'Postmark',
      hint: t('adminDeployment.emailHelp.postmarkHint', 'User and password are both your Server API Token'),
      config: {
        SMTP_HOST: 'smtp.postmarkapp.com',
        SMTP_PORT: '587',
        SMTP_USER: 'your-server-api-token',
        SMTP_PASS: 'your-server-api-token',
        SMTP_FROM: 'Sanctum <noreply@yourdomain.com>',
      },
    },
    {
      title: 'Brevo',
      hint: t('adminDeployment.emailHelp.brevoHint', 'Formerly Sendinblue. Use your SMTP key, not your account password.'),
      config: {
        SMTP_HOST: 'smtp-relay.brevo.com',
        SMTP_PORT: '587',
        SMTP_USER: 'your-brevo-login-email',
        SMTP_PASS: 'your-smtp-key',
        SMTP_FROM: 'Sanctum <noreply@yourdomain.com>',
      },
    },
  ]

  // LLM help pages data
  const LLM_HELP_PAGES = [
    {
      title: t('adminDeployment.llmHelp.overviewTitle', 'What is an LLM Provider?'),
      content: 'overview',
    },
    {
      title: 'Maple',
      hint: t('adminDeployment.llmHelp.mapleHint', 'Privacy-focused inference. Your queries are never stored or used for training.'),
      config: {
        LLM_PROVIDER: 'maple',
        MAPLE_API_KEY: 'your-api-key-from-trymaple.ai',
        LLM_MODEL: 'llama-3.3-70b',
      },
      extra: t('adminDeployment.llmHelp.mapleExtra', 'Get your API key at trymaple.ai. Maple routes requests through privacy-preserving infrastructure.'),
    },
    {
      title: 'Ollama',
      hint: t('adminDeployment.llmHelp.ollamaHint', 'Self-hosted, runs on your own hardware. No API key needed.'),
      config: {
        LLM_PROVIDER: 'ollama',
        OLLAMA_BASE_URL: 'http://localhost:11434',
        LLM_MODEL: 'llama3.2',
      },
      extra: t('adminDeployment.llmHelp.ollamaExtra', 'Install Ollama from ollama.ai, then run: ollama pull llama3.2'),
    },
    {
      title: 'OpenAI',
      hint: t('adminDeployment.llmHelp.openaiHint', 'Cloud-hosted, requires API key from OpenAI.'),
      config: {
        LLM_PROVIDER: 'openai',
        OPENAI_API_KEY: 'sk-...',
        LLM_MODEL: 'gpt-4o',
      },
      extra: t('adminDeployment.llmHelp.openaiExtra', 'Get your API key at platform.openai.com. Common models: gpt-4o, gpt-4o-mini, gpt-3.5-turbo'),
    },
  ]

  // Embedding help pages data
  const EMBEDDING_HELP_PAGES = [
    {
      title: t('adminDeployment.embeddingHelp.overviewTitle', 'What are Embeddings?'),
      content: 'overview',
    },
    {
      title: t('adminDeployment.embeddingHelp.modelsTitle', 'Model Options'),
      content: 'models',
    },
    {
      title: t('adminDeployment.embeddingHelp.performanceTitle', 'Performance Settings'),
      content: 'performance',
    },
  ]

  // Get icon for category
  const getCategoryIcon = (category: string) => {
    switch (category) {
      case 'llm':
        return <Server className="w-4 h-4 text-text-muted" />
      case 'embedding':
        return <Database className="w-4 h-4 text-text-muted" />
      case 'email':
        return <Mail className="w-4 h-4 text-text-muted" />
      case 'storage':
        return <Database className="w-4 h-4 text-text-muted" />
      case 'security':
        return <Shield className="w-4 h-4 text-text-muted" />
      case 'search':
        return <Search className="w-4 h-4 text-text-muted" />
      default:
        return <Server className="w-4 h-4 text-text-muted" />
    }
  }

  // Get status icon for service health
  const getStatusIcon = (status: ServiceHealthItem['status']) => {
    switch (status) {
      case 'healthy':
        return <CheckCircle className="w-5 h-5 text-success" />
      case 'unhealthy':
        return <XCircle className="w-5 h-5 text-error" />
      default:
        return <AlertCircle className="w-5 h-5 text-warning" />
    }
  }

  // Check if a config key is a secret (should be masked in audit log)
  const isSecretKey = (configKey: string): boolean => {
    if (!deploymentConfig) return false
    const allConfigs = [
      ...(deploymentConfig.llm || []),
      ...(deploymentConfig.email || []),
      ...(deploymentConfig.embedding || []),
      ...(deploymentConfig.storage || []),
      ...(deploymentConfig.security || []),
      ...(deploymentConfig.search || []),
      ...(deploymentConfig.general || []),
    ]
    const configItem = allConfigs.find((c) => c.key === configKey)
    return configItem?.is_secret ?? false
  }

  // Get translated deployment config item metadata
  const deploymentConfigItemMeta = getDeploymentConfigItemMeta(t)

  // Render a config item
  const renderConfigItem = (item: DeploymentConfigItem) => {
    const isEditing = editingKey === item.key
    const isShowingSecret = showSecret === item.key
    const meta = deploymentConfigItemMeta[item.key as DeploymentConfigItemKey]

    return (
      <div
        key={item.key}
        className="bg-surface border border-border rounded-lg p-3 hover:border-border-strong transition-all"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-sm font-mono text-text">{item.key}</p>
              {item.requires_restart && (
                <span className="text-[10px] bg-warning/10 text-warning px-1.5 py-0.5 rounded">
                  {t('adminDeployment.requiresRestart', 'Requires Restart')}
                </span>
              )}
              {item.is_secret && (
                <span className="text-[10px] bg-error/10 text-error px-1.5 py-0.5 rounded">
                  {t('adminDeployment.secret', 'Secret')}
                </span>
              )}
            </div>
            <p className="text-xs text-text-muted mt-0.5">{meta?.description || item.description}</p>
            {meta?.hint && (
              <p className="text-xs text-text-muted/70 mt-1 leading-relaxed">{meta.hint}</p>
            )}
          </div>
          {!isEditing && (
            <div className="flex items-center gap-2">
              {item.is_secret && (
                <button
                  onClick={() => handleToggleSecret(item.key)}
                  disabled={revealingSecret === item.key}
                  className="text-text-muted hover:text-text transition-colors disabled:opacity-50"
                >
                  {revealingSecret === item.key ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : isShowingSecret ? (
                    <EyeOff className="w-4 h-4" />
                  ) : (
                    <Eye className="w-4 h-4" />
                  )}
                </button>
              )}
              <button
                onClick={() => handleEdit(item)}
                className="text-xs text-accent hover:text-accent-hover transition-colors"
              >
                {t('common.edit')}
              </button>
            </div>
          )}
        </div>

        {isEditing ? (
          <div className="mt-3 space-y-3">
            <input
              type={item.is_secret ? 'password' : 'text'}
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              placeholder={item.is_secret ? t('adminDeployment.leaveEmptyForSecret', 'Leave empty to keep current value') : (item.value || '')}
              className="w-full border border-border rounded-lg px-3 py-2 bg-surface text-text placeholder:text-text-muted text-sm font-mono focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
            />

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
            <code className="text-xs text-text-muted bg-surface-overlay rounded px-1.5 py-0.5">
              {item.is_secret
                ? (isShowingSecret ? (revealedSecrets[item.key] || t('admin.database.notSet')) : '********')
                : (item.value || t('admin.database.notSet'))}
            </code>
          </div>
        )}
      </div>
    )
  }

  // Get translated config categories
  const configCategories = getConfigCategories(t)

  // Render a config category section
  const renderCategory = (category: ConfigCategory, items: DeploymentConfigItem[]) => {
    if (items.length === 0) return null

    const meta = configCategories[category]

    return (
      <div key={category} className="card card-sm p-5! bg-surface-overlay!">
        <h3 className="heading-sm mb-2 flex items-center gap-2">
          {getCategoryIcon(category)}
          {meta.label}
          {category === 'email' && (
            <button
              onClick={() => setShowEmailHelpModal(true)}
              className="ml-1 text-text-muted hover:text-accent transition-colors"
              aria-label={t('adminDeployment.emailHelp.ariaLabel', 'Email configuration help')}
            >
              <HelpCircle className="w-5 h-5" />
            </button>
          )}
          {category === 'llm' && (
            <button
              onClick={() => setShowLlmHelpModal(true)}
              className="ml-1 text-text-muted hover:text-accent transition-colors"
              aria-label={t('adminDeployment.llmHelp.ariaLabel', 'LLM provider configuration help')}
            >
              <HelpCircle className="w-5 h-5" />
            </button>
          )}
          {category === 'embedding' && (
            <button
              onClick={() => setShowEmbeddingHelpModal(true)}
              className="ml-1 text-text-muted hover:text-accent transition-colors"
              aria-label={t('adminDeployment.embeddingHelp.ariaLabel', 'Embedding configuration help')}
            >
              <HelpCircle className="w-5 h-5" />
            </button>
          )}
        </h3>
        <p className="text-sm text-text-secondary mb-1">{meta.description}</p>
        {'hint' in meta && meta.hint && (
          <p className="text-xs text-text-muted mb-4">{meta.hint}</p>
        )}

        <div className="space-y-2">
          {items.map(renderConfigItem)}
        </div>
      </div>
    )
  }

  const footer = (
    <Link to="/admin/setup" className="text-text-muted hover:text-text transition-colors">
      {t('admin.setup.backToChat')}
    </Link>
  )

  if (!authChecked || configLoading) {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-accent animate-spin" />
      </div>
    )
  }

  return (
    <OnboardingCard
      title={t('adminDeployment.title', 'Deployment Configuration')}
      subtitle={t('adminDeployment.subtitle', 'Manage your server connections and infrastructure settings')}
      footer={footer}
    >
      <div className="space-y-6">
        {/* Error display */}
        {configError && (
          <div className="bg-error/10 border border-error/20 rounded-xl p-4">
            <p className="text-sm text-error">{t(configError)}</p>
          </div>
        )}

        {/* Service Health Section */}
        <div className="card card-sm p-5! bg-surface-overlay!">
          <div className="flex items-center justify-between mb-2">
            <h3 className="heading-sm flex items-center gap-2">
              <Server className="w-4 h-4 text-text-muted" />
              {t('adminDeployment.serviceHealth', 'Service Health')}
            </h3>
            <button
              onClick={refreshHealth}
              disabled={healthLoading}
              className="flex items-center gap-1.5 text-xs text-accent hover:text-accent-hover transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${healthLoading ? 'animate-spin' : ''}`} />
              {t('adminDeployment.refresh', 'Refresh')}
            </button>
          </div>
          <p className="text-sm text-text-secondary mb-1">
            {t('adminDeployment.serviceHealthDesc', 'Monitor your connected services')}
          </p>
          <p className="text-xs text-text-muted mb-4">
            {t('adminDeployment.serviceHealthHint', 'Green means the service is responding normally. If a service shows red, check its configuration below.')}
          </p>

          {health?.restart_required && (
            <div className="bg-warning/10 border border-warning/20 rounded-lg p-3 mb-4">
              <div className="flex items-center gap-2 text-warning text-sm font-medium">
                <AlertCircle className="w-4 h-4" />
                {t('adminDeployment.restartRequired', 'Service restart required')}
              </div>
              {Array.isArray(health.changed_keys_requiring_restart) &&
               health.changed_keys_requiring_restart.length > 0 && (
                <p className="text-xs text-text-muted mt-1">
                  Changed keys: {health.changed_keys_requiring_restart.join(', ')}
                </p>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            {health?.services.map((service) => (
              <div
                key={service.name}
                className={`bg-surface border rounded-lg p-3 ${
                  service.status === 'healthy'
                    ? 'border-success/30'
                    : service.status === 'unhealthy'
                    ? 'border-error/30'
                    : 'border-border'
                }`}
              >
                <div className="flex items-center gap-2">
                  {getStatusIcon(service.status)}
                  <span className="text-sm font-medium text-text">{service.name}</span>
                </div>
                {service.response_time_ms != null && (
                  <p className="text-xs text-text-muted mt-1 flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {service.response_time_ms}ms
                  </p>
                )}
                {service.error && (
                  <p className="text-xs text-error mt-1">{service.error}</p>
                )}
                {/* Add test email button for SMTP service */}
                {service.name === 'SMTP' && (
                  <button
                    onClick={() => setShowTestEmailModal(true)}
                    className="mt-2 flex items-center gap-1.5 text-xs text-accent hover:text-accent-hover transition-colors"
                  >
                    <Send className="w-3 h-3" />
                    {t('adminDeployment.sendTestEmail', 'Send Test Email')}
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Actions Section */}
        <div className="flex gap-3">
          <button
            onClick={handleValidate}
            className="flex-1 flex items-center justify-center gap-2 border border-border hover:border-accent/50 text-text rounded-lg px-4 py-2.5 text-sm font-medium transition-all hover:bg-surface"
          >
            <CheckCircle className="w-4 h-4" />
            {t('adminDeployment.validate', 'Validate Config')}
          </button>
          <button
            onClick={handleExport}
            className="flex-1 flex items-center justify-center gap-2 border border-border hover:border-accent/50 text-text rounded-lg px-4 py-2.5 text-sm font-medium transition-all hover:bg-surface"
          >
            <Download className="w-4 h-4" />
            {t('adminDeployment.exportEnv', 'Export .env')}
          </button>
          <button
            onClick={() => setShowAuditLog(!showAuditLog)}
            aria-label={t('adminDeployment.auditLog', 'Recent Changes')}
            className="flex items-center justify-center gap-2 border border-border hover:border-accent/50 text-text rounded-lg px-4 py-2.5 text-sm font-medium transition-all hover:bg-surface"
          >
            <History className="w-4 h-4" />
          </button>
        </div>

        {/* Export Error */}
        {exportError && (
          <div className="bg-error/10 border border-error/20 rounded-xl p-4">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-error" />
              <p className="text-sm text-error">{exportError}</p>
            </div>
          </div>
        )}

        {/* Reveal Secret Error */}
        {revealError && (
          <div className="bg-error/10 border border-error/20 rounded-xl p-4">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-error" />
              <p className="text-sm text-error">{revealError}</p>
            </div>
          </div>
        )}

        {/* Validation Result */}
        {validationResult && (
          <div className={`border rounded-xl p-4 ${validationResult.valid ? 'bg-success/10 border-success/20' : 'bg-error/10 border-error/20'}`}>
            <div className="flex items-center gap-2 mb-2">
              {validationResult.valid ? (
                <CheckCircle className="w-5 h-5 text-success" />
              ) : (
                <XCircle className="w-5 h-5 text-error" />
              )}
              <span className={`font-medium ${validationResult.valid ? 'text-success' : 'text-error'}`}>
                {validationResult.valid
                  ? t('adminDeployment.configValid', 'Configuration Valid')
                  : t('adminDeployment.configInvalid', 'Configuration Invalid')}
              </span>
            </div>
            {validationResult.errors.length > 0 && (
              <ul className="text-sm text-error list-disc list-inside">
                {validationResult.errors.map((err, i) => (
                  <li key={i}>{err}</li>
                ))}
              </ul>
            )}
            {validationResult.warnings.length > 0 && (
              <ul className="text-sm text-warning list-disc list-inside mt-2">
                {validationResult.warnings.map((warn, i) => (
                  <li key={i}>{warn}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* Audit Log */}
        {showAuditLog && (
          <div className="card card-sm p-5! bg-surface-overlay!">
            <div className="flex items-center justify-between mb-4">
              <h3 className="heading-sm flex items-center gap-2">
                <History className="w-4 h-4 text-text-muted" />
                {t('adminDeployment.auditLog', 'Recent Changes')}
              </h3>
              <button
                onClick={refreshAudit}
                disabled={auditLoading}
                className="text-xs text-accent hover:text-accent-hover transition-colors"
              >
                {t('adminDeployment.refresh', 'Refresh')}
              </button>
            </div>

            {auditLog?.entries.length ? (
              <div className="space-y-2 max-h-60 overflow-y-auto">
                {auditLog.entries.map((entry) => {
                  // Mask secret values in audit log display
                  const secret = isSecretKey(entry.config_key)
                  const displayOld = secret ? '********' : (entry.old_value ? `"${entry.old_value}"` : '(empty)')
                  const displayNew = secret ? '********' : (entry.new_value ? `"${entry.new_value}"` : '(empty)')

                  return (
                    <div key={entry.id} className="bg-surface border border-border rounded-lg p-2 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-text">{entry.config_key}</span>
                        <span className="text-text-muted">
                          {(() => {
                            const date = new Date(entry.changed_at)
                            return isNaN(date.getTime()) ? entry.changed_at : date.toLocaleString()
                          })()}
                        </span>
                      </div>
                      <p className="text-text-muted mt-1">
                        {displayOld} → {displayNew}
                      </p>
                    </div>
                  )
                })}
              </div>
            ) : (
              <p className="text-xs text-text-muted text-center py-4">{t('adminDeployment.noRecentChanges', 'No recent changes')}</p>
            )}
          </div>
        )}

        {/* Configuration Categories */}
        {deploymentConfig && (
          <>
            {renderCategory('llm', deploymentConfig.llm)}
            {renderCategory('embedding', deploymentConfig.embedding)}
            {renderCategory('email', deploymentConfig.email)}
            {renderCategory('storage', deploymentConfig.storage)}
            {renderCategory('search', deploymentConfig.search)}
            {renderCategory('security', deploymentConfig.security)}
            {renderCategory('general', deploymentConfig.general)}
          </>
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
        </div>

        {/* Test Email Modal */}
        {showTestEmailModal && (
          <div
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
            role="dialog"
            aria-modal="true"
            aria-labelledby="test-email-modal-title"
            onKeyDown={(e) => e.key === 'Escape' && handleCloseTestEmailModal()}
            tabIndex={-1}
          >
            <div className="bg-surface border border-border rounded-xl p-6 w-full max-w-md mx-4 shadow-xl">
              <div className="flex items-center justify-between mb-4">
                <h3 id="test-email-modal-title" className="text-lg font-semibold text-text flex items-center gap-2">
                  <Mail className="w-5 h-5" />
                  {t('adminDeployment.testEmailTitle', 'Send Test Email')}
                </h3>
                <button
                  onClick={handleCloseTestEmailModal}
                  className="text-text-muted hover:text-text transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <p className="text-sm text-text-muted mb-4">
                {t('adminDeployment.testEmailDesc', 'Send a test email to verify your SMTP configuration is working correctly.')}
              </p>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-text mb-1">
                    {t('adminDeployment.emailAddress', 'Email Address')}
                  </label>
                  <input
                    type="email"
                    value={testEmailAddress}
                    onChange={(e) => setTestEmailAddress(e.target.value)}
                    placeholder="test@example.com"
                    className="w-full border border-border rounded-lg px-3 py-2 bg-surface text-text placeholder:text-text-muted text-sm focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
                    disabled={testEmailSending}
                  />
                </div>

                {/* Result display */}
                {testEmailResult && (
                  <div className={`rounded-lg p-3 ${testEmailResult.success ? 'bg-success/10 border border-success/20' : 'bg-error/10 border border-error/20'}`}>
                    <div className="flex items-center gap-2">
                      {testEmailResult.success ? (
                        <CheckCircle className="w-4 h-4 text-success" />
                      ) : (
                        <XCircle className="w-4 h-4 text-error" />
                      )}
                      <span className={`text-sm font-medium ${testEmailResult.success ? 'text-success' : 'text-error'}`}>
                        {testEmailResult.message}
                      </span>
                    </div>
                    {testEmailResult.error && (
                      <p className="text-xs text-error mt-1 pl-6">{testEmailResult.error}</p>
                    )}
                  </div>
                )}

                <div className="flex gap-3">
                  <button
                    onClick={handleCloseTestEmailModal}
                    className="flex-1 bg-surface-overlay border border-border text-text rounded-lg px-4 py-2.5 text-sm font-medium hover:bg-surface transition-all"
                  >
                    {t('common.cancel', 'Cancel')}
                  </button>
                  <button
                    onClick={handleSendTestEmail}
                    disabled={testEmailSending || !testEmailAddress.trim()}
                    className="flex-1 bg-accent text-accent-text rounded-lg px-4 py-2.5 text-sm font-medium hover:bg-accent-hover transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {testEmailSending ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Send className="w-4 h-4" />
                    )}
                    {t('adminDeployment.send', 'Send')}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Email Help Modal */}
        {showEmailHelpModal && (
          <div
            ref={emailHelpModalRef}
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
            role="dialog"
            aria-modal="true"
            aria-labelledby="email-help-modal-title"
            onKeyDown={(e) => e.key === 'Escape' && handleCloseEmailHelpModal()}
            tabIndex={-1}
          >
            <div className="bg-surface border border-border rounded-xl p-6 w-full max-w-lg mx-4 shadow-xl">
              <div className="flex items-center justify-between mb-4">
                <h3 id="email-help-modal-title" className="text-lg font-semibold text-text flex items-center gap-2">
                  <HelpCircle className="w-5 h-5" />
                  {EMAIL_HELP_PAGES[emailHelpPage].title}
                </h3>
                <button
                  onClick={handleCloseEmailHelpModal}
                  className="text-text-muted hover:text-text transition-colors"
                  aria-label={t('common.close', 'Close')}
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Content */}
              <div className="min-h-[280px]">
                {EMAIL_HELP_PAGES[emailHelpPage].content === 'overview' ? (
                  <div className="space-y-3">
                    <p className="text-sm text-text-muted mb-4">
                      {t('adminDeployment.emailHelp.overviewDesc', 'Here\'s what each SMTP field does:')}
                    </p>
                    <div className="space-y-2">
                      <div className="bg-surface-overlay border border-border rounded-lg p-3">
                        <p className="text-sm font-mono text-text">MOCK_SMTP</p>
                        <p className="text-xs text-text-muted mt-1">
                          {t('adminDeployment.emailHelp.mockSmtp', 'Enable for development. Emails are logged to console instead of being sent.')}
                        </p>
                      </div>
                      <div className="bg-surface-overlay border border-border rounded-lg p-3">
                        <p className="text-sm font-mono text-text">SMTP_FROM</p>
                        <p className="text-xs text-text-muted mt-1">
                          {t('adminDeployment.emailHelp.smtpFrom', 'The "from" address recipients will see. Format: Name <email@domain.com>')}
                        </p>
                      </div>
                      <div className="bg-surface-overlay border border-border rounded-lg p-3">
                        <p className="text-sm font-mono text-text">SMTP_HOST</p>
                        <p className="text-xs text-text-muted mt-1">
                          {t('adminDeployment.emailHelp.smtpHost', 'Your email provider\'s SMTP server address (e.g., smtp.gmail.com)')}
                        </p>
                      </div>
                      <div className="bg-surface-overlay border border-border rounded-lg p-3">
                        <p className="text-sm font-mono text-text">SMTP_PORT</p>
                        <p className="text-xs text-text-muted mt-1">
                          {t('adminDeployment.emailHelp.smtpPort', 'Usually 587 (TLS/STARTTLS) or 465 (SSL). Most providers use 587.')}
                        </p>
                      </div>
                      <div className="bg-surface-overlay border border-border rounded-lg p-3">
                        <p className="text-sm font-mono text-text">SMTP_USER</p>
                        <p className="text-xs text-text-muted mt-1">
                          {t('adminDeployment.emailHelp.smtpUser', 'Login username. Varies by provider (email address, API key name, or token).')}
                        </p>
                      </div>
                      <div className="bg-surface-overlay border border-border rounded-lg p-3">
                        <p className="text-sm font-mono text-text">SMTP_PASS</p>
                        <p className="text-xs text-text-muted mt-1">
                          {t('adminDeployment.emailHelp.smtpPass', 'Password, app password, or API key depending on your provider.')}
                        </p>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {EMAIL_HELP_PAGES[emailHelpPage].hint && (
                      <div className="bg-accent/10 border border-accent/20 rounded-lg p-3">
                        <p className="text-sm text-accent">
                          {EMAIL_HELP_PAGES[emailHelpPage].hint}
                        </p>
                      </div>
                    )}
                    <p className="text-sm text-text-muted">
                      {t('adminDeployment.emailHelp.exampleConfig', 'Example configuration:')}
                    </p>
                    <div className="bg-surface-overlay border border-border rounded-lg p-3 font-mono text-xs space-y-1">
                      {EMAIL_HELP_PAGES[emailHelpPage].config && Object.entries(EMAIL_HELP_PAGES[emailHelpPage].config!).map(([key, value]) => (
                        <div key={key} className="flex">
                          <span className="text-accent">{key}</span>
                          <span className="text-text-muted">=</span>
                          <span className="text-text">{value}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Pagination */}
              <div className="flex items-center justify-between mt-6 pt-4 border-t border-border">
                <button
                  onClick={() => setEmailHelpPage((prev) => Math.max(0, prev - 1))}
                  disabled={emailHelpPage === 0}
                  className="flex items-center gap-1 text-sm text-text-muted hover:text-text disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronLeft className="w-4 h-4" />
                  {t('common.previous', 'Previous')}
                </button>

                {/* Page indicators */}
                <div className="flex items-center gap-1.5">
                  {EMAIL_HELP_PAGES.map((_, index) => (
                    <button
                      key={index}
                      onClick={() => setEmailHelpPage(index)}
                      className={`w-2 h-2 rounded-full transition-colors ${
                        index === emailHelpPage
                          ? 'bg-accent'
                          : 'bg-border hover:bg-text-muted'
                      }`}
                      aria-label={`${t('adminDeployment.emailHelp.goToPage', 'Go to page')} ${index + 1}`}
                    />
                  ))}
                </div>

                <button
                  onClick={() => setEmailHelpPage((prev) => Math.min(EMAIL_HELP_PAGES.length - 1, prev + 1))}
                  disabled={emailHelpPage === EMAIL_HELP_PAGES.length - 1}
                  className="flex items-center gap-1 text-sm text-text-muted hover:text-text disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  {t('common.next', 'Next')}
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* LLM Help Modal */}
        {showLlmHelpModal && (
          <div
            ref={llmHelpModalRef}
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
            role="dialog"
            aria-modal="true"
            aria-labelledby="llm-help-modal-title"
            onKeyDown={(e) => e.key === 'Escape' && handleCloseLlmHelpModal()}
            tabIndex={-1}
          >
            <div className="bg-surface border border-border rounded-xl p-6 w-full max-w-lg mx-4 shadow-xl">
              <div className="flex items-center justify-between mb-4">
                <h3 id="llm-help-modal-title" className="text-lg font-semibold text-text flex items-center gap-2">
                  <HelpCircle className="w-5 h-5" />
                  {LLM_HELP_PAGES[llmHelpPage].title}
                </h3>
                <button
                  onClick={handleCloseLlmHelpModal}
                  className="text-text-muted hover:text-text transition-colors"
                  aria-label={t('common.close', 'Close')}
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Content */}
              <div className="min-h-[280px]">
                {LLM_HELP_PAGES[llmHelpPage].content === 'overview' ? (
                  <div className="space-y-3">
                    <p className="text-sm text-text-muted mb-4">
                      {t('adminDeployment.llmHelp.overviewDesc', 'An LLM (Large Language Model) provider is the AI service that powers your assistant\'s responses. Choose based on your privacy needs and infrastructure.')}
                    </p>
                    <div className="space-y-2">
                      <div className="bg-surface-overlay border border-border rounded-lg p-3">
                        <p className="text-sm font-medium text-text">LLM_PROVIDER</p>
                        <p className="text-xs text-text-muted mt-1">
                          {t('adminDeployment.llmHelp.providerField', 'Which service to use: "maple", "ollama", or "openai"')}
                        </p>
                      </div>
                      <div className="bg-surface-overlay border border-border rounded-lg p-3">
                        <p className="text-sm font-medium text-text">LLM_MODEL</p>
                        <p className="text-xs text-text-muted mt-1">
                          {t('adminDeployment.llmHelp.modelField', 'The specific AI model to use. Each provider has different models available.')}
                        </p>
                      </div>
                      <div className="bg-surface-overlay border border-border rounded-lg p-3">
                        <p className="text-sm font-medium text-text">{t('adminDeployment.llmHelp.apiKeyLabel', 'API Key (provider-specific)')}</p>
                        <p className="text-xs text-text-muted mt-1">
                          {t('adminDeployment.llmHelp.apiKeyField', 'Authentication credential for cloud providers. Ollama doesn\'t need one.')}
                        </p>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {LLM_HELP_PAGES[llmHelpPage].hint && (
                      <div className="bg-accent/10 border border-accent/20 rounded-lg p-3">
                        <p className="text-sm text-accent">
                          {LLM_HELP_PAGES[llmHelpPage].hint}
                        </p>
                      </div>
                    )}
                    <p className="text-sm text-text-muted">
                      {t('adminDeployment.llmHelp.exampleConfig', 'Example configuration:')}
                    </p>
                    <div className="bg-surface-overlay border border-border rounded-lg p-3 font-mono text-xs space-y-1">
                      {LLM_HELP_PAGES[llmHelpPage].config && Object.entries(LLM_HELP_PAGES[llmHelpPage].config!).map(([key, value]) => (
                        <div key={key} className="flex">
                          <span className="text-accent">{key}</span>
                          <span className="text-text-muted">=</span>
                          <span className="text-text">{value}</span>
                        </div>
                      ))}
                    </div>
                    {LLM_HELP_PAGES[llmHelpPage].extra && (
                      <p className="text-xs text-text-muted mt-3">
                        {LLM_HELP_PAGES[llmHelpPage].extra}
                      </p>
                    )}
                  </div>
                )}
              </div>

              {/* Pagination */}
              <div className="flex items-center justify-between mt-6 pt-4 border-t border-border">
                <button
                  onClick={() => setLlmHelpPage((prev) => Math.max(0, prev - 1))}
                  disabled={llmHelpPage === 0}
                  className="flex items-center gap-1 text-sm text-text-muted hover:text-text disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronLeft className="w-4 h-4" />
                  {t('common.previous', 'Previous')}
                </button>

                {/* Page indicators */}
                <div className="flex items-center gap-1.5">
                  {LLM_HELP_PAGES.map((_, index) => (
                    <button
                      key={index}
                      onClick={() => setLlmHelpPage(index)}
                      className={`w-2 h-2 rounded-full transition-colors ${
                        index === llmHelpPage
                          ? 'bg-accent'
                          : 'bg-border hover:bg-text-muted'
                      }`}
                      aria-label={`${t('adminDeployment.llmHelp.goToPage', 'Go to page')} ${index + 1}`}
                    />
                  ))}
                </div>

                <button
                  onClick={() => setLlmHelpPage((prev) => Math.min(LLM_HELP_PAGES.length - 1, prev + 1))}
                  disabled={llmHelpPage === LLM_HELP_PAGES.length - 1}
                  className="flex items-center gap-1 text-sm text-text-muted hover:text-text disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  {t('common.next', 'Next')}
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Embedding Help Modal */}
        {showEmbeddingHelpModal && (
          <div
            ref={embeddingHelpModalRef}
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
            role="dialog"
            aria-modal="true"
            aria-labelledby="embedding-help-modal-title"
            onKeyDown={(e) => e.key === 'Escape' && handleCloseEmbeddingHelpModal()}
            tabIndex={-1}
          >
            <div className="bg-surface border border-border rounded-xl p-6 w-full max-w-lg mx-4 shadow-xl">
              <div className="flex items-center justify-between mb-4">
                <h3 id="embedding-help-modal-title" className="text-lg font-semibold text-text flex items-center gap-2">
                  <HelpCircle className="w-5 h-5" />
                  {EMBEDDING_HELP_PAGES[embeddingHelpPage].title}
                </h3>
                <button
                  onClick={handleCloseEmbeddingHelpModal}
                  className="text-text-muted hover:text-text transition-colors"
                  aria-label={t('common.close', 'Close')}
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Content */}
              <div className="min-h-[280px]">
                {EMBEDDING_HELP_PAGES[embeddingHelpPage].content === 'overview' ? (
                  <div className="space-y-3">
                    <p className="text-sm text-text-muted mb-4">
                      {t('adminDeployment.embeddingHelp.overviewDesc', 'Embeddings convert your documents into numbers that computers can compare. This is what makes searching your knowledge base possible.')}
                    </p>
                    <div className="bg-surface-overlay border border-border rounded-lg p-4">
                      <p className="text-sm font-medium text-text mb-2">{t('adminDeployment.embeddingHelp.howItWorks', 'How it works:')}</p>
                      <ol className="text-xs text-text-muted space-y-2 list-decimal list-inside">
                        <li>{t('adminDeployment.embeddingHelp.step1', 'Your documents are split into chunks')}</li>
                        <li>{t('adminDeployment.embeddingHelp.step2', 'Each chunk is converted to a vector (list of numbers)')}</li>
                        <li>{t('adminDeployment.embeddingHelp.step3', 'When users ask questions, their query is also converted')}</li>
                        <li>{t('adminDeployment.embeddingHelp.step4', 'The system finds chunks with similar vectors')}</li>
                      </ol>
                    </div>
                    <p className="text-xs text-text-muted">
                      {t('adminDeployment.embeddingHelp.overviewNote', 'Think of it like creating a fingerprint for each piece of text that captures its meaning.')}
                    </p>
                  </div>
                ) : EMBEDDING_HELP_PAGES[embeddingHelpPage].content === 'models' ? (
                  <div className="space-y-3">
                    <p className="text-sm text-text-muted mb-4">
                      {t('adminDeployment.embeddingHelp.modelsDesc', 'Different embedding models have different strengths:')}
                    </p>
                    <div className="space-y-2">
                      <div className="bg-surface-overlay border border-border rounded-lg p-3">
                        <p className="text-sm font-medium text-text">multilingual-e5-base</p>
                        <p className="text-xs text-text-muted mt-1">
                          {t('adminDeployment.embeddingHelp.e5Desc', 'Default choice. Good balance of speed and quality. Supports 100+ languages. Runs locally.')}
                        </p>
                        <p className="text-xs text-success mt-1">{t('adminDeployment.embeddingHelp.recommended', 'Recommended')}</p>
                      </div>
                      <div className="bg-surface-overlay border border-border rounded-lg p-3">
                        <p className="text-sm font-medium text-text">OpenAI text-embedding-3-small</p>
                        <p className="text-xs text-text-muted mt-1">
                          {t('adminDeployment.embeddingHelp.openaiSmallDesc', 'Cloud-based, requires API key. Fast and cost-effective.')}
                        </p>
                      </div>
                      <div className="bg-surface-overlay border border-border rounded-lg p-3">
                        <p className="text-sm font-medium text-text">OpenAI text-embedding-3-large</p>
                        <p className="text-xs text-text-muted mt-1">
                          {t('adminDeployment.embeddingHelp.openaiLargeDesc', 'Highest quality but more expensive. Best for complex documents.')}
                        </p>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <p className="text-sm text-text-muted mb-4">
                      {t('adminDeployment.embeddingHelp.performanceDesc', 'These settings affect processing speed and resource usage:')}
                    </p>
                    <div className="space-y-2">
                      <div className="bg-surface-overlay border border-border rounded-lg p-3">
                        <p className="text-sm font-medium text-text">EMBEDDING_DIMENSION</p>
                        <p className="text-xs text-text-muted mt-1">
                          {t('adminDeployment.embeddingHelp.dimensionDesc', 'Size of the vectors. Higher = more detailed but uses more storage. Default: 768')}
                        </p>
                      </div>
                      <div className="bg-surface-overlay border border-border rounded-lg p-3">
                        <p className="text-sm font-medium text-text">EMBEDDING_BATCH_SIZE</p>
                        <p className="text-xs text-text-muted mt-1">
                          {t('adminDeployment.embeddingHelp.batchDesc', 'How many chunks to process at once. Higher = faster but uses more memory. Default: 32')}
                        </p>
                      </div>
                    </div>
                    <div className="bg-warning/10 border border-warning/20 rounded-lg p-3 mt-4">
                      <p className="text-xs text-warning">
                        {t('adminDeployment.embeddingHelp.warning', 'Changing the embedding model or dimension after uploading documents requires re-processing all documents.')}
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {/* Pagination */}
              <div className="flex items-center justify-between mt-6 pt-4 border-t border-border">
                <button
                  onClick={() => setEmbeddingHelpPage((prev) => Math.max(0, prev - 1))}
                  disabled={embeddingHelpPage === 0}
                  className="flex items-center gap-1 text-sm text-text-muted hover:text-text disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronLeft className="w-4 h-4" />
                  {t('common.previous', 'Previous')}
                </button>

                {/* Page indicators */}
                <div className="flex items-center gap-1.5">
                  {EMBEDDING_HELP_PAGES.map((_, index) => (
                    <button
                      key={index}
                      onClick={() => setEmbeddingHelpPage(index)}
                      className={`w-2 h-2 rounded-full transition-colors ${
                        index === embeddingHelpPage
                          ? 'bg-accent'
                          : 'bg-border hover:bg-text-muted'
                      }`}
                      aria-label={`${t('adminDeployment.embeddingHelp.goToPage', 'Go to page')} ${index + 1}`}
                    />
                  ))}
                </div>

                <button
                  onClick={() => setEmbeddingHelpPage((prev) => Math.min(EMBEDDING_HELP_PAGES.length - 1, prev + 1))}
                  disabled={embeddingHelpPage === EMBEDDING_HELP_PAGES.length - 1}
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
    </OnboardingCard>
  )
}
