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
  Key,
  Globe,
  Lock,
} from 'lucide-react'
import { OnboardingCard } from '../components/onboarding/OnboardingCard'
import { isAdminAuthenticated } from '../utils/adminApi'
import { useDeploymentConfig, useServiceHealth, useConfigAuditLog, useKeyMigration } from '../hooks/useAdminConfig'
import type { DeploymentConfigItem, ServiceHealthItem, ConfigCategory, DeploymentConfigItemKey, MigrationPrepareResponse, DecryptedUserData, DecryptedFieldValue } from '../types/config'
import { getConfigCategories, getDeploymentConfigItemMeta } from '../types/config'
import { STORAGE_KEYS } from '../types/onboarding'
import { hasNip04Support, decryptField } from '../utils/encryption'
import { hasNostrExtension } from '../utils/nostrAuth'
import { normalizePubkey } from '../utils/nostrKeys'
import { clearAdminAuth } from '../utils/adminApi'

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

  // Domains help modal state
  const [showDomainsHelpModal, setShowDomainsHelpModal] = useState(false)
  const [domainsHelpPage, setDomainsHelpPage] = useState(0)
  const domainsHelpModalRef = useRef<HTMLDivElement>(null)

  // Key migration hook and state
  const {
    loading: migrationLoading,
    prepare: prepareMigration,
    execute: executeMigration,
  } = useKeyMigration()

  const [showMigrationModal, setShowMigrationModal] = useState(false)
  const [migrationStep, setMigrationStep] = useState<'input' | 'confirm' | 'progress' | 'complete' | 'error'>('input')
  const [newAdminPubkey, setNewAdminPubkey] = useState('')
  const [migrationPrepareData, setMigrationPrepareData] = useState<MigrationPrepareResponse | null>(null)
  const [migrationProgress, setMigrationProgress] = useState('')
  const [migrationResult, setMigrationResult] = useState<{ success: boolean; message: string; usersMigrated?: number; fieldValuesMigrated?: number } | null>(null)
  const migrationModalRef = useRef<HTMLDivElement>(null)
  const isExecutingMigration = useRef(false)

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

  const handleCloseDomainsHelpModal = () => {
    setShowDomainsHelpModal(false)
    setDomainsHelpPage(0)
  }

  // Key migration handlers
  const handleOpenMigrationModal = () => {
    // Check prerequisites
    if (!hasNostrExtension()) {
      setMigrationResult({
        success: false,
        message: t('adminDeployment.keyMigration.noExtension', 'No Nostr extension found. Please install a NIP-07 compatible extension like Alby or nos2x.'),
      })
      setMigrationStep('error')
      setShowMigrationModal(true)
      return
    }
    if (!hasNip04Support()) {
      setMigrationResult({
        success: false,
        message: t('adminDeployment.keyMigration.noNip04', 'Your Nostr extension does not support NIP-04 decryption.'),
      })
      setMigrationStep('error')
      setShowMigrationModal(true)
      return
    }

    setMigrationStep('input')
    setNewAdminPubkey('')
    setMigrationPrepareData(null)
    setMigrationResult(null)
    setShowMigrationModal(true)
  }

  const handleCloseMigrationModal = () => {
    if (migrationStep === 'progress') {
      // Don't allow closing during migration
      return
    }
    setShowMigrationModal(false)
    setMigrationStep('input')
    setNewAdminPubkey('')
    setMigrationPrepareData(null)
    setMigrationResult(null)
  }

  const handleMigrationPrepare = async () => {
    // Validate new pubkey
    const trimmed = newAdminPubkey.trim()
    let normalizedPubkey: string
    try {
      normalizedPubkey = normalizePubkey(trimmed)
    } catch {
      setMigrationResult({
        success: false,
        message: t('adminDeployment.keyMigration.invalidPubkey', 'Invalid pubkey format. Enter a valid npub or 64-character hex pubkey.'),
      })
      setMigrationStep('error')
      return
    }

    // Fetch encrypted data
    setMigrationProgress(t('adminDeployment.keyMigration.fetchingData', 'Fetching encrypted data...'))
    setMigrationStep('progress')

    try {
      const prepareData = await prepareMigration()
      setMigrationPrepareData(prepareData)

      // Check if trying to migrate to same key
      if (normalizedPubkey === prepareData.admin_pubkey) {
        setMigrationResult({
          success: false,
          message: t('adminDeployment.keyMigration.samePubkey', 'The new pubkey must be different from the current admin pubkey.'),
        })
        setMigrationStep('error')
        return
      }

      setNewAdminPubkey(normalizedPubkey)
      setMigrationStep('confirm')
    } catch (err) {
      setMigrationResult({
        success: false,
        message: err instanceof Error ? err.message : t('adminDeployment.keyMigration.prepareFailed', 'Failed to prepare migration'),
      })
      setMigrationStep('error')
    }
  }

  const handleMigrationExecute = async () => {
    if (!migrationPrepareData || !newAdminPubkey) return
    if (isExecutingMigration.current) return

    isExecutingMigration.current = true
    setMigrationStep('progress')

    try {
      // Step 1: Decrypt all user data
      setMigrationProgress(t('adminDeployment.keyMigration.decryptingUsers', 'Decrypting user data...'))
      const decryptedUsers: DecryptedUserData[] = []

      for (const user of migrationPrepareData.users) {
        const decryptedUser: DecryptedUserData = { id: user.id }

        // Guard: encrypted data must have its ephemeral pubkey
        if (user.encrypted_email && !user.ephemeral_pubkey_email) {
          throw new Error(t('adminDeployment.keyMigration.decryptFailed', 'Data integrity error: encrypted email for user {{id}} is missing ephemeral pubkey. Migration aborted.', { id: user.id }))
        }
        if (user.encrypted_name && !user.ephemeral_pubkey_name) {
          throw new Error(t('adminDeployment.keyMigration.decryptFailed', 'Data integrity error: encrypted name for user {{id}} is missing ephemeral pubkey. Migration aborted.', { id: user.id }))
        }

        if (user.encrypted_email && user.ephemeral_pubkey_email) {
          const email = await decryptField({
            ciphertext: user.encrypted_email,
            ephemeral_pubkey: user.ephemeral_pubkey_email,
          })
          if (email === null) {
            throw new Error(t('adminDeployment.keyMigration.decryptFailed', 'Failed to decrypt email for user {{id}}. Migration aborted to prevent data loss.', { id: user.id }))
          }
          decryptedUser.email = email
        }

        if (user.encrypted_name && user.ephemeral_pubkey_name) {
          const name = await decryptField({
            ciphertext: user.encrypted_name,
            ephemeral_pubkey: user.ephemeral_pubkey_name,
          })
          if (name === null) {
            throw new Error(t('adminDeployment.keyMigration.decryptFailed', 'Failed to decrypt name for user {{id}}. Migration aborted to prevent data loss.', { id: user.id }))
          }
          decryptedUser.name = name
        }

        decryptedUsers.push(decryptedUser)
      }

      // Step 2: Decrypt all field values
      setMigrationProgress(t('adminDeployment.keyMigration.decryptingFields', 'Decrypting field values...'))
      const decryptedFieldValues: DecryptedFieldValue[] = []

      for (const field of migrationPrepareData.field_values) {
        // Guard: encrypted data must have its ephemeral pubkey
        if (field.encrypted_value && !field.ephemeral_pubkey) {
          throw new Error(t('adminDeployment.keyMigration.decryptFieldFailed', 'Data integrity error: encrypted field {{id}} is missing ephemeral pubkey. Migration aborted.', { id: field.id }))
        }

        if (field.encrypted_value && field.ephemeral_pubkey) {
          const value = await decryptField({
            ciphertext: field.encrypted_value,
            ephemeral_pubkey: field.ephemeral_pubkey,
          })
          if (value === null) {
            throw new Error(t('adminDeployment.keyMigration.decryptFieldFailed', 'Failed to decrypt field value {{id}}. Migration aborted to prevent data loss.', { id: field.id }))
          }
          decryptedFieldValues.push({ id: field.id, value })
        }
      }

      // Step 3: Sign authorization event
      setMigrationProgress(t('adminDeployment.keyMigration.signing', 'Requesting signature...'))

      if (!window.nostr) {
        throw new Error(t('adminDeployment.keyMigration.noExtension', 'No Nostr extension found'))
      }

      const unsignedEvent = {
        kind: 22242,
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ['action', 'admin_key_migration'],
          ['new_pubkey', newAdminPubkey],
        ],
        content: '',
      }

      const signedEvent = await window.nostr.signEvent(unsignedEvent)

      // Step 4: Submit migration
      setMigrationProgress(t('adminDeployment.keyMigration.submitting', 'Submitting migration...'))

      const result = await executeMigration(
        newAdminPubkey,
        decryptedUsers,
        decryptedFieldValues,
        signedEvent
      )

      setMigrationResult({
        success: true,
        message: result.message,
        usersMigrated: result.users_migrated,
        fieldValuesMigrated: result.field_values_migrated,
      })
      setMigrationStep('complete')

    } catch (err) {
      console.error('Migration failed:', err)
      setMigrationResult({
        success: false,
        message: err instanceof Error ? err.message : t('adminDeployment.keyMigration.failed', 'Migration failed'),
      })
      setMigrationStep('error')
    } finally {
      isExecutingMigration.current = false
    }
  }

  const handleMigrationComplete = () => {
    // Clear session and redirect to login
    clearAdminAuth()
    navigate('/admin')
  }

  // Focus trap for migration modal
  useEffect(() => {
    if (showMigrationModal && migrationModalRef.current) {
      migrationModalRef.current.focus()
    }
  }, [showMigrationModal])

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

  // Focus trap for domains help modal
  useEffect(() => {
    if (showDomainsHelpModal && domainsHelpModalRef.current) {
      domainsHelpModalRef.current.focus()
    }
  }, [showDomainsHelpModal, domainsHelpModalRef])

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

  const DOMAINS_HELP_PAGES = [
    {
      title: t('adminDeployment.domainsHelp.overviewTitle', 'Domains & URLs Overview'),
      content: 'overview',
    },
    {
      title: t('adminDeployment.domainsHelp.urlsTitle', 'Public URLs & CORS'),
      content: 'urls',
    },
    {
      title: t('adminDeployment.domainsHelp.dnsTitle', 'DNS Records (Email)'),
      content: 'dns',
    },
    {
      title: t('adminDeployment.domainsHelp.edgeTitle', 'CDN & Webhooks'),
      content: 'edge',
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
      case 'domains':
        return <Globe className="w-4 h-4 text-text-muted" />
      case 'ssl':
        return <Lock className="w-4 h-4 text-text-muted" />
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
      ...(deploymentConfig.domains || []),
      ...(deploymentConfig.ssl || []),
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
    const label = meta?.label || item.key
    const description = meta?.description || item.description
    const hint = meta?.hint
    const helpText = hint || description || item.description

    return (
      <div
        key={item.key}
        className="bg-surface border border-border rounded-lg p-3 hover:border-border-strong transition-all"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-sm font-medium text-text">{label}</p>
              {helpText && (
                <span
                  className="text-text-muted"
                  title={helpText}
                  aria-label={helpText}
                >
                  <HelpCircle className="w-4 h-4" />
                </span>
              )}
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
            <p className="text-[11px] font-mono text-text-muted mt-1">{item.key}</p>
            {description && (
              <p className="text-xs text-text-muted mt-1">{description}</p>
            )}
            {hint && (
              <p className="text-xs text-text-muted/70 mt-1 leading-relaxed">{hint}</p>
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
    const helpText = meta.hint || meta.description
    const hasModalHelp = category === 'email' || category === 'llm' || category === 'embedding' || category === 'domains'

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
              title={helpText}
            >
              <HelpCircle className="w-5 h-5" />
            </button>
          )}
          {category === 'llm' && (
            <button
              onClick={() => setShowLlmHelpModal(true)}
              className="ml-1 text-text-muted hover:text-accent transition-colors"
              aria-label={t('adminDeployment.llmHelp.ariaLabel', 'LLM provider configuration help')}
              title={helpText}
            >
              <HelpCircle className="w-5 h-5" />
            </button>
          )}
          {category === 'embedding' && (
            <button
              onClick={() => setShowEmbeddingHelpModal(true)}
              className="ml-1 text-text-muted hover:text-accent transition-colors"
              aria-label={t('adminDeployment.embeddingHelp.ariaLabel', 'Embedding configuration help')}
              title={helpText}
            >
              <HelpCircle className="w-5 h-5" />
            </button>
          )}
          {category === 'domains' && (
            <button
              onClick={() => setShowDomainsHelpModal(true)}
              className="ml-1 text-text-muted hover:text-accent transition-colors"
              aria-label={t('adminDeployment.domainsHelp.ariaLabel', 'Domains and DNS configuration help')}
              title={helpText}
            >
              <HelpCircle className="w-5 h-5" />
            </button>
          )}
          {!hasModalHelp && helpText && (
            <span className="ml-1 text-text-muted" title={helpText} aria-label={helpText}>
              <HelpCircle className="w-5 h-5" />
            </span>
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
      size="xl"
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
            {renderCategory('domains', deploymentConfig.domains)}
            {renderCategory('ssl', deploymentConfig.ssl)}
            {renderCategory('general', deploymentConfig.general)}
          </>
        )}

        {/* Admin Key Migration Section */}
        <div className="card card-sm p-5! bg-surface-overlay!">
          <h3 className="heading-sm mb-2 flex items-center gap-2">
            <Key className="w-4 h-4 text-text-muted" />
            {t('adminDeployment.keyMigration.title', 'Admin Key Migration')}
          </h3>
          <p className="text-sm text-text-secondary mb-1">
            {t('adminDeployment.keyMigration.description', 'Migrate to a new Nostr private key')}
          </p>
          <p className="text-xs text-text-muted mb-4">
            {t('adminDeployment.keyMigration.hint', 'Re-encrypts all user PII to a new admin pubkey. Use this if you need to change your admin key.')}
          </p>

          <div className="bg-surface border border-border rounded-lg p-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-text-muted mb-1">
                  {t('adminDeployment.keyMigration.currentAdmin', 'Current Admin')}
                </p>
                <p className="text-sm font-mono text-text">
                  {localStorage.getItem(STORAGE_KEYS.ADMIN_PUBKEY)
                    ? `${localStorage.getItem(STORAGE_KEYS.ADMIN_PUBKEY)?.slice(0, 8)}...${localStorage.getItem(STORAGE_KEYS.ADMIN_PUBKEY)?.slice(-8)}`
                    : t('adminDeployment.keyMigration.unknown', 'Unknown')}
                </p>
              </div>
              <button
                onClick={handleOpenMigrationModal}
                className="flex items-center gap-2 bg-warning/10 border border-warning/30 text-warning rounded-lg px-4 py-2 text-sm font-medium hover:bg-warning/20 transition-all"
              >
                <Key className="w-4 h-4" />
                {t('adminDeployment.keyMigration.migrateButton', 'Migrate to New Key')}
              </button>
            </div>
          </div>
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

        {/* Domains Help Modal */}
        {showDomainsHelpModal && (
          <div
            ref={domainsHelpModalRef}
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
            role="dialog"
            aria-modal="true"
            aria-labelledby="domains-help-modal-title"
            onKeyDown={(e) => e.key === 'Escape' && handleCloseDomainsHelpModal()}
            tabIndex={-1}
          >
            <div className="bg-surface border border-border rounded-xl p-6 w-full max-w-lg mx-4 shadow-xl">
              <div className="flex items-center justify-between mb-4">
                <h3 id="domains-help-modal-title" className="text-lg font-semibold text-text flex items-center gap-2">
                  <HelpCircle className="w-5 h-5" />
                  {DOMAINS_HELP_PAGES[domainsHelpPage].title}
                </h3>
                <button
                  onClick={handleCloseDomainsHelpModal}
                  className="text-text-muted hover:text-text transition-colors"
                  aria-label={t('common.close', 'Close')}
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="min-h-[280px]">
                {DOMAINS_HELP_PAGES[domainsHelpPage].content === 'overview' ? (
                  <div className="space-y-3">
                    <p className="text-sm text-text-muted mb-4">
                      {t('adminDeployment.domainsHelp.overviewDesc', 'These settings control where your app lives on the internet and how services find each other. Defaults are set for local development.')}
                    </p>
                    <div className="bg-surface-overlay border border-border rounded-lg p-4">
                      <p className="text-sm font-medium text-text mb-2">{t('adminDeployment.domainsHelp.whatToSet', 'Set these when you go live:')}</p>
                      <ul className="text-xs text-text-muted space-y-2 list-disc list-inside">
                        <li>{t('adminDeployment.domainsHelp.overviewUrl', 'INSTANCE_URL / API_BASE_URL / ADMIN_BASE_URL for public entry points')}</li>
                        <li>{t('adminDeployment.domainsHelp.overviewCORS', 'CORS_ORIGINS to allow your frontend domain')}</li>
                        <li>{t('adminDeployment.domainsHelp.overviewDns', 'Email DNS (DKIM/SPF/DMARC) for deliverability')}</li>
                      </ul>
                    </div>
                    <p className="text-xs text-text-muted">
                      {t('adminDeployment.domainsHelp.overviewNote', 'If you are staying on localhost, you can keep the defaults.')}
                    </p>
                  </div>
                ) : DOMAINS_HELP_PAGES[domainsHelpPage].content === 'urls' ? (
                  <div className="space-y-3">
                    <p className="text-sm text-text-muted mb-4">
                      {t('adminDeployment.domainsHelp.urlsDesc', 'Public URLs and CORS origins must match exactly (scheme + domain + port).')}
                    </p>
                    <div className="bg-surface-overlay border border-border rounded-lg p-3 font-mono text-xs space-y-1">
                      <div>INSTANCE_URL=https://app.example.com</div>
                      <div>API_BASE_URL=https://api.example.com</div>
                      <div>ADMIN_BASE_URL=https://admin.example.com</div>
                      <div>CORS_ORIGINS=https://app.example.com,https://admin.example.com</div>
                    </div>
                    <p className="text-xs text-text-muted">
                      {t('adminDeployment.domainsHelp.urlsNote', 'If your API is served from the same domain as the app, you can leave API_BASE_URL empty.')}
                    </p>
                  </div>
                ) : DOMAINS_HELP_PAGES[domainsHelpPage].content === 'dns' ? (
                  <div className="space-y-3">
                    <p className="text-sm text-text-muted mb-4">
                      {t('adminDeployment.domainsHelp.dnsDesc', 'These values help you create DNS records for email deliverability.')}
                    </p>
                    <div className="space-y-2">
                      <div className="bg-surface-overlay border border-border rounded-lg p-3">
                        <p className="text-xs text-text-muted mb-1">SPF</p>
                        <p className="text-xs text-text">
                          {t('adminDeployment.domainsHelp.spfExample', 'Example TXT record: v=spf1 include:sendgrid.net ~all')}
                        </p>
                      </div>
                      <div className="bg-surface-overlay border border-border rounded-lg p-3">
                        <p className="text-xs text-text-muted mb-1">DKIM</p>
                        <p className="text-xs text-text">
                          {t('adminDeployment.domainsHelp.dkimExample', 'Use the selector from DKIM_SELECTOR and the public key from your provider.')}
                        </p>
                      </div>
                      <div className="bg-surface-overlay border border-border rounded-lg p-3">
                        <p className="text-xs text-text-muted mb-1">DMARC</p>
                        <p className="text-xs text-text">
                          {t('adminDeployment.domainsHelp.dmarcExample', 'Example TXT record: v=DMARC1; p=none; rua=mailto:dmarc@example.com')}
                        </p>
                      </div>
                    </div>
                    <p className="text-xs text-text-muted">
                      {t('adminDeployment.domainsHelp.dnsNote', 'Use your email provider\'s recommended records for best deliverability.')}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <p className="text-sm text-text-muted mb-4">
                      {t('adminDeployment.domainsHelp.edgeDesc', 'Optional settings for advanced setups.')}
                    </p>
                    <div className="space-y-2">
                      <div className="bg-surface-overlay border border-border rounded-lg p-3">
                        <p className="text-xs font-medium text-text">CDN_DOMAINS</p>
                        <p className="text-xs text-text-muted mt-1">
                          {t('adminDeployment.domainsHelp.cdnDesc', 'Comma-separated CDN hostnames for static assets. Leave blank if not using a CDN.')}
                        </p>
                      </div>
                      <div className="bg-surface-overlay border border-border rounded-lg p-3">
                        <p className="text-xs font-medium text-text">WEBHOOK_BASE_URL</p>
                        <p className="text-xs text-text-muted mt-1">
                          {t('adminDeployment.domainsHelp.webhookDesc', 'Base URL used to construct webhook callbacks. Use your public API domain.')}
                        </p>
                      </div>
                      <div className="bg-surface-overlay border border-border rounded-lg p-3">
                        <p className="text-xs font-medium text-text">CUSTOM_SEARXNG_URL</p>
                        <p className="text-xs text-text-muted mt-1">
                          {t('adminDeployment.domainsHelp.searxDesc', 'Only needed if your SearXNG instance lives on a different host.')}
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between mt-6 pt-4 border-t border-border">
                <button
                  onClick={() => setDomainsHelpPage((prev) => Math.max(0, prev - 1))}
                  disabled={domainsHelpPage === 0}
                  className="flex items-center gap-1 text-sm text-text-muted hover:text-text disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronLeft className="w-4 h-4" />
                  {t('common.previous', 'Previous')}
                </button>

                <div className="flex items-center gap-1.5">
                  {DOMAINS_HELP_PAGES.map((_, index) => (
                    <button
                      key={index}
                      onClick={() => setDomainsHelpPage(index)}
                      className={`w-2 h-2 rounded-full transition-colors ${
                        index === domainsHelpPage
                          ? 'bg-accent'
                          : 'bg-border hover:bg-text-muted'
                      }`}
                      aria-label={`${t('adminDeployment.domainsHelp.goToPage', 'Go to page')} ${index + 1}`}
                    />
                  ))}
                </div>

                <button
                  onClick={() => setDomainsHelpPage((prev) => Math.min(DOMAINS_HELP_PAGES.length - 1, prev + 1))}
                  disabled={domainsHelpPage === DOMAINS_HELP_PAGES.length - 1}
                  className="flex items-center gap-1 text-sm text-text-muted hover:text-text disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  {t('common.next', 'Next')}
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Key Migration Modal */}
        {showMigrationModal && (
          <div
            ref={migrationModalRef}
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
            role="dialog"
            aria-modal="true"
            aria-labelledby="migration-modal-title"
            onKeyDown={(e) => e.key === 'Escape' && migrationStep !== 'progress' && handleCloseMigrationModal()}
            tabIndex={-1}
          >
            <div className="bg-surface border border-border rounded-xl p-6 w-full max-w-md mx-4 shadow-xl">
              <div className="flex items-center justify-between mb-4">
                <h3 id="migration-modal-title" className="text-lg font-semibold text-text flex items-center gap-2">
                  <Key className="w-5 h-5" />
                  {t('adminDeployment.keyMigration.modalTitle', 'Admin Key Migration')}
                </h3>
                {migrationStep !== 'progress' && (
                  <button
                    onClick={handleCloseMigrationModal}
                    className="text-text-muted hover:text-text transition-colors"
                    aria-label={t('common.close', 'Close')}
                  >
                    <X className="w-5 h-5" />
                  </button>
                )}
              </div>

              {/* Input Step */}
              {migrationStep === 'input' && (
                <div className="space-y-4">
                  <div className="bg-warning/10 border border-warning/20 rounded-lg p-3">
                    <p className="text-xs text-warning">
                      {t('adminDeployment.keyMigration.warning', 'This operation is irreversible. Make sure you have access to the new private key before proceeding.')}
                    </p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-text mb-1">
                      {t('adminDeployment.keyMigration.newPubkeyLabel', 'New Admin Pubkey')}
                    </label>
                    <input
                      type="text"
                      value={newAdminPubkey}
                      onChange={(e) => setNewAdminPubkey(e.target.value)}
                      placeholder="npub1... or 64-char hex"
                      className="w-full border border-border rounded-lg px-3 py-2 bg-surface text-text placeholder:text-text-muted text-sm font-mono focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
                    />
                    <p className="text-xs text-text-muted mt-1">
                      {t('adminDeployment.keyMigration.pubkeyHint', 'Enter the public key (npub or hex) of the new admin')}
                    </p>
                  </div>

                  <div className="flex gap-3">
                    <button
                      onClick={handleCloseMigrationModal}
                      className="flex-1 bg-surface-overlay border border-border text-text rounded-lg px-4 py-2.5 text-sm font-medium hover:bg-surface transition-all"
                    >
                      {t('common.cancel', 'Cancel')}
                    </button>
                    <button
                      onClick={handleMigrationPrepare}
                      disabled={!newAdminPubkey.trim() || migrationLoading}
                      className="flex-1 bg-warning text-white rounded-lg px-4 py-2.5 text-sm font-medium hover:bg-warning/90 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                      {migrationLoading ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Key className="w-4 h-4" />
                      )}
                      {t('common.continue', 'Continue')}
                    </button>
                  </div>
                </div>
              )}

              {/* Confirm Step */}
              {migrationStep === 'confirm' && migrationPrepareData && (
                <div className="space-y-4">
                  <div className="bg-surface-overlay border border-border rounded-lg p-4 space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-text-muted">{t('adminDeployment.keyMigration.usersToMigrate', 'Users to migrate:')}</span>
                      <span className="text-text font-medium">{migrationPrepareData.user_count}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-text-muted">{t('adminDeployment.keyMigration.fieldsToMigrate', 'Field values to migrate:')}</span>
                      <span className="text-text font-medium">{migrationPrepareData.field_value_count}</span>
                    </div>
                    <div className="pt-2 border-t border-border">
                      <div className="text-xs text-text-muted mb-1">{t('adminDeployment.keyMigration.fromKey', 'From:')}</div>
                      <div className="text-xs font-mono text-text truncate">{migrationPrepareData.admin_pubkey}</div>
                    </div>
                    <div>
                      <div className="text-xs text-text-muted mb-1">{t('adminDeployment.keyMigration.toKey', 'To:')}</div>
                      <div className="text-xs font-mono text-text truncate">{newAdminPubkey}</div>
                    </div>
                  </div>

                  <div className="bg-error/10 border border-error/20 rounded-lg p-3">
                    <p className="text-xs text-error font-medium mb-1">
                      {t('adminDeployment.keyMigration.confirmWarningTitle', 'This action cannot be undone')}
                    </p>
                    <p className="text-xs text-error">
                      {t('adminDeployment.keyMigration.confirmWarning', 'You will be signed out after migration and must log in with the new key.')}
                    </p>
                  </div>

                  <div className="flex gap-3">
                    <button
                      onClick={() => setMigrationStep('input')}
                      className="flex-1 bg-surface-overlay border border-border text-text rounded-lg px-4 py-2.5 text-sm font-medium hover:bg-surface transition-all"
                    >
                      {t('common.back', 'Back')}
                    </button>
                    <button
                      onClick={handleMigrationExecute}
                      className="flex-1 bg-error text-white rounded-lg px-4 py-2.5 text-sm font-medium hover:bg-error/90 transition-all flex items-center justify-center gap-2"
                    >
                      <Key className="w-4 h-4" />
                      {t('adminDeployment.keyMigration.confirmButton', 'Migrate Now')}
                    </button>
                  </div>
                </div>
              )}

              {/* Progress Step */}
              {migrationStep === 'progress' && (
                <div className="space-y-4 py-4">
                  <div className="flex flex-col items-center gap-4">
                    <Loader2 className="w-12 h-12 text-accent animate-spin" />
                    <p className="text-sm text-text-muted text-center">{migrationProgress}</p>
                  </div>
                  <p className="text-xs text-text-muted text-center">
                    {t('adminDeployment.keyMigration.doNotClose', 'Please do not close this window.')}
                  </p>
                </div>
              )}

              {/* Complete Step */}
              {migrationStep === 'complete' && migrationResult && (
                <div className="space-y-4">
                  <div className="flex flex-col items-center gap-4 py-4">
                    <CheckCircle className="w-12 h-12 text-success" />
                    <p className="text-sm text-text text-center font-medium">{migrationResult.message}</p>
                  </div>

                  <div className="bg-surface-overlay border border-border rounded-lg p-3 space-y-1">
                    <div className="flex justify-between text-sm">
                      <span className="text-text-muted">{t('adminDeployment.keyMigration.usersMigrated', 'Users migrated:')}</span>
                      <span className="text-success font-medium">{migrationResult.usersMigrated}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-text-muted">{t('adminDeployment.keyMigration.fieldsMigrated', 'Fields migrated:')}</span>
                      <span className="text-success font-medium">{migrationResult.fieldValuesMigrated}</span>
                    </div>
                  </div>

                  <p className="text-xs text-text-muted text-center">
                    {t('adminDeployment.keyMigration.signInPrompt', 'Click below to sign in with your new key.')}
                  </p>

                  <button
                    onClick={handleMigrationComplete}
                    className="w-full bg-accent text-accent-text rounded-lg px-4 py-2.5 text-sm font-medium hover:bg-accent-hover transition-all"
                  >
                    {t('adminDeployment.keyMigration.goToLogin', 'Go to Login')}
                  </button>
                </div>
              )}

              {/* Error Step */}
              {migrationStep === 'error' && migrationResult && (
                <div className="space-y-4">
                  <div className="flex flex-col items-center gap-4 py-4">
                    <XCircle className="w-12 h-12 text-error" />
                    <p className="text-sm text-error text-center">{migrationResult.message}</p>
                  </div>

                  <button
                    onClick={handleCloseMigrationModal}
                    className="w-full bg-surface-overlay border border-border text-text rounded-lg px-4 py-2.5 text-sm font-medium hover:bg-surface transition-all"
                  >
                    {t('common.close', 'Close')}
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </OnboardingCard>
  )
}
