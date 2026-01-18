import { useState, useCallback, useEffect, useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useTheme } from '../theme'
import { useInstanceConfig } from '../context/InstanceConfigContext'
import { ChatContainer } from '../components/chat/ChatContainer'
import { MessageList } from '../components/chat/MessageList'
import { ChatInput } from '../components/chat/ChatInput'
import { ToolSelector, Tool } from '../components/chat/ToolSelector'
import { DocumentScope } from '../components/chat/DocumentScope'
import { ExportButton } from '../components/chat/ExportButton'
import { DynamicIcon } from '../components/shared/DynamicIcon'
import { Message } from '../components/chat/ChatMessage'
import { API_BASE, STORAGE_KEYS } from '../types/onboarding'
import { isAdminAuthenticated } from '../utils/adminApi'

function ThemeToggle() {
  const { setTheme, resolvedTheme } = useTheme()

  return (
    <div className="flex items-center">
      <button
        onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
        className="p-2 rounded-lg text-text-secondary hover:text-text hover:bg-surface-overlay transition-all"
        aria-label="Toggle theme"
        title={`Switch to ${resolvedTheme === 'dark' ? 'light' : 'dark'} mode`}
      >
        {resolvedTheme === 'dark' ? (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v2.25m6.364.386l-1.591 1.591M21 12h-2.25m-.386 6.364l-1.591-1.591M12 18.75V21m-4.773-4.227l-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z" />
          </svg>
        ) : (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21.752 15.002A9.718 9.718 0 0118 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 003 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 009.002-5.998z" />
          </svg>
        )}
      </button>
    </div>
  )
}

export function ChatPage() {
  const navigate = useNavigate()
  const { config } = useInstanceConfig()
  const [messages, setMessages] = useState<Message[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedTools, setSelectedTools] = useState<string[]>([])
  const [selectedDocuments, setSelectedDocuments] = useState<string[]>([])
  const [ragSessionId, setRagSessionId] = useState<string | null>(null)

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

  // Check approval status on mount
  useEffect(() => {
    const approved = localStorage.getItem(STORAGE_KEYS.USER_APPROVED)
    if (approved === 'false') {
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
        ? { question: content, top_k: 8, tools: selectedTools, ...(ragSessionId && { session_id: ragSessionId }) }
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
      if (useRag && data.search_term) {
        await triggerAutoSearch(data.search_term, token)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to send message')
    } finally {
      setIsLoading(false)
    }
  }
  
  // Auto-search triggered by backend
  const triggerAutoSearch = async (searchTerm: string, token: string | null) => {
    try {
      // Show searching indicator
      const searchingMessage: Message = {
        id: generateMessageId(),
        role: 'assistant',
        content: `🔍 Searching for "${searchTerm}"...`,
        timestamp: new Date(),
      }
      setMessages((prev) => [...prev, searchingMessage])
      
      // Call the chat endpoint with web-search tool
      const searchRes = await fetch(`${API_BASE}/llm/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token && { 'Authorization': `Bearer ${token}` })
        },
        body: JSON.stringify({
          message: searchTerm,
          tools: ['web-search']
        }),
      })
      
      if (!searchRes.ok) {
        throw new Error(`Search failed: HTTP ${searchRes.status}`)
      }
      
      const searchData = await searchRes.json()
      
      // Replace searching message with results
      const searchResultMessage: Message = {
        id: generateMessageId(),
        role: 'assistant',
        content: `I went ahead and searched "${searchTerm}" for you based on our conversation:\n\n${searchData.message}`,
        timestamp: new Date(),
      }
      
      // Remove the "Searching..." message and add results
      setMessages((prev) => {
        const withoutSearching = prev.filter(m => !m.content.startsWith('🔍 Searching'))
        return [...withoutSearching, searchResultMessage]
      })
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

  const handleSuggestedPrompt = (prompt: string) => {
    handleSend(prompt)
  }

  const header = (
    <div className="max-w-5xl mx-auto px-3 sm:px-4 py-2.5 flex items-center justify-between">
      {/* Left: Back + Branding */}
      <div className="flex items-center gap-3">
        <Link
          to="/"
          className="p-1.5 -ml-1.5 rounded-lg text-text-muted hover:text-text hover:bg-surface-overlay transition-all"
          title="Back to Dashboard"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
          </svg>
        </Link>
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-accent to-accent-hover flex items-center justify-center shadow-sm">
            <DynamicIcon name={config.icon} size={16} className="text-white" />
          </div>
          <span className="font-semibold text-text hidden sm:block">{config.name}</span>
        </div>
      </div>

      {/* Right: Actions */}
      <div className="flex items-center gap-1">
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
        <ThemeToggle />
      </div>
    </div>
  )

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
