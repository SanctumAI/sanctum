import { useState } from 'react'

const API_BASE = 'http://localhost:8000'

// Shared styles
const cardStyle = {
  border: '1px solid #ddd',
  borderRadius: '8px',
  padding: '1.5rem',
  marginBottom: '1.5rem',
  background: '#fff',
}

const descStyle = {
  color: '#666',
  fontSize: '0.9rem',
  marginBottom: '1rem',
}

const howItWorksStyle = {
  background: '#f8f9fa',
  padding: '0.75rem 1rem',
  borderRadius: '4px',
  fontSize: '0.85rem',
  color: '#555',
  marginBottom: '1rem',
  borderLeft: '3px solid #007bff',
}

const resultStyle = {
  background: '#f4f4f4',
  padding: '1rem',
  borderRadius: '4px',
  overflow: 'auto',
  fontSize: '0.85rem',
  maxHeight: '300px',
}

const buttonStyle = {
  padding: '0.5rem 1rem',
  fontSize: '0.9rem',
  cursor: 'pointer',
  border: '1px solid #007bff',
  background: '#007bff',
  color: '#fff',
  borderRadius: '4px',
}

const buttonDisabledStyle = {
  ...buttonStyle,
  background: '#ccc',
  borderColor: '#ccc',
  cursor: 'not-allowed',
}

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
    <div style={{ padding: '2rem', fontFamily: 'system-ui', maxWidth: '900px', margin: '0 auto', background: '#f5f5f5', minHeight: '100vh' }}>
      <h1 style={{ marginBottom: '0.5rem' }}>Sanctum Test Dashboard</h1>
      <p style={{ color: '#666', marginBottom: '2rem' }}>Test each component of the RAG pipeline</p>

      {/* System Status Row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.5rem' }}>
        {/* Health Check */}
        <div style={cardStyle}>
          <h3 style={{ marginTop: 0 }}>1. Health Check</h3>
          <p style={descStyle}>Checks if Neo4j and Qdrant services are running.</p>
          <div style={howItWorksStyle}>
            <strong>GET /health</strong> — Pings both databases and returns their status.
          </div>
          <button
            onClick={checkHealth}
            disabled={healthLoading}
            style={healthLoading ? buttonDisabledStyle : buttonStyle}
          >
            {healthLoading ? 'Checking...' : 'Check Health'}
          </button>
          {health && (
            <pre style={{ ...resultStyle, marginTop: '1rem' }}>
              {JSON.stringify(health, null, 2)}
            </pre>
          )}
        </div>

        {/* DB Smoke Test */}
        <div style={cardStyle}>
          <h3 style={{ marginTop: 0 }}>2. Database Smoke Test</h3>
          <p style={descStyle}>Verifies seeded test data exists in both databases.</p>
          <div style={howItWorksStyle}>
            <strong>GET /test</strong> — Retrieves the Spanish UDHR claim from Neo4j and its embedding from Qdrant.
          </div>
          <button
            onClick={runDbTest}
            disabled={dbTestLoading}
            style={dbTestLoading ? buttonDisabledStyle : buttonStyle}
          >
            {dbTestLoading ? 'Testing...' : 'Run DB Test'}
          </button>
          {dbTest && (
            <pre style={{ ...resultStyle, marginTop: '1rem' }}>
              {JSON.stringify(dbTest, null, 2)}
            </pre>
          )}
        </div>
      </div>

      {/* LLM Test */}
      <div style={cardStyle}>
        <h3 style={{ marginTop: 0 }}>3. LLM Provider Test</h3>
        <p style={descStyle}>Tests connectivity to the LLM provider (Maple or Ollama).</p>
        <div style={howItWorksStyle}>
          <strong>GET /llm/test</strong> — Sends "Say 'hello'" to the LLM and returns its response. Shows which model and provider are active.
        </div>
        <button
          onClick={runLlmTest}
          disabled={llmTestLoading}
          style={llmTestLoading ? buttonDisabledStyle : buttonStyle}
        >
          {llmTestLoading ? 'Testing LLM...' : 'Test LLM'}
        </button>
        {llmTest && (
          <pre style={{ ...resultStyle, marginTop: '1rem' }}>
            {JSON.stringify(llmTest, null, 2)}
          </pre>
        )}
      </div>

      {/* RAG Query */}
      <div style={cardStyle}>
        <h3 style={{ marginTop: 0 }}>4. RAG Query (Full Pipeline)</h3>
        <p style={descStyle}>The complete RAG pipeline: embed → search → retrieve → generate.</p>
        <div style={howItWorksStyle}>
          <strong>POST /query</strong> — This is where the magic happens:
          <ol style={{ margin: '0.5rem 0 0 1.5rem', padding: 0 }}>
            <li>Embeds your question using the same model as ingestion</li>
            <li>Searches Qdrant for semantically similar knowledge</li>
            <li>Fetches full context from Neo4j (claims + sources)</li>
            <li>Sends context + question to the LLM</li>
            <li>Returns a grounded answer with citations</li>
          </ol>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
          <input
            type="text"
            value={ragInput}
            onChange={e => setRagInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && runRagQuery()}
            placeholder="Ask a question... (try: When was the UDHR adopted?)"
            style={{ flex: 1, padding: '0.5rem', fontSize: '1rem', borderRadius: '4px', border: '1px solid #ccc' }}
            disabled={ragLoading}
          />
          <button
            onClick={runRagQuery}
            disabled={ragLoading || !ragInput.trim()}
            style={ragLoading || !ragInput.trim() ? buttonDisabledStyle : buttonStyle}
          >
            {ragLoading ? 'Querying...' : 'Query'}
          </button>
        </div>
        {ragError && <p style={{ color: 'red', margin: '0.5rem 0' }}>Error: {ragError}</p>}
        {ragResult && (
          <div style={{ marginTop: '1rem' }}>
            <div style={{ background: '#e8f5e9', padding: '1rem', borderRadius: '4px', marginBottom: '1rem' }}>
              <strong>Answer:</strong>
              <p style={{ margin: '0.5rem 0 0 0' }}>{ragResult.answer}</p>
              <p style={{ fontSize: '0.8rem', color: '#666', margin: '0.5rem 0 0 0' }}>
                Model: {ragResult.model} | Provider: {ragResult.provider}
              </p>
            </div>
            {ragResult.citations.length > 0 && (
              <div>
                <strong>Citations:</strong>
                {ragResult.citations.map((c, i) => (
                  <div key={i} style={{ background: '#fff3e0', padding: '0.75rem', borderRadius: '4px', marginTop: '0.5rem', fontSize: '0.9rem' }}>
                    <div><strong>Claim:</strong> {c.claim_text}</div>
                    <div style={{ marginTop: '0.25rem' }}>
                      <strong>Source:</strong> {c.source_title}
                      {c.source_url && (
                        <a href={c.source_url} target="_blank" rel="noopener noreferrer" style={{ marginLeft: '0.5rem', color: '#007bff' }}>
                          [link]
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Direct Chat */}
      <div style={cardStyle}>
        <h3 style={{ marginTop: 0 }}>5. Direct Chat (No RAG)</h3>
        <p style={descStyle}>Direct chat with the LLM. No retrieval, just generation.</p>
        <div style={howItWorksStyle}>
          <strong>POST /llm/chat</strong> — Sends your message directly to the LLM without any knowledge retrieval. Useful for comparing RAG vs non-RAG responses.
        </div>
        <div style={{
          border: '1px solid #ddd',
          borderRadius: '4px',
          height: '200px',
          overflowY: 'auto',
          padding: '1rem',
          marginBottom: '0.5rem',
          background: '#fafafa'
        }}>
          {messages.length === 0 && (
            <p style={{ color: '#888', margin: 0 }}>Send a message to chat directly with the LLM...</p>
          )}
          {messages.map((msg, i) => (
            <div key={i} style={{
              marginBottom: '0.5rem',
              padding: '0.5rem',
              background: msg.role === 'user' ? '#e3f2fd' : '#f5f5f5',
              borderRadius: '4px'
            }}>
              <strong>{msg.role === 'user' ? 'You' : 'Assistant'}:</strong> {msg.content}
            </div>
          ))}
          {chatLoading && (
            <div style={{ color: '#888', fontStyle: 'italic' }}>Thinking...</div>
          )}
        </div>
        {chatError && <p style={{ color: 'red', margin: '0.5rem 0' }}>Error: {chatError}</p>}
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <input
            type="text"
            value={chatInput}
            onChange={e => setChatInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && sendChat()}
            placeholder="Type a message..."
            style={{ flex: 1, padding: '0.5rem', fontSize: '1rem', borderRadius: '4px', border: '1px solid #ccc' }}
            disabled={chatLoading}
          />
          <button
            onClick={sendChat}
            disabled={chatLoading || !chatInput.trim()}
            style={chatLoading || !chatInput.trim() ? buttonDisabledStyle : buttonStyle}
          >
            Send
          </button>
        </div>
      </div>
    </div>
  )
}

export default App
