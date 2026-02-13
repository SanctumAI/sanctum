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

const MAX_CHANGESET_REQUESTS = 50

function _isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function _readInt(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value)
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!/^-?\d+$/.test(trimmed)) return undefined
    const parsed = Number.parseInt(trimmed, 10)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

function _readBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value === 1 ? true : value === 0 ? false : undefined
  if (typeof value !== 'string') return undefined
  const normalized = value.trim().toLowerCase()
  if (['true', '1', 'yes', 'on'].includes(normalized)) return true
  if (['false', '0', 'no', 'off'].includes(normalized)) return false
  return undefined
}

function _readString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function _readNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}

function _readUserTypeId(value: unknown): number | string | undefined {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) return value
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined
  if (/^@type:[a-z0-9_]+$/.test(trimmed)) return trimmed
  if (/^\d+$/.test(trimmed)) {
    const parsed = Number.parseInt(trimmed, 10)
    if (Number.isFinite(parsed) && parsed > 0) return parsed
  }
  return undefined
}

/**
 * Normalize common-but-unsupported request shapes into supported ones.
 *
 * Today the backend supports updating instance settings via:
 *   PUT /admin/settings  with a JSON body like { "instance_name": "...", ... }
 *
 * But LLMs often emit per-key endpoints like:
 *   PUT /admin/settings/instance_name  body: { "value": "..." }
 *
 * We coalesce those into a single PUT /admin/settings to make the assistant
 * more forgiving, while still keeping the strict allowlist intact.
 */
function normalizeAdminAssistantChangeSet(changeSet: AdminAssistantChangeSet): AdminAssistantChangeSet {
  const settingsPatch: Record<string, unknown> = {}
  let sawSettingsPatch = false

  const out: AdminAssistantRequest[] = []
  const perKeyRe = /^\/admin\/settings\/([A-Za-z0-9_]+)$/

  for (const req of changeSet.requests) {
    if (!req || typeof req !== 'object') continue

    if (req.method === 'PUT' && req.path === '/admin/settings' && _isPlainObject(req.body)) {
      Object.assign(settingsPatch, req.body)
      sawSettingsPatch = true
      continue
    }

    const m = req.method === 'PUT' ? perKeyRe.exec(req.path) : null
    if (m) {
      const key = m[1]
      if (_isPlainObject(req.body) && Object.keys(req.body).length === 1 && 'value' in req.body) {
        settingsPatch[key] = (req.body as Record<string, unknown>).value
        sawSettingsPatch = true
        continue
      }
      // Keep the original request so validation can fail loudly if it's not in the supported shape.
      out.push(req)
      continue
    }

    // Normalize common LLM payload formats to match backend schemas.
    if (req.method === 'POST' && _isPlainObject(req.body)) {
      // /admin/user-types expects: { name, description?, icon?, display_order? }
      if (req.method === 'POST' && req.path === '/admin/user-types') {
        const b = req.body
        const name = _readNonEmptyString(b.name)
        const description = _readString(b.description)
        const icon = _readString(b.icon)
        const displayOrder = _readInt(b.display_order ?? b.order)
        const normalizedBody: Record<string, unknown> = {}
        if (name !== undefined) normalizedBody.name = name
        if (description !== undefined) normalizedBody.description = description
        if (icon !== undefined) normalizedBody.icon = icon
        if (displayOrder !== undefined) normalizedBody.display_order = displayOrder
        out.push({ ...req, body: normalizedBody })
        continue
      }

      // /admin/user-fields expects: { field_name, field_type, required?, display_order?, user_type_id?, placeholder?, options?, encryption_enabled?, include_in_chat? }
      if (req.method === 'POST' && req.path === '/admin/user-fields') {
        const b = req.body
        const fieldName =
          _readNonEmptyString(b.field_name) ??
          _readNonEmptyString(b.name) ??
          _readNonEmptyString(b.label) ??
          undefined

        const fieldType =
          _readNonEmptyString(b.field_type) ??
          _readNonEmptyString(b.type) ??
          undefined

        const displayOrder = _readInt(b.display_order ?? b.order)
        const required = _readBoolean(b.required)
        const encryptionEnabled = _readBoolean(b.encryption_enabled ?? b.encryptionEnabled)
        const includeInChat = _readBoolean(b.include_in_chat ?? b.includeInChat)
        const userTypeId = _readUserTypeId(b.user_type_id ?? b.userTypeId)
        const placeholder = _readString(b.placeholder)

        const normalizedBody: Record<string, unknown> = {}
        if (fieldName !== undefined) normalizedBody.field_name = fieldName
        if (fieldType !== undefined) normalizedBody.field_type = fieldType
        if (required !== undefined) normalizedBody.required = required
        if (displayOrder !== undefined) normalizedBody.display_order = displayOrder
        if (userTypeId !== undefined) normalizedBody.user_type_id = userTypeId
        if (placeholder !== undefined) normalizedBody.placeholder = placeholder
        if (encryptionEnabled !== undefined) normalizedBody.encryption_enabled = encryptionEnabled
        if (includeInChat !== undefined) normalizedBody.include_in_chat = includeInChat

        // Only select fields use options in the current UI, but the backend accepts it.
        // Normalize options to an array of strings when present.
        const opts = b.options
        if (Array.isArray(opts) && opts.every((o) => typeof o === 'string')) {
          if (String(fieldType || '').toLowerCase() === 'select') normalizedBody.options = opts
        }

        out.push({ ...req, body: normalizedBody })
        continue
      }
    }

    out.push(req)
  }

  const requests = sawSettingsPatch
    ? [{ method: 'PUT', path: '/admin/settings', body: settingsPatch } satisfies AdminAssistantRequest, ...out]
    : out

  // If we didn't change anything, return original object for referential stability.
  const same =
    requests.length === changeSet.requests.length
    && requests.every((r, i) => r === changeSet.requests[i])
  if (same) return changeSet

  return { ...changeSet, requests }
}

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

  const changeSet = normalizeAdminAssistantChangeSet(candidates[0])
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
  //
  // Note: We allow a user-type placeholder token `@type:<slug>` in certain routes
  // so a single change set can create user types and then reference them without
  // guessing numeric IDs. The apply pipeline resolves placeholders to IDs.
  const userTypeSegment = '(?:\\d+|@type:[a-z0-9_]+)'
  const allowedPathByMethod: Record<AdminAssistantHttpMethod, RegExp[]> = {
    PUT: [
      /^\/admin\/deployment\/config\/[A-Z0-9_]+$/,
      /^\/admin\/settings$/,
      /^\/admin\/ai-config\/[a-z0-9_]+$/i,
      new RegExp(`^/admin/ai-config/user-type/${userTypeSegment}/[a-z0-9_]+$`, 'i'),
      /^\/admin\/user-types\/\d+$/,
      /^\/admin\/user-fields\/\d+$/,
      /^\/admin\/user-fields\/\d+\/encryption$/,
      /^\/ingest\/admin\/documents\/[A-Za-z0-9_-]+\/defaults$/,
      /^\/ingest\/admin\/documents\/defaults\/batch$/,
      new RegExp(`^/ingest/admin/documents/[A-Za-z0-9_-]+/defaults/user-type/${userTypeSegment}$`),
    ],
    POST: [
      /^\/admin\/user-types$/,
      /^\/admin\/user-fields$/,
    ],
    DELETE: [
      /^\/admin\/user-types\/\d+$/,
      /^\/admin\/user-fields\/\d+$/,
      new RegExp(`^/admin/ai-config/user-type/${userTypeSegment}/[a-z0-9_]+$`, 'i'),
      new RegExp(`^/ingest/admin/documents/[A-Za-z0-9_-]+/defaults/user-type/${userTypeSegment}$`),
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
