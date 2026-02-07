import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark, oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism'
import type { CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../../theme'
import { useInstanceConfig } from '../../context/InstanceConfigContext'
import { DynamicIcon } from '../shared/DynamicIcon'

export interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp?: Date
}

interface ChatMessageProps {
  message: Message
}

function UserIcon({ iconName }: { iconName: string }) {
  return (
    <div className="w-7 h-7 rounded-full bg-accent/10 flex items-center justify-center shrink-0 ring-1 ring-accent/20">
      <DynamicIcon name={iconName} size={16} className="text-accent" />
    </div>
  )
}

function AssistantIcon({ iconName }: { iconName: string }) {
  return (
    <div className="w-7 h-7 rounded-full bg-gradient-to-br from-accent to-accent-hover flex items-center justify-center shrink-0 shadow-md ring-1 ring-white/10">
      <DynamicIcon name={iconName} size={16} className="text-white" />
    </div>
  )
}

interface CodeBlockProps {
  language: string | null
  children: string
  resolvedTheme: 'light' | 'dark'
}

function CodeBlock({ language, children, resolvedTheme }: CodeBlockProps) {
  const [copied, setCopied] = useState(false)
  const { t } = useTranslation()

  const handleCopy = async () => {
    await navigator.clipboard.writeText(children)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const codeStyle = resolvedTheme === 'dark' ? oneDark : oneLight

  return (
    <div className="my-4 rounded-xl overflow-hidden border border-border shadow-md group">
      <div className="flex items-center justify-between px-4 py-2.5 bg-surface-raised border-b border-border">
        <div className="flex items-center gap-2">
          <span className="label">
            {language || 'code'}
          </span>
        </div>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md
            text-text-muted hover:text-text-secondary hover:bg-surface-overlay
            opacity-0 group-hover:opacity-100 transition-all duration-200
            focus:opacity-100 focus:outline-none focus:ring-2 focus:ring-accent/50"
          aria-label={copied ? t('chat.code.copied') : t('chat.code.copyCode')}
        >
          {copied ? (
            <>
              <svg className="w-3.5 h-3.5 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              <span>{t('chat.code.copied')}</span>
            </>
          ) : (
            <>
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
              <span>{t('chat.code.copy')}</span>
            </>
          )}
        </button>
      </div>
      <SyntaxHighlighter
        style={codeStyle as { [key: string]: CSSProperties }}
        language={language || 'text'}
        PreTag="div"
        showLineNumbers={false}
        customStyle={{
          margin: 0,
          padding: '1rem 1.25rem',
          fontSize: '0.8125rem',
          lineHeight: '1.7',
        }}
      >
        {children}
      </SyntaxHighlighter>
    </div>
  )
}

export function ChatMessage({ message }: ChatMessageProps) {
  const { resolvedTheme } = useTheme()
  const { config } = useInstanceConfig()
  const isUser = message.role === 'user'
  const label = isUser ? config.userLabel : config.assistantName

  const bubbleStyles = {
    soft: {
      user: 'rounded-2xl rounded-tr-md',
      assistant: 'rounded-2xl rounded-tl-md',
    },
    round: {
      user: 'rounded-3xl',
      assistant: 'rounded-3xl',
    },
    square: {
      user: 'rounded-lg',
      assistant: 'rounded-lg',
    },
    pill: {
      user: 'rounded-full',
      assistant: 'rounded-full',
    },
  } as const

  const bubbleRadius = bubbleStyles[config.chatBubbleStyle] || bubbleStyles.soft
  const bubbleShadow = config.chatBubbleShadow ? 'shadow-md' : ''
  const userBubbleClass = `inline-block max-w-[85%] bg-accent text-accent-text px-4 py-2.5 ${bubbleRadius.user} ${bubbleShadow} ${config.chatBubbleShadow ? 'glow-accent' : ''}`
  const assistantBubbleClass = `inline-block max-w-[85%] bg-surface-raised border border-border px-4 py-2.5 ${bubbleRadius.assistant} ${bubbleShadow}`

  return (
    <div className="animate-fade-in-up mb-4 last:mb-0">
      <div className={`flex gap-3 ${isUser ? 'flex-row-reverse' : ''}`}>
        {/* Avatar */}
        {isUser ? (
          <UserIcon iconName={config.userIcon} />
        ) : (
          <AssistantIcon iconName={config.assistantIcon} />
        )}

        {/* Content */}
        <div className={`flex-1 min-w-0 ${isUser ? 'flex flex-col items-end' : 'flex flex-col items-start'}`}>
          {label?.trim() && (
            <div className="text-xs text-text-muted mb-1">{label}</div>
          )}
          {isUser ? (
            <div className={userBubbleClass}>
              <p className="whitespace-pre-wrap text-[15px] leading-relaxed">{message.content}</p>
            </div>
          ) : (
            <div className={assistantBubbleClass}>
              <div className="text-text [&_*]:text-inherit [&_a]:text-accent [&_code]:text-text">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                  code({ node, className, children, ...props }) {
                    const match = /language-(\w+)/.exec(className || '')
                    const isInline = !match && !className

                    if (isInline) {
                      return (
                        <code
                          className="bg-surface-overlay px-1.5 py-0.5 rounded text-[0.875em] font-mono text-text"
                          {...props}
                        >
                          {children}
                        </code>
                      )
                    }

                    return (
                      <CodeBlock
                        language={match ? match[1] : null}
                        resolvedTheme={resolvedTheme}
                      >
                        {String(children).replace(/\n$/, '')}
                      </CodeBlock>
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
                      <blockquote className="my-4 border-l-4 border-border pl-4 text-text-secondary text-[15px] leading-relaxed [&>p]:mb-0">
                        {children}
                      </blockquote>
                    )
                  },
                  em({ children }) {
                    return <em className="italic text-inherit">{children}</em>
                  },
                  h1({ children }) {
                    return <h1 className="text-xl font-semibold mb-3 mt-4 first:mt-0 text-text tracking-tight">{children}</h1>
                  },
                  h2({ children }) {
                    return <h2 className="text-lg font-semibold mb-2 mt-4 first:mt-0 text-text tracking-tight">{children}</h2>
                  },
                  h3({ children }) {
                    return <h3 className="text-base font-semibold mb-2 mt-3 first:mt-0 text-text tracking-tight">{children}</h3>
                  },
                  hr() {
                    return <hr className="my-4 border-border" />
                  },
                  strong({ children }) {
                    return <strong className="font-semibold text-text">{children}</strong>
                  },
                  table({ children }) {
                    return (
                      <div className="my-4 overflow-x-auto rounded-xl border border-border shadow-sm">
                        <table className="min-w-full text-sm divide-y divide-border">
                          {children}
                        </table>
                      </div>
                    )
                  },
                  thead({ children }) {
                    return (
                      <thead className="bg-surface-raised">
                        {children}
                      </thead>
                    )
                  },
                  tbody({ children }) {
                    return (
                      <tbody className="divide-y divide-border bg-surface">
                        {children}
                      </tbody>
                    )
                  },
                  tr({ children }) {
                    return (
                      <tr className="hover:bg-surface-overlay transition-colors duration-150 even:bg-surface-raised/50">
                        {children}
                      </tr>
                    )
                  },
                  th({ children }) {
                    return (
                      <th className="px-4 py-3 text-left text-xs font-semibold text-text uppercase tracking-wider">
                        {children}
                      </th>
                    )
                  },
                  td({ children }) {
                    return (
                      <td className="px-4 py-3 text-text-secondary">
                        {children}
                      </td>
                    )
                  },
                  }}
                >
                  {message.content}
                </ReactMarkdown>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
