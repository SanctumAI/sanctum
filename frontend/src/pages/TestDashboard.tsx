import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Sun, Moon, Settings, Upload, Database, User, MessageCircle } from 'lucide-react'
import { useTheme } from '../theme'

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

// Ingestion pipeline interfaces
interface OntologyInfo {
  id: string
  name: string
  description: string
  entity_types: string[]
  relationship_types: string[]
}

interface IngestJob {
  job_id: string
  filename: string
  status: string
  ontology_id: string
  total_chunks: number
  created_at: string
}

interface ChunkInfo {
  chunk_id: string
  job_id: string
  index: number
  text: string
  char_count: number
  status: string
  source_file: string
}

interface IngestStats {
  jobs: { total: number; by_status: Record<string, number> }
  chunks: { total: number; by_status: Record<string, number> }
  ontologies_available: string[]
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
          <Sun className="w-5 h-5 text-text" />
        ) : (
          <Moon className="w-5 h-5 text-text" />
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

export function TestDashboard() {
  // Health check state
  const [health, setHealth] = useState<Record<string, unknown> | null>(null)
  const [healthLoading, setHealthLoading] = useState(false)

  // DB smoke test state
  const [dbTest, setDbTest] = useState<Record<string, unknown> | null>(null)
  const [dbTestLoading, setDbTestLoading] = useState(false)

  // LLM test state
  const [llmTest, setLlmTest] = useState<Record<string, unknown> | null>(null)
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

  // Ingestion pipeline state
  const [ontologies, setOntologies] = useState<OntologyInfo[] | null>(null)
  const [ontologiesLoading, setOntologiesLoading] = useState(false)

  const [selectedOntology, setSelectedOntology] = useState<string>('bitcoin_technical')
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [uploadLoading, setUploadLoading] = useState(false)
  const [uploadResult, setUploadResult] = useState<Record<string, unknown> | null>(null)

  const [jobs, setJobs] = useState<IngestJob[] | null>(null)
  const [jobsLoading, setJobsLoading] = useState(false)

  const [selectedJobId, setSelectedJobId] = useState<string>('')
  const [jobStatus, setJobStatus] = useState<Record<string, unknown> | null>(null)
  const [jobStatusLoading, setJobStatusLoading] = useState(false)

  const [chunks, setChunks] = useState<ChunkInfo[] | null>(null)
  const [chunksLoading, setChunksLoading] = useState(false)

  const [selectedChunkId, setSelectedChunkId] = useState<string>('')
  const [chunkDetail, setChunkDetail] = useState<Record<string, unknown> | null>(null)
  const [chunkLoading, setChunkLoading] = useState(false)

  const [extractionJson, setExtractionJson] = useState<string>('')
  const [extractionResult, setExtractionResult] = useState<Record<string, unknown> | null>(null)
  const [extractionLoading, setExtractionLoading] = useState(false)

  const [storeResult, setStoreResult] = useState<Record<string, unknown> | null>(null)
  const [storeLoading, setStoreLoading] = useState(false)

  const [ingestStats, setIngestStats] = useState<IngestStats | null>(null)
  const [statsLoading, setStatsLoading] = useState(false)

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

  // Ingestion pipeline API calls
  const fetchOntologies = async () => {
    setOntologiesLoading(true)
    try {
      const res = await fetch(`${API_BASE}/ingest/ontologies`)
      const data = await res.json()
      setOntologies(data.ontologies)
    } catch (e) {
      setOntologies(null)
    } finally {
      setOntologiesLoading(false)
    }
  }

  const uploadDocument = async () => {
    if (!uploadFile) return
    setUploadLoading(true)
    setUploadResult(null)
    try {
      const formData = new FormData()
      formData.append('file', uploadFile)
      formData.append('ontology_id', selectedOntology)
      const res = await fetch(`${API_BASE}/ingest/upload`, {
        method: 'POST',
        body: formData,
      })
      setUploadResult(await res.json())
      setUploadFile(null)
      // Auto-refresh jobs after upload
      fetchJobs()
    } catch (e) {
      setUploadResult({ error: e instanceof Error ? e.message : 'Failed' })
    } finally {
      setUploadLoading(false)
    }
  }

  const fetchJobs = async () => {
    setJobsLoading(true)
    try {
      const res = await fetch(`${API_BASE}/ingest/jobs`)
      const data = await res.json()
      setJobs(data.jobs)
    } catch (e) {
      setJobs(null)
    } finally {
      setJobsLoading(false)
    }
  }

  const fetchJobStatus = async (jobId?: string) => {
    const id = jobId || selectedJobId
    if (!id) return
    setJobStatusLoading(true)
    try {
      const res = await fetch(`${API_BASE}/ingest/status/${id}`)
      setJobStatus(await res.json())
    } catch (e) {
      setJobStatus({ error: e instanceof Error ? e.message : 'Failed' })
    } finally {
      setJobStatusLoading(false)
    }
  }

  const fetchPendingChunks = async (jobId?: string) => {
    setChunksLoading(true)
    try {
      const id = jobId || selectedJobId
      const url = id
        ? `${API_BASE}/ingest/pending?job_id=${id}`
        : `${API_BASE}/ingest/pending`
      const res = await fetch(url)
      const data = await res.json()
      setChunks(data.chunks)
    } catch (e) {
      setChunks(null)
    } finally {
      setChunksLoading(false)
    }
  }

  const fetchChunkDetail = async (chunkId?: string) => {
    const id = chunkId || selectedChunkId
    if (!id) return
    setChunkLoading(true)
    try {
      const res = await fetch(`${API_BASE}/ingest/chunk/${id}`)
      setChunkDetail(await res.json())
    } catch (e) {
      setChunkDetail({ error: e instanceof Error ? e.message : 'Failed' })
    } finally {
      setChunkLoading(false)
    }
  }

  const submitExtraction = async () => {
    if (!selectedChunkId || !extractionJson.trim()) return
    setExtractionLoading(true)
    setExtractionResult(null)
    try {
      const parsed = JSON.parse(extractionJson)
      const res = await fetch(`${API_BASE}/ingest/chunk/${selectedChunkId}/extract`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed),
      })
      setExtractionResult(await res.json())
      // Refresh chunks to show updated status
      fetchPendingChunks()
    } catch (e) {
      setExtractionResult({ error: e instanceof Error ? e.message : 'Failed (check JSON syntax)' })
    } finally {
      setExtractionLoading(false)
    }
  }

  const storeToGraph = async () => {
    if (!selectedChunkId) return
    setStoreLoading(true)
    setStoreResult(null)
    try {
      const res = await fetch(`${API_BASE}/ingest/chunk/${selectedChunkId}/store`, {
        method: 'POST',
      })
      setStoreResult(await res.json())
      // Refresh chunks to show updated status
      fetchPendingChunks()
    } catch (e) {
      setStoreResult({ error: e instanceof Error ? e.message : 'Failed' })
    } finally {
      setStoreLoading(false)
    }
  }

  const fetchIngestStats = async () => {
    setStatsLoading(true)
    try {
      const res = await fetch(`${API_BASE}/ingest/stats`)
      setIngestStats(await res.json())
    } catch (e) {
      setIngestStats(null)
    } finally {
      setStatsLoading(false)
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
          <div className="flex items-center gap-3">
            <Link
              to="/admin"
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg font-medium text-text-secondary border border-border hover:bg-surface-overlay hover:text-text transition-colors text-sm"
            >
              <Settings className="w-4 h-4" />
              Admin
            </Link>
            <Link
              to="/admin/upload"
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg font-medium text-text-secondary border border-border hover:bg-surface-overlay hover:text-text transition-colors text-sm"
            >
              <Upload className="w-4 h-4" />
              Upload
            </Link>
            <Link
              to="/admin/database"
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg font-medium text-text-secondary border border-border hover:bg-surface-overlay hover:text-text transition-colors text-sm"
            >
              <Database className="w-4 h-4" />
              Database
            </Link>
            <Link
              to="/login"
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg font-medium text-text-secondary border border-border hover:bg-surface-overlay hover:text-text transition-colors text-sm"
            >
              <User className="w-4 h-4" />
              User Login
            </Link>
            <Link
              to="/chat"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg font-medium bg-accent text-accent-text hover:bg-accent-hover transition-colors"
            >
              <MessageCircle className="w-5 h-5" />
              Open Chat
            </Link>
            <ThemeToggle />
          </div>
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

        {/* Ingestion Pipeline */}
        <Card className="mt-6">
          <h3 className="text-lg font-semibold text-text mb-2">6. Ingestion Pipeline</h3>
          <p className="text-sm text-text-secondary mb-4">
            Document upload, chunking, and manual LLM extraction workflow.
          </p>

          {/* ONTOLOGIES */}
          <div className="mb-6">
            <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-3">Ontologies</p>
            <InfoBox>
              <strong className="text-text">GET /ingest/ontologies</strong> — Lists available ontologies with their entity and relationship types.
            </InfoBox>
            <Button onClick={fetchOntologies} disabled={ontologiesLoading}>
              {ontologiesLoading ? 'Fetching...' : 'Fetch Ontologies'}
            </Button>
            {ontologies && (
              <div className="mt-4 space-y-2">
                {ontologies.map((ont) => (
                  <div key={ont.id} className="bg-surface-overlay rounded-lg p-3">
                    <p className="font-medium text-text">{ont.name} <span className="text-text-muted font-mono text-sm">({ont.id})</span></p>
                    <p className="text-sm text-text-secondary mt-1">{ont.description}</p>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {ont.entity_types.map((t) => (
                        <span key={t} className="text-xs bg-accent-subtle text-accent px-2 py-0.5 rounded">{t}</span>
                      ))}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {ont.relationship_types.map((t) => (
                        <span key={t} className="text-xs bg-surface text-text-muted px-2 py-0.5 rounded border border-border">{t}</span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* UPLOAD DOCUMENT */}
          <div className="border-t border-border pt-6 mb-6">
            <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-3">Upload Document</p>
            <InfoBox>
              <strong className="text-text">POST /ingest/upload</strong> — Upload PDF, TXT, or MD files for processing. Returns a job_id to track progress.
            </InfoBox>
            <div className="flex flex-wrap gap-3 items-center">
              <input
                type="file"
                accept=".pdf,.txt,.md"
                onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
                className="text-sm text-text file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-accent file:text-accent-text file:font-medium file:cursor-pointer hover:file:bg-accent-hover"
              />
              <select
                value={selectedOntology}
                onChange={(e) => setSelectedOntology(e.target.value)}
                className="px-3 py-2 bg-surface border border-border rounded-lg text-text text-sm focus:border-accent focus:ring-1 focus:ring-accent"
              >
                <option value="bitcoin_technical">bitcoin_technical</option>
                <option value="human_rights">human_rights</option>
              </select>
              <Button onClick={uploadDocument} disabled={uploadLoading || !uploadFile}>
                {uploadLoading ? 'Uploading...' : 'Upload'}
              </Button>
            </div>
            {uploadFile && (
              <p className="text-sm text-text-secondary mt-2">Selected: {uploadFile.name}</p>
            )}
            {uploadResult && (
              <div className="mt-4">
                <CodeBlock>{JSON.stringify(uploadResult, null, 2)}</CodeBlock>
              </div>
            )}
          </div>

          {/* JOBS & STATUS */}
          <div className="border-t border-border pt-6 mb-6">
            <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-3">Jobs & Status</p>
            <InfoBox>
              <strong className="text-text">GET /ingest/jobs</strong> — List all ingest jobs. <br />
              <strong className="text-text">GET /ingest/status/&#123;job_id&#125;</strong> — Get detailed status of a specific job.
            </InfoBox>
            <div className="flex gap-3 mb-4">
              <Button onClick={fetchJobs} disabled={jobsLoading}>
                {jobsLoading ? 'Fetching...' : 'Fetch Jobs'}
              </Button>
            </div>
            {jobs && jobs.length > 0 && (
              <div className="overflow-x-auto mb-4">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left py-2 px-2 text-text-muted font-medium">Job ID</th>
                      <th className="text-left py-2 px-2 text-text-muted font-medium">Filename</th>
                      <th className="text-left py-2 px-2 text-text-muted font-medium">Status</th>
                      <th className="text-left py-2 px-2 text-text-muted font-medium">Chunks</th>
                      <th className="text-left py-2 px-2 text-text-muted font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {jobs.map((job) => (
                      <tr key={job.job_id} className="border-b border-border/50">
                        <td className="py-2 px-2 font-mono text-text text-xs">{job.job_id}</td>
                        <td className="py-2 px-2 text-text">{job.filename}</td>
                        <td className="py-2 px-2">
                          <span className={`text-xs px-2 py-0.5 rounded ${
                            job.status === 'chunked' ? 'bg-success-subtle text-success' :
                            job.status === 'failed' ? 'bg-error-subtle text-error' :
                            'bg-warning-subtle text-warning'
                          }`}>
                            {job.status}
                          </span>
                        </td>
                        <td className="py-2 px-2 text-text-secondary">{job.total_chunks}</td>
                        <td className="py-2 px-2">
                          <button
                            onClick={() => {
                              setSelectedJobId(job.job_id)
                              fetchJobStatus(job.job_id)
                              fetchPendingChunks(job.job_id)
                            }}
                            className="text-xs text-accent hover:text-accent-hover underline"
                          >
                            Select
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {jobs && jobs.length === 0 && (
              <p className="text-text-muted text-sm mb-4">No jobs found. Upload a document to create one.</p>
            )}
            {selectedJobId && (
              <div className="flex gap-3 items-center mb-4">
                <span className="text-sm text-text-secondary">Selected Job:</span>
                <code className="text-sm bg-surface-overlay px-2 py-1 rounded font-mono text-text">{selectedJobId}</code>
                <Button variant="secondary" onClick={() => fetchJobStatus()} disabled={jobStatusLoading}>
                  {jobStatusLoading ? 'Checking...' : 'Check Status'}
                </Button>
              </div>
            )}
            {jobStatus && (
              <div className="mt-2">
                <CodeBlock>{JSON.stringify(jobStatus, null, 2)}</CodeBlock>
              </div>
            )}
          </div>

          {/* CHUNKS */}
          <div className="border-t border-border pt-6 mb-6">
            <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-3">Chunks</p>
            <InfoBox>
              <strong className="text-text">GET /ingest/pending</strong> — List all chunks (optionally filtered by job). <br />
              <strong className="text-text">GET /ingest/chunk/&#123;chunk_id&#125;</strong> — Get chunk with full LLM extraction prompt.
            </InfoBox>
            <div className="flex gap-3 mb-4">
              <Button onClick={() => fetchPendingChunks()} disabled={chunksLoading}>
                {chunksLoading ? 'Fetching...' : 'Fetch Chunks'}
              </Button>
              {selectedJobId && (
                <span className="text-sm text-text-muted self-center">(filtered by selected job)</span>
              )}
            </div>
            {chunks && chunks.length > 0 && (
              <div className="space-y-2 mb-4 max-h-48 overflow-y-auto">
                {chunks.map((chunk) => (
                  <div
                    key={chunk.chunk_id}
                    onClick={() => {
                      setSelectedChunkId(chunk.chunk_id)
                      fetchChunkDetail(chunk.chunk_id)
                    }}
                    className={`p-3 rounded-lg border cursor-pointer transition-colors ${
                      selectedChunkId === chunk.chunk_id
                        ? 'border-accent bg-accent-subtle'
                        : 'border-border bg-surface-overlay hover:border-accent/50'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-xs text-text">{chunk.chunk_id}</span>
                      <span className={`text-xs px-2 py-0.5 rounded ${
                        chunk.status === 'stored' ? 'bg-success-subtle text-success' :
                        chunk.status === 'extracted' ? 'bg-info-subtle text-info' :
                        'bg-warning-subtle text-warning'
                      }`}>
                        {chunk.status}
                      </span>
                    </div>
                    <p className="text-xs text-text-secondary mt-1 line-clamp-2">{chunk.text.slice(0, 100)}...</p>
                    <p className="text-xs text-text-muted mt-1">{chunk.char_count} chars | {chunk.source_file}</p>
                  </div>
                ))}
              </div>
            )}
            {chunks && chunks.length === 0 && (
              <p className="text-text-muted text-sm mb-4">No chunks found.</p>
            )}
            {chunkLoading && (
              <p className="text-text-muted text-sm mt-4">Loading chunk details...</p>
            )}
            {chunkDetail && !chunkLoading && (
              <div className="mt-4">
                <p className="text-sm font-medium text-text mb-2">Full LLM Prompt (copy this to your LLM):</p>
                <div className="bg-surface-overlay rounded-lg p-4 overflow-auto max-h-64">
                  <pre className="text-xs font-mono text-text-secondary whitespace-pre-wrap">
                    {(chunkDetail as { full_prompt_for_llm?: string }).full_prompt_for_llm || JSON.stringify(chunkDetail, null, 2)}
                  </pre>
                </div>
                <Button
                  variant="secondary"
                  onClick={() => {
                    const prompt = (chunkDetail as { full_prompt_for_llm?: string }).full_prompt_for_llm
                    if (prompt) navigator.clipboard.writeText(prompt)
                  }}
                >
                  Copy Prompt
                </Button>
              </div>
            )}
          </div>

          {/* EXTRACTION WORKFLOW */}
          <div className="border-t border-border pt-6 mb-6">
            <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-3">Extraction Workflow</p>
            <InfoBox>
              <strong className="text-text">POST /ingest/chunk/&#123;chunk_id&#125;/extract</strong> — Submit LLM extraction results. <br />
              <strong className="text-text">POST /ingest/chunk/&#123;chunk_id&#125;/store</strong> — Commit extraction to Neo4j and Qdrant.
            </InfoBox>
            {!selectedChunkId ? (
              <p className="text-text-muted text-sm">Select a chunk above to begin extraction workflow.</p>
            ) : (
              <div className="space-y-4">
                <div>
                  <p className="text-sm text-text-secondary mb-2">
                    1. Copy the prompt above and send to your LLM
                  </p>
                  <p className="text-sm text-text-secondary mb-2">
                    2. Paste the JSON response below (should have <code className="bg-surface-overlay px-1 rounded">entities</code> and <code className="bg-surface-overlay px-1 rounded">relationships</code> arrays):
                  </p>
                  <textarea
                    value={extractionJson}
                    onChange={(e) => setExtractionJson(e.target.value)}
                    placeholder='{"entities": [...], "relationships": [...]}'
                    className="w-full h-32 px-4 py-3 bg-surface border border-border rounded-lg text-text font-mono text-sm placeholder:text-text-muted focus:border-accent focus:ring-1 focus:ring-accent resize-none"
                  />
                </div>
                <div className="flex gap-3">
                  <Button onClick={submitExtraction} disabled={extractionLoading || !extractionJson.trim()}>
                    {extractionLoading ? 'Submitting...' : '3. Submit Extraction'}
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={storeToGraph}
                    disabled={storeLoading || !extractionResult || 'error' in extractionResult}
                  >
                    {storeLoading ? 'Storing...' : '4. Store to Graph'}
                  </Button>
                </div>
                {extractionResult && (
                  <div className="mt-2">
                    <p className="text-sm font-medium text-text mb-1">Extraction Result:</p>
                    <CodeBlock>{JSON.stringify(extractionResult, null, 2)}</CodeBlock>
                  </div>
                )}
                {storeResult && (
                  <div className="mt-2">
                    <p className="text-sm font-medium text-text mb-1">Store Result:</p>
                    <CodeBlock>{JSON.stringify(storeResult, null, 2)}</CodeBlock>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* PIPELINE STATS */}
          <div className="border-t border-border pt-6">
            <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-3">Pipeline Stats</p>
            <InfoBox>
              <strong className="text-text">GET /ingest/stats</strong> — Overall statistics for jobs and chunks.
            </InfoBox>
            <Button onClick={fetchIngestStats} disabled={statsLoading}>
              {statsLoading ? 'Fetching...' : 'Fetch Stats'}
            </Button>
            {ingestStats && (
              <div className="mt-4 grid md:grid-cols-2 gap-4">
                <div className="bg-surface-overlay rounded-lg p-4">
                  <p className="font-medium text-text mb-2">Jobs</p>
                  <p className="text-2xl font-bold text-accent">{ingestStats.jobs.total}</p>
                  <div className="mt-2 space-y-1">
                    {Object.entries(ingestStats.jobs.by_status).map(([status, count]) => (
                      <div key={status} className="flex justify-between text-sm">
                        <span className="text-text-secondary">{status}</span>
                        <span className="text-text">{count}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="bg-surface-overlay rounded-lg p-4">
                  <p className="font-medium text-text mb-2">Chunks</p>
                  <p className="text-2xl font-bold text-accent">{ingestStats.chunks.total}</p>
                  <div className="mt-2 space-y-1">
                    {Object.entries(ingestStats.chunks.by_status).map(([status, count]) => (
                      <div key={status} className="flex justify-between text-sm">
                        <span className="text-text-secondary">{status}</span>
                        <span className="text-text">{count}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
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
