import { API_BASE } from '../types/onboarding'
import { adminFetch, isAdminAuthenticated } from './adminApi'
import { decryptField, hasNip04Support } from './encryption'

type DbQueryToolData = {
  sql?: string
  columns?: string[]
  rows?: Record<string, unknown>[]
  row_count?: number
  truncated?: boolean
}

type TranslateFn = (key: string, options?: Record<string, unknown>) => string

const formatDbCell = (value: unknown) => {
  if (value === null || value === undefined) return ''
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

const decryptDbQueryData = async (data: DbQueryToolData) => {
  const columns = data.columns || []
  const rows = data.rows || []
  let encryptedValueCount = 0
  let decryptedCount = 0

  const outputColumns = columns.reduce<string[]>((acc, col) => {
    if (col.startsWith('ephemeral_pubkey')) return acc
    if (col.startsWith('encrypted_')) {
      const fieldName = col.replace('encrypted_', '')
      if (!acc.includes(fieldName)) acc.push(fieldName)
      return acc
    }
    if (!acc.includes(col)) acc.push(col)
    return acc
  }, [])

  const decryptedRows = await Promise.all(
    rows.map(async (row) => {
      const nextRow: Record<string, unknown> = {}

      for (const col of columns) {
        if (col.startsWith('ephemeral_pubkey')) {
          continue
        }

        if (col.startsWith('encrypted_')) {
          const fieldName = col.replace('encrypted_', '')
          const ciphertext = row[col]
          if (typeof ciphertext !== 'string' || !ciphertext) {
            continue
          }
          encryptedValueCount += 1

          let ephemeral = row[col.replace('encrypted_', 'ephemeral_pubkey_')]
          if (!ephemeral && col === 'encrypted_value') {
            ephemeral = row['ephemeral_pubkey']
          }

          if (typeof ephemeral !== 'string' || !ephemeral) {
            nextRow[fieldName] = ciphertext
            continue
          }

          try {
            const decrypted = await decryptField({ ciphertext, ephemeral_pubkey: ephemeral })
            if (decrypted !== null) {
              decryptedCount += 1
            }
            nextRow[fieldName] = decrypted ?? ciphertext
          } catch {
            nextRow[fieldName] = ciphertext
          }
          continue
        }

        if (nextRow[col] === undefined) {
          nextRow[col] = row[col]
        }
      }

      return nextRow
    })
  )

  return { columns: outputColumns, rows: decryptedRows, encryptedValueCount, decryptedCount }
}

const formatDbQueryContext = (
  data: DbQueryToolData,
  columns: string[],
  rows: Record<string, unknown>[],
  t: TranslateFn
) => {
  const lines: string[] = []

  if (data.sql) {
    lines.push(t('chat.database.executedSql', { sql: data.sql }))
    lines.push('')
  }

  if (!rows.length) {
    lines.push(t('chat.database.noResults'))
    return lines.join('\n')
  }

  lines.push(t('chat.database.resultsCount', { count: rows.length }))

  if (data.truncated) {
    lines.push(t('chat.database.resultsTruncated'))
  }

  lines.push('')
  lines.push(columns.join(' | '))
  lines.push('-'.repeat(columns.join(' | ').length))

  for (const row of rows) {
    const values = columns.map((col) => formatDbCell(row[col]))
    lines.push(values.join(' | '))
  }

  return lines.join('\n')
}

interface SendLlmChatOptions {
  content: string
  tools: string[]
  t: TranslateFn
  baseToolContext?: string
}

export async function sendLlmChatWithUnifiedTools({
  content,
  tools,
  t,
  baseToolContext,
}: SendLlmChatOptions): Promise<Response> {
  const toolContextParts: string[] = []
  if (baseToolContext && baseToolContext.trim()) {
    toolContextParts.push(baseToolContext.trim())
  }

  let clientExecutedTools: string[] = []
  const wantsDbQuery = tools.includes('db-query')
  const canDecryptDbQuery = wantsDbQuery && isAdminAuthenticated() && hasNip04Support()

  if (canDecryptDbQuery) {
    try {
      const toolResponse = await adminFetch('/admin/tools/execute', {
        method: 'POST',
        body: JSON.stringify({ tool_id: 'db-query', query: content }),
      })

      if (toolResponse.ok) {
        const toolPayload = await toolResponse.json()
        if (toolPayload?.success && toolPayload?.data) {
          const decrypted = await decryptDbQueryData(toolPayload.data as DbQueryToolData)
          const hasEncryptedValues = decrypted.encryptedValueCount > 0

          if (!hasEncryptedValues || decrypted.decryptedCount > 0) {
            const dbContext = formatDbQueryContext(
              toolPayload.data as DbQueryToolData,
              decrypted.columns,
              decrypted.rows,
              t
            )
            if (dbContext.trim()) {
              toolContextParts.push(dbContext)
              clientExecutedTools = ['db-query']
            }
          }
        }
      }
    } catch (e) {
      console.warn('Falling back to server-side db-query tool execution:', e)
    }
  }

  const body: Record<string, unknown> = {
    message: content,
    tools,
  }

  if (toolContextParts.length > 0) {
    body.tool_context = toolContextParts.join('\n\n')
    // Send explicit client-executed tools list. Empty array means
    // "tool_context exists, but no tools were pre-executed".
    body.client_executed_tools = clientExecutedTools
  }

  return fetch(`${API_BASE}/llm/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    credentials: 'include',
    body: JSON.stringify(body),
  })
}
