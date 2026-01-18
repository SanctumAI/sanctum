import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Sun, Moon, Settings, Database, ChevronDown, Key, Shield, Users, Sliders, FileText, Zap } from 'lucide-react'
import { useTheme } from '../theme'
import {
  API_BASE,
  STORAGE_KEYS,
  AdminResponse,
  InstanceSettingsResponse,
  MagicLinkResponse,
  SessionCheckResponse,
  TableInfo,
  DBQueryResponse,
  FieldDefinitionResponse,
  UserWithFieldsResponse
} from '../types/onboarding'
import { authenticateWithNostr, hasNostrExtension, AuthResult } from '../utils/nostrAuth'
import { adminFetch, clearAdminAuth, isAdminAuthenticated } from '../utils/adminApi'

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

  // Ontology detail state
  const [selectedOntologyId, setSelectedOntologyId] = useState<string | null>(null)

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
  const [createUserResult, setCreateUserResult] = useState<Record<string, unknown> | null>(null)
  const [createUserLoading, setCreateUserLoading] = useState(false)

  // Neo4j query state
  const [cypherQuery, setCypherQuery] = useState('MATCH (n) RETURN n LIMIT 10')
  const [neo4jResult, setNeo4jResult] = useState<Neo4jQueryResult | null>(null)
  const [neo4jLoading, setNeo4jLoading] = useState(false)

  // === NEW MODULE STATE ===

  // Admin session state (shared across admin modules)
  const [adminToken, setAdminToken] = useState<string>(() => {
    return localStorage.getItem(STORAGE_KEYS.ADMIN_SESSION_TOKEN) || ''
  })
  const [, setAdminPubkey] = useState<string>(() => {
    return localStorage.getItem(STORAGE_KEYS.ADMIN_PUBKEY) || ''
  })

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
  const [allUsers, setAllUsers] = useState<UserWithFieldsResponse[] | null>(null)
  const [usersLoading, setUsersLoading] = useState(false)
  const [lookupUserId, setLookupUserId] = useState('')
  const [singleUser, setSingleUser] = useState<UserWithFieldsResponse | null>(null)
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

  // Module 16: Rate Limiting Test state
  const [rateLimitTestType, setRateLimitTestType] = useState<'magic_link' | 'admin_auth'>('magic_link')
  const [rateLimitResults, setRateLimitResults] = useState<{ success: number; blocked: number; responses: string[] }>({ success: 0, blocked: 0, responses: [] })
  const [rateLimitTesting, setRateLimitTesting] = useState(false)

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

  // Vector search API call
  const runVectorSearch = async () => {
    if (!vectorQuery.trim()) return
    setVectorLoading(true)
    setVectorResults(null)
    try {
      const res = await fetch(`${API_BASE}/vector-search`, {
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
      const res = await fetch(url)
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
      const res = await fetch(`${API_BASE}/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pubkey: testPubkey.trim(),
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
        headers: { 'Content-Type': 'application/json' },
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
    localStorage.setItem(STORAGE_KEYS.ADMIN_SESSION_TOKEN, token)
    localStorage.setItem(STORAGE_KEYS.ADMIN_PUBKEY, pubkey)
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
      const res = await fetch(`${API_BASE}/auth/verify?token=${encodeURIComponent(verifyToken.trim())}`)
      setVerifyResult(await res.json())
    } catch (e) {
      setVerifyResult({ error: e instanceof Error ? e.message : 'Failed' })
    } finally {
      setVerifyLoading(false)
    }
  }

  const checkAuthStatus = async () => {
    if (!sessionCheckToken.trim()) return
    setSessionCheckLoading(true)
    setSessionCheckResult(null)
    try {
      const res = await fetch(`${API_BASE}/auth/me?token=${encodeURIComponent(sessionCheckToken.trim())}`)
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
      const res = await adminFetch(`/admin/${removeAdminPubkey.trim()}`, { method: 'DELETE' })
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
      setAllUsers(data.users)
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
      const res = await fetch(`${API_BASE}/users/${lookupUserId.trim()}`)
      if (res.ok) {
        const data = await res.json()
        setSingleUser(data.user)
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
      const res = await fetch(`${API_BASE}/users/${userId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
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
      await fetch(`${API_BASE}/users/${userId}`, { method: 'DELETE' })
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
              title="Back to Chat"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
              </svg>
            </Link>
            <div>
              <h1 className="text-2xl font-semibold text-text">Test Dashboard</h1>
              <p className="text-sm text-text-muted">Admin tools for testing the RAG pipeline</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Link
              to="/admin/setup"
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg font-medium text-text-secondary border border-border hover:bg-surface-overlay hover:text-text transition-colors text-sm"
            >
              <Settings className="w-4 h-4" />
              Instance Config
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
                  <div
                    key={ont.id}
                    className={`bg-surface-overlay rounded-lg p-3 cursor-pointer transition-colors ${
                      selectedOntologyId === ont.id ? 'ring-2 ring-accent' : 'hover:bg-surface'
                    }`}
                    onClick={() => setSelectedOntologyId(selectedOntologyId === ont.id ? null : ont.id)}
                  >
                    <div className="flex items-center justify-between">
                      <p className="font-medium text-text">{ont.name} <span className="text-text-muted font-mono text-sm">({ont.id})</span></p>
                      <span className="text-text-muted text-sm">{selectedOntologyId === ont.id ? '▼' : '▶'}</span>
                    </div>
                    <p className="text-sm text-text-secondary mt-1">{ont.description}</p>
                    {selectedOntologyId === ont.id && (
                      <div className="mt-3 pt-3 border-t border-border">
                        <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-2">Entity Types ({ont.entity_types.length})</p>
                        <div className="flex flex-wrap gap-1 mb-3">
                          {ont.entity_types.map((t) => (
                            <span key={t} className="text-xs bg-accent-subtle text-accent px-2 py-0.5 rounded">{t}</span>
                          ))}
                        </div>
                        <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-2">Relationship Types ({ont.relationship_types.length})</p>
                        <div className="flex flex-wrap gap-1">
                          {ont.relationship_types.map((t) => (
                            <span key={t} className="text-xs bg-surface text-text-muted px-2 py-0.5 rounded border border-border">{t}</span>
                          ))}
                        </div>
                      </div>
                    )}
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

        {/* Vector Search */}
        <Card className="mt-6">
          <h3 className="text-lg font-semibold text-text mb-2">7. Vector Search (Direct Qdrant)</h3>
          <p className="text-sm text-text-secondary mb-4">
            Search the vector store directly without LLM generation. Useful for debugging embeddings.
          </p>
          <InfoBox>
            <strong className="text-text">POST /vector-search</strong> — Embeds your query and searches Qdrant directly.
            Returns matching vectors with similarity scores (no LLM call).
          </InfoBox>

          <div className="space-y-3 mb-4">
            <div className="flex gap-3">
              <input
                type="text"
                value={vectorQuery}
                onChange={e => setVectorQuery(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && runVectorSearch()}
                placeholder="Enter search query..."
                className="flex-1 px-4 py-2 bg-surface border border-border rounded-lg text-text placeholder:text-text-muted focus:border-accent focus:ring-1 focus:ring-accent transition-colors"
                disabled={vectorLoading}
              />
              <Button onClick={runVectorSearch} disabled={vectorLoading || !vectorQuery.trim()}>
                {vectorLoading ? 'Searching...' : 'Search'}
              </Button>
            </div>
            <div className="flex gap-4 items-center">
              <label className="text-sm text-text-secondary">
                Top K:
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
                Found {vectorResults.results.length} results | Embedding dimension: {vectorResults.query_embedding_dim}
              </p>
              {vectorResults.results.length === 0 ? (
                <p className="text-text-muted text-sm">No results found. Try a different query or check if the collection has data.</p>
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
          <h3 className="text-lg font-semibold text-text mb-2">8. User Onboarding Test</h3>
          <p className="text-sm text-text-secondary mb-4">
            Test the user creation flow with dynamic fields based on user type.
          </p>
          <InfoBox>
            <strong className="text-text">GET /user-types</strong> — Fetch available user types. <br />
            <strong className="text-text">GET /admin/user-fields</strong> — Get field definitions for a type. <br />
            <strong className="text-text">POST /users</strong> — Create a new user with fields.
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
                    <p className="text-text-muted text-sm">No user types configured. Go to Admin Setup to create some.</p>
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
                <p className="text-sm font-medium text-text mb-3">2. Fill in fields for selected type:</p>
                {fieldDefinitions.length === 0 ? (
                  <p className="text-text-muted text-sm">No fields defined for this type.</p>
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
                <p className="text-sm font-medium text-text mb-3">3. Enter pubkey and create user:</p>
                <div className="flex gap-3">
                  <input
                    type="text"
                    value={testPubkey}
                    onChange={(e) => setTestPubkey(e.target.value)}
                    placeholder="Enter test pubkey (e.g., npub1... or hex)"
                    className="flex-1 px-3 py-2 bg-surface border border-border rounded-lg text-text text-sm placeholder:text-text-muted focus:border-accent focus:ring-1 focus:ring-accent"
                  />
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
          <h3 className="text-lg font-semibold text-text mb-2">9. Neo4j Graph Query</h3>
          <p className="text-sm text-text-secondary mb-4">
            Run read-only Cypher queries against the knowledge graph.
          </p>
          <InfoBox>
            <strong className="text-text">POST /admin/neo4j/query</strong> — Execute a Cypher query (MATCH only, no writes).
            Useful for exploring entities and relationships after ingestion.
          </InfoBox>

          <div className="space-y-4">
            <div className="flex flex-wrap gap-2 mb-2">
              <span className="text-xs text-text-muted">Examples:</span>
              <button
                onClick={() => setCypherQuery('MATCH (n) RETURN n LIMIT 10')}
                className="text-xs text-accent hover:text-accent-hover underline"
              >
                All nodes
              </button>
              <button
                onClick={() => setCypherQuery('MATCH (c:Claim)-[r:SUPPORTED_BY]->(s:Source) RETURN c, r, s LIMIT 10')}
                className="text-xs text-accent hover:text-accent-hover underline"
              >
                Claims + Sources
              </button>
              <button
                onClick={() => setCypherQuery('MATCH (n) RETURN labels(n) AS type, count(*) AS count')}
                className="text-xs text-accent hover:text-accent-hover underline"
              >
                Node counts by type
              </button>
              <button
                onClick={() => setCypherQuery('MATCH ()-[r]->() RETURN type(r) AS rel_type, count(*) AS count')}
                className="text-xs text-accent hover:text-accent-hover underline"
              >
                Relationship counts
              </button>
            </div>
            <textarea
              value={cypherQuery}
              onChange={(e) => setCypherQuery(e.target.value)}
              placeholder="MATCH (n) RETURN n LIMIT 10"
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
                      {neo4jResult.rows.length} row(s) returned | Columns: {neo4jResult.columns.join(', ')}
                    </p>
                    {neo4jResult.rows.length === 0 ? (
                      <p className="text-text-muted text-sm">No results.</p>
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

        <SectionHeader title="Authentication Testing" icon={Key} />

        {/* Admin Session Panel */}
        <Card className="mb-6 border-accent/30">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Shield className="w-5 h-5 text-accent" />
              <h3 className="text-lg font-semibold text-text">Admin Session</h3>
            </div>
            {adminToken ? (
              <StatusBadge status="success" />
            ) : (
              <StatusBadge status="warning" />
            )}
          </div>
          <p className="text-sm text-text-secondary mb-4">
            Admin authentication is required for admin-only endpoints below. Authenticate via Nostr or paste a token.
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
                Clear Session
              </Button>
            </div>
            {nostrAuthError && (
              <div className="bg-error-subtle border border-error/20 text-error rounded-lg px-4 py-3 text-sm">
                {nostrAuthError}
              </div>
            )}
            {nostrAuthResult && (
              <div className="bg-success-subtle border border-success/20 rounded-lg px-4 py-3 text-sm">
                <p className="text-success font-medium">Authenticated as admin!</p>
                <p className="text-text-secondary mt-1 font-mono text-xs">Pubkey: {nostrAuthResult.admin.pubkey.slice(0, 16)}...</p>
              </div>
            )}
            <div className="border-t border-border pt-4">
              <p className="text-xs text-text-muted mb-2">Or paste an existing admin session token:</p>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={adminToken}
                  onChange={(e) => setAdminToken(e.target.value)}
                  placeholder="Paste admin session token..."
                  className="flex-1 px-3 py-2 bg-surface border border-border rounded-lg text-text text-sm font-mono placeholder:text-text-muted focus:border-accent focus:ring-1 focus:ring-accent"
                />
                <Button
                  variant="secondary"
                  onClick={() => {
                    if (adminToken) {
                      localStorage.setItem(STORAGE_KEYS.ADMIN_SESSION_TOKEN, adminToken)
                    }
                  }}
                >
                  Save
                </Button>
              </div>
            </div>
            {adminToken && (
              <p className="text-xs text-text-muted">
                Token stored: {adminToken.slice(0, 20)}...
              </p>
            )}
          </div>
        </Card>

        {/* Module 10: Authentication Testing */}
        <CollapsibleSection title="Authentication Testing" moduleNumber={10} icon={Key}>
          <p className="text-sm text-text-secondary mb-4">
            Test magic link and Nostr authentication flows.
          </p>

          {/* Magic Link */}
          <div className="mb-6">
            <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-3">Magic Link Authentication</p>
            <InfoBox>
              <strong className="text-text">POST /auth/magic-link</strong> — Send a magic link to the provided email. Rate limited: 5 requests/minute.
            </InfoBox>
            <div className="flex flex-wrap gap-3 mb-3">
              <input
                type="email"
                value={magicLinkEmail}
                onChange={(e) => setMagicLinkEmail(e.target.value)}
                placeholder="Email address"
                className="flex-1 min-w-[200px] px-3 py-2 bg-surface border border-border rounded-lg text-text text-sm placeholder:text-text-muted focus:border-accent focus:ring-1 focus:ring-accent"
              />
              <input
                type="text"
                value={magicLinkName}
                onChange={(e) => setMagicLinkName(e.target.value)}
                placeholder="Name (optional)"
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
            <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-3">Verify Magic Link Token</p>
            <InfoBox>
              <strong className="text-text">GET /auth/verify?token=...</strong> — Verify a magic link token and get session token.
            </InfoBox>
            <div className="flex gap-3 mb-3">
              <input
                type="text"
                value={verifyToken}
                onChange={(e) => setVerifyToken(e.target.value)}
                placeholder="Paste magic link token..."
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
            <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-3">Check Session Status</p>
            <InfoBox>
              <strong className="text-text">GET /auth/me?token=...</strong> — Check if a session token is valid and get user info.
            </InfoBox>
            <div className="flex gap-3 mb-3">
              <input
                type="text"
                value={sessionCheckToken}
                onChange={(e) => setSessionCheckToken(e.target.value)}
                placeholder="Paste session token..."
                className="flex-1 px-3 py-2 bg-surface border border-border rounded-lg text-text text-sm font-mono placeholder:text-text-muted focus:border-accent focus:ring-1 focus:ring-accent"
              />
              <Button onClick={checkAuthStatus} disabled={sessionCheckLoading || !sessionCheckToken.trim()}>
                {sessionCheckLoading ? 'Checking...' : 'Check Status'}
              </Button>
            </div>
            {sessionCheckResult && (
              <CodeBlock>{JSON.stringify(sessionCheckResult, null, 2)}</CodeBlock>
            )}
          </div>

          {/* Admin List */}
          <div className="border-t border-border pt-6 mb-6">
            <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-3">Admin List</p>
            <InfoBox>
              <strong className="text-text">GET /admin/list</strong> — List all admins. Requires admin authentication.
            </InfoBox>
            <Button onClick={fetchAdmins} disabled={adminsLoading || !adminToken}>
              {adminsLoading ? 'Fetching...' : 'Fetch Admins'}
            </Button>
            {!adminToken && <p className="text-xs text-warning mt-2">Requires admin session above</p>}
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
            <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-3">Remove Admin</p>
            <InfoBox>
              <strong className="text-text">DELETE /admin/&#123;pubkey&#125;</strong> — Remove an admin by pubkey. Requires admin authentication.
            </InfoBox>
            <div className="flex gap-3 mb-3">
              <input
                type="text"
                value={removeAdminPubkey}
                onChange={(e) => setRemoveAdminPubkey(e.target.value)}
                placeholder="Admin pubkey to remove..."
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
        <CollapsibleSection title="Rate Limiting Test" moduleNumber={16} icon={Zap}>
          <p className="text-sm text-text-secondary mb-4">
            Test rate limiting by sending rapid requests to rate-limited endpoints.
          </p>
          <InfoBox>
            <strong className="text-text">Magic Link:</strong> 5 requests/minute | <strong className="text-text">Admin Auth:</strong> 10 requests/minute
          </InfoBox>
          <div className="flex flex-wrap gap-3 items-center mb-4">
            <select
              value={rateLimitTestType}
              onChange={(e) => setRateLimitTestType(e.target.value as 'magic_link' | 'admin_auth')}
              className="px-3 py-2 bg-surface border border-border rounded-lg text-text text-sm focus:border-accent focus:ring-1 focus:ring-accent"
            >
              <option value="magic_link">Magic Link (5/min)</option>
              <option value="admin_auth">Admin Auth (10/min)</option>
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
                  <p className="text-xs text-text-secondary">Blocked (429)</p>
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

        <SectionHeader title="Admin: Instance & User Management" icon={Sliders} />

        {/* Module 11: Instance Settings */}
        <CollapsibleSection title="Instance Settings" moduleNumber={11} badge="Admin" icon={Settings}>
          <p className="text-sm text-text-secondary mb-4">
            View and update instance-wide configuration settings.
          </p>
          <InfoBox>
            <strong className="text-text">GET /admin/settings</strong> — Fetch all settings. <br />
            <strong className="text-text">PUT /admin/settings</strong> — Update settings.
          </InfoBox>
          <Button onClick={fetchInstanceSettings} disabled={settingsLoading || !adminToken}>
            {settingsLoading ? 'Fetching...' : 'Fetch Settings'}
          </Button>
          {!adminToken && <p className="text-xs text-warning mt-2">Requires admin session</p>}
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
                        <option value="true">true (auto-approve new users)</option>
                        <option value="false">false (require manual approval)</option>
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
        <CollapsibleSection title="User Type Management" moduleNumber={12} badge="Admin" icon={Users}>
          <p className="text-sm text-text-secondary mb-4">
            Manage user types for categorizing users during onboarding.
          </p>
          <InfoBox>
            <strong className="text-text">GET/POST /admin/user-types</strong> — List and create user types. <br />
            <strong className="text-text">PUT/DELETE /admin/user-types/&#123;id&#125;</strong> — Update and delete.
          </InfoBox>
          <Button onClick={fetchAdminUserTypes} disabled={adminUserTypesLoading || !adminToken}>
            {adminUserTypesLoading ? 'Fetching...' : 'Fetch User Types'}
          </Button>
          {!adminToken && <p className="text-xs text-warning mt-2">Requires admin session</p>}
          {adminUserTypes && (
            <div className="mt-4 space-y-4">
              {adminUserTypes.length === 0 ? (
                <p className="text-text-muted text-sm">No user types defined.</p>
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
                  <p className="text-sm font-medium text-text mb-3">Edit User Type #{editingTypeId}</p>
                  <div className="grid gap-3">
                    <input
                      type="text"
                      value={editTypeName}
                      onChange={(e) => setEditTypeName(e.target.value)}
                      placeholder="Name"
                      className="px-3 py-2 bg-surface border border-border rounded-lg text-text text-sm"
                    />
                    <input
                      type="text"
                      value={editTypeDescription}
                      onChange={(e) => setEditTypeDescription(e.target.value)}
                      placeholder="Description"
                      className="px-3 py-2 bg-surface border border-border rounded-lg text-text text-sm"
                    />
                    <input
                      type="number"
                      value={editTypeOrder}
                      onChange={(e) => setEditTypeOrder(Number(e.target.value))}
                      placeholder="Display order"
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
                <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-3">Create New User Type</p>
                <div className="flex flex-wrap gap-3 items-end">
                  <div>
                    <label className="text-xs text-text-muted">Name</label>
                    <input
                      type="text"
                      value={newTypeName}
                      onChange={(e) => setNewTypeName(e.target.value)}
                      placeholder="Developer"
                      className="block mt-1 px-3 py-2 bg-surface border border-border rounded-lg text-text text-sm"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-text-muted">Description</label>
                    <input
                      type="text"
                      value={newTypeDescription}
                      onChange={(e) => setNewTypeDescription(e.target.value)}
                      placeholder="Software developers"
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
        <CollapsibleSection title="User Field Definitions" moduleNumber={13} badge="Admin" icon={FileText}>
          <p className="text-sm text-text-secondary mb-4">
            Manage custom fields that users fill out during onboarding.
          </p>
          <InfoBox>
            <strong className="text-text">GET/POST /admin/user-fields</strong> — List and create fields. <br />
            <strong className="text-text">PUT/DELETE /admin/user-fields/&#123;id&#125;</strong> — Update and delete.
          </InfoBox>
          <div className="flex flex-wrap gap-3 items-center mb-4">
            <select
              value={fieldTypeFilter}
              onChange={(e) => setFieldTypeFilter(e.target.value === 'all' ? 'all' : e.target.value === 'global' ? 'global' : Number(e.target.value))}
              className="px-3 py-2 bg-surface border border-border rounded-lg text-text text-sm"
            >
              <option value="all">All Fields</option>
              <option value="global">Global Only</option>
              {adminUserTypes?.map((t) => (
                <option key={t.id} value={t.id}>{t.name} Only</option>
              ))}
            </select>
            <Button onClick={fetchAdminFieldDefs} disabled={fieldDefsLoading || !adminToken}>
              {fieldDefsLoading ? 'Fetching...' : 'Fetch Fields'}
            </Button>
          </div>
          {!adminToken && <p className="text-xs text-warning mt-2">Requires admin session</p>}
          {adminFieldDefs && (
            <div className="mt-4 space-y-4">
              {adminFieldDefs.length === 0 ? (
                <p className="text-text-muted text-sm">No field definitions found.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="text-left py-2 px-2 text-text-muted font-medium">ID</th>
                        <th className="text-left py-2 px-2 text-text-muted font-medium">Name</th>
                        <th className="text-left py-2 px-2 text-text-muted font-medium">Type</th>
                        <th className="text-left py-2 px-2 text-text-muted font-medium">Required</th>
                        <th className="text-left py-2 px-2 text-text-muted font-medium">User Type</th>
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
                <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-3">Create New Field</p>
                <div className="flex flex-wrap gap-3 items-end">
                  <div>
                    <label className="text-xs text-text-muted">Name</label>
                    <input
                      type="text"
                      value={newFieldName}
                      onChange={(e) => setNewFieldName(e.target.value)}
                      placeholder="company_name"
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
                    <label className="text-xs text-text-muted">User Type</label>
                    <select
                      value={newFieldUserTypeId}
                      onChange={(e) => setNewFieldUserTypeId(e.target.value === 'global' ? 'global' : Number(e.target.value))}
                      className="block mt-1 px-3 py-2 bg-surface border border-border rounded-lg text-text text-sm"
                    >
                      <option value="global">Global (all types)</option>
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
        <CollapsibleSection title="User Management" moduleNumber={14} badge="Admin" icon={Users}>
          <p className="text-sm text-text-secondary mb-4">
            View all users, manage approval status, and delete users.
          </p>
          <InfoBox>
            <strong className="text-text">GET /admin/users</strong> — List all users (admin only). <br />
            <strong className="text-text">GET/PUT/DELETE /users/&#123;id&#125;</strong> — Manage individual users.
          </InfoBox>
          <Button onClick={fetchAllUsers} disabled={usersLoading || !adminToken}>
            {usersLoading ? 'Fetching...' : 'Fetch All Users'}
          </Button>
          {!adminToken && <p className="text-xs text-warning mt-2">Requires admin session</p>}
          {allUsers && (
            <div className="mt-4 space-y-4">
              {allUsers.length === 0 ? (
                <p className="text-text-muted text-sm">No users found.</p>
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
                          <td className="py-2 px-2 text-text">{user.email || '-'}</td>
                          <td className="py-2 px-2 text-text-secondary">{user.name || '-'}</td>
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
                <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-3">Lookup Single User</p>
                <div className="flex gap-3 mb-3">
                  <input
                    type="text"
                    value={lookupUserId}
                    onChange={(e) => setLookupUserId(e.target.value)}
                    placeholder="User ID"
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

        <SectionHeader title="Admin: Database" icon={Database} />

        {/* Module 15: Database Explorer */}
        <CollapsibleSection title="Database Explorer (Quick View)" moduleNumber={15} badge="Admin" icon={Database}>
          <p className="text-sm text-text-secondary mb-4">
            Quick view of SQLite database. For full explorer, visit{' '}
            <Link to="/admin/database" className="text-accent hover:text-accent-hover underline">/admin/database</Link>.
          </p>
          <InfoBox>
            <strong className="text-text">GET /admin/db/tables</strong> — List tables. <br />
            <strong className="text-text">POST /admin/db/query</strong> — Execute read-only SQL.
          </InfoBox>
          <Button onClick={fetchDbTables} disabled={dbTablesLoading || !adminToken}>
            {dbTablesLoading ? 'Fetching...' : 'Fetch Tables'}
          </Button>
          {!adminToken && <p className="text-xs text-warning mt-2">Requires admin session</p>}
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

              {tableDataLoading && <p className="text-text-muted text-sm">Loading table data...</p>}
              {tableData && selectedDbTable && (
                <div>
                  <p className="text-sm font-medium text-text mb-2">
                    {selectedDbTable} (first 20 rows)
                  </p>
                  <div className="overflow-x-auto max-h-60">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-border">
                          {tableData.columns.map((col) => (
                            <th key={col} className="text-left py-2 px-2 text-text-muted font-medium">{col}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {tableData.rows.map((row, idx) => (
                          <tr key={idx} className="border-b border-border/50">
                            {tableData.columns.map((col) => (
                              <td key={col} className="py-2 px-2 text-text font-mono">
                                {String(row[col] ?? '')}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Quick Query */}
              <div className="border-t border-border pt-4">
                <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-3">Quick SQL Query</p>
                <textarea
                  value={dbQuery}
                  onChange={(e) => setDbQuery(e.target.value)}
                  placeholder="SELECT * FROM users LIMIT 10"
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
                    ) : (
                      <div>
                        <p className="text-sm text-text-secondary mb-2">
                          {dbQueryResult.rows.length} row(s) returned
                        </p>
                        <div className="overflow-x-auto max-h-60">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="border-b border-border">
                                {dbQueryResult.columns.map((col) => (
                                  <th key={col} className="text-left py-2 px-2 text-text-muted font-medium">{col}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {dbQueryResult.rows.map((row, idx) => (
                                <tr key={idx} className="border-b border-border/50">
                                  {dbQueryResult.columns.map((col) => (
                                    <td key={col} className="py-2 px-2 text-text font-mono">
                                      {typeof row[col] === 'object'
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
                    )}
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
          Sanctum — Private RAG System for Curated Knowledge
        </div>
      </footer>
    </div>
  )
}
