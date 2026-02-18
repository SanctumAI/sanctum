import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Sun, Moon, Settings, Database, ChevronDown, Key, Shield, Users, Sliders, FileText, Zap, Lock, Unlock } from 'lucide-react'
import { useTheme } from '../theme'
import {
  API_BASE,
  AdminResponse,
  InstanceSettingsResponse,
  MagicLinkResponse,
  SessionCheckResponse,
  TableInfo,
  DBQueryResponse,
  FieldDefinitionResponse
} from '../types/onboarding'
import { authenticateWithNostr, hasNostrExtension, AuthResult } from '../utils/nostrAuth'
import { adminFetch as baseAdminFetch, clearAdminAuth, isAdminAuthenticated } from '../utils/adminApi'
import {
  decryptField,
  decryptUser,
  decryptUsers,
  formatEncryptedValue,
  type DecryptedUser,
  type UserWithEncryption
} from '../utils/encryption'
import { normalizePubkey } from '../utils/nostrKeys'

interface Message {
  role: 'user' | 'assistant'
  content: string
}

interface RAGSource {
  score: number
  type: string
  text: string
  chunk_id: string
  source_file: string
}

interface RAGResponse {
  answer: string
  session_id: string
  sources: RAGSource[]
  graph_context: Record<string, string[]>
  clarifying_questions: string[]
  search_term: string | null
  context_used: string
  temperature: number
}

// Ingestion pipeline interfaces
interface IngestJob {
  job_id: string
  filename: string
  status: string
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
}

// Vector Search interfaces
interface VectorSearchResultItem {
  id: string
  score: number
  payload: Record<string, unknown>
}

interface VectorSearchResponse {
  results: VectorSearchResultItem[]
  query_embedding_dim: number
  collection: string
}

// User onboarding interfaces
interface UserType {
  id: number
  name: string
  description: string | null
  display_order: number
}

interface FieldDefinition {
  id: number
  field_name: string
  field_type: string
  required: boolean
  display_order: number
  user_type_id: number | null
}

// Neo4j query interfaces
interface Neo4jQueryResult {
  success: boolean
  columns: string[]
  rows: Record<string, unknown>[]
  error?: string
}

function ThemeToggle() {
  const { t } = useTranslation()
  const { theme, setTheme, resolvedTheme } = useTheme()

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
        className="p-2 rounded-lg bg-surface-raised border border-border hover:bg-surface-overlay transition-colors"
        aria-label={t('testDashboard.extracted.toggle_theme_9b0eaf', 'Toggle theme')}
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

function CollapsibleSection({
  title,
  moduleNumber,
  defaultOpen = false,
  badge,
  icon: Icon,
  children
}: {
  title: string
  moduleNumber: number
  defaultOpen?: boolean
  badge?: string
  icon?: React.ComponentType<{ className?: string }>
  children: React.ReactNode
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen)

  return (
    <Card className="mb-6">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between text-left"
      >
        <div className="flex items-center gap-2">
          {Icon && <Icon className="w-5 h-5 text-accent" />}
          <span className="text-lg font-semibold text-text">
            {moduleNumber}. {title}
          </span>
          {badge && (
            <span className="text-xs px-2 py-0.5 rounded bg-accent-subtle text-accent">
              {badge}
            </span>
          )}
        </div>
        <ChevronDown className={`w-5 h-5 text-text-muted transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>
      {isOpen && <div className="mt-4 pt-4 border-t border-border">{children}</div>}
    </Card>
  )
}

function SectionHeader({ title, icon: Icon }: { title: string; icon?: React.ComponentType<{ className?: string }> }) {
  return (
    <div className="flex items-center gap-2 mb-4 mt-8">
      {Icon && <Icon className="w-5 h-5 text-accent" />}
      <h2 className="text-xl font-bold text-text">{title}</h2>
    </div>
  )
}

function StatusBadge({ status }: { status: 'success' | 'warning' | 'error' | 'info' }) {
  const classes = {
    success: 'bg-success-subtle text-success',
    warning: 'bg-warning-subtle text-warning',
    error: 'bg-error-subtle text-error',
    info: 'bg-accent-subtle text-accent'
  }
  return (
    <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded ${classes[status]}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${status === 'success' ? 'bg-success' : status === 'warning' ? 'bg-warning' : status === 'error' ? 'bg-error' : 'bg-accent'}`} />
      {status}
    </span>
  )
}

export function TestDashboard() {
  const { t } = useTranslation()
  const navigate = useNavigate()

  // Admin guard - redirect non-admins to home
  useEffect(() => {
    if (!isAdminAuthenticated()) {
      navigate('/')
    }
  }, [navigate])

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

  // Vector search state
  const [vectorQuery, setVectorQuery] = useState('')
  const [vectorTopK, setVectorTopK] = useState(5)
  const [vectorCollection, setVectorCollection] = useState('sanctum_smoke_test')
  const [vectorResults, setVectorResults] = useState<VectorSearchResponse | null>(null)
  const [vectorLoading, setVectorLoading] = useState(false)

  // User onboarding test state
  const [userTypes, setUserTypes] = useState<UserType[] | null>(null)
  const [userTypesLoading, setUserTypesLoading] = useState(false)
  const [selectedUserTypeId, setSelectedUserTypeId] = useState<number | null>(null)
  const [fieldDefinitions, setFieldDefinitions] = useState<FieldDefinition[] | null>(null)
  const [userFields, setUserFields] = useState<Record<string, string>>({})
  const [testPubkey, setTestPubkey] = useState('')
  const [testEmail, setTestEmail] = useState('')
  const [testName, setTestName] = useState('')
  const [createUserResult, setCreateUserResult] = useState<Record<string, unknown> | null>(null)
  const [createUserLoading, setCreateUserLoading] = useState(false)

  // Neo4j query state
  const [cypherQuery, setCypherQuery] = useState('MATCH (n) RETURN n LIMIT 10')
  const [neo4jResult, setNeo4jResult] = useState<Neo4jQueryResult | null>(null)
  const [neo4jLoading, setNeo4jLoading] = useState(false)

  // === NEW MODULE STATE ===

  // Admin session state (shared across admin modules)
  const [adminToken, setAdminToken] = useState<string>('')
  const [, setAdminPubkey] = useState<string>('')

  const adminFetch = (endpoint: string, options: RequestInit = {}): Promise<Response> => {
    const headers = new Headers(options.headers)
    const authToken = adminToken.trim()
    if (authToken && !headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${authToken}`)
    }
    return baseAdminFetch(endpoint, { ...options, headers })
  }

  // Module 10: Authentication Testing state
  const [magicLinkEmail, setMagicLinkEmail] = useState('')
  const [magicLinkName, setMagicLinkName] = useState('')
  const [magicLinkResult, setMagicLinkResult] = useState<MagicLinkResponse | null>(null)
  const [magicLinkLoading, setMagicLinkLoading] = useState(false)

  const [verifyToken, setVerifyToken] = useState('')
  const [verifyResult, setVerifyResult] = useState<Record<string, unknown> | null>(null)
  const [verifyLoading, setVerifyLoading] = useState(false)

  const [sessionCheckToken, setSessionCheckToken] = useState('')
  const [sessionCheckResult, setSessionCheckResult] = useState<SessionCheckResponse | null>(null)
  const [sessionCheckLoading, setSessionCheckLoading] = useState(false)

  const [nostrAuthLoading, setNostrAuthLoading] = useState(false)
  const [nostrAuthResult, setNostrAuthResult] = useState<AuthResult | null>(null)
  const [nostrAuthError, setNostrAuthError] = useState<string | null>(null)

  const [adminsList, setAdminsList] = useState<AdminResponse[] | null>(null)
  const [adminsLoading, setAdminsLoading] = useState(false)
  const [removeAdminPubkey, setRemoveAdminPubkey] = useState('')
  const [removeAdminLoading, setRemoveAdminLoading] = useState(false)
  const [removeAdminResult, setRemoveAdminResult] = useState<Record<string, unknown> | null>(null)

  // Module 11: Instance Settings state
  const [instanceSettings, setInstanceSettings] = useState<Record<string, string> | null>(null)
  const [settingsLoading, setSettingsLoading] = useState(false)
  const [settingsForm, setSettingsForm] = useState<Record<string, string>>({})
  const [saveSettingsLoading, setSaveSettingsLoading] = useState(false)
  const [saveSettingsResult, setSaveSettingsResult] = useState<Record<string, unknown> | null>(null)

  // Module 12: User Type Management state
  const [adminUserTypes, setAdminUserTypes] = useState<UserType[] | null>(null)
  const [adminUserTypesLoading, setAdminUserTypesLoading] = useState(false)
  const [newTypeName, setNewTypeName] = useState('')
  const [newTypeDescription, setNewTypeDescription] = useState('')
  const [newTypeOrder, setNewTypeOrder] = useState(0)
  const [createTypeLoading, setCreateTypeLoading] = useState(false)
  const [createTypeResult, setCreateTypeResult] = useState<Record<string, unknown> | null>(null)
  const [editingTypeId, setEditingTypeId] = useState<number | null>(null)
  const [editTypeName, setEditTypeName] = useState('')
  const [editTypeDescription, setEditTypeDescription] = useState('')
  const [editTypeOrder, setEditTypeOrder] = useState(0)
  const [updateTypeLoading, setUpdateTypeLoading] = useState(false)
  const [deleteTypeLoading, setDeleteTypeLoading] = useState(false)

  // Module 13: User Field Definitions state
  const [adminFieldDefs, setAdminFieldDefs] = useState<FieldDefinitionResponse[] | null>(null)
  const [fieldDefsLoading, setFieldDefsLoading] = useState(false)
  const [fieldTypeFilter, setFieldTypeFilter] = useState<number | string>('all')
  const [newFieldName, setNewFieldName] = useState('')
  const [newFieldType, setNewFieldType] = useState('text')
  const [newFieldRequired, setNewFieldRequired] = useState(false)
  const [newFieldOrder, setNewFieldOrder] = useState(0)
  const [newFieldUserTypeId, setNewFieldUserTypeId] = useState<number | string>('global')
  const [createFieldLoading, setCreateFieldLoading] = useState(false)
  const [createFieldResult, setCreateFieldResult] = useState<Record<string, unknown> | null>(null)
  const [deleteFieldLoading, setDeleteFieldLoading] = useState(false)

  // Module 14: User Management state
  const [allUsers, setAllUsers] = useState<DecryptedUser[] | null>(null)
  const [usersLoading, setUsersLoading] = useState(false)
  const [lookupUserId, setLookupUserId] = useState('')
  const [singleUser, setSingleUser] = useState<DecryptedUser | null>(null)
  const [lookupLoading, setLookupLoading] = useState(false)
  const [updateUserLoading, setUpdateUserLoading] = useState(false)
  const [updateUserResult, setUpdateUserResult] = useState<Record<string, unknown> | null>(null)
  const [deleteUserLoading, setDeleteUserLoading] = useState(false)

  // Module 15: Database Explorer state
  const [dbTables, setDbTables] = useState<TableInfo[] | null>(null)
  const [dbTablesLoading, setDbTablesLoading] = useState(false)
  const [selectedDbTable, setSelectedDbTable] = useState<string | null>(null)
  const [tableData, setTableData] = useState<{ columns: string[]; rows: Record<string, unknown>[] } | null>(null)
  const [tableDataLoading, setTableDataLoading] = useState(false)
  const [dbQuery, setDbQuery] = useState('SELECT * FROM users LIMIT 10')
  const [dbQueryResult, setDbQueryResult] = useState<DBQueryResponse | null>(null)
  const [dbQueryLoading, setDbQueryLoading] = useState(false)
  // Decrypted values for Database Explorer: maps rowIndex -> { columnName -> decryptedValue }
  const [decryptedTableData, setDecryptedTableData] = useState<Record<number, Record<string, string>>>({})
  const [decryptedQueryData, setDecryptedQueryData] = useState<Record<number, Record<string, string>>>({})

  // Module 16: Rate Limiting Test state
  const [rateLimitTestType, setRateLimitTestType] = useState<'magic_link' | 'admin_auth'>('magic_link')
  const [rateLimitResults, setRateLimitResults] = useState<{ success: number; blocked: number; responses: string[] }>({ success: 0, blocked: 0, responses: [] })
  const [rateLimitTesting, setRateLimitTesting] = useState(false)

  // Decrypt table data when it loads (for Database Explorer)
  useEffect(() => {
    if (!tableData) {
      setDecryptedTableData({})
      return
    }

    let cancelled = false

    const decryptTableRows = async () => {
      const decrypted: Record<number, Record<string, string>> = {}

      for (let i = 0; i < tableData.rows.length; i++) {
        if (cancelled) return
        const row = tableData.rows[i]
        decrypted[i] = {}

        for (const col of tableData.columns) {
          if (cancelled) return
          if (col.startsWith('encrypted_')) {
            const fieldName = col.replace('encrypted_', '')
            const ephemeralCol = `ephemeral_pubkey_${fieldName}`
            const ciphertext = row[col] as string | null
            // Try field-specific key first, then fall back to generic ephemeral_pubkey
            const ephemeralPubkey = (row[ephemeralCol] as string | null) ?? (row['ephemeral_pubkey'] as string | null)

            if (ciphertext && ephemeralPubkey) {
              try {
                const result = await decryptField({ ciphertext, ephemeral_pubkey: ephemeralPubkey })
                decrypted[i][col] = result ?? '[Encrypted]'
              } catch {
                decrypted[i][col] = '[Encrypted - Error]'
              }
            } else if (ciphertext) {
              decrypted[i][col] = '[Encrypted - Missing Key]'
            }
          }
        }
      }
      if (!cancelled) {
        setDecryptedTableData(decrypted)
      }
    }

    decryptTableRows()

    return () => {
      cancelled = true
    }
  }, [tableData])

  // Decrypt query result data when it loads (for Quick Query)
  useEffect(() => {
    if (!dbQueryResult || dbQueryResult.error) {
      setDecryptedQueryData({})
      return
    }

    let cancelled = false

    const decryptQueryRows = async () => {
      const decrypted: Record<number, Record<string, string>> = {}

      for (let i = 0; i < dbQueryResult.rows.length; i++) {
        if (cancelled) return
        const row = dbQueryResult.rows[i]
        decrypted[i] = {}

        for (const col of dbQueryResult.columns) {
          if (cancelled) return
          if (col.startsWith('encrypted_')) {
            const fieldName = col.replace('encrypted_', '')
            const ephemeralCol = `ephemeral_pubkey_${fieldName}`
            const ciphertext = row[col] as string | null
            // Try field-specific key first, then fall back to generic ephemeral_pubkey
            const ephemeralPubkey = (row[ephemeralCol] as string | null) ?? (row['ephemeral_pubkey'] as string | null)

            if (ciphertext && ephemeralPubkey) {
              try {
                const result = await decryptField({ ciphertext, ephemeral_pubkey: ephemeralPubkey })
                decrypted[i][col] = result ?? '[Encrypted]'
              } catch {
                decrypted[i][col] = '[Encrypted - Error]'
              }
            } else if (ciphertext) {
              decrypted[i][col] = '[Encrypted - Missing Key]'
            }
          }
        }
      }
      if (!cancelled) {
        setDecryptedQueryData(decrypted)
      }
    }

    decryptQueryRows()

    return () => {
      cancelled = true
    }
  }, [dbQueryResult])

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
        headers: {
          'Content-Type': 'application/json',
          ...(adminToken && { 'Authorization': `Bearer ${adminToken}` })
        },
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
        headers: {
          'Content-Type': 'application/json',
          ...(adminToken && { 'Authorization': `Bearer ${adminToken}` })
        },
        credentials: 'include',
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
  const uploadDocument = async () => {
    if (!uploadFile) return
    setUploadLoading(true)
    setUploadResult(null)
    try {
      const formData = new FormData()
      formData.append('file', uploadFile)
      const res = await adminFetch('/ingest/upload', {
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
      const res = await adminFetch('/ingest/jobs')
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
      const res = await adminFetch(`/ingest/status/${id}`)
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
      const endpoint = id
        ? `/ingest/pending?job_id=${id}`
        : '/ingest/pending'
      const res = await adminFetch(endpoint)
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
      const res = await adminFetch(`/ingest/chunk/${id}`)
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
      const res = await adminFetch(`/ingest/chunk/${selectedChunkId}/extract`, {
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
      const res = await adminFetch(`/ingest/chunk/${selectedChunkId}/store`, {
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
      const res = await adminFetch('/ingest/stats')
      setIngestStats(await res.json())
    } catch (e) {
      setIngestStats(null)
    } finally {
      setStatsLoading(false)
    }
  }

  // Vector search API call
  const runVectorSearch = async () => {
    if (!vectorQuery.trim()) return
    setVectorLoading(true)
    setVectorResults(null)
    try {
      const res = await adminFetch('/vector-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: vectorQuery.trim(),
          top_k: vectorTopK,
          collection: vectorCollection
        })
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setVectorResults(await res.json())
    } catch (e) {
      setVectorResults({ results: [], query_embedding_dim: 0, collection: vectorCollection })
    } finally {
      setVectorLoading(false)
    }
  }

  // User onboarding API calls
  const fetchUserTypes = async () => {
    setUserTypesLoading(true)
    try {
      const res = await fetch(`${API_BASE}/user-types`)
      const data = await res.json()
      setUserTypes(data.types)
    } catch (e) {
      setUserTypes(null)
    } finally {
      setUserTypesLoading(false)
    }
  }

  const fetchFieldDefinitions = async (typeId: number | null) => {
    try {
      const url = typeId
        ? `${API_BASE}/admin/user-fields?user_type_id=${typeId}`
        : `${API_BASE}/admin/user-fields`
      const res = await fetch(url, {
        headers: {
          ...(adminToken && { 'Authorization': `Bearer ${adminToken}` })
        }
      })
      const data = await res.json()
      setFieldDefinitions(data.fields)
      // Reset field values when type changes
      setUserFields({})
    } catch (e) {
      setFieldDefinitions(null)
    }
  }

  const createTestUser = async () => {
    if (!testPubkey.trim()) return
    setCreateUserLoading(true)
    setCreateUserResult(null)
    try {
      let normalizedPubkey = ''
      try {
        normalizedPubkey = normalizePubkey(testPubkey)
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Invalid pubkey'
        setCreateUserResult({ error: message })
        setCreateUserLoading(false)
        return
      }

      const authToken = adminToken.trim() || null
      const res = await fetch(`${API_BASE}/users`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken && { 'Authorization': `Bearer ${authToken}` }),
        },
        credentials: 'include',
        body: JSON.stringify({
          pubkey: normalizedPubkey,
          email: testEmail || undefined,
          name: testName || undefined,
          user_type_id: selectedUserTypeId,
          fields: userFields
        })
      })
      setCreateUserResult(await res.json())
    } catch (e) {
      setCreateUserResult({ error: e instanceof Error ? e.message : 'Failed' })
    } finally {
      setCreateUserLoading(false)
    }
  }

  // Neo4j query API call
  const runNeo4jQuery = async () => {
    if (!cypherQuery.trim()) return
    setNeo4jLoading(true)
    setNeo4jResult(null)
    try {
      const res = await fetch(`${API_BASE}/admin/neo4j/query`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(adminToken && { 'Authorization': `Bearer ${adminToken}` })
        },
        body: JSON.stringify({ cypher: cypherQuery.trim() })
      })
      setNeo4jResult(await res.json())
    } catch (e) {
      setNeo4jResult({ success: false, columns: [], rows: [], error: e instanceof Error ? e.message : 'Failed' })
    } finally {
      setNeo4jLoading(false)
    }
  }

  // === NEW MODULE API CALLS ===

  // Admin session helpers
  const saveAdminSession = (token: string, pubkey: string) => {
    setAdminToken(token)
    setAdminPubkey(pubkey)
  }

  const clearAdminSession = () => {
    clearAdminAuth()
    setAdminToken('')
    setAdminPubkey('')
  }

  // Module 10: Authentication API calls
  const sendMagicLink = async () => {
    if (!magicLinkEmail.trim()) return
    setMagicLinkLoading(true)
    setMagicLinkResult(null)
    try {
      const res = await fetch(`${API_BASE}/auth/magic-link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: magicLinkEmail.trim(), name: magicLinkName.trim() || null })
      })
      const data = await res.json()
      if (!res.ok) {
        setMagicLinkResult({ success: false, message: data.detail || `HTTP ${res.status}` })
      } else {
        setMagicLinkResult(data)
      }
    } catch (e) {
      setMagicLinkResult({ success: false, message: e instanceof Error ? e.message : 'Failed' })
    } finally {
      setMagicLinkLoading(false)
    }
  }

  const verifyMagicLink = async () => {
    if (!verifyToken.trim()) return
    setVerifyLoading(true)
    setVerifyResult(null)
    try {
      const res = await fetch(`${API_BASE}/auth/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ token: verifyToken.trim() }),
      })
      setVerifyResult(await res.json())
    } catch (e) {
      setVerifyResult({ error: e instanceof Error ? e.message : 'Failed' })
    } finally {
      setVerifyLoading(false)
    }
  }

  const checkAuthStatus = async () => {
    setSessionCheckLoading(true)
    setSessionCheckResult(null)
    try {
      const headers: HeadersInit = {}
      if (sessionCheckToken.trim()) {
        headers.Authorization = `Bearer ${sessionCheckToken.trim()}`
      }
      const res = await fetch(`${API_BASE}/auth/me`, {
        headers,
        credentials: 'include',
      })
      setSessionCheckResult(await res.json())
    } catch (e) {
      setSessionCheckResult({ authenticated: false, user: null })
    } finally {
      setSessionCheckLoading(false)
    }
  }

  const authenticateAdmin = async () => {
    setNostrAuthLoading(true)
    setNostrAuthResult(null)
    setNostrAuthError(null)
    try {
      const result = await authenticateWithNostr()
      setNostrAuthResult(result)
      saveAdminSession(result.session_token, result.admin.pubkey)
    } catch (e) {
      setNostrAuthError(e instanceof Error ? e.message : 'Failed')
    } finally {
      setNostrAuthLoading(false)
    }
  }

  const fetchAdmins = async () => {
    setAdminsLoading(true)
    setAdminsList(null)
    try {
      const res = await adminFetch('/admin/list')
      const data = await res.json()
      setAdminsList(data.admins)
    } catch (e) {
      setAdminsList(null)
    } finally {
      setAdminsLoading(false)
    }
  }

  const removeAdmin = async () => {
    if (!removeAdminPubkey.trim()) return
    setRemoveAdminLoading(true)
    setRemoveAdminResult(null)
    try {
      let normalizedPubkey = ''
      try {
        normalizedPubkey = normalizePubkey(removeAdminPubkey)
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Invalid pubkey'
        setRemoveAdminResult({ error: message })
        setRemoveAdminLoading(false)
        return
      }

      const res = await adminFetch(`/admin/${normalizedPubkey}`, { method: 'DELETE' })
      setRemoveAdminResult(await res.json())
      // Refresh admins list
      fetchAdmins()
    } catch (e) {
      setRemoveAdminResult({ error: e instanceof Error ? e.message : 'Failed' })
    } finally {
      setRemoveAdminLoading(false)
    }
  }

  // Module 11: Instance Settings API calls
  const fetchInstanceSettings = async () => {
    setSettingsLoading(true)
    setInstanceSettings(null)
    try {
      const res = await adminFetch('/admin/settings')
      const data: InstanceSettingsResponse = await res.json()
      setInstanceSettings(data.settings)
      setSettingsForm(data.settings)
    } catch (e) {
      setInstanceSettings(null)
    } finally {
      setSettingsLoading(false)
    }
  }

  const saveInstanceSettings = async () => {
    setSaveSettingsLoading(true)
    setSaveSettingsResult(null)
    try {
      const res = await adminFetch('/admin/settings', {
        method: 'PUT',
        body: JSON.stringify({ settings: settingsForm })
      })
      const data = await res.json()
      setSaveSettingsResult(data)
      setInstanceSettings(settingsForm)
    } catch (e) {
      setSaveSettingsResult({ error: e instanceof Error ? e.message : 'Failed' })
    } finally {
      setSaveSettingsLoading(false)
    }
  }

  // Module 12: User Type Management API calls
  const fetchAdminUserTypes = async () => {
    setAdminUserTypesLoading(true)
    setAdminUserTypes(null)
    try {
      const res = await adminFetch('/admin/user-types')
      const data = await res.json()
      setAdminUserTypes(data.types)
    } catch (e) {
      setAdminUserTypes(null)
    } finally {
      setAdminUserTypesLoading(false)
    }
  }

  const createUserType = async () => {
    if (!newTypeName.trim()) return
    setCreateTypeLoading(true)
    setCreateTypeResult(null)
    try {
      const res = await adminFetch('/admin/user-types', {
        method: 'POST',
        body: JSON.stringify({
          name: newTypeName.trim(),
          description: newTypeDescription.trim() || null,
          display_order: newTypeOrder
        })
      })
      setCreateTypeResult(await res.json())
      setNewTypeName('')
      setNewTypeDescription('')
      setNewTypeOrder(0)
      fetchAdminUserTypes()
    } catch (e) {
      setCreateTypeResult({ error: e instanceof Error ? e.message : 'Failed' })
    } finally {
      setCreateTypeLoading(false)
    }
  }

  const updateUserType = async () => {
    if (!editingTypeId || !editTypeName.trim()) return
    setUpdateTypeLoading(true)
    try {
      await adminFetch(`/admin/user-types/${editingTypeId}`, {
        method: 'PUT',
        body: JSON.stringify({
          name: editTypeName.trim(),
          description: editTypeDescription.trim() || null,
          display_order: editTypeOrder
        })
      })
      setEditingTypeId(null)
      fetchAdminUserTypes()
    } catch (e) {
      // Handle error silently or add error state
    } finally {
      setUpdateTypeLoading(false)
    }
  }

  const deleteUserType = async (typeId: number) => {
    setDeleteTypeLoading(true)
    try {
      await adminFetch(`/admin/user-types/${typeId}`, { method: 'DELETE' })
      fetchAdminUserTypes()
    } catch (e) {
      // Handle error
    } finally {
      setDeleteTypeLoading(false)
    }
  }

  // Module 13: User Field Definitions API calls
  const fetchAdminFieldDefs = async () => {
    setFieldDefsLoading(true)
    setAdminFieldDefs(null)
    try {
      const url = fieldTypeFilter === 'all'
        ? '/admin/user-fields'
        : fieldTypeFilter === 'global'
          ? '/admin/user-fields?user_type_id=null'
          : `/admin/user-fields?user_type_id=${fieldTypeFilter}`
      const res = await adminFetch(url)
      const data = await res.json()
      setAdminFieldDefs(data.fields)
    } catch (e) {
      setAdminFieldDefs(null)
    } finally {
      setFieldDefsLoading(false)
    }
  }

  const createFieldDef = async () => {
    if (!newFieldName.trim()) return
    setCreateFieldLoading(true)
    setCreateFieldResult(null)
    try {
      const res = await adminFetch('/admin/user-fields', {
        method: 'POST',
        body: JSON.stringify({
          field_name: newFieldName.trim(),
          field_type: newFieldType,
          required: newFieldRequired,
          display_order: newFieldOrder,
          user_type_id: newFieldUserTypeId === 'global' ? null : Number(newFieldUserTypeId)
        })
      })
      setCreateFieldResult(await res.json())
      setNewFieldName('')
      setNewFieldType('text')
      setNewFieldRequired(false)
      setNewFieldOrder(0)
      setNewFieldUserTypeId('global')
      fetchAdminFieldDefs()
    } catch (e) {
      setCreateFieldResult({ error: e instanceof Error ? e.message : 'Failed' })
    } finally {
      setCreateFieldLoading(false)
    }
  }

  const deleteFieldDef = async (fieldId: number) => {
    setDeleteFieldLoading(true)
    try {
      await adminFetch(`/admin/user-fields/${fieldId}`, { method: 'DELETE' })
      fetchAdminFieldDefs()
    } catch (e) {
      // Handle error
    } finally {
      setDeleteFieldLoading(false)
    }
  }

  // Module 14: User Management API calls
  const fetchAllUsers = async () => {
    setUsersLoading(true)
    setAllUsers(null)
    try {
      const res = await adminFetch('/admin/users')
      const data = await res.json()
      const decrypted = await decryptUsers(data.users as UserWithEncryption[])
      setAllUsers(decrypted)
    } catch (e) {
      setAllUsers(null)
    } finally {
      setUsersLoading(false)
    }
  }

  const lookupUser = async () => {
    if (!lookupUserId.trim()) return
    setLookupLoading(true)
    setSingleUser(null)
    try {
      const authToken = adminToken.trim() || null
      const res = await fetch(`${API_BASE}/users/${lookupUserId.trim()}`, {
        headers: {
          ...(authToken && { 'Authorization': `Bearer ${authToken}` }),
        },
        credentials: 'include',
      })
      if (res.ok) {
        const data = await res.json()
        const raw = (data.user ?? data) as UserWithEncryption
        const decrypted = await decryptUser(raw)
        setSingleUser(decrypted)
      } else {
        setSingleUser(null)
      }
    } catch (e) {
      setSingleUser(null)
    } finally {
      setLookupLoading(false)
    }
  }

  const updateUser = async (userId: number, approved: boolean) => {
    setUpdateUserLoading(true)
    setUpdateUserResult(null)
    try {
      const authToken = adminToken.trim() || null
      const res = await fetch(`${API_BASE}/users/${userId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken && { 'Authorization': `Bearer ${authToken}` }),
        },
        credentials: 'include',
        body: JSON.stringify({ approved })
      })
      setUpdateUserResult(await res.json())
      // Refresh
      if (singleUser?.id === userId) {
        lookupUser()
      }
      fetchAllUsers()
    } catch (e) {
      setUpdateUserResult({ error: e instanceof Error ? e.message : 'Failed' })
    } finally {
      setUpdateUserLoading(false)
    }
  }

  const deleteUser = async (userId: number) => {
    setDeleteUserLoading(true)
    try {
      const authToken = adminToken.trim() || null
      await fetch(`${API_BASE}/users/${userId}`, {
        method: 'DELETE',
        headers: {
          ...(authToken && { 'Authorization': `Bearer ${authToken}` }),
        },
        credentials: 'include',
      })
      fetchAllUsers()
      if (singleUser?.id === userId) {
        setSingleUser(null)
      }
    } catch (e) {
      // Handle error
    } finally {
      setDeleteUserLoading(false)
    }
  }

  // Module 15: Database Explorer API calls
  const fetchDbTables = async () => {
    setDbTablesLoading(true)
    setDbTables(null)
    try {
      const res = await adminFetch('/admin/db/tables')
      const data = await res.json()
      setDbTables(data.tables)
    } catch (e) {
      setDbTables(null)
    } finally {
      setDbTablesLoading(false)
    }
  }

  const fetchTableData = async (tableName: string) => {
    setTableDataLoading(true)
    setTableData(null)
    setSelectedDbTable(tableName)
    try {
      const res = await adminFetch(`/admin/db/tables/${tableName}?page=1&page_size=20`)
      const data = await res.json()
      setTableData({ columns: data.columns?.map((c: { name: string }) => c.name) || [], rows: data.rows || [] })
    } catch (e) {
      setTableData(null)
    } finally {
      setTableDataLoading(false)
    }
  }

  const runDbQuery = async () => {
    if (!dbQuery.trim()) return
    setDbQueryLoading(true)
    setDbQueryResult(null)
    try {
      const res = await adminFetch('/admin/db/query', {
        method: 'POST',
        body: JSON.stringify({ query: dbQuery.trim() })
      })
      setDbQueryResult(await res.json())
    } catch (e) {
      setDbQueryResult({ success: false, columns: [], rows: [], error: e instanceof Error ? e.message : 'Failed' })
    } finally {
      setDbQueryLoading(false)
    }
  }

  // Module 16: Rate Limiting Test
  const runRateLimitTest = async () => {
    setRateLimitTesting(true)
    setRateLimitResults({ success: 0, blocked: 0, responses: [] })

    const endpoint = rateLimitTestType === 'magic_link' ? '/auth/magic-link' : '/admin/auth'
    const limit = rateLimitTestType === 'magic_link' ? 6 : 11 // Test slightly over limit
    const results: string[] = []
    let success = 0
    let blocked = 0

    for (let i = 0; i < limit; i++) {
      try {
        const res = await fetch(`${API_BASE}${endpoint}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: rateLimitTestType === 'magic_link'
            ? JSON.stringify({ email: `test${i}@ratelimit.test`, name: 'Rate Test' })
            : JSON.stringify({ event: {} }) // Invalid event, but tests rate limit
        })
        if (res.status === 429) {
          blocked++
          results.push(`Request ${i + 1}: 429 Too Many Requests`)
        } else {
          success++
          results.push(`Request ${i + 1}: ${res.status}`)
        }
      } catch (e) {
        results.push(`Request ${i + 1}: Error - ${e instanceof Error ? e.message : 'Unknown'}`)
      }
    }

    setRateLimitResults({ success, blocked, responses: results })
    setRateLimitTesting(false)
  }

  return (
    <div className="min-h-screen bg-surface">
      {/* Header */}
      <header className="border-b border-border bg-surface-raised">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link
              to="/chat"
              className="p-2 -ml-2 rounded-lg text-text-muted hover:text-text hover:bg-surface-overlay transition-all"
              title={t('testDashboard.extracted.back_to_chat_e2991f', 'Back to Chat')}
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
              </svg>
            </Link>
            <div>
              <h1 className="text-2xl font-semibold text-text">{t('testDashboard.extracted.test_dashboard_7349f9', 'Test Dashboard')}</h1>
              <p className="text-sm text-text-muted">{t('testDashboard.extracted.admin_tools_for_testing_the_rag_pipeline_a7787f', 'Admin tools for testing the RAG pipeline')}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Link
              to="/admin/setup"
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg font-medium text-text-secondary border border-border hover:bg-surface-overlay hover:text-text transition-colors text-sm"
            >
              <Settings className="w-4 h-4" />
              {t('testDashboard.extracted.instance_config_6c9a3f', 'Instance Config')}
            </Link>
            <ThemeToggle />
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-6xl mx-auto px-6 py-8">
        <p className="text-text-secondary mb-8">{t('testDashboard.extracted.test_each_component_of_the_rag_pipeline_408491', 'Test each component of the RAG pipeline')}</p>

        {/* System Status Row */}
        <div className="grid md:grid-cols-2 gap-6 mb-6">
          {/* Health Check */}
          <Card>
            <h3 className="text-lg font-semibold text-text mb-2">{t('testDashboard.extracted.1_health_check_7d1e91', '1. Health Check')}</h3>
            <p className="text-sm text-text-secondary mb-4">
              {t('testDashboard.extracted.checks_if_neo4j_and_qdrant_services_are_running_8dab74', 'Checks if Neo4j and Qdrant services are running.')}
            </p>
            <InfoBox>
              <strong className="text-text">{t('testDashboard.extracted.get_health_ce575b', 'GET /health')}</strong> {t('testDashboard.extracted.pings_both_databases_and_returns_their_status_0602d8', '— Pings both databases and returns their status.')}
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
            <h3 className="text-lg font-semibold text-text mb-2">{t('testDashboard.extracted.2_database_smoke_test_209494', '2. Database Smoke Test')}</h3>
            <p className="text-sm text-text-secondary mb-4">
              {t('testDashboard.extracted.verifies_seeded_test_data_exists_in_both_databases_3ac1d4', 'Verifies seeded test data exists in both databases.')}
            </p>
            <InfoBox>
              <strong className="text-text">{t('testDashboard.extracted.get_test_b58003', 'GET /test')}</strong> {t('testDashboard.extracted.retrieves_the_spanish_udhr_claim_from_neo4j_and_3bbddf', '— Retrieves the Spanish UDHR claim from Neo4j and its embedding from Qdrant.')}
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
          <h3 className="text-lg font-semibold text-text mb-2">{t('testDashboard.extracted.3_llm_provider_test_f3cd3d', '3. LLM Provider Test')}</h3>
          <p className="text-sm text-text-secondary mb-4">
            {t('testDashboard.extracted.tests_connectivity_to_the_llm_provider_maple_or_e91a9f', 'Tests connectivity to the LLM provider (Maple or Ollama).')}
          </p>
          <InfoBox>
            <strong className="text-text">{t('testDashboard.extracted.get_llm_test_86edd0', 'GET /llm/test')}</strong> {t('testDashboard.extracted.sends_say_hello_to_the_llm_and_returns_9da964', '— Sends "Say \'hello\'" to the LLM and returns its response. Shows which model and provider are active.')}
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
          <h3 className="text-lg font-semibold text-text mb-2">{t('testDashboard.extracted.4_rag_query_full_pipeline_8ea01b', '4. RAG Query (Full Pipeline)')}</h3>
          <p className="text-sm text-text-secondary mb-4">
            {t('testDashboard.extracted.the_complete_rag_pipeline_embed_search_retrieve_generate_d5ac42', 'The complete RAG pipeline: embed → search → retrieve → generate.')}
          </p>
          <InfoBox>
            <strong className="text-text">{t('testDashboard.extracted.post_query_1e40bd', 'POST /query')}</strong> {t('testDashboard.extracted.this_is_where_the_magic_happens_e98c18', '— This is where the magic happens:')}
            <ol className="mt-2 ml-5 list-decimal text-text-secondary">
              <li>{t('testDashboard.extracted.embeds_your_question_using_the_same_model_as_436607', 'Embeds your question using the same model as ingestion')}</li>
              <li>{t('testDashboard.extracted.searches_qdrant_for_semantically_similar_knowledge_303a40', 'Searches Qdrant for semantically similar knowledge')}</li>
              <li>{t('testDashboard.extracted.fetches_full_context_from_neo4j_claims_sources_98ea16', 'Fetches full context from Neo4j (claims + sources)')}</li>
              <li>{t('testDashboard.extracted.sends_context_question_to_the_llm_e76b36', 'Sends context + question to the LLM')}</li>
              <li>{t('testDashboard.extracted.returns_a_grounded_answer_with_citations_f503fe', 'Returns a grounded answer with citations')}</li>
            </ol>
          </InfoBox>

          <div className="flex gap-3 mb-4">
            <input
              type="text"
              value={ragInput}
              onChange={e => setRagInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && runRagQuery()}
              placeholder={t('testDashboard.extracted.ask_a_question_try_when_was_the_udhr_b3eb35', 'Ask a question... (try: When was the UDHR adopted?)')}
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
                <p className="text-text whitespace-pre-wrap">{ragResult.answer}</p>
                <p className="text-sm text-text-muted mt-2">
                  Session: {ragResult.session_id?.slice(0, 8)}{t('testDashboard.extracted.temp_b27bd5', '... | Temp:')} {ragResult.temperature}
                </p>
              </div>

              {/* Clarifying Questions */}
              {ragResult.clarifying_questions?.length > 0 && (
                <div className="bg-warning-subtle border border-warning/20 rounded-lg p-4">
                  <p className="font-medium text-warning mb-2">{t('testDashboard.extracted.clarifying_questions_8a371e', 'Clarifying Questions:')}</p>
                  <ul className="list-disc list-inside text-text-secondary">
                    {ragResult.clarifying_questions.map((q, i) => (
                      <li key={i}>{q}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Sources */}
              {ragResult.sources?.length > 0 && (
                <div>
                  <p className="font-medium text-text mb-2">{t('testDashboard.extracted.sources_25464d', 'Sources (')}{ragResult.sources.length}):</p>
                  <div className="space-y-2">
                    {ragResult.sources.slice(0, 5).map((s, i) => (
                      <div key={i} className="bg-accent-subtle border border-accent/20 rounded-lg p-4">
                        <div className="flex justify-between items-start mb-2">
                          <span className="text-xs font-mono bg-surface-secondary px-2 py-1 rounded">
                            {s.type} {t('testDashboard.extracted.score_92d190', '| score:')} {s.score?.toFixed(3)}
                          </span>
                          <span className="text-xs text-text-muted">{s.source_file}</span>
                        </div>
                        <p className="text-text text-sm">{s.text?.slice(0, 300)}{s.text?.length > 300 ? '...' : ''}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Graph Context */}
              {ragResult.graph_context && Object.keys(ragResult.graph_context).some(k => ragResult.graph_context[k]?.length > 0) && (
                <div>
                  <p className="font-medium text-text mb-2">{t('testDashboard.extracted.graph_context_185228', 'Graph Context:')}</p>
                  <div className="bg-surface-secondary rounded-lg p-4 text-sm">
                    {Object.entries(ragResult.graph_context).map(([key, values]) => (
                      values?.length > 0 && (
                        <div key={key} className="mb-2">
                          <strong className="text-text">{key}:</strong>{' '}
                          <span className="text-text-secondary">{values.join(', ')}</span>
                        </div>
                      )
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </Card>

        {/* Direct Chat */}
        <Card>
          <h3 className="text-lg font-semibold text-text mb-2">{t('testDashboard.extracted.5_direct_chat_no_rag_e7a3fb', '5. Direct Chat (No RAG)')}</h3>
          <p className="text-sm text-text-secondary mb-4">
            {t('testDashboard.extracted.direct_chat_with_the_llm_no_retrieval_just_d01a4a', 'Direct chat with the LLM. No retrieval, just generation.')}
          </p>
          <InfoBox>
            <strong className="text-text">{t('testDashboard.extracted.post_llm_chat_296eaa', 'POST /llm/chat')}</strong> {t('testDashboard.extracted.sends_your_message_directly_to_the_llm_without_a01bbb', '— Sends your message directly to the LLM without any knowledge retrieval. Useful for comparing RAG vs non-RAG responses.')}
          </InfoBox>

          {/* Chat Messages */}
          <div className="border border-border rounded-lg h-52 overflow-y-auto p-4 mb-4 bg-surface">
            {messages.length === 0 && (
              <p className="text-text-muted">{t('testDashboard.extracted.send_a_message_to_chat_directly_with_the_1a9c04', 'Send a message to chat directly with the LLM...')}</p>
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
              placeholder={t('testDashboard.extracted.type_a_message_09bdff', 'Type a message...')}
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
          <h3 className="text-lg font-semibold text-text mb-2">{t('testDashboard.extracted.6_ingestion_pipeline_e66cb3', '6. Ingestion Pipeline')}</h3>
          <p className="text-sm text-text-secondary mb-4">
            {t('testDashboard.extracted.document_upload_chunking_and_manual_llm_extraction_workflow_9edc5e', 'Document upload, chunking, and manual LLM extraction workflow.')}
          </p>

          {/* UPLOAD DOCUMENT */}
          <div className="mb-6">
            <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-3">{t('testDashboard.extracted.upload_document_9e2628', 'Upload Document')}</p>
            <InfoBox>
              <strong className="text-text">{t('testDashboard.extracted.post_ingest_upload_3eb8fd', 'POST /ingest/upload')}</strong> {t('testDashboard.extracted.upload_pdf_txt_or_md_files_for_processing_0a6ce7', '— Upload PDF, TXT, or MD files for processing. Returns a job_id to track progress.')}
            </InfoBox>
            <div className="flex flex-wrap gap-3 items-center">
              <input
                type="file"
                accept=".pdf,.txt,.md"
                onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
                className="text-sm text-text file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-accent file:text-accent-text file:font-medium file:cursor-pointer hover:file:bg-accent-hover"
              />
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
            <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-3">{t('testDashboard.extracted.jobs_status_8339b3', 'Jobs & Status')}</p>
            <InfoBox>
              <strong className="text-text">{t('testDashboard.extracted.get_ingest_jobs_039c92', 'GET /ingest/jobs')}</strong> {t('testDashboard.extracted.list_all_ingest_jobs_49dcb6', '— List all ingest jobs.')} <br />
              <strong className="text-text">{t('testDashboard.extracted.get_ingest_status_job_id_c08668', 'GET /ingest/status/&#123;job_id&#125;')}</strong> {t('testDashboard.extracted.get_detailed_status_of_a_specific_job_ead8cd', '— Get detailed status of a specific job.')}
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
                      <th className="text-left py-2 px-2 text-text-muted font-medium">{t('testDashboard.extracted.job_id_770797', 'Job ID')}</th>
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
              <p className="text-text-muted text-sm mb-4">{t('testDashboard.extracted.no_jobs_found_upload_a_document_to_create_b24fe3', 'No jobs found. Upload a document to create one.')}</p>
            )}
            {selectedJobId && (
              <div className="flex gap-3 items-center mb-4">
                <span className="text-sm text-text-secondary">{t('testDashboard.extracted.selected_job_651296', 'Selected Job:')}</span>
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
              <strong className="text-text">{t('testDashboard.extracted.get_ingest_pending_35eae8', 'GET /ingest/pending')}</strong> {t('testDashboard.extracted.list_all_chunks_optionally_filtered_by_job_36f0d4', '— List all chunks (optionally filtered by job).')} <br />
              <strong className="text-text">{t('testDashboard.extracted.get_ingest_chunk_chunk_id_c379aa', 'GET /ingest/chunk/&#123;chunk_id&#125;')}</strong> {t('testDashboard.extracted.get_chunk_with_full_llm_extraction_prompt_49a386', '— Get chunk with full LLM extraction prompt.')}
            </InfoBox>
            <div className="flex gap-3 mb-4">
              <Button onClick={() => fetchPendingChunks()} disabled={chunksLoading}>
                {chunksLoading ? 'Fetching...' : 'Fetch Chunks'}
              </Button>
              {selectedJobId && (
                <span className="text-sm text-text-muted self-center">{t('testDashboard.extracted.filtered_by_selected_job_955917', '(filtered by selected job)')}</span>
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
                    <p className="text-xs text-text-muted mt-1">{chunk.char_count} {t('testDashboard.extracted.chars_5a36c0', 'chars |')} {chunk.source_file}</p>
                  </div>
                ))}
              </div>
            )}
            {chunks && chunks.length === 0 && (
              <p className="text-text-muted text-sm mb-4">{t('testDashboard.extracted.no_chunks_found_96d00e', 'No chunks found.')}</p>
            )}
            {chunkLoading && (
              <p className="text-text-muted text-sm mt-4">{t('testDashboard.extracted.loading_chunk_details_785d39', 'Loading chunk details...')}</p>
            )}
            {chunkDetail && !chunkLoading && (
              <div className="mt-4">
                <p className="text-sm font-medium text-text mb-2">{t('testDashboard.extracted.full_llm_prompt_copy_this_to_your_llm_660052', 'Full LLM Prompt (copy this to your LLM):')}</p>
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
                  {t('testDashboard.extracted.copy_prompt_c6ce5d', 'Copy Prompt')}
                </Button>
              </div>
            )}
          </div>

          {/* EXTRACTION WORKFLOW */}
          <div className="border-t border-border pt-6 mb-6">
            <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-3">{t('testDashboard.extracted.extraction_workflow_63958f', 'Extraction Workflow')}</p>
            <InfoBox>
              <strong className="text-text">{t('testDashboard.extracted.post_ingest_chunk_chunk_id_extract_ebff86', 'POST /ingest/chunk/&#123;chunk_id&#125;/extract')}</strong> {t('testDashboard.extracted.submit_llm_extraction_results_9668ac', '— Submit LLM extraction results.')} <br />
              <strong className="text-text">{t('testDashboard.extracted.post_ingest_chunk_chunk_id_store_3ebda3', 'POST /ingest/chunk/&#123;chunk_id&#125;/store')}</strong> {t('testDashboard.extracted.commit_extraction_to_neo4j_and_qdrant_6ddd62', '— Commit extraction to Neo4j and Qdrant.')}
            </InfoBox>
            {!selectedChunkId ? (
              <p className="text-text-muted text-sm">{t('testDashboard.extracted.select_a_chunk_above_to_begin_extraction_workflow_e530d4', 'Select a chunk above to begin extraction workflow.')}</p>
            ) : (
              <div className="space-y-4">
                <div>
                  <p className="text-sm text-text-secondary mb-2">
                    {t('testDashboard.extracted.1_copy_the_prompt_above_and_send_to_bf527f', '1. Copy the prompt above and send to your LLM')}
                  </p>
                  <p className="text-sm text-text-secondary mb-2">
                    {t('testDashboard.extracted.2_paste_the_json_response_below_should_have_59b7bd', '2. Paste the JSON response below (should have')} <code className="bg-surface-overlay px-1 rounded">entities</code> and <code className="bg-surface-overlay px-1 rounded">relationships</code> {t('testDashboard.extracted.arrays_6e742b', 'arrays):')}
                  </p>
                  <textarea
                    value={extractionJson}
                    onChange={(e) => setExtractionJson(e.target.value)}
                    placeholder={t('testDashboard.extracted.entities_relationships_df50cd', '{"entities": [...], "relationships": [...]}')}
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
                    <p className="text-sm font-medium text-text mb-1">{t('testDashboard.extracted.extraction_result_604392', 'Extraction Result:')}</p>
                    <CodeBlock>{JSON.stringify(extractionResult, null, 2)}</CodeBlock>
                  </div>
                )}
                {storeResult && (
                  <div className="mt-2">
                    <p className="text-sm font-medium text-text mb-1">{t('testDashboard.extracted.store_result_4a8acf', 'Store Result:')}</p>
                    <CodeBlock>{JSON.stringify(storeResult, null, 2)}</CodeBlock>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* PIPELINE STATS */}
          <div className="border-t border-border pt-6">
            <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-3">{t('testDashboard.extracted.pipeline_stats_5fc80f', 'Pipeline Stats')}</p>
            <InfoBox>
              <strong className="text-text">{t('testDashboard.extracted.get_ingest_stats_48d91e', 'GET /ingest/stats')}</strong> {t('testDashboard.extracted.overall_statistics_for_jobs_and_chunks_3111a8', '— Overall statistics for jobs and chunks.')}
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

        {/* Vector Search */}
        <Card className="mt-6">
          <h3 className="text-lg font-semibold text-text mb-2">{t('testDashboard.extracted.7_vector_search_direct_qdrant_049447', '7. Vector Search (Direct Qdrant)')}</h3>
          <p className="text-sm text-text-secondary mb-4">
            {t('testDashboard.extracted.search_the_vector_store_directly_without_llm_generation_ce9e36', 'Search the vector store directly without LLM generation. Useful for debugging embeddings.')}
          </p>
          <InfoBox>
            <strong className="text-text">{t('testDashboard.extracted.post_vector_search_da9f62', 'POST /vector-search')}</strong> {t('testDashboard.extracted.embeds_your_query_and_searches_qdrant_directly_returns_eeff55', '— Embeds your query and searches Qdrant directly. Returns matching vectors with similarity scores (no LLM call).')}
          </InfoBox>

          <div className="space-y-3 mb-4">
            <div className="flex gap-3">
              <input
                type="text"
                value={vectorQuery}
                onChange={e => setVectorQuery(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && runVectorSearch()}
                placeholder={t('testDashboard.extracted.enter_search_query_87a0d2', 'Enter search query...')}
                className="flex-1 px-4 py-2 bg-surface border border-border rounded-lg text-text placeholder:text-text-muted focus:border-accent focus:ring-1 focus:ring-accent transition-colors"
                disabled={vectorLoading}
              />
              <Button onClick={runVectorSearch} disabled={vectorLoading || !vectorQuery.trim()}>
                {vectorLoading ? 'Searching...' : 'Search'}
              </Button>
            </div>
            <div className="flex gap-4 items-center">
              <label className="text-sm text-text-secondary">
                {t('testDashboard.extracted.top_k_bf7748', 'Top K:')}
                <select
                  value={vectorTopK}
                  onChange={(e) => setVectorTopK(Number(e.target.value))}
                  className="ml-2 px-2 py-1 bg-surface border border-border rounded text-text text-sm focus:border-accent focus:ring-1 focus:ring-accent"
                >
                  <option value={3}>3</option>
                  <option value={5}>5</option>
                  <option value={10}>10</option>
                  <option value={20}>20</option>
                </select>
              </label>
              <label className="text-sm text-text-secondary">
                Collection:
                <select
                  value={vectorCollection}
                  onChange={(e) => setVectorCollection(e.target.value)}
                  className="ml-2 px-2 py-1 bg-surface border border-border rounded text-text text-sm focus:border-accent focus:ring-1 focus:ring-accent"
                >
                  <option value="sanctum_smoke_test">sanctum_smoke_test</option>
                  <option value="sanctum_knowledge">sanctum_knowledge</option>
                </select>
              </label>
            </div>
          </div>

          {vectorResults && (
            <div className="space-y-3">
              <p className="text-sm text-text-secondary">
                Found {vectorResults.results.length} {t('testDashboard.extracted.results_embedding_dimension_e74de7', 'results | Embedding dimension:')} {vectorResults.query_embedding_dim}
              </p>
              {vectorResults.results.length === 0 ? (
                <p className="text-text-muted text-sm">{t('testDashboard.extracted.no_results_found_try_a_different_query_or_fef914', 'No results found. Try a different query or check if the collection has data.')}</p>
              ) : (
                <div className="space-y-2 max-h-80 overflow-y-auto">
                  {vectorResults.results.map((result, idx) => (
                    <div key={result.id} className="bg-surface-overlay rounded-lg p-3 border border-border">
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-mono text-xs text-text-muted">#{idx + 1}</span>
                        <span className={`text-sm font-medium px-2 py-0.5 rounded ${
                          result.score > 0.8 ? 'bg-success-subtle text-success' :
                          result.score > 0.5 ? 'bg-warning-subtle text-warning' :
                          'bg-surface text-text-muted'
                        }`}>
                          Score: {result.score.toFixed(4)}
                        </span>
                      </div>
                      <p className="text-xs font-mono text-text-muted mb-2">ID: {result.id}</p>
                      <CodeBlock>{JSON.stringify(result.payload, null, 2)}</CodeBlock>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </Card>

        {/* User Onboarding Test */}
        <Card className="mt-6">
          <h3 className="text-lg font-semibold text-text mb-2">{t('testDashboard.extracted.8_user_onboarding_test_6152c0', '8. User Onboarding Test')}</h3>
          <p className="text-sm text-text-secondary mb-4">
            {t('testDashboard.extracted.test_the_user_creation_flow_with_dynamic_fields_b0142a', 'Test the user creation flow with dynamic fields based on user type.')}
          </p>
          <InfoBox>
            <strong className="text-text">{t('testDashboard.extracted.get_user_types_0ccb5f', 'GET /user-types')}</strong> {t('testDashboard.extracted.fetch_available_user_types_9799ee', '— Fetch available user types.')} <br />
            <strong className="text-text">{t('testDashboard.extracted.get_admin_user_fields_c29319', 'GET /admin/user-fields')}</strong> {t('testDashboard.extracted.get_field_definitions_for_a_type_3d1099', '— Get field definitions for a type.')} <br />
            <strong className="text-text">{t('testDashboard.extracted.post_users_137faf', 'POST /users')}</strong> {t('testDashboard.extracted.create_a_new_user_with_fields_5206e7', '— Create a new user with fields.')}
          </InfoBox>

          <div className="space-y-4">
            {/* Fetch User Types */}
            <div>
              <Button onClick={fetchUserTypes} disabled={userTypesLoading}>
                {userTypesLoading ? 'Fetching...' : '1. Fetch User Types'}
              </Button>
              {userTypes && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {userTypes.length === 0 ? (
                    <p className="text-text-muted text-sm">{t('testDashboard.extracted.no_user_types_configured_go_to_admin_setup_694677', 'No user types configured. Go to Admin Setup to create some.')}</p>
                  ) : (
                    userTypes.map((type) => (
                      <button
                        key={type.id}
                        onClick={() => {
                          setSelectedUserTypeId(type.id)
                          fetchFieldDefinitions(type.id)
                        }}
                        className={`px-3 py-2 rounded-lg text-sm transition-colors ${
                          selectedUserTypeId === type.id
                            ? 'bg-accent text-accent-text'
                            : 'bg-surface-overlay text-text border border-border hover:border-accent'
                        }`}
                      >
                        {type.name}
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>

            {/* Field Definitions & Input */}
            {selectedUserTypeId && fieldDefinitions && (
              <div className="border-t border-border pt-4">
                <p className="text-sm font-medium text-text mb-3">{t('testDashboard.extracted.2_fill_in_fields_for_selected_type_1c0f0c', '2. Fill in fields for selected type:')}</p>
                {fieldDefinitions.length === 0 ? (
                  <p className="text-text-muted text-sm">{t('testDashboard.extracted.no_fields_defined_for_this_type_f99ace', 'No fields defined for this type.')}</p>
                ) : (
                  <div className="space-y-3">
                    {fieldDefinitions.map((field) => (
                      <div key={field.id} className="flex items-center gap-3">
                        <label className="text-sm text-text-secondary w-32">
                          {field.field_name}
                          {field.required && <span className="text-error ml-1">*</span>}
                        </label>
                        <input
                          type={field.field_type === 'number' ? 'number' : 'text'}
                          value={userFields[field.field_name] || ''}
                          onChange={(e) => setUserFields(prev => ({ ...prev, [field.field_name]: e.target.value }))}
                          placeholder={`Enter ${field.field_name}...`}
                          className="flex-1 px-3 py-2 bg-surface border border-border rounded-lg text-text text-sm placeholder:text-text-muted focus:border-accent focus:ring-1 focus:ring-accent"
                        />
                        <span className="text-xs text-text-muted">{field.field_type}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Create User */}
            {selectedUserTypeId && (
              <div className="border-t border-border pt-4">
                <p className="text-sm font-medium text-text mb-3">{t('testDashboard.extracted.3_enter_user_details_and_create_user_c3da8f', '3. Enter user details and create user:')}</p>
                <div className="space-y-3">
                  <input
                    type="text"
                    value={testPubkey}
                    onChange={(e) => setTestPubkey(e.target.value)}
                    placeholder={t('testDashboard.extracted.pubkey_e_g_npub1_or_hex_ec4a44', 'Pubkey (e.g., npub1... or hex)')}
                    className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-text text-sm placeholder:text-text-muted focus:border-accent focus:ring-1 focus:ring-accent"
                  />
                  <div className="flex gap-3">
                    <input
                      type="email"
                      value={testEmail}
                      onChange={(e) => setTestEmail(e.target.value)}
                      placeholder={t('testDashboard.extracted.email_optional_5c10b5', 'Email (optional)')}
                      className="flex-1 px-3 py-2 bg-surface border border-border rounded-lg text-text text-sm placeholder:text-text-muted focus:border-accent focus:ring-1 focus:ring-accent"
                    />
                    <input
                      type="text"
                      value={testName}
                      onChange={(e) => setTestName(e.target.value)}
                      placeholder={t('testDashboard.extracted.name_optional_9c9f03', 'Name (optional)')}
                      className="flex-1 px-3 py-2 bg-surface border border-border rounded-lg text-text text-sm placeholder:text-text-muted focus:border-accent focus:ring-1 focus:ring-accent"
                    />
                  </div>
                  <Button onClick={createTestUser} disabled={createUserLoading || !testPubkey.trim()}>
                    {createUserLoading ? 'Creating...' : 'Create User'}
                  </Button>
                </div>
              </div>
            )}

            {/* Result */}
            {createUserResult && (
              <div className="mt-4">
                <p className="text-sm font-medium text-text mb-2">Result:</p>
                <CodeBlock>{JSON.stringify(createUserResult, null, 2)}</CodeBlock>
              </div>
            )}
          </div>
        </Card>

        {/* Neo4j Graph Query */}
        <Card className="mt-6">
          <h3 className="text-lg font-semibold text-text mb-2">{t('testDashboard.extracted.9_neo4j_graph_query_c9ebc6', '9. Neo4j Graph Query')}</h3>
          <p className="text-sm text-text-secondary mb-4">
            {t('testDashboard.extracted.run_read_only_cypher_queries_against_the_knowledge_99f5cd', 'Run read-only Cypher queries against the knowledge graph.')}
          </p>
          <InfoBox>
            <strong className="text-text">{t('testDashboard.extracted.post_admin_neo4j_query_edf4d4', 'POST /admin/neo4j/query')}</strong> {t('testDashboard.extracted.execute_a_cypher_query_match_only_no_writes_a8734d', '— Execute a Cypher query (MATCH only, no writes). Useful for exploring entities and relationships after ingestion.')}
          </InfoBox>

          <div className="space-y-4">
            <div className="flex flex-wrap gap-2 mb-2">
              <span className="text-xs text-text-muted">Examples:</span>
              <button
                onClick={() => setCypherQuery('MATCH (n) RETURN n LIMIT 10')}
                className="text-xs text-accent hover:text-accent-hover underline"
              >
                {t('testDashboard.extracted.all_nodes_59bd64', 'All nodes')}
              </button>
              <button
                onClick={() => setCypherQuery('MATCH (c:Claim)-[r:SUPPORTED_BY]->(s:Source) RETURN c, r, s LIMIT 10')}
                className="text-xs text-accent hover:text-accent-hover underline"
              >
                {t('testDashboard.extracted.claims_sources_929fbf', 'Claims + Sources')}
              </button>
              <button
                onClick={() => setCypherQuery('MATCH (n) RETURN labels(n) AS type, count(*) AS count')}
                className="text-xs text-accent hover:text-accent-hover underline"
              >
                {t('testDashboard.extracted.node_counts_by_type_0575ec', 'Node counts by type')}
              </button>
              <button
                onClick={() => setCypherQuery('MATCH ()-[r]->() RETURN type(r) AS rel_type, count(*) AS count')}
                className="text-xs text-accent hover:text-accent-hover underline"
              >
                {t('testDashboard.extracted.relationship_counts_f4de62', 'Relationship counts')}
              </button>
            </div>
            <textarea
              value={cypherQuery}
              onChange={(e) => setCypherQuery(e.target.value)}
              placeholder={t('testDashboard.extracted.match_n_return_n_limit_10_b71dca', 'MATCH (n) RETURN n LIMIT 10')}
              className="w-full h-24 px-4 py-3 bg-surface border border-border rounded-lg text-text font-mono text-sm placeholder:text-text-muted focus:border-accent focus:ring-1 focus:ring-accent resize-none"
            />
            <Button onClick={runNeo4jQuery} disabled={neo4jLoading || !cypherQuery.trim()}>
              {neo4jLoading ? 'Executing...' : 'Run Query'}
            </Button>

            {neo4jResult && (
              <div className="mt-4">
                {neo4jResult.error ? (
                  <div className="bg-error-subtle border border-error/20 text-error rounded-lg px-4 py-3">
                    Error: {neo4jResult.error}
                  </div>
                ) : (
                  <div>
                    <p className="text-sm text-text-secondary mb-2">
                      {neo4jResult.rows.length} {t('testDashboard.extracted.row_s_returned_columns_cb3f95', 'row(s) returned | Columns:')} {neo4jResult.columns.join(', ')}
                    </p>
                    {neo4jResult.rows.length === 0 ? (
                      <p className="text-text-muted text-sm">{t('testDashboard.extracted.no_results_003540', 'No results.')}</p>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-border">
                              {neo4jResult.columns.map((col) => (
                                <th key={col} className="text-left py-2 px-2 text-text-muted font-medium">{col}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {neo4jResult.rows.map((row, idx) => (
                              <tr key={idx} className="border-b border-border/50">
                                {neo4jResult.columns.map((col) => (
                                  <td key={col} className="py-2 px-2 text-text font-mono text-xs">
                                    {typeof row[col] === 'object'
                                      ? JSON.stringify(row[col], null, 1)
                                      : String(row[col])}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </Card>

        {/* ============================================ */}
        {/* NEW MODULES: Authentication & Admin Testing */}
        {/* ============================================ */}

        <SectionHeader title={t('testDashboard.extracted.authentication_testing_af7ce7', 'Authentication Testing')} icon={Key} />

        {/* Admin Session Panel */}
        <Card className="mb-6 border-accent/30">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Shield className="w-5 h-5 text-accent" />
              <h3 className="text-lg font-semibold text-text">{t('testDashboard.extracted.admin_session_0b18ca', 'Admin Session')}</h3>
            </div>
            {adminToken ? (
              <StatusBadge status="success" />
            ) : (
              <StatusBadge status="warning" />
            )}
          </div>
          <p className="text-sm text-text-secondary mb-4">
            {t('testDashboard.extracted.admin_authentication_is_required_for_admin_only_endpoints_d67ff6', 'Admin authentication is required for admin-only endpoints below. Authenticate via Nostr or paste a token.')}
          </p>
          <div className="space-y-4">
            <div className="flex flex-wrap gap-3 items-center">
              <Button
                onClick={authenticateAdmin}
                disabled={nostrAuthLoading || !hasNostrExtension()}
              >
                {nostrAuthLoading ? 'Authenticating...' : hasNostrExtension() ? 'Login with Nostr' : 'No Nostr Extension'}
              </Button>
              <Button variant="secondary" onClick={clearAdminSession} disabled={!adminToken}>
                {t('testDashboard.extracted.clear_session_f08fca', 'Clear Session')}
              </Button>
            </div>
            {nostrAuthError && (
              <div className="bg-error-subtle border border-error/20 text-error rounded-lg px-4 py-3 text-sm">
                {nostrAuthError}
              </div>
            )}
            {nostrAuthResult && (
              <div className="bg-success-subtle border border-success/20 rounded-lg px-4 py-3 text-sm">
                <p className="text-success font-medium">{t('testDashboard.extracted.authenticated_as_admin_a499c5', 'Authenticated as admin!')}</p>
                <p className="text-text-secondary mt-1 font-mono text-xs">Pubkey: {nostrAuthResult.admin.pubkey.slice(0, 16)}...</p>
              </div>
            )}
            <div className="border-t border-border pt-4">
              <p className="text-xs text-text-muted mb-2">{t('testDashboard.extracted.or_paste_an_existing_admin_session_token_67d4c1', 'Or paste an existing admin session token:')}</p>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={adminToken}
                  onChange={(e) => setAdminToken(e.target.value)}
                  placeholder={t('testDashboard.extracted.paste_admin_session_token_26636c', 'Paste admin session token...')}
                  className="flex-1 px-3 py-2 bg-surface border border-border rounded-lg text-text text-sm font-mono placeholder:text-text-muted focus:border-accent focus:ring-1 focus:ring-accent"
                />
                <Button
                  variant="secondary"
                  onClick={() => setAdminToken(adminToken.trim())}
                >
                  Use
                </Button>
              </div>
            </div>
            {adminToken && (
              <p className="text-xs text-text-muted">
                {t('testDashboard.extracted.token_in_memory_8c6773', 'Token in-memory:')} {adminToken.slice(0, 20)}...
              </p>
            )}
          </div>
        </Card>

        {/* Module 10: Authentication Testing */}
        <CollapsibleSection title={t('testDashboard.extracted.authentication_testing_af7ce7', 'Authentication Testing')} moduleNumber={10} icon={Key}>
          <p className="text-sm text-text-secondary mb-4">
            {t('testDashboard.extracted.test_magic_link_and_nostr_authentication_flows_40c5c7', 'Test magic link and Nostr authentication flows.')}
          </p>

          {/* Magic Link */}
          <div className="mb-6">
            <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-3">{t('testDashboard.extracted.magic_link_authentication_ea55a8', 'Magic Link Authentication')}</p>
            <InfoBox>
              <strong className="text-text">{t('testDashboard.extracted.post_auth_magic_link_78e420', 'POST /auth/magic-link')}</strong> {t('testDashboard.extracted.send_a_magic_link_to_the_provided_email_fa9f3b', '— Send a magic link to the provided email. Rate limited: 5 requests/minute.')}
            </InfoBox>
            <div className="flex flex-wrap gap-3 mb-3">
              <input
                type="email"
                value={magicLinkEmail}
                onChange={(e) => setMagicLinkEmail(e.target.value)}
                placeholder={t('testDashboard.extracted.email_address_c94d31', 'Email address')}
                className="flex-1 min-w-[200px] px-3 py-2 bg-surface border border-border rounded-lg text-text text-sm placeholder:text-text-muted focus:border-accent focus:ring-1 focus:ring-accent"
              />
              <input
                type="text"
                value={magicLinkName}
                onChange={(e) => setMagicLinkName(e.target.value)}
                placeholder={t('testDashboard.extracted.name_optional_9c9f03', 'Name (optional)')}
                className="w-40 px-3 py-2 bg-surface border border-border rounded-lg text-text text-sm placeholder:text-text-muted focus:border-accent focus:ring-1 focus:ring-accent"
              />
              <Button onClick={sendMagicLink} disabled={magicLinkLoading || !magicLinkEmail.trim()}>
                {magicLinkLoading ? 'Sending...' : 'Send Magic Link'}
              </Button>
            </div>
            {magicLinkResult && (
              <CodeBlock>{JSON.stringify(magicLinkResult, null, 2)}</CodeBlock>
            )}
          </div>

          {/* Token Verification */}
          <div className="border-t border-border pt-6 mb-6">
            <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-3">{t('testDashboard.extracted.verify_magic_link_token_183cf5', 'Verify Magic Link Token')}</p>
            <InfoBox>
              <strong className="text-text">{t('testDashboard.extracted.post_auth_verify_8bed78', 'POST /auth/verify')}</strong> {t('testDashboard.extracted.verify_a_magic_link_token_and_get_session_fc176a', '— Verify a magic link token and get session info (cookie-based session).')}
            </InfoBox>
            <div className="flex gap-3 mb-3">
              <input
                type="text"
                value={verifyToken}
                onChange={(e) => setVerifyToken(e.target.value)}
                placeholder={t('testDashboard.extracted.paste_magic_link_token_0a179f', 'Paste magic link token...')}
                className="flex-1 px-3 py-2 bg-surface border border-border rounded-lg text-text text-sm font-mono placeholder:text-text-muted focus:border-accent focus:ring-1 focus:ring-accent"
              />
              <Button onClick={verifyMagicLink} disabled={verifyLoading || !verifyToken.trim()}>
                {verifyLoading ? 'Verifying...' : 'Verify Token'}
              </Button>
            </div>
            {verifyResult && (
              <CodeBlock>{JSON.stringify(verifyResult, null, 2)}</CodeBlock>
            )}
          </div>

          {/* Session Check */}
          <div className="border-t border-border pt-6 mb-6">
            <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-3">{t('testDashboard.extracted.check_session_status_c950fd', 'Check Session Status')}</p>
            <InfoBox>
              <strong className="text-text">{t('testDashboard.extracted.get_auth_me_277c84', 'GET /auth/me')}</strong> {t('testDashboard.extracted.check_current_cookie_session_or_pass_authorization_bearer_98f304', '— Check current cookie session (or pass Authorization bearer token).')}
            </InfoBox>
            <div className="flex gap-3 mb-3">
              <input
                type="text"
                value={sessionCheckToken}
                onChange={(e) => setSessionCheckToken(e.target.value)}
                placeholder={t('testDashboard.extracted.paste_session_token_1db0f3', 'Paste session token...')}
                className="flex-1 px-3 py-2 bg-surface border border-border rounded-lg text-text text-sm font-mono placeholder:text-text-muted focus:border-accent focus:ring-1 focus:ring-accent"
              />
              <Button onClick={checkAuthStatus} disabled={sessionCheckLoading}>
                {sessionCheckLoading ? 'Checking...' : sessionCheckToken.trim() ? 'Check Status' : 'Check Cookie Session'}
              </Button>
            </div>
            {sessionCheckResult && (
              <CodeBlock>{JSON.stringify(sessionCheckResult, null, 2)}</CodeBlock>
            )}
          </div>

          {/* Admin List */}
          <div className="border-t border-border pt-6 mb-6">
            <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-3">{t('testDashboard.extracted.admin_list_99f096', 'Admin List')}</p>
            <InfoBox>
              <strong className="text-text">{t('testDashboard.extracted.get_admin_list_3f352e', 'GET /admin/list')}</strong> {t('testDashboard.extracted.list_all_admins_requires_admin_authentication_fc4e7b', '— List all admins. Requires admin authentication.')}
            </InfoBox>
            <Button onClick={fetchAdmins} disabled={adminsLoading || !adminToken}>
              {adminsLoading ? 'Fetching...' : 'Fetch Admins'}
            </Button>
            {!adminToken && <p className="text-xs text-warning mt-2">{t('testDashboard.extracted.requires_admin_session_above_ce1222', 'Requires admin session above')}</p>}
            {adminsList && (
              <div className="mt-4">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left py-2 px-2 text-text-muted font-medium">ID</th>
                      <th className="text-left py-2 px-2 text-text-muted font-medium">Pubkey</th>
                      <th className="text-left py-2 px-2 text-text-muted font-medium">Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {adminsList.map((admin) => (
                      <tr key={admin.id} className="border-b border-border/50">
                        <td className="py-2 px-2 text-text">{admin.id}</td>
                        <td className="py-2 px-2 font-mono text-xs text-text">{admin.pubkey.slice(0, 20)}...</td>
                        <td className="py-2 px-2 text-text-secondary text-xs">{admin.created_at || 'N/A'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Remove Admin */}
          <div className="border-t border-border pt-6">
            <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-3">{t('testDashboard.extracted.remove_admin_2bfae9', 'Remove Admin')}</p>
            <InfoBox>
              <strong className="text-text">{t('testDashboard.extracted.delete_admin_pubkey_6e8f73', 'DELETE /admin/&#123;pubkey&#125;')}</strong> {t('testDashboard.extracted.remove_an_admin_by_pubkey_requires_admin_authentication_f2131f', '— Remove an admin by pubkey. Requires admin authentication.')}
            </InfoBox>
            <div className="flex gap-3 mb-3">
              <input
                type="text"
                value={removeAdminPubkey}
                onChange={(e) => setRemoveAdminPubkey(e.target.value)}
                placeholder={t('testDashboard.extracted.admin_pubkey_to_remove_d5384e', 'Admin pubkey to remove...')}
                className="flex-1 px-3 py-2 bg-surface border border-border rounded-lg text-text text-sm font-mono placeholder:text-text-muted focus:border-accent focus:ring-1 focus:ring-accent"
              />
              <Button onClick={removeAdmin} disabled={removeAdminLoading || !removeAdminPubkey.trim() || !adminToken}>
                {removeAdminLoading ? 'Removing...' : 'Remove Admin'}
              </Button>
            </div>
            {removeAdminResult && (
              <CodeBlock>{JSON.stringify(removeAdminResult, null, 2)}</CodeBlock>
            )}
          </div>
        </CollapsibleSection>

        {/* Module 16: Rate Limiting Test */}
        <CollapsibleSection title={t('testDashboard.extracted.rate_limiting_test_fbe391', 'Rate Limiting Test')} moduleNumber={16} icon={Zap}>
          <p className="text-sm text-text-secondary mb-4">
            {t('testDashboard.extracted.test_rate_limiting_by_sending_rapid_requests_to_2ede24', 'Test rate limiting by sending rapid requests to rate-limited endpoints.')}
          </p>
          <InfoBox>
            <strong className="text-text">{t('testDashboard.extracted.magic_link_9d2e96', 'Magic Link:')}</strong> {t('testDashboard.extracted.5_requests_minute_2110bd', '5 requests/minute |')} <strong className="text-text">{t('testDashboard.extracted.admin_auth_2d5ed1', 'Admin Auth:')}</strong> {t('testDashboard.extracted.10_requests_minute_4ddd60', '10 requests/minute')}
          </InfoBox>
          <div className="flex flex-wrap gap-3 items-center mb-4">
            <select
              value={rateLimitTestType}
              onChange={(e) => setRateLimitTestType(e.target.value as 'magic_link' | 'admin_auth')}
              className="px-3 py-2 bg-surface border border-border rounded-lg text-text text-sm focus:border-accent focus:ring-1 focus:ring-accent"
            >
              <option value="magic_link">{t('testDashboard.extracted.magic_link_5_min_6decbc', 'Magic Link (5/min)')}</option>
              <option value="admin_auth">{t('testDashboard.extracted.admin_auth_10_min_e15503', 'Admin Auth (10/min)')}</option>
            </select>
            <Button onClick={runRateLimitTest} disabled={rateLimitTesting}>
              {rateLimitTesting ? 'Testing...' : `Send ${rateLimitTestType === 'magic_link' ? '6' : '11'} Rapid Requests`}
            </Button>
          </div>
          {rateLimitResults.responses.length > 0 && (
            <div className="space-y-4">
              <div className="flex gap-4">
                <div className="bg-success-subtle border border-success/20 rounded-lg p-3 flex-1 text-center">
                  <p className="text-2xl font-bold text-success">{rateLimitResults.success}</p>
                  <p className="text-xs text-text-secondary">Successful</p>
                </div>
                <div className="bg-error-subtle border border-error/20 rounded-lg p-3 flex-1 text-center">
                  <p className="text-2xl font-bold text-error">{rateLimitResults.blocked}</p>
                  <p className="text-xs text-text-secondary">{t('testDashboard.extracted.blocked_429_04c78f', 'Blocked (429)')}</p>
                </div>
              </div>
              <div className="max-h-40 overflow-y-auto bg-surface-overlay rounded-lg p-3">
                {rateLimitResults.responses.map((r, i) => (
                  <p key={i} className={`text-xs font-mono ${r.includes('429') ? 'text-error' : 'text-text-secondary'}`}>
                    {r}
                  </p>
                ))}
              </div>
            </div>
          )}
        </CollapsibleSection>

        <SectionHeader title={t('testDashboard.extracted.admin_instance_user_management_fb3ccf', 'Admin: Instance & User Management')} icon={Sliders} />

        {/* Module 11: Instance Settings */}
        <CollapsibleSection title={t('testDashboard.extracted.instance_settings_4ae9d7', 'Instance Settings')} moduleNumber={11} badge="Admin" icon={Settings}>
          <p className="text-sm text-text-secondary mb-4">
            {t('testDashboard.extracted.view_and_update_instance_wide_configuration_settings_9d59d3', 'View and update instance-wide configuration settings.')}
          </p>
          <InfoBox>
            <strong className="text-text">{t('testDashboard.extracted.get_admin_settings_bb858a', 'GET /admin/settings')}</strong> {t('testDashboard.extracted.fetch_all_settings_a3925a', '— Fetch all settings.')} <br />
            <strong className="text-text">{t('testDashboard.extracted.put_admin_settings_ef90bd', 'PUT /admin/settings')}</strong> {t('testDashboard.extracted.update_settings_9959e7', '— Update settings.')}
          </InfoBox>
          <Button onClick={fetchInstanceSettings} disabled={settingsLoading || !adminToken}>
            {settingsLoading ? 'Fetching...' : 'Fetch Settings'}
          </Button>
          {!adminToken && <p className="text-xs text-warning mt-2">{t('testDashboard.extracted.requires_admin_session_557d43', 'Requires admin session')}</p>}
          {instanceSettings && (
            <div className="mt-4 space-y-4">
              <div className="grid gap-3">
                {Object.entries(settingsForm).map(([key, value]) => (
                  <div key={key} className="flex items-center gap-3">
                    <label className="text-sm text-text-secondary w-40">{key}</label>
                    {key === 'primary_color' ? (
                      <div className="flex gap-2 items-center flex-1">
                        <input
                          type="color"
                          value={value}
                          onChange={(e) => setSettingsForm(prev => ({ ...prev, [key]: e.target.value }))}
                          className="w-10 h-10 rounded cursor-pointer"
                        />
                        <input
                          type="text"
                          value={value}
                          onChange={(e) => setSettingsForm(prev => ({ ...prev, [key]: e.target.value }))}
                          className="flex-1 px-3 py-2 bg-surface border border-border rounded-lg text-text text-sm font-mono"
                        />
                      </div>
                    ) : key === 'description' ? (
                      <textarea
                        value={value}
                        onChange={(e) => setSettingsForm(prev => ({ ...prev, [key]: e.target.value }))}
                        className="flex-1 px-3 py-2 bg-surface border border-border rounded-lg text-text text-sm resize-none h-20"
                      />
                    ) : key === 'auto_approve_users' ? (
                      <select
                        value={value}
                        onChange={(e) => setSettingsForm(prev => ({ ...prev, [key]: e.target.value }))}
                        className="flex-1 px-3 py-2 bg-surface border border-border rounded-lg text-text text-sm"
                      >
                        <option value="true">{t('testDashboard.extracted.true_auto_approve_new_users_07a0a6', 'true (auto-approve new users)')}</option>
                        <option value="false">{t('testDashboard.extracted.false_require_manual_approval_cf2539', 'false (require manual approval)')}</option>
                      </select>
                    ) : (
                      <input
                        type="text"
                        value={value}
                        onChange={(e) => setSettingsForm(prev => ({ ...prev, [key]: e.target.value }))}
                        className="flex-1 px-3 py-2 bg-surface border border-border rounded-lg text-text text-sm"
                      />
                    )}
                  </div>
                ))}
              </div>
              <Button onClick={saveInstanceSettings} disabled={saveSettingsLoading}>
                {saveSettingsLoading ? 'Saving...' : 'Save Settings'}
              </Button>
              {saveSettingsResult && (
                <CodeBlock>{JSON.stringify(saveSettingsResult, null, 2)}</CodeBlock>
              )}
            </div>
          )}
        </CollapsibleSection>

        {/* Module 12: User Type Management */}
        <CollapsibleSection title={t('testDashboard.extracted.user_type_management_670f60', 'User Type Management')} moduleNumber={12} badge="Admin" icon={Users}>
          <p className="text-sm text-text-secondary mb-4">
            {t('testDashboard.extracted.manage_user_types_for_categorizing_users_during_onboarding_43211e', 'Manage user types for categorizing users during onboarding.')}
          </p>
          <InfoBox>
            <strong className="text-text">{t('testDashboard.extracted.get_post_admin_user_types_a96df8', 'GET/POST /admin/user-types')}</strong> {t('testDashboard.extracted.list_and_create_user_types_a517f0', '— List and create user types.')} <br />
            <strong className="text-text">{t('testDashboard.extracted.put_delete_admin_user_types_id_4981b5', 'PUT/DELETE /admin/user-types/&#123;id&#125;')}</strong> {t('testDashboard.extracted.update_and_delete_28386e', '— Update and delete.')}
          </InfoBox>
          <Button onClick={fetchAdminUserTypes} disabled={adminUserTypesLoading || !adminToken}>
            {adminUserTypesLoading ? 'Fetching...' : 'Fetch User Types'}
          </Button>
          {!adminToken && <p className="text-xs text-warning mt-2">{t('testDashboard.extracted.requires_admin_session_557d43', 'Requires admin session')}</p>}
          {adminUserTypes && (
            <div className="mt-4 space-y-4">
              {adminUserTypes.length === 0 ? (
                <p className="text-text-muted text-sm">{t('testDashboard.extracted.no_user_types_defined_a605f5', 'No user types defined.')}</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="text-left py-2 px-2 text-text-muted font-medium">ID</th>
                        <th className="text-left py-2 px-2 text-text-muted font-medium">Name</th>
                        <th className="text-left py-2 px-2 text-text-muted font-medium">Description</th>
                        <th className="text-left py-2 px-2 text-text-muted font-medium">Order</th>
                        <th className="text-left py-2 px-2 text-text-muted font-medium">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {adminUserTypes.map((type) => (
                        <tr key={type.id} className="border-b border-border/50">
                          <td className="py-2 px-2 text-text">{type.id}</td>
                          <td className="py-2 px-2 text-text font-medium">{type.name}</td>
                          <td className="py-2 px-2 text-text-secondary text-xs">{type.description || '-'}</td>
                          <td className="py-2 px-2 text-text-secondary">{type.display_order}</td>
                          <td className="py-2 px-2">
                            <div className="flex gap-2">
                              <button
                                onClick={() => {
                                  setEditingTypeId(type.id)
                                  setEditTypeName(type.name)
                                  setEditTypeDescription(type.description || '')
                                  setEditTypeOrder(type.display_order)
                                }}
                                className="text-xs text-accent hover:text-accent-hover"
                              >
                                Edit
                              </button>
                              <button
                                onClick={() => deleteUserType(type.id)}
                                className="text-xs text-error hover:text-error/80"
                                disabled={deleteTypeLoading}
                              >
                                Delete
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Edit Form */}
              {editingTypeId && (
                <div className="bg-accent-subtle border border-accent/20 rounded-lg p-4">
                  <p className="text-sm font-medium text-text mb-3">{t('testDashboard.extracted.edit_user_type_465134', 'Edit User Type #')}{editingTypeId}</p>
                  <div className="grid gap-3">
                    <input
                      type="text"
                      value={editTypeName}
                      onChange={(e) => setEditTypeName(e.target.value)}
                      placeholder={t('testDashboard.extracted.name_49ee30', 'Name')}
                      className="px-3 py-2 bg-surface border border-border rounded-lg text-text text-sm"
                    />
                    <input
                      type="text"
                      value={editTypeDescription}
                      onChange={(e) => setEditTypeDescription(e.target.value)}
                      placeholder={t('testDashboard.extracted.description_d2b81d', 'Description')}
                      className="px-3 py-2 bg-surface border border-border rounded-lg text-text text-sm"
                    />
                    <input
                      type="number"
                      value={editTypeOrder}
                      onChange={(e) => setEditTypeOrder(Number(e.target.value))}
                      placeholder={t('testDashboard.extracted.display_order_5f1293', 'Display order')}
                      className="w-32 px-3 py-2 bg-surface border border-border rounded-lg text-text text-sm"
                    />
                    <div className="flex gap-2">
                      <Button onClick={updateUserType} disabled={updateTypeLoading}>
                        {updateTypeLoading ? 'Saving...' : 'Save'}
                      </Button>
                      <Button variant="secondary" onClick={() => setEditingTypeId(null)}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                </div>
              )}

              {/* Create Form */}
              <div className="border-t border-border pt-4">
                <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-3">{t('testDashboard.extracted.create_new_user_type_f48e26', 'Create New User Type')}</p>
                <div className="flex flex-wrap gap-3 items-end">
                  <div>
                    <label className="text-xs text-text-muted">Name</label>
                    <input
                      type="text"
                      value={newTypeName}
                      onChange={(e) => setNewTypeName(e.target.value)}
                      placeholder={t('testDashboard.extracted.developer_96882c', 'Developer')}
                      className="block mt-1 px-3 py-2 bg-surface border border-border rounded-lg text-text text-sm"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-text-muted">Description</label>
                    <input
                      type="text"
                      value={newTypeDescription}
                      onChange={(e) => setNewTypeDescription(e.target.value)}
                      placeholder={t('testDashboard.extracted.software_developers_d0b5df', 'Software developers')}
                      className="block mt-1 px-3 py-2 bg-surface border border-border rounded-lg text-text text-sm"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-text-muted">Order</label>
                    <input
                      type="number"
                      value={newTypeOrder}
                      onChange={(e) => setNewTypeOrder(Number(e.target.value))}
                      className="block mt-1 w-20 px-3 py-2 bg-surface border border-border rounded-lg text-text text-sm"
                    />
                  </div>
                  <Button onClick={createUserType} disabled={createTypeLoading || !newTypeName.trim()}>
                    {createTypeLoading ? 'Creating...' : 'Create'}
                  </Button>
                </div>
                {createTypeResult && (
                  <div className="mt-3">
                    <CodeBlock>{JSON.stringify(createTypeResult, null, 2)}</CodeBlock>
                  </div>
                )}
              </div>
            </div>
          )}
        </CollapsibleSection>

        {/* Module 13: User Field Definitions */}
        <CollapsibleSection title={t('testDashboard.extracted.user_field_definitions_96a417', 'User Field Definitions')} moduleNumber={13} badge="Admin" icon={FileText}>
          <p className="text-sm text-text-secondary mb-4">
            {t('testDashboard.extracted.manage_custom_fields_that_users_fill_out_during_465c3f', 'Manage custom fields that users fill out during onboarding.')}
          </p>
          <InfoBox>
            <strong className="text-text">{t('testDashboard.extracted.get_post_admin_user_fields_0cbd77', 'GET/POST /admin/user-fields')}</strong> {t('testDashboard.extracted.list_and_create_fields_e0f6c5', '— List and create fields.')} <br />
            <strong className="text-text">{t('testDashboard.extracted.put_delete_admin_user_fields_id_967add', 'PUT/DELETE /admin/user-fields/&#123;id&#125;')}</strong> {t('testDashboard.extracted.update_and_delete_28386e', '— Update and delete.')}
          </InfoBox>
          <div className="flex flex-wrap gap-3 items-center mb-4">
            <select
              value={fieldTypeFilter}
              onChange={(e) => setFieldTypeFilter(e.target.value === 'all' ? 'all' : e.target.value === 'global' ? 'global' : Number(e.target.value))}
              className="px-3 py-2 bg-surface border border-border rounded-lg text-text text-sm"
            >
              <option value="all">{t('testDashboard.extracted.all_fields_f51c73', 'All Fields')}</option>
              <option value="global">{t('testDashboard.extracted.global_only_018ef5', 'Global Only')}</option>
              {adminUserTypes?.map((t) => (
                <option key={t.id} value={t.id}>{t.name} Only</option>
              ))}
            </select>
            <Button onClick={fetchAdminFieldDefs} disabled={fieldDefsLoading || !adminToken}>
              {fieldDefsLoading ? 'Fetching...' : 'Fetch Fields'}
            </Button>
          </div>
          {!adminToken && <p className="text-xs text-warning mt-2">{t('testDashboard.extracted.requires_admin_session_557d43', 'Requires admin session')}</p>}
          {adminFieldDefs && (
            <div className="mt-4 space-y-4">
              {adminFieldDefs.length === 0 ? (
                <p className="text-text-muted text-sm">{t('testDashboard.extracted.no_field_definitions_found_fd57b8', 'No field definitions found.')}</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="text-left py-2 px-2 text-text-muted font-medium">ID</th>
                        <th className="text-left py-2 px-2 text-text-muted font-medium">Name</th>
                        <th className="text-left py-2 px-2 text-text-muted font-medium">Type</th>
                        <th className="text-left py-2 px-2 text-text-muted font-medium">Required</th>
                        <th className="text-left py-2 px-2 text-text-muted font-medium">{t('testDashboard.extracted.user_type_1ef9d5', 'User Type')}</th>
                        <th className="text-left py-2 px-2 text-text-muted font-medium">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {adminFieldDefs.map((field) => (
                        <tr key={field.id} className="border-b border-border/50">
                          <td className="py-2 px-2 text-text">{field.id}</td>
                          <td className="py-2 px-2 text-text font-medium">{field.field_name}</td>
                          <td className="py-2 px-2 text-text-secondary">
                            <span className="text-xs px-2 py-0.5 rounded bg-surface-overlay">{field.field_type}</span>
                          </td>
                          <td className="py-2 px-2">
                            {field.required ? (
                              <span className="text-xs text-success">Yes</span>
                            ) : (
                              <span className="text-xs text-text-muted">No</span>
                            )}
                          </td>
                          <td className="py-2 px-2 text-text-secondary text-xs">
                            {field.user_type_id ? `Type #${field.user_type_id}` : 'Global'}
                          </td>
                          <td className="py-2 px-2">
                            <button
                              onClick={() => deleteFieldDef(field.id)}
                              className="text-xs text-error hover:text-error/80"
                              disabled={deleteFieldLoading}
                            >
                              Delete
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Create Form */}
              <div className="border-t border-border pt-4">
                <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-3">{t('testDashboard.extracted.create_new_field_190e49', 'Create New Field')}</p>
                <div className="flex flex-wrap gap-3 items-end">
                  <div>
                    <label className="text-xs text-text-muted">Name</label>
                    <input
                      type="text"
                      value={newFieldName}
                      onChange={(e) => setNewFieldName(e.target.value)}
                      placeholder={t('testDashboard.extracted.company_name_2959df', 'company_name')}
                      className="block mt-1 px-3 py-2 bg-surface border border-border rounded-lg text-text text-sm"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-text-muted">Type</label>
                    <select
                      value={newFieldType}
                      onChange={(e) => setNewFieldType(e.target.value)}
                      className="block mt-1 px-3 py-2 bg-surface border border-border rounded-lg text-text text-sm"
                    >
                      <option value="text">text</option>
                      <option value="email">email</option>
                      <option value="number">number</option>
                      <option value="textarea">textarea</option>
                      <option value="url">url</option>
                      <option value="date">date</option>
                      <option value="checkbox">checkbox</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-text-muted">{t('testDashboard.extracted.user_type_1ef9d5', 'User Type')}</label>
                    <select
                      value={newFieldUserTypeId}
                      onChange={(e) => setNewFieldUserTypeId(e.target.value === 'global' ? 'global' : Number(e.target.value))}
                      className="block mt-1 px-3 py-2 bg-surface border border-border rounded-lg text-text text-sm"
                    >
                      <option value="global">{t('testDashboard.extracted.global_all_types_ae5fa4', 'Global (all types)')}</option>
                      {adminUserTypes?.map((t) => (
                        <option key={t.id} value={t.id}>{t.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="newFieldRequired"
                      checked={newFieldRequired}
                      onChange={(e) => setNewFieldRequired(e.target.checked)}
                      className="w-4 h-4"
                    />
                    <label htmlFor="newFieldRequired" className="text-xs text-text-muted">Required</label>
                  </div>
                  <Button onClick={createFieldDef} disabled={createFieldLoading || !newFieldName.trim()}>
                    {createFieldLoading ? 'Creating...' : 'Create'}
                  </Button>
                </div>
                {createFieldResult && (
                  <div className="mt-3">
                    <CodeBlock>{JSON.stringify(createFieldResult, null, 2)}</CodeBlock>
                  </div>
                )}
              </div>
            </div>
          )}
        </CollapsibleSection>

        {/* Module 14: User Management */}
        <CollapsibleSection title={t('testDashboard.extracted.user_management_5ca6e5', 'User Management')} moduleNumber={14} badge="Admin" icon={Users}>
          <p className="text-sm text-text-secondary mb-4">
            {t('testDashboard.extracted.view_all_users_manage_approval_status_and_delete_03feec', 'View all users, manage approval status, and delete users.')}
          </p>
          <InfoBox>
            <strong className="text-text">{t('testDashboard.extracted.get_admin_users_16656e', 'GET /admin/users')}</strong> {t('testDashboard.extracted.list_all_users_admin_only_ef41b8', '— List all users (admin only).')} <br />
            <strong className="text-text">{t('testDashboard.extracted.get_put_delete_users_id_5fc49d', 'GET/PUT/DELETE /users/&#123;id&#125;')}</strong> {t('testDashboard.extracted.manage_individual_users_ea076d', '— Manage individual users.')}
          </InfoBox>
          <Button onClick={fetchAllUsers} disabled={usersLoading || !adminToken}>
            {usersLoading ? 'Fetching...' : 'Fetch All Users'}
          </Button>
          {!adminToken && <p className="text-xs text-warning mt-2">{t('testDashboard.extracted.requires_admin_session_557d43', 'Requires admin session')}</p>}
          {allUsers && (
            <div className="mt-4 space-y-4">
              {allUsers.length === 0 ? (
                <p className="text-text-muted text-sm">{t('testDashboard.extracted.no_users_found_e611ef', 'No users found.')}</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="text-left py-2 px-2 text-text-muted font-medium">ID</th>
                        <th className="text-left py-2 px-2 text-text-muted font-medium">Email</th>
                        <th className="text-left py-2 px-2 text-text-muted font-medium">Name</th>
                        <th className="text-left py-2 px-2 text-text-muted font-medium">Type</th>
                        <th className="text-left py-2 px-2 text-text-muted font-medium">Approved</th>
                        <th className="text-left py-2 px-2 text-text-muted font-medium">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {allUsers.map((user) => (
                        <tr key={user.id} className="border-b border-border/50">
                          <td className="py-2 px-2 text-text">{user.id}</td>
                          <td className="py-2 px-2 text-text">
                            {formatEncryptedValue(user.email, user.email_encrypted) ?? '-'}
                          </td>
                          <td className="py-2 px-2 text-text-secondary">
                            {formatEncryptedValue(user.name, user.name_encrypted) ?? '-'}
                          </td>
                          <td className="py-2 px-2 text-text-secondary">{user.user_type_id || '-'}</td>
                          <td className="py-2 px-2">
                            {user.approved ? (
                              <span className="text-xs px-2 py-0.5 rounded bg-success-subtle text-success">Yes</span>
                            ) : (
                              <span className="text-xs px-2 py-0.5 rounded bg-warning-subtle text-warning">Pending</span>
                            )}
                          </td>
                          <td className="py-2 px-2">
                            <div className="flex gap-2">
                              <button
                                onClick={() => updateUser(user.id, !user.approved)}
                                className="text-xs text-accent hover:text-accent-hover"
                                disabled={updateUserLoading}
                              >
                                {user.approved ? 'Revoke' : 'Approve'}
                              </button>
                              <button
                                onClick={() => deleteUser(user.id)}
                                className="text-xs text-error hover:text-error/80"
                                disabled={deleteUserLoading}
                              >
                                Delete
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Single User Lookup */}
              <div className="border-t border-border pt-4">
                <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-3">{t('testDashboard.extracted.lookup_single_user_f65358', 'Lookup Single User')}</p>
                <div className="flex gap-3 mb-3">
                  <input
                    type="text"
                    value={lookupUserId}
                    onChange={(e) => setLookupUserId(e.target.value)}
                    placeholder={t('testDashboard.extracted.user_id_23bf49', 'User ID')}
                    className="w-32 px-3 py-2 bg-surface border border-border rounded-lg text-text text-sm"
                  />
                  <Button onClick={lookupUser} disabled={lookupLoading || !lookupUserId.trim()}>
                    {lookupLoading ? 'Looking...' : 'Lookup'}
                  </Button>
                </div>
                {singleUser && (
                  <CodeBlock>{JSON.stringify(singleUser, null, 2)}</CodeBlock>
                )}
              </div>
            </div>
          )}
          {updateUserResult && (
            <div className="mt-4">
              <CodeBlock>{JSON.stringify(updateUserResult, null, 2)}</CodeBlock>
            </div>
          )}
        </CollapsibleSection>

        <SectionHeader title={t('testDashboard.extracted.admin_database_f19a90', 'Admin: Database')} icon={Database} />

        {/* Module 15: Database Explorer */}
        <CollapsibleSection title={t('testDashboard.extracted.database_explorer_quick_view_134355', 'Database Explorer (Quick View)')} moduleNumber={15} badge="Admin" icon={Database}>
          <p className="text-sm text-text-secondary mb-4">
            {t('testDashboard.extracted.quick_view_of_sqlite_database_for_full_explorer_1b8c77', 'Quick view of SQLite database. For full explorer, visit')}{' '}
            <Link to="/admin/database" className="text-accent hover:text-accent-hover underline">/admin/database</Link>.
          </p>
          <InfoBox>
            <strong className="text-text">{t('testDashboard.extracted.get_admin_db_tables_1ea5ca', 'GET /admin/db/tables')}</strong> {t('testDashboard.extracted.list_tables_732bbb', '— List tables.')} <br />
            <strong className="text-text">{t('testDashboard.extracted.post_admin_db_query_0f1b94', 'POST /admin/db/query')}</strong> {t('testDashboard.extracted.execute_read_only_sql_a4eb56', '— Execute read-only SQL.')}
          </InfoBox>
          <Button onClick={fetchDbTables} disabled={dbTablesLoading || !adminToken}>
            {dbTablesLoading ? 'Fetching...' : 'Fetch Tables'}
          </Button>
          {!adminToken && <p className="text-xs text-warning mt-2">{t('testDashboard.extracted.requires_admin_session_557d43', 'Requires admin session')}</p>}
          {dbTables && (
            <div className="mt-4 space-y-4">
              <div className="flex flex-wrap gap-2">
                {dbTables.map((table) => (
                  <button
                    key={table.name}
                    onClick={() => fetchTableData(table.name)}
                    className={`px-3 py-2 rounded-lg text-sm transition-colors ${
                      selectedDbTable === table.name
                        ? 'bg-accent text-accent-text'
                        : 'bg-surface-overlay text-text border border-border hover:border-accent'
                    }`}
                  >
                    {table.name} <span className="text-xs opacity-70">({table.rowCount})</span>
                  </button>
                ))}
              </div>

              {tableDataLoading && <p className="text-text-muted text-sm">{t('testDashboard.extracted.loading_table_data_624023', 'Loading table data...')}</p>}
              {tableData && selectedDbTable && (() => {
                // Filter out ephemeral_pubkey_* columns from display (they're technical data)
                const displayColumns = tableData.columns.filter(col => !col.startsWith('ephemeral_pubkey_'))
                const encryptedBaseNames = new Set(
                  displayColumns
                    .filter((col) => col.startsWith('encrypted_'))
                    .map((col) => col.replace('encrypted_', ''))
                )
                const renderColumnHeader = (col: string) => {
                  const isEncrypted = col.startsWith('encrypted_')
                  const baseName = isEncrypted ? col.replace('encrypted_', '') : col
                  const isPlaintextCounterpart = !isEncrypted && encryptedBaseNames.has(col)
                  return (
                    <span className="inline-flex items-center gap-1">
                      {isEncrypted && <Lock className="w-3 h-3 text-warning" aria-hidden="true" />}
                      {isPlaintextCounterpart && (
                        <Unlock className="w-3 h-3 text-text-muted" aria-hidden="true" />
                      )}
                      <span>{baseName}</span>
                    </span>
                  )
                }
                return (
                  <div>
                    <p className="text-sm font-medium text-text mb-2">
                      {selectedDbTable} {t('testDashboard.extracted.first_20_rows_fe14b1', '(first 20 rows)')}
                    </p>
                    <div className="overflow-x-auto max-h-60">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-border">
                            {displayColumns.map((col) => (
                              <th key={col} className="text-left py-2 px-2 text-text-muted font-medium">
                                {renderColumnHeader(col)}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {tableData.rows.map((row, idx) => (
                            <tr key={idx} className="border-b border-border/50">
                              {displayColumns.map((col) => (
                                <td key={col} className="py-2 px-2 text-text font-mono">
                                  {col.startsWith('encrypted_')
                                    ? (decryptedTableData[idx]?.[col] ?? '[Decrypting...]')
                                    : String(row[col] ?? '')}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )
              })()}

              {/* Quick Query */}
              <div className="border-t border-border pt-4">
                <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-3">{t('testDashboard.extracted.quick_sql_query_7af594', 'Quick SQL Query')}</p>
                <textarea
                  value={dbQuery}
                  onChange={(e) => setDbQuery(e.target.value)}
                  placeholder={t('testDashboard.extracted.select_from_users_limit_10_27fd4a', 'SELECT * FROM users LIMIT 10')}
                  className="w-full h-20 px-4 py-3 bg-surface border border-border rounded-lg text-text font-mono text-sm placeholder:text-text-muted focus:border-accent focus:ring-1 focus:ring-accent resize-none"
                />
                <div className="flex gap-2 mt-2">
                  <Button onClick={runDbQuery} disabled={dbQueryLoading || !dbQuery.trim()}>
                    {dbQueryLoading ? 'Running...' : 'Run Query'}
                  </Button>
                </div>
                {dbQueryResult && (
                  <div className="mt-4">
                    {dbQueryResult.error ? (
                      <div className="bg-error-subtle border border-error/20 text-error rounded-lg px-4 py-3 text-sm">
                        {dbQueryResult.error}
                      </div>
                    ) : (() => {
                      // Filter out ephemeral_pubkey_* columns from display (they're technical data)
                      const displayColumns = dbQueryResult.columns.filter(col => !col.startsWith('ephemeral_pubkey_'))
                      const encryptedBaseNames = new Set(
                        displayColumns
                          .filter((col) => col.startsWith('encrypted_'))
                          .map((col) => col.replace('encrypted_', ''))
                      )
                      const renderColumnHeader = (col: string) => {
                        const isEncrypted = col.startsWith('encrypted_')
                        const baseName = isEncrypted ? col.replace('encrypted_', '') : col
                        const isPlaintextCounterpart = !isEncrypted && encryptedBaseNames.has(col)
                        return (
                          <span className="inline-flex items-center gap-1">
                            {isEncrypted && <Lock className="w-3 h-3 text-warning" aria-hidden="true" />}
                            {isPlaintextCounterpart && (
                              <Unlock className="w-3 h-3 text-text-muted" aria-hidden="true" />
                            )}
                            <span>{baseName}</span>
                          </span>
                        )
                      }
                      return (
                        <div>
                          <p className="text-sm text-text-secondary mb-2">
                            {dbQueryResult.rows.length} {t('testDashboard.extracted.row_s_returned_b2299c', 'row(s) returned')}
                          </p>
                          <div className="overflow-x-auto max-h-60">
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="border-b border-border">
                                  {displayColumns.map((col) => (
                                    <th key={col} className="text-left py-2 px-2 text-text-muted font-medium">
                                      {renderColumnHeader(col)}
                                    </th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {dbQueryResult.rows.map((row, idx) => (
                                  <tr key={idx} className="border-b border-border/50">
                                    {displayColumns.map((col) => (
                                      <td key={col} className="py-2 px-2 text-text font-mono">
                                        {col.startsWith('encrypted_')
                                          ? (decryptedQueryData[idx]?.[col] ?? '[Decrypting...]')
                                          : typeof row[col] === 'object'
                                            ? JSON.stringify(row[col])
                                            : String(row[col] ?? '')}
                                      </td>
                                    ))}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )
                    })()}
                  </div>
                )}
              </div>
            </div>
          )}
        </CollapsibleSection>
      </main>

      {/* Footer */}
      <footer className="border-t border-border mt-12">
        <div className="max-w-6xl mx-auto px-6 py-6 text-center text-sm text-text-muted">
          {t('testDashboard.extracted.sanctum_private_rag_system_for_curated_knowledge_5afbbe', 'Sanctum — Private RAG System for Curated Knowledge')}
        </div>
      </footer>
    </div>
  )
}
