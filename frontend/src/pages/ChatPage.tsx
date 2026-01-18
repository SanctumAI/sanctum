import { useState, useCallback, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChatContainer } from '../components/chat/ChatContainer'
import { MessageList } from '../components/chat/MessageList'
import { ChatInput } from '../components/chat/ChatInput'
import { ToolSelector, Tool } from '../components/chat/ToolSelector'
import { DocumentScope } from '../components/chat/DocumentScope'
import { ExportButton } from '../components/chat/ExportButton'
import { AppHeader } from '../components/shared/AppHeader'
import { Message } from '../components/chat/ChatMessage'
import { API_BASE, STORAGE_KEYS } from '../types/onboarding'
import { isAdminAuthenticated } from '../utils/adminApi'

export function ChatPage() {
  const navigate = useNavigate()
  const [messages, setMessages] = useState<Message[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedTools, setSelectedTools] = useState<string[]>([])
  const [selectedDocuments, setSelectedDocuments] = useState<string[]>([])

  // Build available tools list - db-query only visible to admins
  const availableTools = useMemo<Tool[]>(() => {
    const tools: Tool[] = [
      {
        id: 'web-search',
        name: 'Web',
        description: 'Search the web for current information',
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
        description: 'Query the SQLite database',
        icon: (
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 0v3.75m-16.5-3.75v3.75m16.5 0v3.75C20.25 16.153 16.556 18 12 18s-8.25-1.847-8.25-4.125v-3.75m16.5 0c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125" />
          </svg>
        ),
      })
    }

    return tools
  }, [])

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

  const handleToolToggle = useCallback((toolId: string) => {
    setSelectedTools((prev) =>
      prev.includes(toolId) ? prev.filter((id) => id !== toolId) : [...prev, toolId]
    )
  }, [])

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
      const useRag = selectedDocuments.length > 0
      const endpoint = useRag ? '/query' : '/llm/chat'
      const body = useRag
        ? { question: content, top_k: 5, tools: selectedTools }
        : { message: content, tools: selectedTools }

      // Admin token takes priority, fall back to user token
      const token = localStorage.getItem(STORAGE_KEYS.ADMIN_SESSION_TOKEN) || localStorage.getItem(STORAGE_KEYS.SESSION_TOKEN)

      const res = await fetch(`${API_BASE}${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token && { 'Authorization': `Bearer ${token}` })
        },
        body: JSON.stringify(body),
      })

      // Handle auth errors
      if (res.status === 401) {
        // Token invalid/expired - redirect to login
        navigate('/login')
        return
      }
      if (res.status === 403) {
        // Not approved - update localStorage and redirect
        localStorage.setItem(STORAGE_KEYS.USER_APPROVED, 'false')
        navigate('/pending')
        return
      }

      if (!res.ok) throw new Error(`HTTP ${res.status}`)

      const data = await res.json()

      let responseContent: string
      if (useRag) {
        responseContent = data.answer
        if (data.citations && data.citations.length > 0) {
          responseContent += '\n\n---\n\n**Sources:**\n'
          data.citations.forEach((c: { claim_text: string; source_title: string; source_url?: string }, i: number) => {
            responseContent += `\n${i + 1}. **${c.source_title}**`
            if (c.source_url) {
              responseContent += ` - [link](${c.source_url})`
            }
            responseContent += `\n   > ${c.claim_text}\n`
          })
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
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to send message')
    } finally {
      setIsLoading(false)
    }
  }

  const handleNewChat = () => {
    setMessages([])
    setError(null)
  }

  const handleSuggestedPrompt = (prompt: string) => {
    handleSend(prompt)
  }

  const rightActions = (
    <>
      <button
        onClick={handleNewChat}
        className="p-2 rounded-lg text-text-secondary hover:text-text hover:bg-surface-overlay transition-all"
        title="New conversation"
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
      <DocumentScope selectedDocuments={selectedDocuments} onToggle={handleDocumentToggle} />
    </>
  )

  return (
    <ChatContainer header={header}>
      <MessageList
        messages={messages}
        isLoading={isLoading}
        onSuggestedPrompt={handleSuggestedPrompt}
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
            ? 'Ask about your selected documents...'
            : 'Ask anything...'
        }
        toolbar={inputToolbar}
      />
    </ChatContainer>
  )
}
