export type AdminAssistantHttpMethod = 'PUT' | 'POST' | 'DELETE'

export interface AdminAssistantRequest {
  method: AdminAssistantHttpMethod
  path: string
  body?: unknown
}

export interface AdminAssistantChangeSet {
  version: 1
  summary?: string
  requests: AdminAssistantRequest[]
}

export type ExtractChangeSetResult =
  | { ok: true; changeSet: AdminAssistantChangeSet }
  | { ok: false; error: string }

const MAX_CHANGESET_REQUESTS = 25

function _extractJsonCodeBlocks(text: string): string[] {
  // Matches ```json ... ``` and ``` ... ```; we prefer explicit json blocks.
  const blocks: string[] = []
  const re = /```(?:json)?\s*([\s\S]*?)\s*```/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const body = (m[1] || '').trim()
    if (body) blocks.push(body)
  }
  return blocks
}

function _safeJsonParse(value: string): unknown | null {
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

function _coerceChangeSet(parsed: unknown): AdminAssistantChangeSet | null {
  if (!parsed || typeof parsed !== 'object') return null
  const obj = parsed as Record<string, unknown>
  if (obj.version !== 1) return null
  if (!Array.isArray(obj.requests)) return null

  const summary = typeof obj.summary === 'string' ? obj.summary : undefined
  const requests: AdminAssistantRequest[] = []
  for (const r of obj.requests) {
    if (!r || typeof r !== 'object') return null
    const ro = r as Record<string, unknown>
    const method = ro.method
    const path = ro.path
    if (method !== 'PUT' && method !== 'POST' && method !== 'DELETE') return null
    if (typeof path !== 'string') return null
    const body = ro.body
    requests.push({ method, path, ...(body !== undefined ? { body } : {}) })
  }

  return {
    version: 1,
    ...(summary ? { summary } : {}),
    requests,
  }
}

/**
 * Strict change set extraction.
 * - Exactly 1 valid change set must be present (otherwise ambiguous).
 * - The extracted change set must also pass allowlist validation.
 */
export function extractAdminAssistantChangeSetStrict(text: string): ExtractChangeSetResult {
  const blocks = _extractJsonCodeBlocks(text)
  if (blocks.length === 0) return { ok: false, error: 'No JSON code block found' }

  const candidates: AdminAssistantChangeSet[] = []
  for (const block of blocks) {
    const parsed = _safeJsonParse(block)
    const coerced = _coerceChangeSet(parsed)
    if (coerced) candidates.push(coerced)
  }

  if (candidates.length === 0) return { ok: false, error: 'No valid change set found' }
  if (candidates.length > 1) return { ok: false, error: 'Multiple change sets found. Please output exactly one.' }

  const changeSet = candidates[0]
  const validation = validateAdminAssistantChangeSet(changeSet)
  if (!validation.ok) return { ok: false, error: validation.error || 'Invalid change set' }

  return { ok: true, changeSet }
}

// Back-compat helper (non-strict API): returns the one extracted changeset or null.
export function extractAdminAssistantChangeSet(text: string): AdminAssistantChangeSet | null {
  const res = extractAdminAssistantChangeSetStrict(text)
  return res.ok ? res.changeSet : null
}

export function validateAdminAssistantChangeSet(
  changeSet: AdminAssistantChangeSet
): { ok: boolean; error?: string } {
  if (!changeSet || changeSet.version !== 1) {
    return { ok: false, error: 'Unsupported change set version' }
  }
  if (!Array.isArray(changeSet.requests) || changeSet.requests.length === 0) {
    return { ok: false, error: 'Change set contains no requests' }
  }
  if (changeSet.requests.length > MAX_CHANGESET_REQUESTS) {
    return { ok: false, error: `Change set has too many requests (max ${MAX_CHANGESET_REQUESTS})` }
  }

  const allowedMethods = new Set<AdminAssistantHttpMethod>(['PUT', 'POST', 'DELETE'])

  // Intentionally narrow allowlist: only explicit admin mutation endpoints.
  // Regexes are anchored to avoid accidental prefix matches.
  const allowedPathByMethod: Record<AdminAssistantHttpMethod, RegExp[]> = {
    PUT: [
      /^\/admin\/deployment\/config\/[A-Z0-9_]+$/,
      /^\/admin\/settings$/,
      /^\/admin\/ai-config\/[a-z0-9_]+$/i,
      /^\/admin\/ai-config\/user-type\/\d+\/[a-z0-9_]+$/i,
      /^\/admin\/user-types\/\d+$/,
      /^\/admin\/user-fields\/\d+$/,
      /^\/admin\/user-fields\/\d+\/encryption$/,
      /^\/ingest\/admin\/documents\/[A-Za-z0-9_-]+\/defaults$/,
      /^\/ingest\/admin\/documents\/defaults\/batch$/,
      /^\/ingest\/admin\/documents\/[A-Za-z0-9_-]+\/defaults\/user-type\/\d+$/,
    ],
    POST: [
      /^\/admin\/user-types$/,
      /^\/admin\/user-fields$/,
    ],
    DELETE: [
      /^\/admin\/user-types\/\d+$/,
      /^\/admin\/user-fields\/\d+$/,
      /^\/admin\/ai-config\/user-type\/\d+\/[a-z0-9_]+$/i,
      /^\/ingest\/admin\/documents\/[A-Za-z0-9_-]+\/defaults\/user-type\/\d+$/,
    ],
  }

  for (const req of changeSet.requests) {
    if (!req || typeof req !== 'object') return { ok: false, error: 'Invalid request entry' }
    if (!allowedMethods.has(req.method)) return { ok: false, error: `Unsupported method: ${String(req.method)}` }
    if (typeof req.path !== 'string' || !req.path.startsWith('/')) return { ok: false, error: 'Invalid request path' }
    if (req.path.includes('..')) return { ok: false, error: 'Invalid request path' }

    // Block high-risk reads and generic tool execution explicitly.
    const pathLower = req.path.toLowerCase()
    if (
      pathLower.includes('/reveal')
      || pathLower.includes('/export')
      || pathLower.includes('/prompts/preview')
      || pathLower.startsWith('/admin/tools/execute')
    ) {
      return { ok: false, error: `Disallowed request path: ${req.path}` }
    }

    const allowed = allowedPathByMethod[req.method].some((re) => re.test(req.path))
    if (!allowed) return { ok: false, error: `Disallowed request: ${req.method} ${req.path}` }
  }

  return { ok: true }
}

export function redactSecrets(text: string, secrets: string[]): string {
  if (!text || secrets.length === 0) return text

  // Replace exact occurrences of known secret values. Keep it simple and deterministic.
  // Sort by descending length so longer secrets are replaced first, preventing
  // substring fragmentation (e.g. "secretkey" fragmenting "mysecretkey123").
  const sorted = [...secrets].sort((a, b) => b.length - a.length)
  let out = text
  for (const secret of sorted) {
    if (!secret) continue
    if (secret.length < 6) continue // Avoid over-redacting common short strings
    if (!out.includes(secret)) continue
    out = out.split(secret).join('[REDACTED]')
  }
  return out
}
