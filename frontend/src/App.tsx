import { useState } from 'react'
import { useTheme } from './theme'

const API_BASE = 'http://localhost:8000'

interface Message {
  role: 'user' | 'assistant'
  content: string
}

interface Citation {
  claim_id: string
  claim_text: string
  source_title: string
  source_url: string | null
}

interface RAGResponse {
  answer: string
  citations: Citation[]
  model: string
  provider: string
}

function ThemeToggle() {
  const { theme, setTheme, resolvedTheme } = useTheme()

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
        className="p-2 rounded-lg bg-surface-raised border border-border hover:bg-surface-overlay transition-colors"
        aria-label="Toggle theme"
      >
        {resolvedTheme === 'dark' ? (
          <svg className="w-5 h-5 text-text" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
          </svg>
        ) : (
          <svg className="w-5 h-5 text-text" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
          </svg>
        )}
      </button>
      <select
        value={theme}
        onChange={(e) => setTheme(e.target.value as 'light' | 'dark' | 'system')}
        className="text-sm bg-surface-raised border border-border rounded-lg px-2 py-1.5 text-text-secondary focus:border-accent focus:ring-1 focus:ring-accent"
      >
        <option value="system">System</option>
        <option value="light">Light</option>
        <option value="dark">Dark</option>
      </select>
    </div>
  )
}

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-surface-raised border border-border rounded-xl p-6 shadow-sm ${className}`}>
      {children}
    </div>
  )
}

function Button({
  children,
  onClick,
  disabled = false,
  variant = 'primary'
}: {
  children: React.ReactNode
  onClick?: () => void
  disabled?: boolean
  variant?: 'primary' | 'secondary'
}) {
  const baseClasses = "px-4 py-2 rounded-lg font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2 focus:ring-offset-surface"
  const variantClasses = variant === 'primary'
    ? "bg-accent text-accent-text hover:bg-accent-hover disabled:bg-border disabled:text-text-muted disabled:cursor-not-allowed"
    : "bg-surface-raised text-text border border-border hover:bg-surface-overlay disabled:opacity-50 disabled:cursor-not-allowed"

  return (
    <button onClick={onClick} disabled={disabled} className={`${baseClasses} ${variantClasses}`}>
      {children}
    </button>
  )
}

function InfoBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-surface-overlay border-l-4 border-accent rounded-r-lg px-4 py-3 text-sm text-text-secondary mb-4">
      {children}
    </div>
  )
}

function CodeBlock({ children }: { children: React.ReactNode }) {
  return (
    <pre className="bg-surface-overlay rounded-lg p-4 overflow-auto text-sm font-mono text-text-secondary max-h-72">
      {children}
    </pre>
  )
}

function App() {
  // Health check state
  const [health, setHealth] = useState<unknown>(null)
  const [healthLoading, setHealthLoading] = useState(false)

  // DB smoke test state
  const [dbTest, setDbTest] = useState<unknown>(null)
  const [dbTestLoading, setDbTestLoading] = useState(false)

  // LLM test state
  const [llmTest, setLlmTest] = useState<unknown>(null)
  const [llmTestLoading, setLlmTestLoading] = useState(false)

  // RAG query state
  const [ragInput, setRagInput] = useState('')
  const [ragResult, setRagResult] = useState<RAGResponse | null>(null)
  const [ragLoading, setRagLoading] = useState(false)
  const [ragError, setRagError] = useState<string | null>(null)

  // Chat state
  const [messages, setMessages] = useState<Message[]>([])
  const [chatInput, setChatInput] = useState('')
  const [chatLoading, setChatLoading] = useState(false)
  const [chatError, setChatError] = useState<string | null>(null)

  // API calls
  const checkHealth = async () => {
    setHealthLoading(true)
    try {
      const res = await fetch(`${API_BASE}/health`)
      setHealth(await res.json())
    } catch (e) {
      setHealth({ error: e instanceof Error ? e.message : 'Failed' })
    } finally {
      setHealthLoading(false)
    }
  }

  const runDbTest = async () => {
    setDbTestLoading(true)
    try {
      const res = await fetch(`${API_BASE}/test`)
      setDbTest(await res.json())
    } catch (e) {
      setDbTest({ error: e instanceof Error ? e.message : 'Failed' })
    } finally {
      setDbTestLoading(false)
    }
  }

  const runLlmTest = async () => {
    setLlmTestLoading(true)
    try {
      const res = await fetch(`${API_BASE}/llm/test`)
      setLlmTest(await res.json())
    } catch (e) {
      setLlmTest({ error: e instanceof Error ? e.message : 'Failed' })
    } finally {
      setLlmTestLoading(false)
    }
  }

  const runRagQuery = async () => {
    if (!ragInput.trim()) return
    setRagLoading(true)
    setRagError(null)
    try {
      const res = await fetch(`${API_BASE}/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: ragInput.trim() }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setRagResult(await res.json())
    } catch (e) {
      setRagError(e instanceof Error ? e.message : 'Failed')
    } finally {
      setRagLoading(false)
    }
  }

  const sendChat = async () => {
    if (!chatInput.trim() || chatLoading) return
    const userMessage = chatInput.trim()
    setChatInput('')
    setChatError(null)
    setMessages(prev => [...prev, { role: 'user', content: userMessage }])
    setChatLoading(true)
    try {
      const res = await fetch(`${API_BASE}/llm/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userMessage }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setMessages(prev => [...prev, { role: 'assistant', content: data.message }])
    } catch (e) {
      setChatError(e instanceof Error ? e.message : 'Failed')
    } finally {
      setChatLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-surface">
      {/* Header */}
      <header className="border-b border-border bg-surface-raised">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-text">Sanctum</h1>
            <p className="text-sm text-text-muted">Test Dashboard</p>
          </div>
          <ThemeToggle />
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-6xl mx-auto px-6 py-8">
        <p className="text-text-secondary mb-8">Test each component of the RAG pipeline</p>

        {/* System Status Row */}
        <div className="grid md:grid-cols-2 gap-6 mb-6">
          {/* Health Check */}
          <Card>
            <h3 className="text-lg font-semibold text-text mb-2">1. Health Check</h3>
            <p className="text-sm text-text-secondary mb-4">
              Checks if Neo4j and Qdrant services are running.
            </p>
            <InfoBox>
              <strong className="text-text">GET /health</strong> — Pings both databases and returns their status.
            </InfoBox>
            <Button onClick={checkHealth} disabled={healthLoading}>
              {healthLoading ? 'Checking...' : 'Check Health'}
            </Button>
            {health && (
              <div className="mt-4">
                <CodeBlock>{JSON.stringify(health, null, 2)}</CodeBlock>
              </div>
            )}
          </Card>

          {/* DB Smoke Test */}
          <Card>
            <h3 className="text-lg font-semibold text-text mb-2">2. Database Smoke Test</h3>
            <p className="text-sm text-text-secondary mb-4">
              Verifies seeded test data exists in both databases.
            </p>
            <InfoBox>
              <strong className="text-text">GET /test</strong> — Retrieves the Spanish UDHR claim from Neo4j and its embedding from Qdrant.
            </InfoBox>
            <Button onClick={runDbTest} disabled={dbTestLoading}>
              {dbTestLoading ? 'Testing...' : 'Run DB Test'}
            </Button>
            {dbTest && (
              <div className="mt-4">
                <CodeBlock>{JSON.stringify(dbTest, null, 2)}</CodeBlock>
              </div>
            )}
          </Card>
        </div>

        {/* LLM Test */}
        <Card className="mb-6">
          <h3 className="text-lg font-semibold text-text mb-2">3. LLM Provider Test</h3>
          <p className="text-sm text-text-secondary mb-4">
            Tests connectivity to the LLM provider (Maple or Ollama).
          </p>
          <InfoBox>
            <strong className="text-text">GET /llm/test</strong> — Sends "Say 'hello'" to the LLM and returns its response. Shows which model and provider are active.
          </InfoBox>
          <Button onClick={runLlmTest} disabled={llmTestLoading}>
            {llmTestLoading ? 'Testing LLM...' : 'Test LLM'}
          </Button>
          {llmTest && (
            <div className="mt-4">
              <CodeBlock>{JSON.stringify(llmTest, null, 2)}</CodeBlock>
            </div>
          )}
        </Card>

        {/* RAG Query */}
        <Card className="mb-6">
          <h3 className="text-lg font-semibold text-text mb-2">4. RAG Query (Full Pipeline)</h3>
          <p className="text-sm text-text-secondary mb-4">
            The complete RAG pipeline: embed → search → retrieve → generate.
          </p>
          <InfoBox>
            <strong className="text-text">POST /query</strong> — This is where the magic happens:
            <ol className="mt-2 ml-5 list-decimal text-text-secondary">
              <li>Embeds your question using the same model as ingestion</li>
              <li>Searches Qdrant for semantically similar knowledge</li>
              <li>Fetches full context from Neo4j (claims + sources)</li>
              <li>Sends context + question to the LLM</li>
              <li>Returns a grounded answer with citations</li>
            </ol>
          </InfoBox>

          <div className="flex gap-3 mb-4">
            <input
              type="text"
              value={ragInput}
              onChange={e => setRagInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && runRagQuery()}
              placeholder="Ask a question... (try: When was the UDHR adopted?)"
              className="flex-1 px-4 py-2 bg-surface border border-border rounded-lg text-text placeholder:text-text-muted focus:border-accent focus:ring-1 focus:ring-accent transition-colors"
              disabled={ragLoading}
            />
            <Button onClick={runRagQuery} disabled={ragLoading || !ragInput.trim()}>
              {ragLoading ? 'Querying...' : 'Query'}
            </Button>
          </div>

          {ragError && (
            <div className="bg-error-subtle border border-error/20 text-error rounded-lg px-4 py-3 mb-4">
              Error: {ragError}
            </div>
          )}

          {ragResult && (
            <div className="space-y-4">
              {/* Answer */}
              <div className="bg-success-subtle border border-success/20 rounded-lg p-4">
                <p className="font-medium text-success mb-2">Answer:</p>
                <p className="text-text">{ragResult.answer}</p>
                <p className="text-sm text-text-muted mt-2">
                  Model: {ragResult.model} | Provider: {ragResult.provider}
                </p>
              </div>

              {/* Citations */}
              {ragResult.citations.length > 0 && (
                <div>
                  <p className="font-medium text-text mb-2">Citations:</p>
                  <div className="space-y-2">
                    {ragResult.citations.map((c, i) => (
                      <div key={i} className="bg-accent-subtle border border-accent/20 rounded-lg p-4">
                        <p className="text-text">
                          <strong>Claim:</strong> {c.claim_text}
                        </p>
                        <p className="text-text-secondary mt-1">
                          <strong>Source:</strong> {c.source_title}
                          {c.source_url && (
                            <a
                              href={c.source_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="ml-2 text-accent hover:text-accent-hover underline"
                            >
                              [link]
                            </a>
                          )}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </Card>

        {/* Direct Chat */}
        <Card>
          <h3 className="text-lg font-semibold text-text mb-2">5. Direct Chat (No RAG)</h3>
          <p className="text-sm text-text-secondary mb-4">
            Direct chat with the LLM. No retrieval, just generation.
          </p>
          <InfoBox>
            <strong className="text-text">POST /llm/chat</strong> — Sends your message directly to the LLM without any knowledge retrieval. Useful for comparing RAG vs non-RAG responses.
          </InfoBox>

          {/* Chat Messages */}
          <div className="border border-border rounded-lg h-52 overflow-y-auto p-4 mb-4 bg-surface">
            {messages.length === 0 && (
              <p className="text-text-muted">Send a message to chat directly with the LLM...</p>
            )}
            {messages.map((msg, i) => (
              <div
                key={i}
                className={`mb-3 p-3 rounded-lg ${
                  msg.role === 'user'
                    ? 'bg-accent-subtle text-text ml-8'
                    : 'bg-surface-overlay text-text mr-8'
                }`}
              >
                <strong className="text-text-secondary text-sm">
                  {msg.role === 'user' ? 'You' : 'Assistant'}:
                </strong>
                <p className="mt-1">{msg.content}</p>
              </div>
            ))}
            {chatLoading && (
              <div className="text-text-muted italic">Thinking...</div>
            )}
          </div>

          {chatError && (
            <div className="bg-error-subtle border border-error/20 text-error rounded-lg px-4 py-3 mb-4">
              Error: {chatError}
            </div>
          )}

          <div className="flex gap-3">
            <input
              type="text"
              value={chatInput}
              onChange={e => setChatInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && sendChat()}
              placeholder="Type a message..."
              className="flex-1 px-4 py-2 bg-surface border border-border rounded-lg text-text placeholder:text-text-muted focus:border-accent focus:ring-1 focus:ring-accent transition-colors"
              disabled={chatLoading}
            />
            <Button onClick={sendChat} disabled={chatLoading || !chatInput.trim()}>
              Send
            </Button>
          </div>
        </Card>
      </main>

      {/* Footer */}
      <footer className="border-t border-border mt-12">
        <div className="max-w-6xl mx-auto px-6 py-6 text-center text-sm text-text-muted">
          Sanctum — Private RAG System for Curated Knowledge
        </div>
      </footer>
    </div>
  )
}

export default App
