import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ChatContainer } from '../components/chat/ChatContainer'
import { MessageList } from '../components/chat/MessageList'
import { ChatInput } from '../components/chat/ChatInput'
import { ToolSelector, Tool } from '../components/chat/ToolSelector'
import { DocumentScope, DocumentSource } from '../components/chat/DocumentScope'
import { ExportButton } from '../components/chat/ExportButton'
import { AppHeader } from '../components/shared/AppHeader'
import { Message } from '../components/chat/ChatMessage'
import { ReachoutModal, type ReachoutMode } from '../components/reachout/ReachoutModal'
import { API_BASE, STORAGE_KEYS, getSelectedUserTypeId, saveSelectedUserTypeId } from '../types/onboarding'
import { getConfigCategories, getDeploymentConfigItemMeta } from '../types/config'
import type { DeploymentConfigItem, DeploymentConfigResponse } from '../types/config'
import { adminFetch, isAdminAuthenticated } from '../utils/adminApi'
import { sendLlmChatWithUnifiedTools } from '../utils/llmChat'
import {
  extractAdminAssistantChangeSetStrict,
  type AdminAssistantChangeSet,
} from '../utils/adminAssistant'

type SnapshotResult = {
  context: string
  secretValues: string[]
  deploymentSecretKeys: Set<string>
  generatedAtIso: string
}

type AdminApplyState =
  | { state: 'idle' }
  | { state: 'review'; changeSet: AdminAssistantChangeSet }
  | { state: 'applying'; changeSet: AdminAssistantChangeSet }
  | { state: 'applied'; message: string }
  | { state: 'error'; message: string }

const CONFIG_TOOL_ID = 'admin-config'

function slugify(value: string): string {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function flattenDeploymentConfig(cfg: DeploymentConfigResponse): DeploymentConfigItem[] {
  return [
    ...(cfg.llm ?? []),
    ...(cfg.embedding ?? []),
    ...(cfg.email ?? []),
    ...(cfg.storage ?? []),
    ...(cfg.security ?? []),
    ...(cfg.search ?? []),
    ...(cfg.domains ?? []),
    ...(cfg.ssl ?? []),
    ...(cfg.general ?? []),
  ]
}

async function readErrorDetail(res: Response): Promise<string> {
  let detail = `HTTP ${res.status}`
  try {
    const payload = await res.json()
    if (payload?.detail !== undefined) {
      detail = typeof payload.detail === 'string'
        ? payload.detail
        : JSON.stringify(payload.detail)
    }
  } catch {
    // ignore
  }
  return detail
}

export function ChatPage() {
  const navigate = useNavigate()
  const { t } = useTranslation()
  const isAdmin = isAdminAuthenticated()
  const [messages, setMessages] = useState<Message[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedTools, setSelectedTools] = useState<string[]>([])
  const [selectedDocuments, setSelectedDocuments] = useState<string[]>([])
  const [ragSessionId, setRagSessionId] = useState<string | null>(null)
  const [documents, setDocuments] = useState<DocumentSource[]>([])
  const [sessionDefaultsLoaded, setSessionDefaultsLoaded] = useState(false)
  const [pendingDefaultDocs, setPendingDefaultDocs] = useState<string[]>([])
  const [adminSnapshotInfo, setAdminSnapshotInfo] = useState<{ generatedAtIso: string } | null>(null)
  const [adminApplyState, setAdminApplyState] = useState<AdminApplyState>({ state: 'idle' })
  const adminDeploymentSecretKeysRef = useRef<Set<string>>(new Set())

  const [reachoutOpen, setReachoutOpen] = useState(false)
  const [reachoutEnabled, setReachoutEnabled] = useState(false)
  const [reachoutMode, setReachoutMode] = useState<ReachoutMode>('support')
  const [reachoutOverrides, setReachoutOverrides] = useState<{
    title?: string
    description?: string
    buttonLabel?: string
    successMessage?: string
  }>({})
  const configCategories = useMemo(() => getConfigCategories(t), [t])
  const deploymentMeta = useMemo(() => getDeploymentConfigItemMeta(t), [t])

  // Build available tools list - db-query only visible to admins
  const availableTools = useMemo<Tool[]>(() => {
    const tools: Tool[] = [
      {
        id: 'web-search',
        name: t('chat.tools.webSearchName'),
        description: t('chat.tools.webSearch'),
        icon: (
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
          </svg>
        ),
      },
    ]

    // Only show Database tool to authenticated admins
    if (isAdmin) {
      tools.push({
        id: CONFIG_TOOL_ID,
        name: t('chat.tools.configName', 'Config'),
        description: t('chat.tools.config', 'Read and update admin configuration'),
        icon: (
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 6h9m-9 6h9m-9 6h9M4.5 6h.008v.008H4.5V6zm0 6h.008v.008H4.5V12zm0 6h.008v.008H4.5V18z" />
          </svg>
        ),
      })
      tools.push({
        id: 'db-query',
        name: t('chat.tools.databaseName'),
        description: t('chat.tools.database'),
        icon: (
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 0v3.75m-16.5-3.75v3.75m16.5 0v3.75C20.25 16.153 16.556 18 12 18s-8.25-1.847-8.25-4.125v-3.75m16.5 0c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125" />
          </svg>
        ),
      })
    }

    return tools
  }, [isAdmin, t])

  const fetchJson = useCallback(async <T,>(endpoint: string, options?: RequestInit): Promise<T> => {
    const res = await adminFetch(endpoint, options)
    if (!res.ok) {
      throw new Error(await readErrorDetail(res))
    }
    return res.json() as Promise<T>
  }, [])

  const buildAdminSnapshot = useCallback(async (): Promise<SnapshotResult> => {
    const generatedAtIso = new Date().toISOString()

    const [settingsRes, deploymentCfg, aiCfg, userTypesRes, docDefaultsRes, healthRes] = await Promise.all([
      fetchJson<{ settings: Record<string, unknown> }>('/admin/settings'),
      fetchJson<DeploymentConfigResponse>('/admin/deployment/config'),
      fetchJson('/admin/ai-config'),
      fetchJson<{ types: Array<{ id: number; name: string; description?: string | null }> }>('/admin/user-types'),
      fetchJson('/ingest/admin/documents/defaults'),
      fetchJson('/admin/deployment/health').catch(() => null),
    ])

    const deploymentItems = flattenDeploymentConfig(deploymentCfg)
    const deploymentSecretKeys = new Set(
      deploymentItems.filter((i) => i.is_secret).map((i) => i.key)
    )

    const userTypes = userTypesRes?.types || []
    const perTypeFetches = await Promise.all(
      userTypes.map(async (ut) => {
        const [fields, aiConfigForType, docDefaultsForType] = await Promise.all([
          fetchJson(`/admin/user-fields?user_type_id=${ut.id}`).catch(() => null),
          fetchJson(`/admin/ai-config/user-type/${ut.id}`).catch(() => null),
          fetchJson(`/ingest/admin/documents/defaults/user-type/${ut.id}`).catch(() => null),
        ])
        return { userType: ut, fields, aiConfigForType, docDefaultsForType }
      })
    )

    const lines: string[] = []
    lines.push('ADMIN CONFIG ASSISTANT CONTEXT')
    lines.push(`Generated: ${generatedAtIso}`)
    lines.push('')
    lines.push('RULES')
    lines.push('- You are assisting the instance admin in configuring Sanctum.')
    lines.push('- Never ask for or assume access to the admin Nostr private key (nsec). It is held in NIP-07 and is not available here.')
    lines.push('- Treat all secret environment variables as highly sensitive.')
    lines.push('- Do not echo secrets back into chat. If you must reference them, say "[REDACTED]".')
    lines.push('- Prefer actionable, specific guidance: which setting to change, what to set it to, and whether restart is required.')
    lines.push('')
    lines.push('CHANGESET FORMAT (optional)')
    lines.push('If you want the admin to apply changes from this chat, include exactly one JSON code block with this shape:')
    lines.push('```json')
    lines.push(JSON.stringify({
      version: 1,
      summary: 'One sentence summary of what will change',
      requests: [
        { method: 'PUT', path: '/admin/deployment/config/LLM_PROVIDER', body: { value: 'maple' } },
      ],
    }, null, 2))
    lines.push('```')
    lines.push('Notes:')
    lines.push('- Instance settings are updated via PUT /admin/settings with a JSON body of keys (example: {"instance_name":"My Sanctum","primary_color":"#F7931A"}).')
    lines.push('- primary_color accepts either a preset name (blue, purple, green, orange, pink, teal) or any valid hex color like "#F7931A".')
    lines.push('- status_icon_set must be one of: classic, minimal, playful.')
    lines.push('- typography_preset must be one of: modern, grotesk, humanist.')
    lines.push('- User onboarding questions are managed as user-fields (POST/PUT/DELETE /admin/user-fields).')
    lines.push('- POST /admin/user-types body shape: {"name":"Bitcoin Designer","description":"...","icon":"User","display_order":0}.')
    lines.push('- POST /admin/user-fields body shape: {"field_name":"Focus Area","field_type":"select","user_type_id":"@type:bitcoin_designer","required":false,"display_order":4,"placeholder":"Choose one","options":["UX","Research","Brand"]}.')
    lines.push('- When referencing user types in a single change set, you may use the placeholder "@type:<slug>" anywhere a numeric user_type_id is required.')
    lines.push('  slug rules: lowercase; non-alphanumeric becomes "_"; trim leading/trailing "_" (example: "Bitcoin Designer" -> "@type:bitcoin_designer").')
    lines.push('- Valid user field types: text, email, number, textarea, select, checkbox, date, url.')
    lines.push('Only include allowed mutation endpoints. Avoid including secret values unless explicitly asked by the admin.')
    lines.push('')

    lines.push('INSTANCE SETTINGS (/admin/settings)')
    const settings = settingsRes?.settings || {}
    for (const [k, v] of Object.entries(settings).sort(([a], [b]) => a.localeCompare(b))) {
      lines.push(`- ${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
    }
    lines.push('')

    lines.push('DEPLOYMENT CONFIG (/admin/deployment/config) [values are masked for secrets]')
    for (const category of Object.keys(configCategories)) {
      const catKey = category as keyof DeploymentConfigResponse
      const items = (deploymentCfg as any)[catKey] as DeploymentConfigItem[] | undefined
      if (!items || items.length === 0) continue
      lines.push('')
      lines.push(`## ${category.toUpperCase()}`)
      for (const item of items) {
        const meta = (deploymentMeta as any)[item.key] as { label?: string } | undefined
        const label = meta?.label ? ` (${meta.label})` : ''
        const restart = item.requires_restart ? ' requires_restart=true' : ''
        const secret = item.is_secret ? ' secret=true' : ''
        const updated = item.updated_at ? ` updated_at=${item.updated_at}` : ''
        lines.push(`- ${item.key}${label} = ${item.value ?? ''}${restart}${secret}${updated}`)
        if (item.description) lines.push(`  description: ${item.description}`)
      }
    }
    lines.push('')

    lines.push('SECRETS')
    lines.push('Secret env vars are NOT included in this context by default.')
    lines.push('')

    lines.push('AI CONFIG (/admin/ai-config)')
    lines.push(JSON.stringify(aiCfg, null, 2))
    lines.push('')

    lines.push('USER TYPES (/admin/user-types)')
    lines.push(JSON.stringify(userTypesRes, null, 2))
    lines.push('')

    lines.push('DOCUMENT DEFAULTS (/ingest/admin/documents/defaults)')
    lines.push(JSON.stringify(docDefaultsRes, null, 2))
    lines.push('')

    lines.push('PER USER TYPE DETAILS')
    for (const entry of perTypeFetches) {
      lines.push('')
      lines.push(`### user_type_id=${entry.userType.id} (${entry.userType.name})`)
      lines.push('user-fields:')
      lines.push(JSON.stringify(entry.fields, null, 2))
      lines.push('ai-config (effective):')
      lines.push(JSON.stringify(entry.aiConfigForType, null, 2))
      lines.push('document-defaults (effective):')
      lines.push(JSON.stringify(entry.docDefaultsForType, null, 2))
    }
    lines.push('')

    if (healthRes) {
      lines.push('SERVICE HEALTH (/admin/deployment/health)')
      lines.push(JSON.stringify(healthRes, null, 2))
      lines.push('')
    }

    return {
      context: lines.join('\n'),
      secretValues: [],
      deploymentSecretKeys,
      generatedAtIso,
    }
  }, [configCategories, deploymentMeta, fetchJson])

  // Reachout settings (public)
  useEffect(() => {
    let isCancelled = false

    async function fetchReachout() {
      try {
        const res = await fetch(`${API_BASE}/settings/public`)
        if (!res.ok) return
        const data = await res.json()
        const s = (data?.settings ?? {}) as Record<string, string>

        if (isCancelled) return

        setReachoutEnabled(String(s.reachout_enabled ?? 'false').toLowerCase() === 'true')
        const mode = String(s.reachout_mode ?? 'support').toLowerCase()
        if (mode === 'feedback' || mode === 'help' || mode === 'support') {
          setReachoutMode(mode)
        } else {
          setReachoutMode('support')
        }

        setReachoutOverrides({
          title: typeof s.reachout_title === 'string' ? s.reachout_title : undefined,
          description: typeof s.reachout_description === 'string' ? s.reachout_description : undefined,
          buttonLabel: typeof s.reachout_button_label === 'string' ? s.reachout_button_label : undefined,
          successMessage: typeof s.reachout_success_message === 'string' ? s.reachout_success_message : undefined,
        })
      } catch {
        // Best-effort: feature remains hidden if fetch fails.
      }
    }

    fetchReachout()

    return () => {
      isCancelled = true
    }
  }, [])

  // Check auth and approval status on mount
  useEffect(() => {
    let isCancelled = false
    const userEmail = localStorage.getItem(STORAGE_KEYS.USER_EMAIL)

    // Not authenticated at all - redirect to login
    if (!isAdmin && !userEmail) {
      navigate('/login')
      return
    }

    // User authenticated but not approved - redirect to pending
    const approved = localStorage.getItem(STORAGE_KEYS.USER_APPROVED)
    if (!isAdmin && approved === 'false') {
      navigate('/pending')
      return
    }

    // Keep onboarding enforcement server-authoritative for returning users.
    if (!isAdmin) {
      const checkOnboardingStatus = async () => {
        try {
          const response = await fetch(`${API_BASE}/users/me/onboarding-status`, {
            credentials: 'include',
          })

          if (isCancelled) return

          if (response.status === 401) {
            navigate('/login')
            return
          }

          if (!response.ok) {
            return
          }

          const status = await response.json()

          if (isCancelled) return

          const effectiveTypeId = status.effective_user_type_id ?? null
          saveSelectedUserTypeId(effectiveTypeId)

          if (status.needs_user_type) {
            navigate('/user-type')
            return
          }

          if (status.needs_onboarding) {
            navigate('/profile')
          }
        } catch (err) {
          console.error('Failed to fetch onboarding status:', err)
        }
      }

      checkOnboardingStatus()
    }

    return () => {
      isCancelled = true
    }
  }, [isAdmin, navigate])

  // Fetch session defaults from admin config
  useEffect(() => {
    if (sessionDefaultsLoaded) return

    const fetchSessionDefaults = async () => {
      try {
        const userTypeId = getSelectedUserTypeId()
        const url = userTypeId !== null
          ? `${API_BASE}/session-defaults?user_type_id=${userTypeId}`
          : `${API_BASE}/session-defaults`
        const res = await fetch(url)
        if (res.ok) {
          const data = await res.json()
          // Apply web search default
          if (data.web_search_enabled) {
            setSelectedTools(['web-search'])
          } else {
            setSelectedTools([])
          }
          // Store default document IDs to apply once documents are loaded
          if (data.default_document_ids && data.default_document_ids.length > 0) {
            setPendingDefaultDocs(data.default_document_ids)
          }
        } else {
          // Non-2xx response - fall back to web search enabled by default
          console.warn('Failed to fetch session defaults:', res.status)
          setSelectedTools(['web-search'])
        }
      } catch (err) {
        console.error('Failed to fetch session defaults:', err)
        // Fall back to web search enabled by default on error
        setSelectedTools(['web-search'])
      } finally {
        setSessionDefaultsLoaded(true)
      }
    }

    fetchSessionDefaults()
  }, [sessionDefaultsLoaded])

  // Fetch available documents from ingest jobs
  useEffect(() => {
    const fetchDocuments = async () => {
      try {
        const res = await fetch(`${API_BASE}/ingest/jobs`, {
          credentials: 'include',
        })
        if (res.ok) {
          const data = await res.json()
          const docs: DocumentSource[] = (data.jobs || [])
            .filter((job: { status: string }) => job.status === 'completed' || job.status === 'completed_with_errors')
            .map((job: { job_id: string; filename: string; total_chunks: number }) => ({
              id: job.job_id,
              name: job.filename.replace(/\.(pdf|txt|md)$/i, ''),
              description: `${job.total_chunks} chunks`,
              tags: [job.filename.split('.').pop()?.toUpperCase() || 'DOC']
            }))
          setDocuments(docs)
        }
      } catch (e) {
        console.error(t('errors.failedToFetchDocuments'), e)
      }
    }
    fetchDocuments()
  }, [])

  // Apply pending default documents once documents are loaded
  useEffect(() => {
    if (pendingDefaultDocs.length > 0 && documents.length > 0) {
      // Filter to only include IDs that exist in the documents list
      const validIds = pendingDefaultDocs.filter(id => documents.some(d => d.id === id))
      if (validIds.length > 0) {
        setSelectedDocuments(validIds)
      }
      setPendingDefaultDocs([])
    }
  }, [pendingDefaultDocs, documents])

  const handleToolToggle = useCallback((toolId: string) => {
    if (toolId === 'db-query' && !selectedTools.includes('db-query') && selectedDocuments.length > 0) {
      // db-query runs against /llm/chat only; clear RAG document selection
      setSelectedDocuments([])
    }
    if (toolId === CONFIG_TOOL_ID && selectedTools.includes(CONFIG_TOOL_ID)) {
      setAdminApplyState({ state: 'idle' })
      setAdminSnapshotInfo(null)
    }
    setSelectedTools((prev) =>
      prev.includes(toolId) ? prev.filter((id) => id !== toolId) : [...prev, toolId]
    )
  }, [selectedDocuments.length, selectedTools])

  const handleDocumentToggle = useCallback((docId: string) => {
    setSelectedDocuments((prev) =>
      prev.includes(docId) ? prev.filter((id) => id !== docId) : [...prev, docId]
    )
  }, [])

  const generateMessageId = () => `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`

  const handleSend = async (content: string) => {
    const userMessage: Message = {
      id: generateMessageId(),
      role: 'user',
      content,
      timestamp: new Date(),
    }

    setMessages((prev) => [...prev, userMessage])
    setIsLoading(true)
    setError(null)
    if (adminApplyState.state === 'error' || adminApplyState.state === 'applied') {
      setAdminApplyState({ state: 'idle' })
    }

    try {
      const hasConfigTool = isAdmin && selectedTools.includes(CONFIG_TOOL_ID)
      const backendTools = selectedTools.filter((toolId) => toolId !== CONFIG_TOOL_ID)
      const wantsDbQuery = selectedTools.includes('db-query')
      const useRag = !isAdmin && selectedDocuments.length > 0 && !wantsDbQuery

      let response: Response
      if (useRag) {
        const body = {
          question: content,
          top_k: 8,
          tools: backendTools,
          job_ids: selectedDocuments,
          ...(ragSessionId && { session_id: ragSessionId }),
        }

        response = await fetch(`${API_BASE}/query`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          credentials: 'include',
          body: JSON.stringify(body),
        })
      } else {
        let baseToolContext: string | undefined
        if (hasConfigTool) {
          const snapshot = await buildAdminSnapshot()
          setAdminSnapshotInfo({ generatedAtIso: snapshot.generatedAtIso })
          adminDeploymentSecretKeysRef.current = snapshot.deploymentSecretKeys
          baseToolContext = snapshot.context
        } else {
          setAdminSnapshotInfo(null)
        }

        response = await sendLlmChatWithUnifiedTools({
          content,
          tools: backendTools,
          t,
          baseToolContext,
        })
      }

      const responseIsRag = useRag

      // Handle auth errors
      if (response.status === 401) {
        // Token invalid/expired
        navigate(isAdmin ? '/admin' : '/login')
        return
      }
      if (response.status === 403) {
        // Not approved - update localStorage and redirect
        localStorage.setItem(STORAGE_KEYS.USER_APPROVED, 'false')
        navigate('/pending')
        return
      }

      if (!response.ok) throw new Error(`HTTP ${response.status}`)

      const data = await response.json()

      let responseContent: string
      if (responseIsRag) {
        responseContent = data.answer
        
        // Save session_id for conversation continuity
        if (data.session_id) {
          setRagSessionId(data.session_id)
        }
      } else {
        responseContent = data.message

        if (hasConfigTool) {
          const raw = String(data.message || '')
          const extracted = extractAdminAssistantChangeSetStrict(raw)
          if (extracted.ok) {
            setAdminApplyState({ state: 'review', changeSet: extracted.changeSet })
          } else if (raw.includes('```json') && raw.includes('"requests"')) {
            setAdminApplyState({ state: 'error', message: extracted.error })
          }
        } else {
          setAdminApplyState({ state: 'idle' })
        }
      }

      const assistantMessage: Message = {
        id: generateMessageId(),
        role: 'assistant',
        content: responseContent,
        timestamp: new Date(),
      }

      setMessages((prev) => [...prev, assistantMessage])
      
      // Handle auto-search if backend returned a search term
      if (responseIsRag && data.search_term) {
        await triggerAutoSearch(data.search_term)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t('errors.failedToSendMessage'))
    } finally {
      setIsLoading(false)
    }
  }

  const handleAdminApply = useCallback(async (changeSet: AdminAssistantChangeSet) => {
    setAdminApplyState({ state: 'applying', changeSet })
    try {
      const userTypeSlugToId = new Map<string, number>()
      try {
        const existing = await fetchJson<{ types: Array<{ id: number; name: string }> }>('/admin/user-types')
        for (const ut of existing.types || []) {
          userTypeSlugToId.set(slugify(ut.name), ut.id)
        }
      } catch {
        // Best-effort; we'll still learn mappings from POST responses below.
      }

      const resolveUserTypeId = (raw: unknown): number | unknown => {
        if (typeof raw !== 'string') return raw
        if (!raw.startsWith('@type:')) return raw
        const slug = raw.slice('@type:'.length)
        const id = userTypeSlugToId.get(slug)
        if (id === undefined) throw new Error(`Unknown user type placeholder: ${raw}`)
        return id
      }

      const rewritePath = (path: string): string => {
        const parts = path.split('/')
        const idx = parts.findIndex((p) => p === 'user-type')
        if (idx !== -1 && parts[idx + 1]?.startsWith('@type:')) {
          const seg = parts[idx + 1]
          const id = resolveUserTypeId(seg)
          if (typeof id === 'number') parts[idx + 1] = String(id)
        }
        const idx2 = parts.findIndex((p) => p === 'defaults')
        if (idx2 !== -1 && parts[idx2 + 1] === 'user-type' && parts[idx2 + 2]?.startsWith('@type:')) {
          const seg = parts[idx2 + 2]
          const id = resolveUserTypeId(seg)
          if (typeof id === 'number') parts[idx2 + 2] = String(id)
        }
        return parts.join('/')
      }

      const results: Array<{ ok: boolean; method: string; path: string; status?: number; error?: string }> = []
      for (const req of changeSet.requests) {
        try {
          const resolvedPath = rewritePath(req.path)
          let resolvedBody: unknown = req.body
          if (resolvedBody && typeof resolvedBody === 'object' && !Array.isArray(resolvedBody)) {
            const b = resolvedBody as Record<string, unknown>
            if ('user_type_id' in b) {
              const resolved = resolveUserTypeId(b.user_type_id)
              resolvedBody = { ...b, user_type_id: resolved }
            }
          }

          const res = await adminFetch(resolvedPath, {
            method: req.method,
            body: resolvedBody ? JSON.stringify(resolvedBody) : undefined,
          })
          if (!res.ok) {
            const detail = await readErrorDetail(res)
            results.push({ ok: false, method: req.method, path: resolvedPath, status: res.status, error: detail })
            continue
          }

          if (req.method === 'POST' && req.path === '/admin/user-types') {
            try {
              const payload = await res.json() as { id?: number; name?: string }
              if (typeof payload?.id === 'number' && typeof payload?.name === 'string') {
                userTypeSlugToId.set(slugify(payload.name), payload.id)
              }
            } catch {
              // ignore
            }
          }

          results.push({ ok: true, method: req.method, path: resolvedPath, status: res.status })
        } catch (err) {
          results.push({ ok: false, method: req.method, path: req.path, error: err instanceof Error ? err.message : String(err) })
        }
      }

      const okCount = results.filter((r) => r.ok).length
      const failCount = results.length - okCount
      const baseSummary = `Applied ${okCount}/${results.length} change(s)${failCount ? `, ${failCount} failed` : ''}.`

      const failedDetails = results
        .filter((r) => !r.ok)
        .map((r) => `${r.method} ${r.path}: ${r.error || `HTTP ${r.status}`}`)
      const failureSummary = failedDetails.length
        ? '\n' + failedDetails.join('\n')
        : ''

      const postApplyNotes: string[] = []
      try {
        const validationRes = await adminFetch('/admin/deployment/config/validate', { method: 'POST' })
        if (validationRes.ok) {
          const v = await validationRes.json() as { valid: boolean; errors?: string[]; warnings?: string[] }
          if (v.valid) {
            const warnings = (v.warnings || []).filter(Boolean)
            postApplyNotes.push(warnings.length ? `Config validation: valid (warnings: ${warnings.length}).` : 'Config validation: valid.')
          } else {
            const errors = (v.errors || []).filter(Boolean)
            postApplyNotes.push(`Config validation: INVALID (errors: ${errors.length}).`)
          }
        } else {
          postApplyNotes.push(`Config validation: failed (HTTP ${validationRes.status}).`)
        }
      } catch {
        postApplyNotes.push('Config validation: failed (network error).')
      }

      try {
        const rr = await adminFetch('/admin/deployment/restart-required')
        if (rr.ok) {
          const data = await rr.json() as { restart_required: boolean; changed_keys?: Array<{ key: string }> }
          const keys = (data.changed_keys || []).map((k) => k.key).filter(Boolean)
          if (data.restart_required && keys.length) {
            postApplyNotes.push(`Restart required for: ${keys.join(', ')}.`)
          } else {
            postApplyNotes.push('Restart required: no.')
          }
        } else {
          postApplyNotes.push(`Restart required check: failed (HTTP ${rr.status}).`)
        }
      } catch {
        postApplyNotes.push('Restart required check: failed (network error).')
      }

      const summary = [baseSummary, ...postApplyNotes].join(' ') + failureSummary
      setAdminApplyState({ state: 'applied', message: summary })

      setMessages((prev) => ([
        ...prev,
        {
          id: generateMessageId(),
          role: 'assistant',
          content: summary,
          timestamp: new Date(),
        },
      ]))
    } catch (e) {
      setAdminApplyState({ state: 'error', message: e instanceof Error ? e.message : String(e) })
    }
  }, [fetchJson])

  const adminApplyPreview = useMemo(() => {
    if (adminApplyState.state !== 'review' && adminApplyState.state !== 'applying') return null
    const changeSet = adminApplyState.changeSet
    const secretKeys = adminDeploymentSecretKeysRef.current

    const pretty = changeSet.requests.map((r, idx) => {
      let bodyDisplay: unknown = r.body
      if (r.method === 'PUT' && r.path.startsWith('/admin/deployment/config/')) {
        const key = r.path.split('/').pop() || ''
        if (secretKeys.has(key) && r.body && typeof r.body === 'object') {
          const o = r.body as Record<string, unknown>
          if (typeof o.value === 'string' && o.value.length > 0) {
            bodyDisplay = { ...o, value: '[REDACTED]' }
          }
        }
      }
      return {
        idx: idx + 1,
        method: r.method,
        path: r.path,
        body: bodyDisplay,
      }
    })

    return {
      summary: changeSet.summary || '',
      requests: pretty,
    }
  }, [adminApplyState])
  
  // Auto-search triggered by backend - injects results back into RAG session
  const triggerAutoSearch = async (searchTerm: string) => {
    try {
      // Show searching indicator
      const searchingMessage: Message = {
        id: generateMessageId(),
        role: 'assistant',
        content: t('chat.messages.searching', { term: searchTerm }),
        timestamp: new Date(),
      }
      setMessages((prev) => [...prev, searchingMessage])
      
      // Build context-aware search prompt with condensing instructions
      const searchPrompt = `Search for: ${searchTerm}

IMPORTANT: Return a CONDENSED response:
- A brief table (3-5 rows max) with Name, Contact, and Notes columns
- 2-3 sentences of practical advice
- NO lengthy explanations or backgrounds
- Focus on actionable contacts and next steps`
      
      // Call the same shared chat path used by the main chat send flow.
      const searchRes = await sendLlmChatWithUnifiedTools({
        content: searchPrompt,
        tools: ['web-search'],
        t,
      })
      
      if (!searchRes.ok) {
        throw new Error(t('errors.searchFailed', { status: searchRes.status }))
      }
      
      const searchData = await searchRes.json()
      const searchResults = searchData.message
      
      // Replace searching message with condensed results
      const searchResultMessage: Message = {
        id: generateMessageId(),
        role: 'assistant',
        content: `${t('chat.messages.searchResults', { term: searchTerm })}\n\n${searchResults}`,
        timestamp: new Date(),
      }
      
      // Remove the "Searching..." message and add results
      const searchingPrefix = `🔍 ${t('chat.messages.searchingPrefix')}`
      setMessages((prev) => {
        const withoutSearching = prev.filter(m => !m.content.startsWith(searchingPrefix))
        return [...withoutSearching, searchResultMessage]
      })
      
      // Inject search results back into RAG session for context continuity
      if (ragSessionId && selectedDocuments.length > 0) {
        // Send a silent update to the RAG session with search results
        await fetch(`${API_BASE}/query`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          credentials: 'include',
          body: JSON.stringify({
            question: `[SYSTEM: Search results for "${searchTerm}" have been provided to the user. The results included: ${searchResults.slice(0, 500)}...]`,
            session_id: ragSessionId,
            top_k: 1,  // Minimal retrieval since this is just context injection
            tools: []  // No tools for this update
          }),
        }).catch(() => {
          // Silent failure - session update is best-effort
        })
      }
    } catch (e) {
      console.error('Auto-search failed:', e)
      // Remove searching message on error
      const searchingPrefix = `🔍 ${t('chat.messages.searchingPrefix')}`
      setMessages((prev) => prev.filter(m => !m.content.startsWith(searchingPrefix)))
    }
  }

  const handleNewChat = () => {
    setMessages([])
    setError(null)
    setRagSessionId(null) // Reset session for new conversation
    setAdminApplyState({ state: 'idle' })
    setAdminSnapshotInfo(null)
  }

  const rightActions = (
    <>
      {reachoutEnabled && (
        <button
          onClick={() => setReachoutOpen(true)}
          className="btn-ghost p-2 rounded-lg transition-all"
          title={t(
            `reachout.mode.${reachoutMode}.openButton`,
            reachoutMode === 'feedback' ? 'Send feedback' : reachoutMode === 'help' ? 'Get help' : 'Contact support'
          )}
          aria-label={t(
            `reachout.mode.${reachoutMode}.openButton`,
            reachoutMode === 'feedback' ? 'Send feedback' : reachoutMode === 'help' ? 'Get help' : 'Contact support'
          )}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25H4.5A2.25 2.25 0 012.25 17.25V6.75A2.25 2.25 0 014.5 4.5h15A2.25 2.25 0 0121.75 6.75z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 7.5l-8.91 5.94a2.25 2.25 0 01-2.48 0L2.25 7.5" />
          </svg>
        </button>
      )}
      <button
        onClick={handleNewChat}
        className="btn-ghost p-2 rounded-lg transition-all"
        title={t('chat.messages.newConversation')}
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
        </svg>
      </button>
      <ExportButton messages={messages} iconOnly />
    </>
  )

  const header = <AppHeader rightActions={rightActions} />

  const inputToolbar = isAdmin
    ? <ToolSelector tools={availableTools} selectedTools={selectedTools} onToggle={handleToolToggle} />
    : (
      <>
        <ToolSelector tools={availableTools} selectedTools={selectedTools} onToggle={handleToolToggle} />
        <div className="w-px h-4 bg-border mx-1" />
        <DocumentScope selectedDocuments={selectedDocuments} onToggle={handleDocumentToggle} documents={documents} />
      </>
    )

  return (
    <ChatContainer header={header}>
      <ReachoutModal
        open={reachoutOpen}
        mode={reachoutMode}
        overrides={reachoutOverrides}
        onClose={() => setReachoutOpen(false)}
      />

      <MessageList
        messages={messages}
        isLoading={isLoading}
      />

      {error && (
        <div className="px-3 sm:px-4 pb-2">
          <div className="max-w-3xl mx-auto">
            <div className="bg-error-subtle border border-error/20 text-error rounded-xl px-4 py-3 text-sm flex items-center gap-3 animate-fade-in shadow-sm">
              <div className="w-8 h-8 rounded-lg bg-error/10 flex items-center justify-center shrink-0">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                </svg>
              </div>
              <span className="flex-1">{error}</span>
              <button
                onClick={() => setError(null)}
                className="p-1.5 hover:bg-error/10 rounded-lg transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      )}

      {isAdmin && selectedTools.includes(CONFIG_TOOL_ID) && adminSnapshotInfo && (
        <div className="px-3 sm:px-4 pb-2">
          <div className="max-w-3xl mx-auto text-xs text-text-muted">
            Admin config context refreshed: {new Date(adminSnapshotInfo.generatedAtIso).toLocaleString()}
          </div>
        </div>
      )}

      {isAdmin && selectedTools.includes(CONFIG_TOOL_ID) && adminApplyState.state === 'error' && (
        <div className="px-3 sm:px-4 pb-2">
          <div className="max-w-3xl mx-auto">
            <div className="text-sm text-error bg-error/10 border border-error/20 rounded-xl px-4 py-3">
              {adminApplyState.message}
            </div>
          </div>
        </div>
      )}

      {isAdmin && selectedTools.includes(CONFIG_TOOL_ID) && adminApplyState.state === 'review' && adminApplyPreview && (
        <div className="px-3 sm:px-4 pb-2">
          <div className="max-w-3xl mx-auto border border-border rounded-2xl bg-surface-raised overflow-hidden">
            <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-3">
              <div className="text-sm font-medium text-text truncate">
                Pending changes {adminApplyPreview.summary ? `: ${adminApplyPreview.summary}` : ''}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => setAdminApplyState({ state: 'idle' })}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium text-text-secondary hover:text-text hover:bg-surface-overlay transition-colors"
                >
                  Dismiss
                </button>
                <button
                  onClick={() => handleAdminApply(adminApplyState.changeSet)}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium bg-accent text-accent-text hover:bg-accent-hover transition-colors"
                >
                  Apply
                </button>
              </div>
            </div>
            <div className="px-4 py-2 text-xs text-text-muted border-b border-border">
              Review: values for secret deployment keys are masked here.
            </div>
            <div className="px-4 py-3 space-y-2 max-h-64 overflow-y-auto">
              {adminApplyPreview.requests.map((r) => (
                <div key={r.idx} className="rounded-xl border border-border bg-surface px-3 py-2">
                  <div className="text-xs font-mono text-text-secondary">{r.method} {r.path}</div>
                  {r.body !== undefined && (
                    <pre className="mt-2 text-xs overflow-x-auto text-text-muted">{JSON.stringify(r.body, null, 2)}</pre>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {isAdmin && selectedTools.includes(CONFIG_TOOL_ID) && adminApplyState.state === 'applying' && (
        <div className="px-3 sm:px-4 pb-2">
          <div className="max-w-3xl mx-auto text-sm text-text-muted border border-border rounded-xl px-4 py-3 bg-surface-raised">
            Applying admin configuration changes...
          </div>
        </div>
      )}

      <ChatInput
        onSend={handleSend}
        disabled={isLoading}
        placeholder={
          !isAdmin && selectedDocuments.length > 0
            ? t('chat.input.placeholderWithDocs')
            : t('chat.input.placeholder')
        }
        toolbar={inputToolbar}
      />
    </ChatContainer>
  )
}
