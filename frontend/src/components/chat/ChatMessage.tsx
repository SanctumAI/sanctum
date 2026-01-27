import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark, oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism'
import type { CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
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
    <div className="w-7 h-7 rounded-full bg-accent/10 flex items-center justify-center shrink-0 ring-1 ring-accent/20">
      <svg className="w-4 h-4 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
      </svg>
    </div>
  )
}

function AssistantIcon() {
  return (
    <div className="w-7 h-7 rounded-full bg-gradient-to-br from-accent to-accent-hover flex items-center justify-center shrink-0 shadow-md ring-1 ring-white/10">
      <svg className="w-4 h-4 text-white" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" />
      </svg>
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
  const isUser = message.role === 'user'

  return (
    <div className="animate-fade-in-up mb-4 last:mb-0">
      <div className={`flex gap-3 ${isUser ? 'flex-row-reverse' : ''}`}>
        {/* Avatar */}
        {isUser ? <UserIcon /> : <AssistantIcon />}

        {/* Content */}
        <div className={`flex-1 min-w-0 ${isUser ? 'flex justify-end' : ''}`}>
          {isUser ? (
            <div className="inline-block max-w-[85%] bg-accent text-accent-text rounded-2xl rounded-tr-md px-4 py-2.5 shadow-md glow-accent">
              <p className="whitespace-pre-wrap text-[15px] leading-relaxed">{message.content}</p>
            </div>
          ) : (
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
          )}
        </div>
      </div>
    </div>
  )
}
