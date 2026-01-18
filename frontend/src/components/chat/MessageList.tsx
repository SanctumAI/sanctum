import { useEffect, useRef } from 'react'
import { Sparkles } from 'lucide-react'
import { ChatMessage, Message } from './ChatMessage'

interface MessageListProps {
  messages: Message[]
  isLoading?: boolean
  onSuggestedPrompt?: (prompt: string) => void
}

const suggestedPrompts = [
  "What documents are in the knowledge base?",
  "Summarize the key concepts",
  "How does the RAG pipeline work?",
  "What are the main entities and relationships?",
]


function EmptyState({ onSuggestedPrompt }: { onSuggestedPrompt?: (prompt: string) => void }) {
  return (
    <div className="flex-1 flex items-center justify-center p-4">
      <div className="text-center max-w-lg animate-fade-in">
        {/* Icon */}
        <div className="relative mx-auto mb-6 w-16 h-16">
          <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-accent/20 to-accent/5 rotate-6" />
          <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-accent to-accent-hover flex items-center justify-center shadow-lg">
            <Sparkles className="w-8 h-8 text-white" strokeWidth={2} />
          </div>
        </div>

        {/* Text */}
        <h2 className="text-xl font-semibold text-text mb-2">What would you like to know?</h2>
        <p className="text-text-secondary text-sm mb-6">
          Ask questions about your knowledge base or start a general conversation
        </p>

        {/* Suggested prompts */}
        {onSuggestedPrompt && (
          <div className="space-y-2">
            <p className="text-xs text-text-muted uppercase tracking-wide font-medium mb-3">Try asking</p>
            <div className="flex flex-wrap justify-center gap-2">
              {suggestedPrompts.map((prompt, i) => (
                <button
                  key={i}
                  onClick={() => onSuggestedPrompt(prompt)}
                  className="px-3 py-1.5 text-sm text-text-secondary bg-surface-raised border border-border rounded-full hover:border-accent hover:text-accent hover:bg-accent/5 transition-all hover-scale active-press"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function TypingIndicator() {
  return (
    <div className="animate-fade-in-up mb-4">
      <div className="flex gap-3">
        {/* Avatar */}
        <div className="w-7 h-7 rounded-full bg-gradient-to-br from-accent to-accent-hover flex items-center justify-center shrink-0 shadow-sm">
          <svg className="w-4 h-4 text-white" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" />
          </svg>
        </div>

        {/* Typing bubble */}
        <div className="flex items-center gap-2 px-4 py-3 bg-surface-raised border border-border rounded-2xl rounded-bl-md">
          <div className="flex items-center gap-1">
            <span className="w-2 h-2 bg-accent/60 rounded-full typing-dot" />
            <span className="w-2 h-2 bg-accent/60 rounded-full typing-dot" />
            <span className="w-2 h-2 bg-accent/60 rounded-full typing-dot" />
          </div>
          <span className="text-sm text-text-muted animate-pulse-subtle">Thinking...</span>
        </div>
      </div>
    </div>
  )
}

export function MessageList({ messages, isLoading, onSuggestedPrompt }: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isLoading])

  if (messages.length === 0 && !isLoading) {
    return <EmptyState onSuggestedPrompt={onSuggestedPrompt} />
  }

  return (
    <div className="flex-1 overflow-y-auto px-3 py-6 sm:px-4">
      <div className="max-w-3xl mx-auto">
        {messages.map((message) => (
          <ChatMessage key={message.id} message={message} />
        ))}
        {isLoading && <TypingIndicator />}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
