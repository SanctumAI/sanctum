import { useState } from 'react'

function App() {
  const [result, setResult] = useState<unknown>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

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

  return (
    <div style={{ padding: '2rem', fontFamily: 'system-ui' }}>
      <h1>Sanctum</h1>
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
  )
}

export default App
