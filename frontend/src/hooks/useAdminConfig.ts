/**
 * React hooks for Admin Configuration System
 */

import { useState, useEffect, useCallback } from 'react'
import { adminFetch } from '../utils/adminApi'
import type {
  AIConfigResponse,
  AIConfigItem,
  PromptPreviewResponse,
  DocumentDefaultsResponse,
  DocumentDefaultItem,
  DeploymentConfigResponse,
  DeploymentConfigItem,
  ServiceHealthResponse,
  DeploymentValidationResponse,
  ConfigAuditLogResponse,
  MigrationPrepareResponse,
  MigrationExecuteResponse,
  DecryptedUserData,
  DecryptedFieldValue,
  NostrEvent,
} from '../types/config'

// --- AI Configuration Hooks ---

export function useAIConfig() {
  const [config, setConfig] = useState<AIConfigResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchConfig = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const response = await adminFetch('/admin/ai-config')
      if (!response.ok) {
        throw new Error(`errors.failedToFetchAIConfig`)
      }
      const data = await response.json()
      setConfig(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'errors.failedToFetchAIConfig')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchConfig()
  }, [fetchConfig])

  const updateConfig = useCallback(async (key: string, value: string): Promise<AIConfigItem | null> => {
    try {
      const response = await adminFetch(`/admin/ai-config/${key}`, {
        method: 'PUT',
        body: JSON.stringify({ value }),
      })
      if (!response.ok) {
        let detail = `Failed to update: ${response.status}`
        try {
          const err = await response.json()
          if (err.detail) detail = err.detail
        } catch {
          // Non-JSON response (e.g., HTML error page), use default message
        }
        throw new Error(detail)
      }
      const updated = await response.json()
      // Refresh full config
      await fetchConfig()
      return updated
    } catch (err) {
      throw err
    }
  }, [fetchConfig])

  const previewPrompt = useCallback(async (sampleQuestion?: string, sampleFacts?: Record<string, string>): Promise<PromptPreviewResponse> => {
    const response = await adminFetch('/admin/ai-config/prompts/preview', {
      method: 'POST',
      body: JSON.stringify({
        sample_question: sampleQuestion,
        sample_facts: sampleFacts || {},
      }),
    })
    if (!response.ok) {
      throw new Error(`errors.failedToPreviewPrompt`)
    }
    return response.json()
  }, [])

  return {
    config,
    loading,
    error,
    refresh: fetchConfig,
    updateConfig,
    previewPrompt,
  }
}

// --- Document Defaults Hooks ---

export function useDocumentDefaults() {
  const [documents, setDocuments] = useState<DocumentDefaultItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchDefaults = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const response = await adminFetch('/ingest/admin/documents/defaults')
      if (!response.ok) {
        throw new Error(`errors.failedToFetchDocumentDefaults`)
      }
      const data: DocumentDefaultsResponse = await response.json()
      setDocuments(data.documents)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'errors.failedToFetchDocumentDefaults')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchDefaults()
  }, [fetchDefaults])

  const updateDocument = useCallback(async (
    jobId: string,
    update: { is_available?: boolean; is_default_active?: boolean; display_order?: number }
  ): Promise<DocumentDefaultItem | null> => {
    try {
      const response = await adminFetch(`/ingest/admin/documents/${jobId}/defaults`, {
        method: 'PUT',
        body: JSON.stringify(update),
      })
      if (!response.ok) {
        throw new Error(`errors.failedToUpdateDocument`)
      }
      const updated = await response.json()
      // Update local state
      setDocuments(prev => prev.map(d => d.job_id === jobId ? updated : d))
      return updated
    } catch (err) {
      throw err
    }
  }, [])

  const batchUpdate = useCallback(async (
    updates: Array<{ job_id: string; is_available?: boolean; is_default_active?: boolean; display_order?: number }>
  ): Promise<void> => {
    const response = await adminFetch('/ingest/admin/documents/defaults/batch', {
      method: 'PUT',
      body: JSON.stringify({ updates }),
    })
    if (!response.ok) {
      throw new Error(`errors.failedToBatchUpdate`)
    }
    // Refresh
    await fetchDefaults()
  }, [fetchDefaults])

  return {
    documents,
    loading,
    error,
    refresh: fetchDefaults,
    updateDocument,
    batchUpdate,
  }
}

// --- Deployment Configuration Hooks ---

export function useDeploymentConfig() {
  const [config, setConfig] = useState<DeploymentConfigResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchConfig = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const response = await adminFetch('/admin/deployment/config')
      if (!response.ok) {
        throw new Error(`errors.failedToFetchDeploymentConfig`)
      }
      const data = await response.json()
      setConfig(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'errors.failedToFetchDeploymentConfig')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchConfig()
  }, [fetchConfig])

  const updateConfig = useCallback(async (key: string, value: string): Promise<DeploymentConfigItem | null> => {
    try {
      const response = await adminFetch(`/admin/deployment/config/${key}`, {
        method: 'PUT',
        body: JSON.stringify({ value }),
      })
      if (!response.ok) {
        let detail = `Failed to update: ${response.status}`
        try {
          const err = await response.json()
          if (err.detail) detail = err.detail
        } catch {
          // Non-JSON response (e.g., HTML error page), use default message
        }
        throw new Error(detail)
      }
      const updated = await response.json()
      // Refresh full config
      await fetchConfig()
      return updated
    } catch (err) {
      throw err
    }
  }, [fetchConfig])

  const exportEnv = useCallback(async (): Promise<string> => {
    const response = await adminFetch('/admin/deployment/config/export')
    if (!response.ok) {
      throw new Error(`errors.failedToExport`)
    }
    return response.text()
  }, [])

  const validate = useCallback(async (): Promise<DeploymentValidationResponse> => {
    const response = await adminFetch('/admin/deployment/config/validate', {
      method: 'POST',
    })
    if (!response.ok) {
      throw new Error(`errors.failedToValidate`)
    }
    return response.json()
  }, [])

  const revealSecret = useCallback(async (key: string): Promise<string> => {
    const response = await adminFetch(`/admin/deployment/config/${key}/reveal`)
    if (!response.ok) {
      throw new Error(`errors.failedToRevealSecret`)
    }
    const data = await response.json()
    return data.value || ''
  }, [])

  return {
    config,
    loading,
    error,
    refresh: fetchConfig,
    updateConfig,
    exportEnv,
    validate,
    revealSecret,
  }
}

// --- Service Health Hook ---

export function useServiceHealth() {
  const [health, setHealth] = useState<ServiceHealthResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchHealth = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const response = await adminFetch('/admin/deployment/health')
      if (!response.ok) {
        throw new Error(`errors.failedToFetchServiceHealth`)
      }
      const data = await response.json()
      setHealth(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'errors.failedToFetchServiceHealth')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchHealth()
  }, [fetchHealth])

  return {
    health,
    loading,
    error,
    refresh: fetchHealth,
  }
}

// --- Audit Log Hook ---

export function useConfigAuditLog(tableName?: string, limit: number = 50) {
  const [log, setLog] = useState<ConfigAuditLogResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchLog = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const params = new URLSearchParams()
      params.set('limit', String(limit))
      if (tableName) {
        params.set('table_name', tableName)
      }
      const response = await adminFetch(`/admin/deployment/audit-log?${params}`)
      if (!response.ok) {
        throw new Error(`errors.failedToFetchAuditLog`)
      }
      const data = await response.json()
      setLog(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'errors.failedToFetchAuditLog')
    } finally {
      setLoading(false)
    }
  }, [tableName, limit])

  useEffect(() => {
    fetchLog()
  }, [fetchLog])

  return {
    log,
    loading,
    error,
    refresh: fetchLog,
  }
}

// --- Key Migration Hook ---

export function useKeyMigration() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const prepare = useCallback(async (): Promise<MigrationPrepareResponse> => {
    setLoading(true)
    setError(null)
    try {
      const response = await adminFetch('/admin/key-migration/prepare')
      if (!response.ok) {
        let detail = `Failed to prepare migration: ${response.status}`
        try {
          const err = await response.json()
          if (err.detail) detail = err.detail
        } catch {
          // Non-JSON response
        }
        throw new Error(detail)
      }
      return await response.json()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'errors.failedToPrepareMigration'
      setError(message)
      throw err
    } finally {
      setLoading(false)
    }
  }, [])

  const execute = useCallback(async (
    newAdminPubkey: string,
    users: DecryptedUserData[],
    fieldValues: DecryptedFieldValue[],
    signatureEvent: NostrEvent
  ): Promise<MigrationExecuteResponse> => {
    setLoading(true)
    setError(null)
    try {
      const response = await adminFetch('/admin/key-migration/execute', {
        method: 'POST',
        body: JSON.stringify({
          new_admin_pubkey: newAdminPubkey,
          users,
          field_values: fieldValues,
          signature_event: signatureEvent,
        }),
      })
      if (!response.ok) {
        let detail = `Failed to execute migration: ${response.status}`
        try {
          const err = await response.json()
          if (err.detail) detail = err.detail
        } catch {
          // Non-JSON response
        }
        throw new Error(detail)
      }
      return await response.json()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'errors.failedToExecuteMigration'
      setError(message)
      throw err
    } finally {
      setLoading(false)
    }
  }, [])

  return {
    loading,
    error,
    prepare,
    execute,
  }
}
