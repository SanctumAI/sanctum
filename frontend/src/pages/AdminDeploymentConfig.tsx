import { useState, useEffect, useRef, useMemo } from 'react'
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
import type { DeploymentConfigItem, ServiceHealthItem, ConfigCategory, DeploymentConfigItemKey, MigrationPrepareResponse, DecryptedUserData, DecryptedFieldValue, DeploymentValidationResponse } from '../types/config'
import { getConfigCategories, getDeploymentConfigItemMeta } from '../types/config'
import { STORAGE_KEYS } from '../types/onboarding'
import { hasNip04Support, decryptField } from '../utils/encryption'
import { hasNostrExtension } from '../utils/nostrAuth'
import { normalizePubkey } from '../utils/nostrKeys'
import { clearAdminAuth } from '../utils/adminApi'

type ValidationState = {
  result: DeploymentValidationResponse
  validatedAt: string
  configFingerprint: string
}

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
  const [validationState, setValidationState] = useState<ValidationState | null>(null)
  const [validationDismissed, setValidationDismissed] = useState(false)
  const [validationLoading, setValidationLoading] = useState(false)
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

  // Storage help modal state
  const [showStorageHelpModal, setShowStorageHelpModal] = useState(false)
  const [storageHelpPage, setStorageHelpPage] = useState(0)
  const storageHelpModalRef = useRef<HTMLDivElement>(null)

  // Search help modal state
  const [showSearchHelpModal, setShowSearchHelpModal] = useState(false)
  const [searchHelpPage, setSearchHelpPage] = useState(0)
  const searchHelpModalRef = useRef<HTMLDivElement>(null)

  // Security help modal state
  const [showSecurityHelpModal, setShowSecurityHelpModal] = useState(false)
  const [securityHelpPage, setSecurityHelpPage] = useState(0)
  const securityHelpModalRef = useRef<HTMLDivElement>(null)

  // SSL help modal state
  const [showSslHelpModal, setShowSslHelpModal] = useState(false)
  const [sslHelpPage, setSslHelpPage] = useState(0)
  const sslHelpModalRef = useRef<HTMLDivElement>(null)

  const [openHelpItemKey, setOpenHelpItemKey] = useState<string | null>(null)

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

  const configSignature = useMemo(() => {
    if (!deploymentConfig) {
      return { fingerprint: '', lastUpdatedAt: null as string | null }
    }

    const items = Object.values(deploymentConfig).flat()
    if (items.length === 0) {
      return { fingerprint: '', lastUpdatedAt: null as string | null }
    }

    const fingerprint = items
      .map((item) => `${item.key}:${item.value ?? ''}:${item.updated_at ?? ''}`)
      .sort()
      .join('|')

    let lastUpdatedAt: string | null = null
    for (const item of items) {
      if (!item.updated_at) continue
      if (!lastUpdatedAt) {
        lastUpdatedAt = item.updated_at
        continue
      }
      const current = new Date(item.updated_at).getTime()
      const existing = new Date(lastUpdatedAt).getTime()
      if (!isNaN(current) && (isNaN(existing) || current > existing)) {
        lastUpdatedAt = item.updated_at
      }
    }

    return { fingerprint, lastUpdatedAt }
  }, [deploymentConfig])

  const validationIsStale = Boolean(
    validationState
    && configSignature.fingerprint
    && validationState.configFingerprint !== configSignature.fingerprint
  )

  const formatTimestamp = (value?: string | null) => {
    if (!value) return t('common.unknown', 'Unknown')
    const date = new Date(value)
    return isNaN(date.getTime()) ? value : date.toLocaleString()
  }

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
    setValidationLoading(true)
    setValidationDismissed(false)
    try {
      const result = await validate()
      setValidationState({
        result,
        validatedAt: new Date().toISOString(),
        configFingerprint: configSignature.fingerprint,
      })
    } catch (err) {
      console.error('Validation failed:', err)
      setValidationState({
        result: {
          valid: false,
          errors: [err instanceof Error ? err.message : t('adminDeployment.validationFailed', 'Validation request failed')],
          warnings: [],
        },
        validatedAt: new Date().toISOString(),
        configFingerprint: configSignature.fingerprint,
      })
    } finally {
      setValidationLoading(false)
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

  const handleCloseStorageHelpModal = () => {
    setShowStorageHelpModal(false)
    setStorageHelpPage(0)
  }

  const handleCloseSearchHelpModal = () => {
    setShowSearchHelpModal(false)
    setSearchHelpPage(0)
  }

  const handleCloseSecurityHelpModal = () => {
    setShowSecurityHelpModal(false)
    setSecurityHelpPage(0)
  }

  const handleCloseSslHelpModal = () => {
    setShowSslHelpModal(false)
    setSslHelpPage(0)
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
    if (!showEmailHelpModal || !emailHelpModalRef.current) return
    const modal = emailHelpModalRef.current
    modal.focus()

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return
      const focusableElements = modal.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      )
      if (focusableElements.length === 0) return
      const firstEl = focusableElements[0]
      const lastEl = focusableElements[focusableElements.length - 1]
      if (e.shiftKey && document.activeElement === firstEl) {
        e.preventDefault()
        lastEl.focus()
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        e.preventDefault()
        firstEl.focus()
      }
    }

    modal.addEventListener('keydown', handleKeyDown)
    return () => modal.removeEventListener('keydown', handleKeyDown)
  }, [showEmailHelpModal])

  // Focus trap for LLM help modal
  useEffect(() => {
    if (!showLlmHelpModal || !llmHelpModalRef.current) return
    const modal = llmHelpModalRef.current
    modal.focus()

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return
      const focusableElements = modal.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      )
      if (focusableElements.length === 0) return
      const firstEl = focusableElements[0]
      const lastEl = focusableElements[focusableElements.length - 1]
      if (e.shiftKey && document.activeElement === firstEl) {
        e.preventDefault()
        lastEl.focus()
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        e.preventDefault()
        firstEl.focus()
      }
    }

    modal.addEventListener('keydown', handleKeyDown)
    return () => modal.removeEventListener('keydown', handleKeyDown)
  }, [showLlmHelpModal])

  // Focus trap for embedding help modal
  useEffect(() => {
    if (!showEmbeddingHelpModal || !embeddingHelpModalRef.current) return
    const modal = embeddingHelpModalRef.current
    modal.focus()

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return
      const focusableElements = modal.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      )
      if (focusableElements.length === 0) return
      const firstEl = focusableElements[0]
      const lastEl = focusableElements[focusableElements.length - 1]
      if (e.shiftKey && document.activeElement === firstEl) {
        e.preventDefault()
        lastEl.focus()
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        e.preventDefault()
        firstEl.focus()
      }
    }

    modal.addEventListener('keydown', handleKeyDown)
    return () => modal.removeEventListener('keydown', handleKeyDown)
  }, [showEmbeddingHelpModal])

  // Focus trap for domains help modal
  useEffect(() => {
    if (!showDomainsHelpModal || !domainsHelpModalRef.current) return
    const modal = domainsHelpModalRef.current
    modal.focus()

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return
      const focusableElements = modal.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      )
      if (focusableElements.length === 0) return
      const firstEl = focusableElements[0]
      const lastEl = focusableElements[focusableElements.length - 1]
      if (e.shiftKey && document.activeElement === firstEl) {
        e.preventDefault()
        lastEl.focus()
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        e.preventDefault()
        firstEl.focus()
      }
    }

    modal.addEventListener('keydown', handleKeyDown)
    return () => modal.removeEventListener('keydown', handleKeyDown)
  }, [showDomainsHelpModal])

  // Focus trap for storage help modal
  useEffect(() => {
    if (!showStorageHelpModal || !storageHelpModalRef.current) return
    const modal = storageHelpModalRef.current
    modal.focus()

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return
      const focusableElements = modal.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      )
      if (focusableElements.length === 0) return
      const firstEl = focusableElements[0]
      const lastEl = focusableElements[focusableElements.length - 1]
      if (e.shiftKey && document.activeElement === firstEl) {
        e.preventDefault()
        lastEl.focus()
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        e.preventDefault()
        firstEl.focus()
      }
    }

    modal.addEventListener('keydown', handleKeyDown)
    return () => modal.removeEventListener('keydown', handleKeyDown)
  }, [showStorageHelpModal])

  // Focus trap for search help modal
  useEffect(() => {
    if (!showSearchHelpModal || !searchHelpModalRef.current) return
    const modal = searchHelpModalRef.current
    modal.focus()

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return
      const focusableElements = modal.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      )
      if (focusableElements.length === 0) return
      const firstEl = focusableElements[0]
      const lastEl = focusableElements[focusableElements.length - 1]
      if (e.shiftKey && document.activeElement === firstEl) {
        e.preventDefault()
        lastEl.focus()
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        e.preventDefault()
        firstEl.focus()
      }
    }

    modal.addEventListener('keydown', handleKeyDown)
    return () => modal.removeEventListener('keydown', handleKeyDown)
  }, [showSearchHelpModal])

  // Focus trap for security help modal
  useEffect(() => {
    if (!showSecurityHelpModal || !securityHelpModalRef.current) return
    const modal = securityHelpModalRef.current
    modal.focus()

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return
      const focusableElements = modal.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      )
      if (focusableElements.length === 0) return
      const firstEl = focusableElements[0]
      const lastEl = focusableElements[focusableElements.length - 1]
      if (e.shiftKey && document.activeElement === firstEl) {
        e.preventDefault()
        lastEl.focus()
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        e.preventDefault()
        firstEl.focus()
      }
    }

    modal.addEventListener('keydown', handleKeyDown)
    return () => modal.removeEventListener('keydown', handleKeyDown)
  }, [showSecurityHelpModal])

  // Focus trap for SSL help modal
  useEffect(() => {
    if (!showSslHelpModal || !sslHelpModalRef.current) return
    const modal = sslHelpModalRef.current
    modal.focus()

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return
      const focusableElements = modal.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      )
      if (focusableElements.length === 0) return
      const firstEl = focusableElements[0]
      const lastEl = focusableElements[focusableElements.length - 1]
      if (e.shiftKey && document.activeElement === firstEl) {
        e.preventDefault()
        lastEl.focus()
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        e.preventDefault()
        firstEl.focus()
      }
    }

    modal.addEventListener('keydown', handleKeyDown)
    return () => modal.removeEventListener('keydown', handleKeyDown)
  }, [showSslHelpModal])

  // Close item help popover on outside click
  useEffect(() => {
    if (!openHelpItemKey) return
    const handleClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null
      if (!target) return
      if (target.closest(`[data-help-item="${openHelpItemKey}"]`)) return
      setOpenHelpItemKey(null)
    }
    document.addEventListener('click', handleClick, true)
    return () => document.removeEventListener('click', handleClick, true)
  }, [openHelpItemKey])

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

  const STORAGE_HELP_PAGES = [
    {
      title: t('adminDeployment.storageHelp.overviewTitle', 'Data Storage Overview'),
      content: 'overview',
    },
    {
      title: t('adminDeployment.storageHelp.pathsTitle', 'Paths & Volumes'),
      content: 'paths',
    },
    {
      title: t('adminDeployment.storageHelp.backupsTitle', 'Backups & Moves'),
      content: 'backups',
    },
  ]

  const SEARCH_HELP_PAGES = [
    {
      title: t('adminDeployment.searchHelp.overviewTitle', 'Web Search Overview'),
      content: 'overview',
    },
    {
      title: t('adminDeployment.searchHelp.configTitle', 'Configure SearXNG'),
      content: 'config',
    },
    {
      title: t('adminDeployment.searchHelp.privacyTitle', 'Privacy & Limits'),
      content: 'privacy',
    },
  ]

  const SECURITY_HELP_PAGES = [
    {
      title: t('adminDeployment.securityHelp.overviewTitle', 'Security Overview'),
      content: 'overview',
    },
    {
      title: t('adminDeployment.securityHelp.devTitle', 'Development Flags'),
      content: 'dev',
    },
    {
      title: t('adminDeployment.securityHelp.frontendTitle', 'Frontend & Sessions'),
      content: 'frontend',
    },
  ]

  const SSL_HELP_PAGES = [
    {
      title: t('adminDeployment.sslHelp.overviewTitle', 'SSL & HTTPS Overview'),
      content: 'overview',
    },
    {
      title: t('adminDeployment.sslHelp.certsTitle', 'Certificates & Proxies'),
      content: 'certs',
    },
    {
      title: t('adminDeployment.sslHelp.httpsTitle', 'HTTPS Behavior'),
      content: 'https',
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
                <div className="relative" data-help-item={item.key}>
                  <button
                    onClick={(event) => {
                      event.stopPropagation()
                      setOpenHelpItemKey((current) => (current === item.key ? null : item.key))
                    }}
                    className="text-text-muted hover:text-accent transition-colors"
                    aria-label={helpText}
                    aria-expanded={openHelpItemKey === item.key}
                    aria-controls={`help-item-popover-${item.key}`}
                    aria-describedby={openHelpItemKey === item.key ? `help-item-popover-${item.key}` : undefined}
                    type="button"
                  >
                    <HelpCircle className="w-4 h-4" />
                  </button>
                  {openHelpItemKey === item.key && (
                    <div
                      id={`help-item-popover-${item.key}`}
                      role="tooltip"
                      className="absolute left-1/2 -translate-x-1/2 top-full mt-2 w-72 max-w-[calc(100vw-2rem)] rounded-lg border border-border bg-surface p-3 text-xs text-text-muted shadow-xl z-10"
                    >
                      {helpText}
                    </div>
                  )}
                </div>
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
    const hasModalHelp = category === 'email' || category === 'llm' || category === 'embedding' || category === 'domains' || category === 'storage' || category === 'search' || category === 'security' || category === 'ssl'

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
          {category === 'storage' && (
            <button
              onClick={() => setShowStorageHelpModal(true)}
              className="ml-1 text-text-muted hover:text-accent transition-colors"
              aria-label={t('adminDeployment.storageHelp.ariaLabel', 'Data storage configuration help')}
              title={helpText}
            >
              <HelpCircle className="w-5 h-5" />
            </button>
          )}
          {category === 'search' && (
            <button
              onClick={() => setShowSearchHelpModal(true)}
              className="ml-1 text-text-muted hover:text-accent transition-colors"
              aria-label={t('adminDeployment.searchHelp.ariaLabel', 'Web search configuration help')}
              title={helpText}
            >
              <HelpCircle className="w-5 h-5" />
            </button>
          )}
          {category === 'security' && (
            <button
              onClick={() => setShowSecurityHelpModal(true)}
              className="ml-1 text-text-muted hover:text-accent transition-colors"
              aria-label={t('adminDeployment.securityHelp.ariaLabel', 'Security configuration help')}
              title={helpText}
            >
              <HelpCircle className="w-5 h-5" />
            </button>
          )}
          {category === 'ssl' && (
            <button
              onClick={() => setShowSslHelpModal(true)}
              className="ml-1 text-text-muted hover:text-accent transition-colors"
              aria-label={t('adminDeployment.sslHelp.ariaLabel', 'SSL and HTTPS configuration help')}
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
            disabled={validationLoading}
            className="flex-1 flex items-center justify-center gap-2 border border-border hover:border-accent/50 text-text rounded-lg px-4 py-2.5 text-sm font-medium transition-all hover:bg-surface disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {validationLoading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <CheckCircle className="w-4 h-4" />
            )}
            {validationLoading ? t('adminDeployment.validating', 'Validating...') : t('adminDeployment.validate', 'Validate Config')}
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
        {validationState && !validationDismissed && (
          <div
            className={`border rounded-xl p-4 ${
              validationIsStale
                ? 'bg-warning/5 border-warning/30'
                : (validationState.result.valid ? 'bg-success/5 border-success/30' : 'bg-error/5 border-error/30')
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-2">
                {validationIsStale ? (
                  <AlertCircle className="w-5 h-5 text-warning" />
                ) : validationState.result.valid ? (
                  <CheckCircle className="w-5 h-5 text-success" />
                ) : (
                  <XCircle className="w-5 h-5 text-error" />
                )}
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`font-medium ${
                        validationIsStale
                          ? 'text-warning'
                          : (validationState.result.valid ? 'text-success' : 'text-error')
                      }`}
                    >
                      {validationIsStale
                        ? t('adminDeployment.validationStaleTitle', 'Validation Out of Date')
                        : (validationState.result.valid
                          ? t('adminDeployment.configValid', 'Configuration Valid')
                          : t('adminDeployment.configInvalid', 'Configuration Invalid'))}
                    </span>
                    {validationIsStale && (
                      <span className="text-[10px] bg-warning/20 text-warning px-2 py-0.5 rounded-full">
                        {t('adminDeployment.validationStalePill', 'Out of date')}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-text-secondary mt-1">
                    {t('adminDeployment.validationTimestamp', 'Validated {{time}}', { time: formatTimestamp(validationState.validatedAt) })}
                    {configSignature.lastUpdatedAt && (
                      <> · {t('adminDeployment.validationConfigUpdated', 'Config updated {{time}}', { time: formatTimestamp(configSignature.lastUpdatedAt) })}</>
                    )}
                  </p>
                  {validationIsStale && (
                    <p className="text-xs text-warning mt-2">
                      {t('adminDeployment.validationStaleDesc', 'Configuration changed since last validation. Revalidate to confirm.')}
                    </p>
                  )}
                </div>
              </div>
              <button
                onClick={() => setValidationDismissed(true)}
                className="text-text-secondary hover:text-text transition-colors"
                aria-label={t('common.close', 'Close')}
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
              <span className="text-text-secondary">
                {validationIsStale
                  ? t('adminDeployment.validationSummaryStale', 'Last result: {{errors}} errors, {{warnings}} warnings', {
                      errors: validationState.result.errors.length,
                      warnings: validationState.result.warnings.length,
                    })
                  : t('adminDeployment.validationSummary', '{{errors}} errors, {{warnings}} warnings', {
                      errors: validationState.result.errors.length,
                      warnings: validationState.result.warnings.length,
                    })}
              </span>
              {validationIsStale && (
                <button
                  onClick={handleValidate}
                  disabled={validationLoading}
                  className="inline-flex items-center gap-1.5 text-xs text-accent hover:text-accent-hover transition-colors disabled:opacity-50"
                >
                  {validationLoading ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <RefreshCw className="w-3 h-3" />
                  )}
                  {t('adminDeployment.revalidate', 'Revalidate')}
                </button>
              )}
            </div>

            {validationState.result.errors.length === 0 && validationState.result.warnings.length === 0 && (
              <p className="text-xs text-text-secondary mt-3">
                {t('adminDeployment.validationNoIssues', 'No issues found')}
              </p>
            )}

            {validationState.result.errors.length > 0 && (
              <>
                <p className="text-xs font-medium text-error mt-3">
                  {t('adminDeployment.validationErrors', 'Errors')}
                </p>
                <ul className="text-sm text-error list-disc list-inside mt-1">
                  {validationState.result.errors.map((err, i) => (
                    <li key={i}>{err}</li>
                  ))}
                </ul>
              </>
            )}

            {validationState.result.warnings.length > 0 && (
              <>
                <p className="text-xs font-medium text-warning mt-3">
                  {t('adminDeployment.validationWarnings', 'Warnings')}
                </p>
                <ul className="text-sm text-warning list-disc list-inside mt-1">
                  {validationState.result.warnings.map((warn, i) => (
                    <li key={i}>{warn}</li>
                  ))}
                </ul>
              </>
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

        {/* Storage Help Modal */}
        {showStorageHelpModal && (
          <div
            ref={storageHelpModalRef}
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
            role="dialog"
            aria-modal="true"
            aria-labelledby="storage-help-modal-title"
            onKeyDown={(e) => e.key === 'Escape' && handleCloseStorageHelpModal()}
            tabIndex={-1}
          >
            <div className="bg-surface border border-border rounded-xl p-6 w-full max-w-lg mx-4 shadow-xl">
              <div className="flex items-center justify-between mb-4">
                <h3 id="storage-help-modal-title" className="text-lg font-semibold text-text flex items-center gap-2">
                  <HelpCircle className="w-5 h-5" />
                  {STORAGE_HELP_PAGES[storageHelpPage].title}
                </h3>
                <button
                  onClick={handleCloseStorageHelpModal}
                  className="text-text-muted hover:text-text transition-colors"
                  aria-label={t('common.close', 'Close')}
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="min-h-[280px]">
                {STORAGE_HELP_PAGES[storageHelpPage].content === 'overview' ? (
                  <div className="space-y-3">
                    <p className="text-sm text-text-muted mb-4">
                      {t('adminDeployment.storageHelp.overviewDesc', 'This section controls where Sanctum keeps its data. Most admins can leave the defaults. You only need to change this if you’re moving files to a new disk, using external storage, or running on custom infrastructure.')}
                    </p>
                    <div className="bg-surface-overlay border border-border rounded-lg p-3">
                      <p className="text-xs text-text-muted">
                        {t('adminDeployment.storageHelp.overviewWhen', 'When you’d change this: migrating servers, using a managed database, or adjusting volume mounts.')}
                      </p>
                    </div>
                    <div className="space-y-2">
                      <div className="bg-surface-overlay border border-border rounded-lg p-3">
                        <p className="text-sm font-medium text-text">SQLite Database</p>
                        <p className="text-xs text-text-muted mt-1">
                          {t('adminDeployment.storageHelp.sqliteDesc', 'Stores users, settings, and job status. Controlled by SQLITE_PATH.')}
                        </p>
                      </div>
                      <div className="bg-surface-overlay border border-border rounded-lg p-3">
                        <p className="text-sm font-medium text-text">Uploads Folder</p>
                        <p className="text-xs text-text-muted mt-1">
                          {t('adminDeployment.storageHelp.uploadsDesc', 'Raw documents are saved here (UPLOADS_DIR). Mounted to the backend container.')}
                        </p>
                      </div>
                      <div className="bg-surface-overlay border border-border rounded-lg p-3">
                        <p className="text-sm font-medium text-text">Vector Database</p>
                        <p className="text-xs text-text-muted mt-1">
                          {t('adminDeployment.storageHelp.qdrantDesc', 'Embeddings are stored in Qdrant at QDRANT_HOST:QDRANT_PORT.')}
                        </p>
                      </div>
                    </div>
                  </div>
                ) : STORAGE_HELP_PAGES[storageHelpPage].content === 'paths' ? (
                  <div className="space-y-3">
                    <p className="text-sm text-text-muted mb-4">
                      {t('adminDeployment.storageHelp.pathsDesc', 'These are internal container paths. If you change them, you must also update your Docker volume mounts to match.')}
                    </p>
                    <div className="bg-surface-overlay border border-border rounded-lg p-3">
                      <p className="text-xs text-text-muted">
                        {t('adminDeployment.storageHelp.pathsWhen', 'Use this if you need to store data on a different disk or a mounted network drive.')}
                      </p>
                    </div>
                    <div className="space-y-2">
                      <div className="bg-surface-overlay border border-border rounded-lg p-3">
                        <p className="text-sm font-medium text-text">SQLITE_PATH</p>
                        <p className="text-xs text-text-muted mt-1">/data/sanctum.db</p>
                      </div>
                      <div className="bg-surface-overlay border border-border rounded-lg p-3">
                        <p className="text-sm font-medium text-text">UPLOADS_DIR</p>
                        <p className="text-xs text-text-muted mt-1">/uploads</p>
                      </div>
                      <div className="bg-surface-overlay border border-border rounded-lg p-3">
                        <p className="text-sm font-medium text-text">QDRANT_HOST / QDRANT_PORT</p>
                        <p className="text-xs text-text-muted mt-1">qdrant / 6333</p>
                      </div>
                    </div>
                    <div className="bg-warning/10 border border-warning/20 rounded-lg p-3 mt-4">
                      <p className="text-xs text-warning">
                        {t('adminDeployment.storageHelp.pathsWarning', 'Changing these requires a service restart and matching volume mounts.')}
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <p className="text-sm text-text-muted mb-4">
                      {t('adminDeployment.storageHelp.backupsDesc', 'For backups or migrations, you’ll want copies of the SQLite database and uploads folder. If you use Qdrant in production, snapshot it too.')}
                    </p>
                    <div className="bg-surface-overlay border border-border rounded-lg p-3">
                      <p className="text-xs text-text-muted">
                        {t('adminDeployment.storageHelp.backupsWhen', 'Use this before upgrading servers or switching hosting providers.')}
                      </p>
                    </div>
                    <div className="space-y-2">
                      <div className="bg-surface-overlay border border-border rounded-lg p-3">
                        <p className="text-xs text-text-muted mb-1">{t('adminDeployment.storageHelp.backupStep1', '1) Stop services')}</p>
                        <p className="text-xs text-text">{t('adminDeployment.storageHelp.backupStep1Desc', 'docker compose down')}</p>
                      </div>
                      <div className="bg-surface-overlay border border-border rounded-lg p-3">
                        <p className="text-xs text-text-muted mb-1">{t('adminDeployment.storageHelp.backupStep2', '2) Copy data')}</p>
                        <p className="text-xs text-text">{t('adminDeployment.storageHelp.backupStep2Desc', 'Copy /data/sanctum.db and /uploads, plus Qdrant snapshots if used.')}</p>
                      </div>
                      <div className="bg-surface-overlay border border-border rounded-lg p-3">
                        <p className="text-xs text-text-muted mb-1">{t('adminDeployment.storageHelp.backupStep3', '3) Restore')}</p>
                        <p className="text-xs text-text">{t('adminDeployment.storageHelp.backupStep3Desc', 'Mount the same paths and restart services.')}</p>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between mt-6 pt-4 border-t border-border">
                <button
                  onClick={() => setStorageHelpPage((prev) => Math.max(0, prev - 1))}
                  disabled={storageHelpPage === 0}
                  className="flex items-center gap-1 text-sm text-text-muted hover:text-text disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronLeft className="w-4 h-4" />
                  {t('common.previous', 'Previous')}
                </button>

                <div className="flex items-center gap-1.5">
                  {STORAGE_HELP_PAGES.map((_, index) => (
                    <button
                      key={index}
                      onClick={() => setStorageHelpPage(index)}
                      className={`w-2 h-2 rounded-full transition-colors ${
                        index === storageHelpPage
                          ? 'bg-accent'
                          : 'bg-border hover:bg-text-muted'
                      }`}
                      aria-label={`${t('adminDeployment.storageHelp.goToPage', 'Go to page')} ${index + 1}`}
                    />
                  ))}
                </div>

                <button
                  onClick={() => setStorageHelpPage((prev) => Math.min(STORAGE_HELP_PAGES.length - 1, prev + 1))}
                  disabled={storageHelpPage === STORAGE_HELP_PAGES.length - 1}
                  className="flex items-center gap-1 text-sm text-text-muted hover:text-text disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  {t('common.next', 'Next')}
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Search Help Modal */}
        {showSearchHelpModal && (
          <div
            ref={searchHelpModalRef}
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
            role="dialog"
            aria-modal="true"
            aria-labelledby="search-help-modal-title"
            onKeyDown={(e) => e.key === 'Escape' && handleCloseSearchHelpModal()}
            tabIndex={-1}
          >
            <div className="bg-surface border border-border rounded-xl p-6 w-full max-w-lg mx-4 shadow-xl">
              <div className="flex items-center justify-between mb-4">
                <h3 id="search-help-modal-title" className="text-lg font-semibold text-text flex items-center gap-2">
                  <HelpCircle className="w-5 h-5" />
                  {SEARCH_HELP_PAGES[searchHelpPage].title}
                </h3>
                <button
                  onClick={handleCloseSearchHelpModal}
                  className="text-text-muted hover:text-text transition-colors"
                  aria-label={t('common.close', 'Close')}
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="min-h-[280px]">
                {SEARCH_HELP_PAGES[searchHelpPage].content === 'overview' ? (
                  <div className="space-y-3">
                    <p className="text-sm text-text-muted mb-4">
                      {t('adminDeployment.searchHelp.overviewDesc', 'Web search lets the assistant fetch current information. It relies on SearXNG, an open-source search proxy you control.')}
                    </p>
                    <div className="bg-surface-overlay border border-border rounded-lg p-3">
                      <p className="text-xs text-text-muted">
                        {t('adminDeployment.searchHelp.overviewWhen', 'Change this when you want the assistant to search the web or if your SearXNG instance moves.')}
                      </p>
                    </div>
                    <div className="bg-surface-overlay border border-border rounded-lg p-3">
                      <p className="text-xs text-text-muted mb-1">{t('adminDeployment.searchHelp.overviewNote', 'If you disable SearXNG, the AI will only use your uploaded documents.')}</p>
                    </div>
                  </div>
                ) : SEARCH_HELP_PAGES[searchHelpPage].content === 'config' ? (
                  <div className="space-y-3">
                    <p className="text-sm text-text-muted mb-4">
                      {t('adminDeployment.searchHelp.configDesc', 'Point SEARXNG_URL to your SearXNG instance. In Docker Compose, the default service name works.')}
                    </p>
                    <div className="bg-surface-overlay border border-border rounded-lg p-3 font-mono text-xs">
                      SEARXNG_URL=http://searxng:8080
                    </div>
                    <p className="text-xs text-text-muted">
                      {t('adminDeployment.searchHelp.configNote', 'If SearXNG is hosted externally, use its public URL instead.')}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <p className="text-sm text-text-muted mb-4">
                      {t('adminDeployment.searchHelp.privacyDesc', 'Search queries are sent to your SearXNG instance. Configure logging and rate limits there based on your privacy requirements.')}
                    </p>
                    <div className="bg-surface-overlay border border-border rounded-lg p-3">
                      <p className="text-xs text-text-muted">
                        {t('adminDeployment.searchHelp.privacyWhen', 'Use this section when your org has specific privacy or compliance requirements.')}
                      </p>
                    </div>
                    <div className="bg-warning/10 border border-warning/20 rounded-lg p-3">
                      <p className="text-xs text-warning">
                        {t('adminDeployment.searchHelp.privacyWarning', 'If you do not want external requests, disable web search by clearing SEARXNG_URL.')}
                      </p>
                    </div>
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between mt-6 pt-4 border-t border-border">
                <button
                  onClick={() => setSearchHelpPage((prev) => Math.max(0, prev - 1))}
                  disabled={searchHelpPage === 0}
                  className="flex items-center gap-1 text-sm text-text-muted hover:text-text disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronLeft className="w-4 h-4" />
                  {t('common.previous', 'Previous')}
                </button>

                <div className="flex items-center gap-1.5">
                  {SEARCH_HELP_PAGES.map((_, index) => (
                    <button
                      key={index}
                      onClick={() => setSearchHelpPage(index)}
                      className={`w-2 h-2 rounded-full transition-colors ${
                        index === searchHelpPage
                          ? 'bg-accent'
                          : 'bg-border hover:bg-text-muted'
                      }`}
                      aria-label={`${t('adminDeployment.searchHelp.goToPage', 'Go to page')} ${index + 1}`}
                    />
                  ))}
                </div>

                <button
                  onClick={() => setSearchHelpPage((prev) => Math.min(SEARCH_HELP_PAGES.length - 1, prev + 1))}
                  disabled={searchHelpPage === SEARCH_HELP_PAGES.length - 1}
                  className="flex items-center gap-1 text-sm text-text-muted hover:text-text disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  {t('common.next', 'Next')}
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Security Help Modal */}
        {showSecurityHelpModal && (
          <div
            ref={securityHelpModalRef}
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
            role="dialog"
            aria-modal="true"
            aria-labelledby="security-help-modal-title"
            onKeyDown={(e) => e.key === 'Escape' && handleCloseSecurityHelpModal()}
            tabIndex={-1}
          >
            <div className="bg-surface border border-border rounded-xl p-6 w-full max-w-lg mx-4 shadow-xl">
              <div className="flex items-center justify-between mb-4">
                <h3 id="security-help-modal-title" className="text-lg font-semibold text-text flex items-center gap-2">
                  <HelpCircle className="w-5 h-5" />
                  {SECURITY_HELP_PAGES[securityHelpPage].title}
                </h3>
                <button
                  onClick={handleCloseSecurityHelpModal}
                  className="text-text-muted hover:text-text transition-colors"
                  aria-label={t('common.close', 'Close')}
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="min-h-[280px]">
                {SECURITY_HELP_PAGES[securityHelpPage].content === 'overview' ? (
                  <div className="space-y-3">
                    <p className="text-sm text-text-muted mb-4">
                      {t('adminDeployment.securityHelp.overviewDesc', 'These settings affect authentication behavior and the URLs used in magic-link emails. Defaults are safe for local development.')}
                    </p>
                    <div className="bg-surface-overlay border border-border rounded-lg p-3">
                      <p className="text-xs text-text-muted mb-1">{t('adminDeployment.securityHelp.overviewNote', 'For production, keep simulation flags disabled and set a correct FRONTEND_URL.')}</p>
                      <p className="text-xs text-text-muted mt-2">
                        {t('adminDeployment.securityHelp.overviewWhen', 'Change these when moving from local testing to a public deployment.')}
                      </p>
                    </div>
                  </div>
                ) : SECURITY_HELP_PAGES[securityHelpPage].content === 'dev' ? (
                  <div className="space-y-3">
                    <p className="text-sm text-text-muted mb-4">
                      {t('adminDeployment.securityHelp.devDesc', 'These flags are for testing only and should be off in production.')}
                    </p>
                    <div className="space-y-2">
                      <div className="bg-surface-overlay border border-border rounded-lg p-3">
                        <p className="text-sm font-medium text-text">SIMULATE_USER_AUTH</p>
                        <p className="text-xs text-text-muted mt-1">
                          {t('adminDeployment.securityHelp.simUserDesc', 'Bypasses magic-link verification for user logins.')}
                        </p>
                      </div>
                      <div className="bg-surface-overlay border border-border rounded-lg p-3">
                        <p className="text-sm font-medium text-text">SIMULATE_ADMIN_AUTH</p>
                        <p className="text-xs text-text-muted mt-1">
                          {t('adminDeployment.securityHelp.simAdminDesc', 'Shows a mock Nostr auth option in the admin flow.')}
                        </p>
                      </div>
                    </div>
                    <div className="bg-warning/10 border border-warning/20 rounded-lg p-3 mt-4">
                      <p className="text-xs text-warning">
                        {t('adminDeployment.securityHelp.devWarning', 'Never enable these flags in production environments.')}
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <p className="text-sm text-text-muted mb-4">
                      {t('adminDeployment.securityHelp.frontendDesc', 'FRONTEND_URL is used for magic-link emails and should match your public UI domain.')}
                    </p>
                    <div className="bg-surface-overlay border border-border rounded-lg p-3 font-mono text-xs">
                      FRONTEND_URL=https://app.example.com
                    </div>
                    <p className="text-xs text-text-muted">
                      {t('adminDeployment.securityHelp.frontendNote', 'If this is wrong, login links may send users to the wrong place.')}
                    </p>
                    <div className="bg-surface-overlay border border-border rounded-lg p-3">
                      <p className="text-xs text-text-muted">
                        {t('adminDeployment.securityHelp.frontendWhen', 'Update this whenever your public domain changes.')}
                      </p>
                    </div>
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between mt-6 pt-4 border-t border-border">
                <button
                  onClick={() => setSecurityHelpPage((prev) => Math.max(0, prev - 1))}
                  disabled={securityHelpPage === 0}
                  className="flex items-center gap-1 text-sm text-text-muted hover:text-text disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronLeft className="w-4 h-4" />
                  {t('common.previous', 'Previous')}
                </button>

                <div className="flex items-center gap-1.5">
                  {SECURITY_HELP_PAGES.map((_, index) => (
                    <button
                      key={index}
                      onClick={() => setSecurityHelpPage(index)}
                      className={`w-2 h-2 rounded-full transition-colors ${
                        index === securityHelpPage
                          ? 'bg-accent'
                          : 'bg-border hover:bg-text-muted'
                      }`}
                      aria-label={`${t('adminDeployment.securityHelp.goToPage', 'Go to page')} ${index + 1}`}
                    />
                  ))}
                </div>

                <button
                  onClick={() => setSecurityHelpPage((prev) => Math.min(SECURITY_HELP_PAGES.length - 1, prev + 1))}
                  disabled={securityHelpPage === SECURITY_HELP_PAGES.length - 1}
                  className="flex items-center gap-1 text-sm text-text-muted hover:text-text disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  {t('common.next', 'Next')}
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* SSL Help Modal */}
        {showSslHelpModal && (
          <div
            ref={sslHelpModalRef}
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
            role="dialog"
            aria-modal="true"
            aria-labelledby="ssl-help-modal-title"
            onKeyDown={(e) => e.key === 'Escape' && handleCloseSslHelpModal()}
            tabIndex={-1}
          >
            <div className="bg-surface border border-border rounded-xl p-6 w-full max-w-lg mx-4 shadow-xl">
              <div className="flex items-center justify-between mb-4">
                <h3 id="ssl-help-modal-title" className="text-lg font-semibold text-text flex items-center gap-2">
                  <HelpCircle className="w-5 h-5" />
                  {SSL_HELP_PAGES[sslHelpPage].title}
                </h3>
                <button
                  onClick={handleCloseSslHelpModal}
                  className="text-text-muted hover:text-text transition-colors"
                  aria-label={t('common.close', 'Close')}
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="min-h-[280px]">
                {SSL_HELP_PAGES[sslHelpPage].content === 'overview' ? (
                  <div className="space-y-3">
                    <p className="text-sm text-text-muted mb-4">
                      {t('adminDeployment.sslHelp.overviewDesc', 'Use these settings when enabling HTTPS. If a reverse proxy handles TLS for you, only the proxy settings are needed.')}
                    </p>
                    <div className="bg-surface-overlay border border-border rounded-lg p-3">
                      <p className="text-xs text-text-muted mb-1">
                        {t('adminDeployment.sslHelp.overviewNote', 'If you use a reverse proxy like Nginx or Caddy, set TRUSTED_PROXIES and leave SSL_CERT_PATH/SSL_KEY_PATH empty.')}
                      </p>
                      <p className="text-xs text-text-muted mt-2">
                        {t('adminDeployment.sslHelp.overviewWhen', 'Change this when you move from HTTP to HTTPS or add a proxy/CDN.')}
                      </p>
                    </div>
                  </div>
                ) : SSL_HELP_PAGES[sslHelpPage].content === 'certs' ? (
                  <div className="space-y-3">
                    <p className="text-sm text-text-muted mb-4">
                      {t('adminDeployment.sslHelp.certsDesc', 'Only set certificate paths when the backend handles TLS directly.')}
                    </p>
                    <div className="bg-surface-overlay border border-border rounded-lg p-3">
                      <p className="text-xs text-text-muted">
                        {t('adminDeployment.sslHelp.certsWhen', 'Use this if you are not terminating TLS in a reverse proxy.')}
                      </p>
                    </div>
                    <div className="space-y-2">
                      <div className="bg-surface-overlay border border-border rounded-lg p-3">
                        <p className="text-sm font-medium text-text">SSL_CERT_PATH</p>
                        <p className="text-xs text-text-muted mt-1">/etc/ssl/certs/your-cert.pem</p>
                      </div>
                      <div className="bg-surface-overlay border border-border rounded-lg p-3">
                        <p className="text-sm font-medium text-text">SSL_KEY_PATH</p>
                        <p className="text-xs text-text-muted mt-1">/etc/ssl/private/your-key.pem</p>
                      </div>
                      <div className="bg-surface-overlay border border-border rounded-lg p-3">
                        <p className="text-sm font-medium text-text">TRUSTED_PROXIES</p>
                        <p className="text-xs text-text-muted mt-1">{t('adminDeployment.sslHelp.proxiesDesc', 'Comma-separated proxy identifiers (cloudflare, aws, custom).')}</p>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <p className="text-sm text-text-muted mb-4">
                      {t('adminDeployment.sslHelp.httpsDesc', 'Control HTTPS behavior and monitoring once TLS is enabled.')}
                    </p>
                    <div className="bg-surface-overlay border border-border rounded-lg p-3">
                      <p className="text-xs text-text-muted">
                        {t('adminDeployment.sslHelp.httpsWhen', 'Adjust these after HTTPS is working and you want stricter security.')}
                      </p>
                    </div>
                    <div className="space-y-2">
                      <div className="bg-surface-overlay border border-border rounded-lg p-3">
                        <p className="text-sm font-medium text-text">FORCE_HTTPS</p>
                        <p className="text-xs text-text-muted mt-1">{t('adminDeployment.sslHelp.forceDesc', 'Redirect HTTP requests to HTTPS.')}</p>
                      </div>
                      <div className="bg-surface-overlay border border-border rounded-lg p-3">
                        <p className="text-sm font-medium text-text">HSTS_MAX_AGE</p>
                        <p className="text-xs text-text-muted mt-1">{t('adminDeployment.sslHelp.hstsDesc', 'Browser HSTS max-age in seconds (only enable after HTTPS is stable).')}</p>
                      </div>
                      <div className="bg-surface-overlay border border-border rounded-lg p-3">
                        <p className="text-sm font-medium text-text">MONITORING_URL</p>
                        <p className="text-xs text-text-muted mt-1">{t('adminDeployment.sslHelp.monitoringDesc', 'Public health endpoint used by monitoring services.')}</p>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between mt-6 pt-4 border-t border-border">
                <button
                  onClick={() => setSslHelpPage((prev) => Math.max(0, prev - 1))}
                  disabled={sslHelpPage === 0}
                  className="flex items-center gap-1 text-sm text-text-muted hover:text-text disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronLeft className="w-4 h-4" />
                  {t('common.previous', 'Previous')}
                </button>

                <div className="flex items-center gap-1.5">
                  {SSL_HELP_PAGES.map((_, index) => (
                    <button
                      key={index}
                      onClick={() => setSslHelpPage(index)}
                      className={`w-2 h-2 rounded-full transition-colors ${
                        index === sslHelpPage
                          ? 'bg-accent'
                          : 'bg-border hover:bg-text-muted'
                      }`}
                      aria-label={`${t('adminDeployment.sslHelp.goToPage', 'Go to page')} ${index + 1}`}
                    />
                  ))}
                </div>

                <button
                  onClick={() => setSslHelpPage((prev) => Math.min(SSL_HELP_PAGES.length - 1, prev + 1))}
                  disabled={sslHelpPage === SSL_HELP_PAGES.length - 1}
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
