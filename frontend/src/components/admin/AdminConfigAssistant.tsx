import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation } from 'react-router-dom'
import { X, MessageCircle, RefreshCw, ShieldAlert, Play, EyeOff, Maximize2, Minimize2 } from 'lucide-react'
import { adminFetch } from '../../utils/adminApi'
import { ChatInput } from '../chat/ChatInput'
import { ChatMessage, type Message } from '../chat/ChatMessage'
import { ToolSelector, type Tool } from '../chat/ToolSelector'
import { getConfigCategories, getDeploymentConfigItemMeta } from '../../types/config'
import type { DeploymentConfigItem, DeploymentConfigResponse } from '../../types/config'
import { API_BASE } from '../../types/onboarding'
import { extractAdminAssistantChangeSetStrict, redactSecrets, type AdminAssistantChangeSet } from '../../utils/adminAssistant'
import { sendLlmChatWithUnifiedTools } from '../../utils/llmChat'

type SnapshotResult = {
  context: string
  // Secret values (not masked), used for client-side redaction of accidental echoes.
  secretValues: string[]
  deploymentSecretKeys: Set<string>
  generatedAtIso: string
}

type ApplyState =
  | { state: 'idle' }
  | { state: 'review'; changeSet: AdminAssistantChangeSet }
  | { state: 'applying'; changeSet: AdminAssistantChangeSet }
  | { state: 'applied'; message: string }
  | { state: 'error'; message: string }

const CONFIG_TOOL_ID = 'admin-config'

function generateMessageId() {
  return `admin-msg-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function slugify(value: string): string {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function flattenDeploymentConfig(cfg: DeploymentConfigResponse): DeploymentConfigItem[] {
  return [
    ...cfg.llm,
    ...cfg.embedding,
    ...cfg.email,
    ...cfg.storage,
    ...cfg.security,
    ...cfg.search,
    ...cfg.domains,
    ...cfg.ssl,
    ...cfg.general,
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

export function AdminConfigAssistant() {
  const { t } = useTranslation()
  const location = useLocation()
  const [open, setOpen] = useState(false)
  const [shareSecrets, setShareSecrets] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [snapshotInfo, setSnapshotInfo] = useState<{ generatedAtIso: string } | null>(null)
  const [applyState, setApplyState] = useState<ApplyState>({ state: 'idle' })
  const [selectedTools, setSelectedTools] = useState<string[]>(['web-search'])

  const secretsForRedactionRef = useRef<string[]>([])
  const deploymentSecretKeysRef = useRef<Set<string>>(new Set())

  const configCategories = useMemo(() => getConfigCategories(t), [t])
  const deploymentMeta = useMemo(() => getDeploymentConfigItemMeta(t), [t])
  const availableTools = useMemo<Tool[]>(() => ([
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
    {
      id: CONFIG_TOOL_ID,
      name: t('chat.tools.configName', 'Config'),
      description: t('chat.tools.config', 'Read and update admin configuration'),
      icon: (
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 6h9m-9 6h9m-9 6h9M4.5 6h.008v.008H4.5V6zm0 6h.008v.008H4.5V12zm0 6h.008v.008H4.5V18z" />
        </svg>
      ),
    },
    {
      id: 'db-query',
      name: t('chat.tools.databaseName'),
      description: t('chat.tools.database'),
      icon: (
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 0v3.75m-16.5-3.75v3.75m16.5 0v3.75C20.25 16.153 16.556 18 12 18s-8.25-1.847-8.25-4.125v-3.75m16.5 0c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125" />
        </svg>
      ),
    },
  ]), [t])

  const fetchJson = useCallback(async <T,>(endpoint: string, options?: RequestInit): Promise<T> => {
    const res = await adminFetch(endpoint, options)
    if (!res.ok) {
      throw new Error(await readErrorDetail(res))
    }
    return res.json() as Promise<T>
  }, [])

  const hasConfigTool = selectedTools.includes(CONFIG_TOOL_ID)

  useEffect(() => {
    let cancelled = false

    const fetchSessionDefaults = async () => {
      try {
        const res = await fetch(`${API_BASE}/session-defaults`)
        if (!res.ok) return
        const data = await res.json()
        if (cancelled) return
        setSelectedTools(data.web_search_enabled ? ['web-search'] : [])
      } catch {
        // Keep local defaults on error.
      }
    }

    fetchSessionDefaults()

    return () => {
      cancelled = true
    }
  }, [])

  const buildSnapshot = useCallback(async (): Promise<SnapshotResult> => {
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

    // Per-user-type fetches (best-effort).
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

    // Secrets are opt-in: only fetch revealed values when enabled.
    const revealedSecrets: Record<string, string> = {}
    if (shareSecrets) {
      const secretKeys = deploymentItems.filter((i) => i.is_secret).map((i) => i.key)
      const revealResults = await Promise.all(
        secretKeys.map(async (key) => {
          try {
            const payload = await fetchJson<{ key: string; value: string }>(`/admin/deployment/config/${key}/reveal`)
            return [key, payload?.value ?? ''] as const
          } catch {
            return [key, ''] as const
          }
        })
      )
      for (const [key, value] of revealResults) revealedSecrets[key] = value
    }

    const secretValues = Object.values(revealedSecrets).filter((v) => typeof v === 'string' && v.length > 0)

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
    lines.push('Only include allowed mutation endpoints. Avoid including secret values unless the admin explicitly requested setting them.')
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
        const meta = (deploymentMeta as any)[item.key] as { label?: string; hint?: string } | undefined
        const label = meta?.label ? ` (${meta.label})` : ''
        const restart = item.requires_restart ? ' requires_restart=true' : ''
        const secret = item.is_secret ? ' secret=true' : ''
        const updated = item.updated_at ? ` updated_at=${item.updated_at}` : ''
        lines.push(`- ${item.key}${label} = ${item.value ?? ''}${restart}${secret}${updated}`)
        if (item.description) lines.push(`  description: ${item.description}`)
      }
    }
    lines.push('')

    if (shareSecrets) {
      lines.push('DEPLOYMENT SECRET VALUES (explicitly shared by admin)')
      lines.push('These are secret env vars revealed via /admin/deployment/config/{key}/reveal.')
      lines.push('Do not repeat them back in responses.')
      for (const key of Object.keys(revealedSecrets).sort()) {
        lines.push(`- ${key} = ${revealedSecrets[key] || ''}`)
      }
      lines.push('')
    } else {
      lines.push('SECRETS')
      lines.push('Secret env vars are NOT included in this context. Ask the admin to toggle "Share secrets" if needed.')
      lines.push('')
    }

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
      secretValues,
      deploymentSecretKeys,
      generatedAtIso,
    }
  }, [configCategories, deploymentMeta, fetchJson, shareSecrets])

  const handleToolToggle = useCallback((toolId: string) => {
    if (toolId === CONFIG_TOOL_ID && selectedTools.includes(CONFIG_TOOL_ID)) {
      setApplyState({ state: 'idle' })
      setSnapshotInfo(null)
      setShareSecrets(false)
      secretsForRedactionRef.current = []
      deploymentSecretKeysRef.current = new Set()
    }
    setSelectedTools((prev) =>
      prev.includes(toolId) ? prev.filter((id) => id !== toolId) : [...prev, toolId]
    )
  }, [selectedTools])

  const handleSend = useCallback(async (content: string) => {
    const userMessage: Message = {
      id: generateMessageId(),
      role: 'user',
      content,
      timestamp: new Date(),
    }
    setMessages((prev) => [...prev, userMessage])
    setIsLoading(true)
    setError(null)

    try {
      const backendTools = selectedTools.filter((toolId) => toolId !== CONFIG_TOOL_ID)
      let baseToolContext: string | undefined
      if (hasConfigTool) {
        const snapshot = await buildSnapshot()
        setSnapshotInfo({ generatedAtIso: snapshot.generatedAtIso })
        secretsForRedactionRef.current = snapshot.secretValues
        deploymentSecretKeysRef.current = snapshot.deploymentSecretKeys
        baseToolContext = snapshot.context
      } else {
        setSnapshotInfo(null)
        setApplyState({ state: 'idle' })
      }

      const res = await sendLlmChatWithUnifiedTools({
        content,
        tools: backendTools,
        baseToolContext,
        t,
      })
      if (res.status === 401) {
        window.location.href = '/admin'
        return
      }
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`)
      }
      const data = await res.json() as { message?: string }
      const raw = String(data?.message || '')

      const assistantId = generateMessageId()

      const display = shareSecrets
        ? redactSecrets(raw, secretsForRedactionRef.current)
        : raw

      const assistantMessage: Message = {
        id: assistantId,
        role: 'assistant',
        content: display,
        timestamp: new Date(),
      }
      setMessages((prev) => [...prev, assistantMessage])

      if (hasConfigTool) {
        const extracted = extractAdminAssistantChangeSetStrict(raw)
        if (extracted.ok) setApplyState({ state: 'review', changeSet: extracted.changeSet })
        else if (raw.includes('```json') && raw.includes('"requests"')) setApplyState({ state: 'error', message: extracted.error })
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to send message')
    } finally {
      setIsLoading(false)
    }
  }, [buildSnapshot, hasConfigTool, selectedTools, shareSecrets, t])

  const handleApply = useCallback(async (changeSet: AdminAssistantChangeSet) => {
    setApplyState({ state: 'applying', changeSet })
    try {
      // Allow one change set to create user types and then reference them without
      // guessing IDs. Placeholder syntax: "@type:<slug>" where slug is the
      // slugified user type name (lowercase, alnum + underscores).
      //
      // Examples:
      // - POST /admin/user-types { "name": "Bitcoin Designer", ... }
      // - POST /admin/user-fields { ..., "user_type_id": "@type:bitcoin_designer" }
      // - PUT /admin/ai-config/user-type/@type:bitcoin_designer/top_k { "value": "8" }
      const userTypeSlugToId = new Map<string, number>()
      try {
        const existing = await fetchJson<{ types: Array<{ id: number; name: string }> }>('/admin/user-types')
        for (const ut of existing.types || []) {
          userTypeSlugToId.set(slugify(ut.name), ut.id)
        }
      } catch {
        // Best-effort; we'll still fill mapping from POST results below.
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
        // Replace /user-type/@type:slug/ with /user-type/<id>/
        const parts = path.split('/')
        const idx = parts.findIndex((p) => p === 'user-type')
        if (idx !== -1 && parts[idx + 1]?.startsWith('@type:')) {
          const seg = parts[idx + 1]
          const id = resolveUserTypeId(seg)
          if (typeof id === 'number') parts[idx + 1] = String(id)
        }
        // Replace /defaults/user-type/@type:slug (ingest doc defaults overrides)
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

          // Learn created user type IDs for later placeholder resolution.
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

      // Post-apply: run deployment config validation + check restart-required keys.
      let postApplyNotes: string[] = []
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
      setApplyState({ state: 'applied', message: summary })

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
      setApplyState({ state: 'error', message: e instanceof Error ? e.message : String(e) })
    }
  }, [fetchJson])

  const applyPreview = useMemo(() => {
    if (applyState.state !== 'review' && applyState.state !== 'applying') return null
    const changeSet = applyState.changeSet

    const secretKeys = deploymentSecretKeysRef.current

    const pretty = changeSet.requests.map((r, idx) => {
      let bodyDisplay: unknown = r.body
      // Mask deployment secrets in preview (even if they exist in body).
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
  }, [applyState])

  const closePanel = () => {
    setOpen(false)
    setError(null)
    setApplyState({ state: 'idle' })
    // Secrets are opt-in and should not persist beyond the session UI.
    setShareSecrets(false)
    secretsForRedactionRef.current = []
  }

  const inputToolbar = (
    <ToolSelector
      tools={availableTools}
      selectedTools={selectedTools}
      onToggle={handleToolToggle}
      compact
    />
  )

  const prefersLargeByRoute = useMemo(() => {
    const path = location.pathname
    return (
      path.startsWith('/admin/setup') ||
      path.startsWith('/admin/instance') ||
      path.startsWith('/admin/users') ||
      path.startsWith('/admin/ai') ||
      path.startsWith('/admin/deployment') ||
      path === '/admin'
    )
  }, [location.pathname])

  const [isExpanded, setIsExpanded] = useState(prefersLargeByRoute)

  useEffect(() => {
    // When panel is closed, follow route-based default size.
    if (!open) {
      setIsExpanded(prefersLargeByRoute)
    }
  }, [open, prefersLargeByRoute])

  const panelSizeClass = isExpanded
    ? 'w-[96vw] max-w-[980px] h-[88vh] max-h-[920px]'
    : 'w-[92vw] max-w-[420px] h-[72vh] max-h-[640px]'

  return (
    <>
      {/* Bubble button */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-5 right-5 z-50 w-12 h-12 rounded-2xl bg-gradient-to-br from-accent to-accent-hover shadow-lg ring-1 ring-white/10 hover:shadow-xl hover:-translate-y-0.5 transition-all active:scale-95 flex items-center justify-center"
          aria-label="Open admin assistant"
          title="Admin assistant"
        >
          <MessageCircle className="w-5 h-5 text-white" />
        </button>
      )}

      {/* Panel */}
      {open && (
        <div className={`fixed bottom-5 right-5 z-50 rounded-2xl bg-surface border border-border shadow-2xl overflow-hidden flex flex-col ${panelSizeClass}`}>
          <div className="px-4 py-3 border-b border-border bg-surface-raised flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <MessageCircle className="w-4 h-4 text-accent" />
                <div className="font-semibold text-text truncate">Admin Configuration Assistant</div>
              </div>
              <div className="text-xs text-text-muted mt-0.5">
                {!hasConfigTool
                  ? 'Context tool is off'
                  : snapshotInfo?.generatedAtIso
                    ? `Context: ${new Date(snapshotInfo.generatedAtIso).toLocaleString()}`
                    : 'Context: not loaded yet'}
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={async () => {
                  if (!hasConfigTool) return
                  setError(null)
                  setIsLoading(true)
                  try {
                    const snap = await buildSnapshot()
                    setSnapshotInfo({ generatedAtIso: snap.generatedAtIso })
                    secretsForRedactionRef.current = snap.secretValues
                    deploymentSecretKeysRef.current = snap.deploymentSecretKeys
                  } catch (e) {
                    setError(e instanceof Error ? e.message : 'Failed to refresh context')
                  } finally {
                    setIsLoading(false)
                  }
                }}
                className="p-2 rounded-xl hover:bg-surface-overlay text-text-muted hover:text-text transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                title="Refresh context"
                aria-label="Refresh context"
                disabled={!hasConfigTool}
              >
                <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
              </button>
              <button
                onClick={() => setIsExpanded((prev) => !prev)}
                className="px-2.5 py-2 rounded-xl hover:bg-surface-overlay text-text-muted hover:text-text transition-colors flex items-center gap-1.5"
                title={isExpanded ? 'Switch to compact size' : 'Switch to expanded size'}
                aria-label={isExpanded ? 'Switch to compact size' : 'Switch to expanded size'}
              >
                {isExpanded ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
                <span className="text-xs font-medium">{isExpanded ? 'Compact' : 'Expand'}</span>
              </button>
              <button
                onClick={closePanel}
                className="p-2 rounded-xl hover:bg-surface-overlay text-text-muted hover:text-text transition-colors"
                title="Close"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="px-4 py-3 border-b border-border bg-surface flex items-start justify-between gap-3">
            <label
              className={`flex items-start gap-3 select-none ${hasConfigTool ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'}`}
              aria-disabled={!hasConfigTool}
            >
              <input
                type="checkbox"
                checked={shareSecrets}
                disabled={!hasConfigTool}
                onChange={(e) => {
                  setShareSecrets(e.target.checked)
                  // Clear redaction cache until next snapshot build.
                  secretsForRedactionRef.current = []
                }}
                className="mt-1 disabled:cursor-not-allowed"
              />
              <div>
                <div className="text-sm font-medium text-text">Share secret env vars</div>
                <div className="text-xs text-text-muted">
                  Off by default. Enable Config tool first. When enabled, secret deployment config values are revealed client-side and sent to your LLM provider.
                </div>
              </div>
            </label>
            {hasConfigTool && shareSecrets && (
              <div className="flex items-center gap-2 text-xs text-warning shrink-0">
                <ShieldAlert className="w-4 h-4" />
                <span className="hidden sm:inline">Sensitive</span>
              </div>
            )}
          </div>

          <div className="flex-1 overflow-y-auto px-3 py-4">
            <div className="space-y-4">
              {messages.length === 0 ? (
                <div className="text-sm text-text-muted">
                  Ask questions about any admin configuration. If you want the assistant to propose and apply changes, ask it to include a JSON change set.
                </div>
              ) : (
                messages.map((m) => (
                  <ChatMessage key={m.id} message={m} />
                ))
              )}

              {isLoading && (
                <div className="animate-fade-in-up">
                  <div className="flex gap-3">
                    <div className="w-7 h-7 rounded-full bg-gradient-to-br from-accent to-accent-hover flex items-center justify-center shrink-0 shadow-md ring-1 ring-white/10">
                      <MessageCircle className="w-3.5 h-3.5 text-white" />
                    </div>
                    <div className="flex items-center gap-2 px-4 py-3 bg-surface-raised border border-border rounded-2xl rounded-bl-md">
                      <div className="flex items-center gap-1">
                        <span className="w-2 h-2 bg-accent/60 rounded-full typing-dot" />
                        <span className="w-2 h-2 bg-accent/60 rounded-full typing-dot" />
                        <span className="w-2 h-2 bg-accent/60 rounded-full typing-dot" />
                      </div>
                      <span className="text-sm text-text-secondary animate-pulse-subtle">Thinking...</span>
                    </div>
                  </div>
                </div>
              )}

              {error && (
                <div className="text-sm text-error bg-error/10 border border-error/20 rounded-xl px-3 py-2">
                  {error}
                </div>
              )}

              {hasConfigTool && applyState.state === 'error' && (
                <div className="text-sm text-error bg-error/10 border border-error/20 rounded-xl px-3 py-2">
                  {applyState.message}
                </div>
              )}

              {hasConfigTool && applyState.state === 'review' && applyPreview && (
                <div className="border border-border rounded-2xl bg-surface-raised overflow-hidden">
                  <div className="px-3 py-2 border-b border-border flex items-center justify-between gap-2">
                    <div className="text-sm font-medium text-text truncate">
                      Pending changes {applyPreview.summary ? `: ${applyPreview.summary}` : ''}
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setApplyState({ state: 'idle' })}
                        className="p-2 rounded-xl hover:bg-surface-overlay text-text-muted hover:text-text transition-colors"
                        title="Dismiss"
                        aria-label="Dismiss"
                      >
                        <EyeOff className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleApply(applyState.changeSet)}
                        className="flex items-center gap-2 px-3 py-2 rounded-xl bg-accent text-accent-text hover:bg-accent-hover transition-colors text-sm font-medium"
                      >
                        <Play className="w-4 h-4" />
                        Apply
                      </button>
                    </div>
                  </div>
                  <div className="px-3 py-2 text-xs text-text-muted">
                    Review: values for secret deployment keys are masked here.
                  </div>
                  <div className="px-3 pb-3 space-y-2">
                    {applyPreview.requests.map((r) => (
                      <div key={r.idx} className="rounded-xl border border-border bg-surface px-3 py-2">
                        <div className="text-xs font-mono text-text-secondary">{r.method} {r.path}</div>
                        {r.body !== undefined && (
                          <pre className="mt-2 text-xs overflow-x-auto text-text-muted">{JSON.stringify(r.body, null, 2)}</pre>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {hasConfigTool && applyState.state === 'applying' && (
                <div className="text-sm text-text-muted border border-border rounded-xl px-3 py-2 bg-surface-raised">
                  Applying changes...
                </div>
              )}
            </div>
          </div>

          <ChatInput
            onSend={(msg) => void handleSend(msg)}
            disabled={isLoading}
            placeholder="Ask about admin configuration..."
            toolbar={inputToolbar}
          />
        </div>
      )}
    </>
  )
}
