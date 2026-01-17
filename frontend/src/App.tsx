import { useState } from 'react'

interface Message {
  role: 'user' | 'assistant'
  content: string
}

function App() {
  const [result, setResult] = useState<unknown>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Chat state
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [chatLoading, setChatLoading] = useState(false)
  const [chatError, setChatError] = useState<string | null>(null)

  const runSmokeTest = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('http://localhost:8000/test')
      const data = await res.json()
      setResult(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }

  const sendMessage = async () => {
    if (!input.trim() || chatLoading) return

    const userMessage = input.trim()
    setInput('')
    setChatError(null)
    setMessages(prev => [...prev, { role: 'user', content: userMessage }])
    setChatLoading(true)

    try {
      const res = await fetch('http://localhost:8000/llm/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userMessage })
      })
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`)
      }
      const data = await res.json()
      setMessages(prev => [...prev, { role: 'assistant', content: data.message }])
    } catch (e) {
      setChatError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setChatLoading(false)
    }
  }

  return (
    <div style={{ padding: '2rem', fontFamily: 'system-ui', maxWidth: '800px', margin: '0 auto' }}>
      <h1>Sanctum</h1>

      {/* Chat Section */}
      <div style={{ marginBottom: '2rem' }}>
        <h2>Chat</h2>
        <div style={{
          border: '1px solid #ccc',
          borderRadius: '4px',
          height: '300px',
          overflowY: 'auto',
          padding: '1rem',
          marginBottom: '0.5rem',
          background: '#fafafa'
        }}>
          {messages.length === 0 && (
            <p style={{ color: '#888' }}>Send a message to test the LLM provider...</p>
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
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && sendMessage()}
            placeholder="Type a message..."
            style={{ flex: 1, padding: '0.5rem', fontSize: '1rem' }}
            disabled={chatLoading}
          />
          <button onClick={sendMessage} disabled={chatLoading || !input.trim()}>
            Send
          </button>
        </div>
      </div>

      {/* Smoke Test Section */}
      <div>
        <h2>Smoke Test</h2>
        <button onClick={runSmokeTest} disabled={loading}>
          {loading ? 'Running...' : 'Run Smoke Test'}
        </button>
        {error && <p style={{ color: 'red' }}>Error: {error}</p>}
        {result && (
          <pre style={{ background: '#f4f4f4', padding: '1rem', marginTop: '1rem', overflow: 'auto' }}>
            {JSON.stringify(result, null, 2)}
          </pre>
        )}
      </div>
    </div>
  )
}

export default App
