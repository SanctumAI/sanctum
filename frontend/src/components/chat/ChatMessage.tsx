import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark, oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism'
import type { CSSProperties } from 'react'
import { useTheme } from '../../theme'

export interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp?: Date
}

interface ChatMessageProps {
  message: Message
}

function UserIcon() {
  return (
    <div className="w-7 h-7 rounded-full bg-accent/10 flex items-center justify-center shrink-0">
      <svg className="w-4 h-4 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
      </svg>
    </div>
  )
}

function AssistantIcon() {
  return (
    <div className="w-7 h-7 rounded-full bg-gradient-to-br from-accent to-accent-hover flex items-center justify-center shrink-0 shadow-sm">
      <svg className="w-4 h-4 text-white" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" />
      </svg>
    </div>
  )
}

export function ChatMessage({ message }: ChatMessageProps) {
  const { resolvedTheme } = useTheme()
  const isUser = message.role === 'user'

  return (
    <div className="animate-fade-in-up mb-4 last:mb-0">
      <div className={`flex gap-3 ${isUser ? 'flex-row-reverse' : ''}`}>
        {/* Avatar */}
        {isUser ? <UserIcon /> : <AssistantIcon />}

        {/* Content */}
        <div className={`flex-1 min-w-0 ${isUser ? 'flex justify-end' : ''}`}>
          {isUser ? (
            <div className="inline-block max-w-[85%] bg-accent text-accent-text rounded-2xl rounded-tr-md px-4 py-2.5 shadow-sm">
              <p className="whitespace-pre-wrap text-[15px] leading-relaxed">{message.content}</p>
            </div>
          ) : (
            <div className="text-text">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  code({ node, className, children, ...props }) {
                    const match = /language-(\w+)/.exec(className || '')
                    const isInline = !match && !className

                    if (isInline) {
                      return (
                        <code
                          className="bg-surface-overlay/80 px-1.5 py-0.5 rounded-md text-sm font-mono text-accent"
                          {...props}
                        >
                          {children}
                        </code>
                      )
                    }

                    const codeStyle = resolvedTheme === 'dark' ? oneDark : oneLight
                    return (
                      <div className="my-3 rounded-xl overflow-hidden border border-border shadow-sm">
                        {match && (
                          <div className="bg-surface-overlay px-4 py-2 text-xs font-medium text-text-secondary border-b border-border flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full bg-text-muted/30" />
                            {match[1]}
                          </div>
                        )}
                        <SyntaxHighlighter
                          style={codeStyle as { [key: string]: CSSProperties }}
                          language={match ? match[1] : 'text'}
                          PreTag="div"
                          customStyle={{
                            margin: 0,
                            padding: '1rem',
                            background: 'var(--color-surface-overlay)',
                            fontSize: '0.8125rem',
                            lineHeight: '1.6',
                          }}
                        >
                          {String(children).replace(/\n$/, '')}
                        </SyntaxHighlighter>
                      </div>
                    )
                  },
                  p({ children }) {
                    return <p className="mb-3 last:mb-0 text-[15px] leading-relaxed">{children}</p>
                  },
                  a({ href, children }) {
                    return (
                      <a
                        href={href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-accent hover:text-accent-hover underline underline-offset-2 decoration-accent/30 hover:decoration-accent transition-colors"
                      >
                        {children}
                      </a>
                    )
                  },
                  ul({ children }) {
                    return <ul className="mb-3 last:mb-0 space-y-1.5 text-[15px]">{children}</ul>
                  },
                  ol({ children }) {
                    return <ol className="mb-3 last:mb-0 space-y-1.5 text-[15px] list-decimal list-inside">{children}</ol>
                  },
                  li({ children }) {
                    return (
                      <li className="flex gap-2 leading-relaxed">
                        <span className="text-accent mt-1.5 text-xs">•</span>
                        <span className="flex-1">{children}</span>
                      </li>
                    )
                  },
                  blockquote({ children }) {
                    return (
                      <blockquote className="my-3 border-l-2 border-accent/50 pl-4 text-text-secondary italic">
                        {children}
                      </blockquote>
                    )
                  },
                  h1({ children }) {
                    return <h1 className="text-xl font-semibold mb-3 mt-4 first:mt-0 text-text">{children}</h1>
                  },
                  h2({ children }) {
                    return <h2 className="text-lg font-semibold mb-2 mt-4 first:mt-0 text-text">{children}</h2>
                  },
                  h3({ children }) {
                    return <h3 className="text-base font-semibold mb-2 mt-3 first:mt-0 text-text">{children}</h3>
                  },
                  hr() {
                    return <hr className="my-4 border-border" />
                  },
                  strong({ children }) {
                    return <strong className="font-semibold text-text">{children}</strong>
                  },
                  table({ children }) {
                    return (
                      <div className="my-3 overflow-x-auto rounded-lg border border-border">
                        <table className="min-w-full text-sm">
                          {children}
                        </table>
                      </div>
                    )
                  },
                  th({ children }) {
                    return (
                      <th className="bg-surface-overlay px-4 py-2.5 text-left font-medium text-text border-b border-border">
                        {children}
                      </th>
                    )
                  },
                  td({ children }) {
                    return (
                      <td className="px-4 py-2.5 text-text-secondary border-b border-border last:border-b-0">
                        {children}
                      </td>
                    )
                  },
                }}
              >
                {message.content}
              </ReactMarkdown>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
