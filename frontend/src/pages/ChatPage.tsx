import { useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { useTheme } from '../theme'
import { useInstanceConfig } from '../context/InstanceConfigContext'
import { ChatContainer } from '../components/chat/ChatContainer'
import { MessageList } from '../components/chat/MessageList'
import { ChatInput } from '../components/chat/ChatInput'
import { ToolSelector } from '../components/chat/ToolSelector'
import { DocumentScope } from '../components/chat/DocumentScope'
import { ExportButton } from '../components/chat/ExportButton'
import { DynamicIcon } from '../components/shared/DynamicIcon'
import { Message } from '../components/chat/ChatMessage'

const API_BASE = 'http://localhost:8000'

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
  const { config } = useInstanceConfig()
  const [messages, setMessages] = useState<Message[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedTools, setSelectedTools] = useState<string[]>([])
  const [selectedDocuments, setSelectedDocuments] = useState<string[]>([])

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
        ? { question: content, top_k: 5 }
        : { message: content }

      const res = await fetch(`${API_BASE}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

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
      <ToolSelector selectedTools={selectedTools} onToggle={handleToolToggle} />
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
