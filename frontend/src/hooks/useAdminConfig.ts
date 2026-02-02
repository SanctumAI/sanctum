/**
 * React hooks for Admin Configuration System
 */

import { useState, useEffect, useCallback } from 'react'
import { adminFetch } from '../utils/adminApi'
import type {
  AIConfigResponse,
  AIConfigResponseWithInheritance,
  AIConfigItem,
  AIConfigUserTypeResponse,
  AIConfigWithInheritance,
  PromptPreviewResponse,
  DocumentDefaultsResponse,
  DocumentDefaultItem,
  DocumentDefaultsUserTypeResponse,
  DocumentDefaultWithInheritance,
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

export function useAIConfig(userTypeId?: number | null) {
  const [config, setConfig] = useState<AIConfigResponse | AIConfigResponseWithInheritance | null>(null)
  const [userTypeConfig, setUserTypeConfig] = useState<AIConfigUserTypeResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Fetch global config or user-type-specific config
  const fetchConfig = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)

      if (userTypeId) {
        // Fetch user-type-specific config with inheritance
        const response = await adminFetch(`/admin/ai-config/user-type/${userTypeId}`)
        if (!response.ok) {
          throw new Error(`errors.failedToFetchAIConfig`)
        }
        const data: AIConfigUserTypeResponse = await response.json()
        setUserTypeConfig(data)
        // Pass the full user-type items directly to preserve is_override and override_user_type_id
        // This allows the UI to show override badges and revert actions
        setConfig({
          prompt_sections: data.prompt_sections,
          parameters: data.parameters,
          defaults: data.defaults,
        })
      } else {
        // Fetch global config
        const response = await adminFetch('/admin/ai-config')
        if (!response.ok) {
          throw new Error(`errors.failedToFetchAIConfig`)
        }
        const data = await response.json()
        setConfig(data)
        setUserTypeConfig(null)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'errors.failedToFetchAIConfig')
    } finally {
      setLoading(false)
    }
  }, [userTypeId])

  useEffect(() => {
    fetchConfig()
  }, [fetchConfig])

  // Update global config
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

  // Set override for a user type
  const setOverride = useCallback(async (key: string, value: string, targetUserTypeId?: number): Promise<AIConfigWithInheritance | null> => {
    const typeId = targetUserTypeId ?? userTypeId
    if (!typeId) {
      throw new Error('User type ID is required for setting overrides')
    }
    try {
      const response = await adminFetch(`/admin/ai-config/user-type/${typeId}/${key}`, {
        method: 'PUT',
        body: JSON.stringify({ value }),
      })
      if (!response.ok) {
        let detail = `errors.failedToSetOverride`
        try {
          const err = await response.json()
          if (err.detail) detail = err.detail
        } catch {
          // Non-JSON response
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
  }, [fetchConfig, userTypeId])

  // Revert override to global (delete override)
  const revertOverride = useCallback(async (key: string, targetUserTypeId?: number): Promise<void> => {
    const typeId = targetUserTypeId ?? userTypeId
    if (!typeId) {
      throw new Error('User type ID is required for reverting overrides')
    }
    try {
      const response = await adminFetch(`/admin/ai-config/user-type/${typeId}/${key}`, {
        method: 'DELETE',
      })
      if (!response.ok) {
        let detail = `errors.failedToRevertOverride`
        try {
          const err = await response.json()
          if (err.detail) detail = err.detail
        } catch {
          // Non-JSON response
        }
        throw new Error(detail)
      }
      // Refresh full config
      await fetchConfig()
    } catch (err) {
      throw err
    }
  }, [fetchConfig, userTypeId])

  // Preview prompt (global or for user type)
  const previewPrompt = useCallback(async (sampleQuestion?: string, sampleFacts?: Record<string, string>, targetUserTypeId?: number): Promise<PromptPreviewResponse> => {
    const typeId = targetUserTypeId ?? userTypeId
    const url = typeId
      ? `/admin/ai-config/user-type/${typeId}/prompts/preview`
      : '/admin/ai-config/prompts/preview'

    const response = await adminFetch(url, {
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
  }, [userTypeId])

  return {
    config,
    userTypeConfig,
    loading,
    error,
    refresh: fetchConfig,
    updateConfig,
    setOverride,
    revertOverride,
    previewPrompt,
  }
}

// --- Document Defaults Hooks ---

export function useDocumentDefaults(userTypeId?: number | null) {
  const [documents, setDocuments] = useState<DocumentDefaultItem[]>([])
  const [userTypeDocuments, setUserTypeDocuments] = useState<DocumentDefaultWithInheritance[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchDefaults = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)

      if (userTypeId) {
        // Fetch user-type-specific document defaults with inheritance
        const response = await adminFetch(`/ingest/admin/documents/defaults/user-type/${userTypeId}`)
        if (!response.ok) {
          throw new Error(`errors.failedToFetchDocumentDefaults`)
        }
        const data: DocumentDefaultsUserTypeResponse = await response.json()
        setUserTypeDocuments(data.documents)
        // Also convert to DocumentDefaultItem format for compatibility
        // Note: We spread full items to preserve is_override metadata for UI badges/revert actions
        setDocuments(data.documents.map(doc => ({ ...doc })))
      } else {
        // Fetch global document defaults
        const response = await adminFetch('/ingest/admin/documents/defaults')
        if (!response.ok) {
          throw new Error(`errors.failedToFetchDocumentDefaults`)
        }
        const data: DocumentDefaultsResponse = await response.json()
        setDocuments(data.documents)
        setUserTypeDocuments([])
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'errors.failedToFetchDocumentDefaults')
    } finally {
      setLoading(false)
    }
  }, [userTypeId])

  useEffect(() => {
    fetchDefaults()
  }, [fetchDefaults])

  // Update global document defaults
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
      // Refresh full list
      await fetchDefaults()
      return updated
    } catch (err) {
      throw err
    }
  }, [fetchDefaults])

  // Set override for a user type
  const setOverride = useCallback(async (
    jobId: string,
    update: { is_available?: boolean; is_default_active?: boolean },
    targetUserTypeId?: number
  ): Promise<DocumentDefaultWithInheritance | null> => {
    const typeId = targetUserTypeId ?? userTypeId
    if (!typeId) {
      throw new Error('User type ID is required for setting document overrides')
    }
    try {
      const response = await adminFetch(`/ingest/admin/documents/${jobId}/defaults/user-type/${typeId}`, {
        method: 'PUT',
        body: JSON.stringify(update),
      })
      if (!response.ok) {
        let detail = `errors.failedToSetDocOverride`
        try {
          const err = await response.json()
          if (err.detail) detail = err.detail
        } catch {
          // Non-JSON response
        }
        throw new Error(detail)
      }
      const updated = await response.json()
      // Refresh full list
      await fetchDefaults()
      return updated
    } catch (err) {
      throw err
    }
  }, [fetchDefaults, userTypeId])

  // Revert override to global (delete override)
  const revertOverride = useCallback(async (jobId: string, targetUserTypeId?: number): Promise<void> => {
    const typeId = targetUserTypeId ?? userTypeId
    if (!typeId) {
      throw new Error('User type ID is required for reverting document overrides')
    }
    try {
      const response = await adminFetch(`/ingest/admin/documents/${jobId}/defaults/user-type/${typeId}`, {
        method: 'DELETE',
      })
      if (!response.ok) {
        let detail = `errors.failedToRevertDocOverride`
        try {
          const err = await response.json()
          if (err.detail) detail = err.detail
        } catch {
          // Non-JSON response
        }
        throw new Error(detail)
      }
      // Refresh full list
      await fetchDefaults()
    } catch (err) {
      throw err
    }
  }, [fetchDefaults, userTypeId])

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
    userTypeDocuments,
    loading,
    error,
    refresh: fetchDefaults,
    updateDocument,
    setOverride,
    revertOverride,
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
