import { useState, useCallback, useEffect, useMemo } from 'react'
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
import { API_BASE, STORAGE_KEYS } from '../types/onboarding'
import { adminFetch, isAdminAuthenticated } from '../utils/adminApi'
import { decryptField, hasNip04Support } from '../utils/encryption'

type DbQueryToolData = {
  sql?: string
  columns?: string[]
  rows?: Record<string, unknown>[]
  row_count?: number
  truncated?: boolean
}

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
            nextRow[fieldName] = null
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

          const decrypted = await decryptField({ ciphertext, ephemeral_pubkey: ephemeral })
          if (decrypted !== null) {
            decryptedCount += 1
          }
          nextRow[fieldName] = decrypted ?? ciphertext
          continue
        }

        nextRow[col] = row[col]
      }

      return nextRow
    })
  )

  return { columns: outputColumns, rows: decryptedRows, encryptedValueCount, decryptedCount }
}

const formatDbQueryContext = (
  data: DbQueryToolData,
  columns: string[],
  rows: Record<string, unknown>[]
) => {
  const lines: string[] = []

  if (data.sql) {
    lines.push(`Executed SQL: ${data.sql}`)
    lines.push('')
  }

  if (!rows.length) {
    lines.push('Query returned no results.')
    return lines.join('\n')
  }

  lines.push(`Database query results (${rows.length} rows):`)

  if (data.truncated) {
    lines.push('(Results truncated to 100 rows)')
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

export function ChatPage() {
  const navigate = useNavigate()
  const { t } = useTranslation()
  const [messages, setMessages] = useState<Message[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedTools, setSelectedTools] = useState<string[]>(['web-search'])
  const [selectedDocuments, setSelectedDocuments] = useState<string[]>([])
  const [ragSessionId, setRagSessionId] = useState<string | null>(null)
  const [documents, setDocuments] = useState<DocumentSource[]>([])

  // Build available tools list - db-query only visible to admins
  const availableTools = useMemo<Tool[]>(() => {
    const tools: Tool[] = [
      {
        id: 'web-search',
        name: 'Web',
        description: t('chat.tools.webSearch'),
        icon: (
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
          </svg>
        ),
      },
    ]

    // Only show Database tool to authenticated admins
    if (isAdminAuthenticated()) {
      tools.push({
        id: 'db-query',
        name: 'Database',
        description: t('chat.tools.database'),
        icon: (
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 0v3.75m-16.5-3.75v3.75m16.5 0v3.75C20.25 16.153 16.556 18 12 18s-8.25-1.847-8.25-4.125v-3.75m16.5 0c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125" />
          </svg>
        ),
      })
    }

    return tools
  }, [t])

  // Check auth and approval status on mount
  useEffect(() => {
    const sessionToken = localStorage.getItem(STORAGE_KEYS.SESSION_TOKEN)
    const adminToken = localStorage.getItem(STORAGE_KEYS.ADMIN_SESSION_TOKEN)

    // Not authenticated at all - redirect to login
    if (!sessionToken && !adminToken) {
      navigate('/login')
      return
    }

    // User authenticated but not approved - redirect to pending
    const approved = localStorage.getItem(STORAGE_KEYS.USER_APPROVED)
    if (!adminToken && approved === 'false') {
      navigate('/pending')
    }
  }, [navigate])

  // Fetch available documents from ingest jobs
  useEffect(() => {
    const fetchDocuments = async () => {
      const token = localStorage.getItem(STORAGE_KEYS.ADMIN_SESSION_TOKEN) ||
                    localStorage.getItem(STORAGE_KEYS.SESSION_TOKEN)
      try {
        const res = await fetch(`${API_BASE}/ingest/jobs`, {
          headers: token ? { 'Authorization': `Bearer ${token}` } : {}
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
        console.error('Failed to fetch documents:', e)
      }
    }
    fetchDocuments()
  }, [])

  const handleToolToggle = useCallback((toolId: string) => {
    if (toolId === 'db-query' && !selectedTools.includes('db-query') && selectedDocuments.length > 0) {
      // db-query runs against /llm/chat only; clear RAG document selection
      setSelectedDocuments([])
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

    try {
      const wantsDbQuery = selectedTools.includes('db-query')
      const useRag = selectedDocuments.length > 0 && !wantsDbQuery

      // Admin token takes priority, fall back to user token
      const adminToken = localStorage.getItem(STORAGE_KEYS.ADMIN_SESSION_TOKEN)
      const userToken = localStorage.getItem(STORAGE_KEYS.SESSION_TOKEN)
      const token = adminToken || userToken

      const canDecryptDbQuery = !useRag && wantsDbQuery && !!adminToken && hasNip04Support()
      let response: Response | null = null
      let responseIsRag = useRag

      if (canDecryptDbQuery) {
        try {
          const toolResponse = await adminFetch('/admin/tools/execute', {
            method: 'POST',
            body: JSON.stringify({ tool_id: 'db-query', query: content })
          })

          if (toolResponse.ok) {
            const toolPayload = await toolResponse.json()
            if (toolPayload?.success && toolPayload?.data) {
              const decrypted = await decryptDbQueryData(toolPayload.data as DbQueryToolData)
              const hasEncryptedValues = decrypted.encryptedValueCount > 0

              if (!hasEncryptedValues || decrypted.decryptedCount > 0) {
                const toolContext = formatDbQueryContext(
                  toolPayload.data as DbQueryToolData,
                  decrypted.columns,
                  decrypted.rows
                )

                response = await fetch(`${API_BASE}/llm/chat`, {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    ...(token && { 'Authorization': `Bearer ${token}` })
                  },
                  body: JSON.stringify({
                    message: content,
                    tools: selectedTools,
                    tool_context: toolContext
                  }),
                })
                responseIsRag = false
              }
            }
          }
        } catch (e) {
          console.warn('Falling back to encrypted db-query tool path:', e)
        }
      }

      if (!response) {
        const endpoint = useRag ? '/query' : '/llm/chat'
        const body = useRag
          ? { question: content, top_k: 8, tools: selectedTools, ...(ragSessionId && { session_id: ragSessionId }) }
          : { message: content, tools: selectedTools }

        response = await fetch(`${API_BASE}${endpoint}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token && { 'Authorization': `Bearer ${token}` })
          },
          body: JSON.stringify(body),
        })
        responseIsRag = useRag
      }

      if (!response) {
        throw new Error('No response from server')
      }

      // Handle auth errors
      if (response.status === 401) {
        // Token invalid/expired - redirect to login
        navigate('/login')
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
        await triggerAutoSearch(data.search_term, token)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to send message')
    } finally {
      setIsLoading(false)
    }
  }
  
  // Auto-search triggered by backend - injects results back into RAG session
  const triggerAutoSearch = async (searchTerm: string, token: string | null) => {
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
      
      // Call the chat endpoint with web-search tool
      const searchRes = await fetch(`${API_BASE}/llm/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token && { 'Authorization': `Bearer ${token}` })
        },
        body: JSON.stringify({
          message: searchPrompt,
          tools: ['web-search']
        }),
      })
      
      if (!searchRes.ok) {
        throw new Error(`Search failed: HTTP ${searchRes.status}`)
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
      setMessages((prev) => {
        const withoutSearching = prev.filter(m => !m.content.startsWith('🔍 Searching'))
        return [...withoutSearching, searchResultMessage]
      })
      
      // Inject search results back into RAG session for context continuity
      if (ragSessionId && selectedDocuments.length > 0) {
        // Send a silent update to the RAG session with search results
        await fetch(`${API_BASE}/query`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token && { 'Authorization': `Bearer ${token}` })
          },
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
      setMessages((prev) => prev.filter(m => !m.content.startsWith('🔍 Searching')))
    }
  }

  const handleNewChat = () => {
    setMessages([])
    setError(null)
    setRagSessionId(null) // Reset session for new conversation
  }

  const rightActions = (
    <>
      <button
        onClick={handleNewChat}
        className="p-2 rounded-lg text-text-secondary hover:text-text hover:bg-surface-overlay transition-all"
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

  const inputToolbar = (
    <>
      <ToolSelector tools={availableTools} selectedTools={selectedTools} onToggle={handleToolToggle} />
      <div className="w-px h-4 bg-border mx-1" />
      <DocumentScope selectedDocuments={selectedDocuments} onToggle={handleDocumentToggle} documents={documents} />
    </>
  )

  return (
    <ChatContainer header={header}>
      <MessageList
        messages={messages}
        isLoading={isLoading}
      />

      {error && (
        <div className="px-3 sm:px-4 pb-2">
          <div className="max-w-3xl mx-auto">
            <div className="bg-error-subtle border border-error/20 text-error rounded-xl px-4 py-2.5 text-sm flex items-center gap-2 animate-fade-in">
              <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
              </svg>
              <span>{error}</span>
              <button
                onClick={() => setError(null)}
                className="ml-auto p-1 hover:bg-error/10 rounded transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      )}

      <ChatInput
        onSend={handleSend}
        disabled={isLoading}
        placeholder={
          selectedDocuments.length > 0
            ? t('chat.input.placeholderWithDocs')
            : t('chat.input.placeholder')
        }
        toolbar={inputToolbar}
      />
    </ChatContainer>
  )
}
