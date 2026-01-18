import { useState, useEffect, useCallback } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { ArrowLeft, SquareTerminal, RefreshCw, Loader2, Play, Database, Key, X, Pencil, Trash2, ChevronLeft, ChevronRight } from 'lucide-react'
import { STORAGE_KEYS } from '../types/onboarding'
import {
  TableInfo,
  ColumnInfo,
  QueryResponse,
  DB_API_BASE,
  formatCellValue,
  truncateValue,
  isJsonValue,
} from '../types/database'

// TODO: Replace localStorage check with proper auth token validation
// Current implementation only checks for admin pubkey in localStorage

// =============================================================================
// MOCK DATA - Remove once backend is implemented
// =============================================================================

// TODO: Remove mock data once backend API is available
const MOCK_TABLES: TableInfo[] = [
  {
    name: 'instance_config',
    rowCount: 1,
    columns: [
      { name: 'id', type: 'INTEGER', nullable: false, primaryKey: true },
      { name: 'name', type: 'TEXT', nullable: false, primaryKey: false },
      { name: 'icon', type: 'TEXT', nullable: false, primaryKey: false },
      { name: 'accent_color', type: 'TEXT', nullable: false, primaryKey: false },
      { name: 'created_at', type: 'TEXT', nullable: false, primaryKey: false },
      { name: 'updated_at', type: 'TEXT', nullable: false, primaryKey: false },
    ],
  },
  {
    name: 'users',
    rowCount: 3,
    columns: [
      { name: 'id', type: 'INTEGER', nullable: false, primaryKey: true },
      { name: 'email', type: 'TEXT', nullable: false, primaryKey: false },
      { name: 'name', type: 'TEXT', nullable: true, primaryKey: false },
      { name: 'role', type: 'TEXT', nullable: false, primaryKey: false, defaultValue: 'user' },
      { name: 'created_at', type: 'TEXT', nullable: false, primaryKey: false },
    ],
  },
  {
    name: 'documents',
    rowCount: 5,
    columns: [
      { name: 'id', type: 'INTEGER', nullable: false, primaryKey: true },
      { name: 'filename', type: 'TEXT', nullable: false, primaryKey: false },
      { name: 'file_type', type: 'TEXT', nullable: false, primaryKey: false },
      { name: 'size_bytes', type: 'INTEGER', nullable: false, primaryKey: false },
      { name: 'status', type: 'TEXT', nullable: false, primaryKey: false },
      { name: 'uploaded_by', type: 'INTEGER', nullable: true, primaryKey: false },
      { name: 'created_at', type: 'TEXT', nullable: false, primaryKey: false },
    ],
  },
  {
    name: 'custom_fields',
    rowCount: 2,
    columns: [
      { name: 'id', type: 'INTEGER', nullable: false, primaryKey: true },
      { name: 'field_name', type: 'TEXT', nullable: false, primaryKey: false },
      { name: 'field_type', type: 'TEXT', nullable: false, primaryKey: false },
      { name: 'required', type: 'INTEGER', nullable: false, primaryKey: false },
      { name: 'options', type: 'TEXT', nullable: true, primaryKey: false },
      { name: 'display_order', type: 'INTEGER', nullable: false, primaryKey: false },
    ],
  },
  {
    name: 'audit_log',
    rowCount: 12,
    columns: [
      { name: 'id', type: 'INTEGER', nullable: false, primaryKey: true },
      { name: 'action', type: 'TEXT', nullable: false, primaryKey: false },
      { name: 'table_name', type: 'TEXT', nullable: true, primaryKey: false },
      { name: 'record_id', type: 'INTEGER', nullable: true, primaryKey: false },
      { name: 'admin_pubkey', type: 'TEXT', nullable: false, primaryKey: false },
      { name: 'details', type: 'TEXT', nullable: true, primaryKey: false },
      { name: 'created_at', type: 'TEXT', nullable: false, primaryKey: false },
    ],
  },
]

// Mock data for tables
const MOCK_TABLE_DATA: Record<string, Record<string, unknown>[]> = {
  instance_config: [
    { id: 1, name: 'Sanctum', icon: 'Sparkles', accent_color: 'blue', created_at: '2024-01-15T10:00:00Z', updated_at: '2024-01-20T15:30:00Z' },
  ],
  users: [
    { id: 1, email: 'admin@example.com', name: 'Admin User', role: 'admin', created_at: '2024-01-15T10:00:00Z' },
    { id: 2, email: 'user1@example.com', name: 'John Doe', role: 'user', created_at: '2024-01-16T11:00:00Z' },
    { id: 3, email: 'user2@example.com', name: null, role: 'user', created_at: '2024-01-17T09:30:00Z' },
  ],
  documents: [
    { id: 1, filename: 'bitcoin_whitepaper.pdf', file_type: 'pdf', size_bytes: 184292, status: 'processed', uploaded_by: 1, created_at: '2024-01-18T14:00:00Z' },
    { id: 2, filename: 'lightning_network.pdf', file_type: 'pdf', size_bytes: 523841, status: 'processed', uploaded_by: 1, created_at: '2024-01-18T14:30:00Z' },
    { id: 3, filename: 'notes.txt', file_type: 'txt', size_bytes: 2341, status: 'pending', uploaded_by: 2, created_at: '2024-01-19T10:00:00Z' },
    { id: 4, filename: 'research.md', file_type: 'md', size_bytes: 8721, status: 'processing', uploaded_by: null, created_at: '2024-01-19T11:00:00Z' },
    { id: 5, filename: 'guide.pdf', file_type: 'pdf', size_bytes: 102400, status: 'failed', uploaded_by: 1, created_at: '2024-01-20T09:00:00Z' },
  ],
  custom_fields: [
    { id: 1, field_name: 'Company', field_type: 'text', required: 0, options: null, display_order: 1 },
    { id: 2, field_name: 'Role', field_type: 'select', required: 1, options: '["Developer","Designer","Manager","Other"]', display_order: 2 },
  ],
  audit_log: [
    { id: 1, action: 'CREATE', table_name: 'users', record_id: 2, admin_pubkey: 'npub1abc...', details: '{"email":"user1@example.com"}', created_at: '2024-01-16T11:00:00Z' },
    { id: 2, action: 'UPDATE', table_name: 'instance_config', record_id: 1, admin_pubkey: 'npub1abc...', details: '{"accent_color":"purple"}', created_at: '2024-01-17T10:00:00Z' },
    { id: 3, action: 'CREATE', table_name: 'documents', record_id: 1, admin_pubkey: 'npub1abc...', details: null, created_at: '2024-01-18T14:00:00Z' },
  ],
}

// =============================================================================
// COMPONENT
// =============================================================================

export function AdminDatabaseExplorer() {
  const navigate = useNavigate()

  // Auth state
  const [isAuthorized, setIsAuthorized] = useState(false)

  // Tables state
  const [tables, setTables] = useState<TableInfo[]>([])
  const [selectedTable, setSelectedTable] = useState<string | null>(null)
  const [isLoadingTables, setIsLoadingTables] = useState(true)

  // Table data state
  const [tableData, setTableData] = useState<Record<string, unknown>[]>([])
  const [isLoadingData, setIsLoadingData] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize] = useState(10)

  // Query state
  const [queryMode, setQueryMode] = useState(false)
  const [sqlQuery, setSqlQuery] = useState('')
  const [queryResult, setQueryResult] = useState<QueryResponse | null>(null)
  const [isRunningQuery, setIsRunningQuery] = useState(false)

  // Record editor state
  const [editingRecord, setEditingRecord] = useState<Record<string, unknown> | null>(null)
  const [isCreatingRecord, setIsCreatingRecord] = useState(false)
  const [recordFormData, setRecordFormData] = useState<Record<string, string>>({})
  const [isSavingRecord, setIsSavingRecord] = useState(false)

  // Cell detail view
  const [expandedCell, setExpandedCell] = useState<{ row: number; col: string } | null>(null)

  // Check if admin is logged in
  useEffect(() => {
    const pubkey = localStorage.getItem(STORAGE_KEYS.ADMIN_PUBKEY)
    if (!pubkey) {
      navigate('/admin')
    } else {
      setIsAuthorized(true)
    }
  }, [navigate])

  // Fetch tables list
  const fetchTables = useCallback(async () => {
    setIsLoadingTables(true)
    try {
      // TODO: Replace with actual API call once backend is implemented
      // const response = await fetch(`${DB_API_BASE}/admin/db/tables`)
      // if (!response.ok) throw new Error('Failed to fetch tables')
      // const data = await response.json()
      // setTables(data.tables)

      // Mock implementation - remove when backend is ready
      await new Promise((resolve) => setTimeout(resolve, 500)) // Simulate network delay
      setTables(MOCK_TABLES)

      // Auto-select first table
      if (MOCK_TABLES.length > 0 && !selectedTable) {
        setSelectedTable(MOCK_TABLES[0].name)
      }
    } catch (error) {
      console.error('Error fetching tables:', error)
      // TODO: Show user-friendly error toast/message
    } finally {
      setIsLoadingTables(false)
    }
  }, [selectedTable])

  useEffect(() => {
    if (isAuthorized) {
      fetchTables()
    }
  }, [isAuthorized, fetchTables])

  // Fetch table data when selection changes
  const fetchTableData = useCallback(async (tableName: string) => {
    setIsLoadingData(true)
    setCurrentPage(1)
    try {
      // TODO: Replace with actual API call once backend is implemented
      // const response = await fetch(
      //   `${DB_API_BASE}/admin/db/tables/${tableName}?page=${currentPage}&pageSize=${pageSize}`
      // )
      // if (!response.ok) throw new Error('Failed to fetch table data')
      // const data = await response.json()
      // setTableData(data.rows)

      // Mock implementation - remove when backend is ready
      await new Promise((resolve) => setTimeout(resolve, 300))
      setTableData(MOCK_TABLE_DATA[tableName] || [])
    } catch (error) {
      console.error('Error fetching table data:', error)
      setTableData([])
    } finally {
      setIsLoadingData(false)
    }
  }, [])

  useEffect(() => {
    if (selectedTable) {
      fetchTableData(selectedTable)
    }
  }, [selectedTable, fetchTableData])

  // Run SQL query
  const runQuery = async () => {
    if (!sqlQuery.trim()) return

    setIsRunningQuery(true)
    setQueryResult(null)

    try {
      // TODO: Replace with actual API call once backend is implemented
      // const response = await fetch(`${DB_API_BASE}/admin/db/query`, {
      //   method: 'POST',
      //   headers: { 'Content-Type': 'application/json' },
      //   body: JSON.stringify({ sql: sqlQuery }),
      // })
      // const data = await response.json()
      // setQueryResult(data)

      // Mock implementation - simulate query execution
      await new Promise((resolve) => setTimeout(resolve, 400))

      // Simple mock query parser
      const queryLower = sqlQuery.toLowerCase().trim()
      if (queryLower.startsWith('select')) {
        // Try to extract table name and return mock data
        const tableMatch = queryLower.match(/from\s+(\w+)/)
        if (tableMatch && MOCK_TABLE_DATA[tableMatch[1]]) {
          const mockData = MOCK_TABLE_DATA[tableMatch[1]]
          setQueryResult({
            success: true,
            columns: mockData.length > 0 ? Object.keys(mockData[0]) : [],
            rows: mockData,
            executionTimeMs: Math.floor(Math.random() * 50) + 10,
          })
        } else {
          setQueryResult({
            success: true,
            columns: [],
            rows: [],
            executionTimeMs: 5,
          })
        }
      } else if (queryLower.startsWith('insert') || queryLower.startsWith('update') || queryLower.startsWith('delete')) {
        setQueryResult({
          success: true,
          rowsAffected: 1,
          executionTimeMs: Math.floor(Math.random() * 30) + 5,
        })
      } else {
        setQueryResult({
          success: false,
          error: 'Only SELECT, INSERT, UPDATE, and DELETE queries are supported',
        })
      }
    } catch (error) {
      setQueryResult({
        success: false,
        error: error instanceof Error ? error.message : 'Query execution failed',
      })
    } finally {
      setIsRunningQuery(false)
    }
  }

  // Handle record creation
  const handleCreateRecord = () => {
    const table = tables.find((t) => t.name === selectedTable)
    if (!table) return

    // Initialize form with empty values (skip auto-increment primary key)
    const initialData: Record<string, string> = {}
    table.columns.forEach((col) => {
      if (!col.primaryKey) {
        initialData[col.name] = col.defaultValue || ''
      }
    })

    setRecordFormData(initialData)
    setIsCreatingRecord(true)
    setEditingRecord(null)
  }

  // Handle record edit
  const handleEditRecord = (record: Record<string, unknown>) => {
    const formData: Record<string, string> = {}
    Object.entries(record).forEach(([key, value]) => {
      formData[key] = value === null ? '' : String(value)
    })

    setRecordFormData(formData)
    setEditingRecord(record)
    setIsCreatingRecord(false)
  }

  // Handle record save
  const handleSaveRecord = async () => {
    setIsSavingRecord(true)

    try {
      if (isCreatingRecord) {
        // TODO: Replace with actual API call
        // await fetch(`${DB_API_BASE}/admin/db/tables/${selectedTable}/rows`, {
        //   method: 'POST',
        //   headers: { 'Content-Type': 'application/json' },
        //   body: JSON.stringify({ data: recordFormData }),
        // })
        console.log('Creating record:', recordFormData)
      } else if (editingRecord) {
        // TODO: Replace with actual API call
        // const recordId = editingRecord.id
        // await fetch(`${DB_API_BASE}/admin/db/tables/${selectedTable}/rows/${recordId}`, {
        //   method: 'PUT',
        //   headers: { 'Content-Type': 'application/json' },
        //   body: JSON.stringify({ data: recordFormData }),
        // })
        console.log('Updating record:', editingRecord, 'with:', recordFormData)
      }

      // Mock: just close the form
      await new Promise((resolve) => setTimeout(resolve, 300))

      // Reset form and refresh data
      setIsCreatingRecord(false)
      setEditingRecord(null)
      setRecordFormData({})

      // TODO: Refresh table data after save
      // fetchTableData(selectedTable!)
    } catch (error) {
      console.error('Error saving record:', error)
      // TODO: Show error message
    } finally {
      setIsSavingRecord(false)
    }
  }

  // Handle record delete
  const handleDeleteRecord = async (record: Record<string, unknown>) => {
    if (!confirm('Are you sure you want to delete this record?')) return

    try {
      // TODO: Replace with actual API call
      // const recordId = record.id
      // await fetch(`${DB_API_BASE}/admin/db/tables/${selectedTable}/rows/${recordId}`, {
      //   method: 'DELETE',
      // })
      console.log('Deleting record:', record)

      // TODO: Refresh table data after delete
      // fetchTableData(selectedTable!)
    } catch (error) {
      console.error('Error deleting record:', error)
    }
  }

  // Cancel editing
  const handleCancelEdit = () => {
    setIsCreatingRecord(false)
    setEditingRecord(null)
    setRecordFormData({})
  }

  // Get current table info
  const currentTableInfo = tables.find((t) => t.name === selectedTable)

  // Get paginated data
  const paginatedData = tableData.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize
  )
  const totalPages = Math.ceil(tableData.length / pageSize)

  if (!isAuthorized) {
    return null // Will redirect
  }

  return (
    <div className="min-h-screen bg-surface flex flex-col">
      {/* Header */}
      <header className="border-b border-border bg-surface-raised shrink-0">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              to="/admin/setup"
              className="p-1.5 -ml-1.5 rounded-lg text-text-muted hover:text-text hover:bg-surface-overlay transition-all"
              title="Back to Admin Setup"
            >
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <div>
              <h1 className="text-lg font-semibold text-text">Database Explorer</h1>
              <p className="text-xs text-text-muted">View and manage SQLite data</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Query Mode Toggle */}
            <button
              onClick={() => setQueryMode(!queryMode)}
              className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                queryMode
                  ? 'bg-accent text-accent-text'
                  : 'border border-border text-text-secondary hover:bg-surface-overlay hover:text-text'
              }`}
            >
              <SquareTerminal className="w-4 h-4" />
              SQL Query
            </button>

            {/* Refresh */}
            <button
              onClick={fetchTables}
              disabled={isLoadingTables}
              className="p-2 rounded-lg text-text-secondary hover:text-text hover:bg-surface-overlay transition-all disabled:opacity-50"
              title="Refresh tables"
            >
              <RefreshCw className={`w-4 h-4 ${isLoadingTables ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar - Tables List */}
        <aside className="w-56 border-r border-border bg-surface-raised shrink-0 overflow-y-auto">
          <div className="p-3">
            <h2 className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-2 px-2">
              Tables
            </h2>

            {isLoadingTables ? (
              <div className="flex items-center justify-center py-8">
                <div className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
              </div>
            ) : tables.length === 0 ? (
              <div className="text-center py-8 px-2">
                <p className="text-sm text-text-muted">No tables found</p>
                <p className="text-xs text-text-muted mt-1">
                  Database may not be initialized
                </p>
              </div>
            ) : (
              <div className="space-y-0.5">
                {tables.map((table) => (
                  <button
                    key={table.name}
                    onClick={() => setSelectedTable(table.name)}
                    className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-all ${
                      selectedTable === table.name
                        ? 'bg-accent text-accent-text'
                        : 'text-text hover:bg-surface-overlay'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium truncate">{table.name}</span>
                      <span className={`text-xs ${
                        selectedTable === table.name ? 'text-accent-text/70' : 'text-text-muted'
                      }`}>
                        {table.rowCount}
                      </span>
                    </div>
                    <div className={`text-xs mt-0.5 ${
                      selectedTable === table.name ? 'text-accent-text/70' : 'text-text-muted'
                    }`}>
                      {table.columns.length} columns
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* TODO: Add table creation UI */}
          {/* <div className="p-3 border-t border-border">
            <button className="w-full ...">Create Table</button>
          </div> */}
        </aside>

        {/* Main Content */}
        <main className="flex-1 flex flex-col overflow-hidden">
          {queryMode ? (
            /* SQL Query Mode */
            <div className="flex-1 flex flex-col p-4 gap-4 overflow-hidden">
              {/* Query Input */}
              <div className="bg-surface-raised border border-border rounded-xl p-4">
                <label className="text-sm font-medium text-text mb-2 block">
                  SQL Query
                </label>
                <textarea
                  value={sqlQuery}
                  onChange={(e) => setSqlQuery(e.target.value)}
                  placeholder="SELECT * FROM users WHERE role = 'admin';"
                  className="w-full h-32 px-4 py-3 bg-surface border border-border rounded-lg text-text font-mono text-sm placeholder:text-text-muted focus:border-accent focus:ring-2 focus:ring-accent/20 resize-none transition-all"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                      runQuery()
                    }
                  }}
                />
                <div className="flex items-center justify-between mt-3">
                  <p className="text-xs text-text-muted">
                    Press Cmd/Ctrl + Enter to run
                  </p>
                  <button
                    onClick={runQuery}
                    disabled={isRunningQuery || !sqlQuery.trim()}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-accent text-accent-text rounded-lg text-sm font-medium hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                  >
                    {isRunningQuery ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Running...
                      </>
                    ) : (
                      <>
                        <Play className="w-4 h-4" />
                        Run Query
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Query Results */}
              {queryResult && (
                <div className="flex-1 bg-surface-raised border border-border rounded-xl overflow-hidden flex flex-col">
                  <div className="px-4 py-2 border-b border-border bg-surface-overlay flex items-center justify-between">
                    <span className="text-sm font-medium text-text">
                      {queryResult.success ? 'Results' : 'Error'}
                    </span>
                    {queryResult.executionTimeMs !== undefined && (
                      <span className="text-xs text-text-muted">
                        {queryResult.executionTimeMs}ms
                      </span>
                    )}
                  </div>

                  {queryResult.error ? (
                    <div className="p-4 bg-error-subtle">
                      <p className="text-sm text-error font-mono">{queryResult.error}</p>
                    </div>
                  ) : queryResult.rowsAffected !== undefined ? (
                    <div className="p-4">
                      <p className="text-sm text-success">
                        {queryResult.rowsAffected} row(s) affected
                        {queryResult.lastInsertId !== undefined && (
                          <span className="text-text-muted ml-2">
                            (Last insert ID: {queryResult.lastInsertId})
                          </span>
                        )}
                      </p>
                    </div>
                  ) : queryResult.rows && queryResult.rows.length > 0 ? (
                    <div className="flex-1 overflow-auto">
                      <table className="w-full text-sm">
                        <thead className="sticky top-0 bg-surface-overlay">
                          <tr>
                            {queryResult.columns?.map((col) => (
                              <th
                                key={col}
                                className="text-left px-3 py-2 font-medium text-text-secondary border-b border-border"
                              >
                                {col}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {queryResult.rows.map((row, i) => (
                            <tr key={i} className="border-b border-border/50 hover:bg-surface-overlay/50">
                              {queryResult.columns?.map((col) => (
                                <td key={col} className="px-3 py-2 text-text font-mono text-xs">
                                  {formatCellValue(row[col])}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="p-4 text-center text-text-muted text-sm">
                      No results returned
                    </div>
                  )}
                </div>
              )}

              {/* TODO: Add query history feature */}
              {/* TODO: Add saved queries feature */}
            </div>
          ) : selectedTable ? (
            /* Table View Mode */
            <div className="flex-1 flex flex-col overflow-hidden">
              {/* Table Header */}
              <div className="px-4 py-3 border-b border-border bg-surface-raised flex items-center justify-between shrink-0">
                <div>
                  <h2 className="text-base font-semibold text-text">{selectedTable}</h2>
                  <p className="text-xs text-text-muted">
                    {currentTableInfo?.columns.length} columns, {tableData.length} rows
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  {/* Add Record Button */}
                  <button
                    onClick={handleCreateRecord}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-accent text-accent-text rounded-lg text-sm font-medium hover:bg-accent-hover transition-all"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                    </svg>
                    Add Row
                  </button>
                </div>
              </div>

              {/* Record Editor Form */}
              {(isCreatingRecord || editingRecord) && currentTableInfo && (
                <div className="px-4 py-3 border-b border-border bg-accent-subtle animate-fade-in">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-semibold text-text">
                      {isCreatingRecord ? 'New Record' : 'Edit Record'}
                    </h3>
                    <button
                      onClick={handleCancelEdit}
                      className="p-1 text-text-muted hover:text-text transition-colors"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                    {currentTableInfo.columns
                      .filter((col) => !col.primaryKey || !isCreatingRecord)
                      .map((col) => (
                        <div key={col.name}>
                          <label className="text-xs font-medium text-text-secondary mb-1 block">
                            {col.name}
                            {!col.nullable && <span className="text-error ml-0.5">*</span>}
                            <span className="text-text-muted ml-1">({col.type})</span>
                          </label>
                          <input
                            type={col.type === 'INTEGER' || col.type === 'REAL' ? 'number' : 'text'}
                            value={recordFormData[col.name] || ''}
                            onChange={(e) =>
                              setRecordFormData((prev) => ({
                                ...prev,
                                [col.name]: e.target.value,
                              }))
                            }
                            disabled={col.primaryKey}
                            placeholder={col.nullable ? 'NULL' : ''}
                            className="w-full px-3 py-1.5 bg-surface border border-border rounded-lg text-text text-sm placeholder:text-text-muted focus:border-accent focus:ring-1 focus:ring-accent/20 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                          />
                        </div>
                      ))}
                  </div>

                  <div className="flex items-center gap-2 mt-3">
                    <button
                      onClick={handleSaveRecord}
                      disabled={isSavingRecord}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-accent text-accent-text rounded-lg text-sm font-medium hover:bg-accent-hover disabled:opacity-50 transition-all"
                    >
                      {isSavingRecord ? 'Saving...' : 'Save'}
                    </button>
                    <button
                      onClick={handleCancelEdit}
                      className="px-3 py-1.5 text-text-secondary hover:text-text text-sm transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {/* Table Data */}
              <div className="flex-1 overflow-auto">
                {isLoadingData ? (
                  <div className="flex items-center justify-center h-full">
                    <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
                  </div>
                ) : tableData.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-text-muted">
                    <Database className="w-12 h-12 mb-3" strokeWidth={1} />
                    <p className="text-sm">No data in this table</p>
                    <button
                      onClick={handleCreateRecord}
                      className="mt-3 text-sm text-accent hover:text-accent-hover transition-colors"
                    >
                      Add your first record
                    </button>
                  </div>
                ) : (
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-surface-raised z-10">
                      <tr>
                        {currentTableInfo?.columns.map((col) => (
                          <th
                            key={col.name}
                            className="text-left px-3 py-2 font-medium text-text-secondary border-b border-border whitespace-nowrap"
                          >
                            <div className="flex items-center gap-1">
                              {col.primaryKey && (
                                <Key className="w-3 h-3 text-warning" />
                              )}
                              {col.name}
                              <span className="text-xs text-text-muted font-normal">
                                {col.type}
                              </span>
                            </div>
                          </th>
                        ))}
                        <th className="w-20 px-3 py-2 border-b border-border"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {paginatedData.map((row, rowIndex) => (
                        <tr
                          key={rowIndex}
                          className="border-b border-border/50 hover:bg-surface-overlay/50 group"
                        >
                          {currentTableInfo?.columns.map((col) => {
                            const value = row[col.name]
                            const displayValue = formatCellValue(value)
                            const isExpanded =
                              expandedCell?.row === rowIndex && expandedCell?.col === col.name
                            const isLongValue = displayValue.length > 50
                            const isJson = isJsonValue(value)

                            return (
                              <td
                                key={col.name}
                                className="px-3 py-2 text-text font-mono text-xs relative"
                              >
                                {isExpanded ? (
                                  <div className="absolute z-20 left-0 top-0 min-w-[300px] max-w-[500px] bg-surface-raised border border-border rounded-lg shadow-lg p-3 animate-fade-in">
                                    <div className="flex items-center justify-between mb-2">
                                      <span className="text-xs font-medium text-text-secondary">
                                        {col.name}
                                      </span>
                                      <button
                                        onClick={() => setExpandedCell(null)}
                                        className="p-1 text-text-muted hover:text-text"
                                      >
                                        <X className="w-3 h-3" />
                                      </button>
                                    </div>
                                    <pre className="text-xs whitespace-pre-wrap break-all max-h-60 overflow-auto">
                                      {isJson
                                        ? JSON.stringify(JSON.parse(String(value)), null, 2)
                                        : displayValue}
                                    </pre>
                                  </div>
                                ) : (
                                  <span
                                    className={`${
                                      value === null ? 'text-text-muted italic' : ''
                                    } ${isLongValue ? 'cursor-pointer hover:text-accent' : ''}`}
                                    onClick={() =>
                                      isLongValue &&
                                      setExpandedCell({ row: rowIndex, col: col.name })
                                    }
                                    title={isLongValue ? 'Click to expand' : undefined}
                                  >
                                    {truncateValue(displayValue)}
                                  </span>
                                )}
                              </td>
                            )
                          })}
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button
                                onClick={() => handleEditRecord(row)}
                                className="p-1 text-text-muted hover:text-accent transition-colors"
                                title="Edit"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => handleDeleteRecord(row)}
                                className="p-1 text-text-muted hover:text-error transition-colors"
                                title="Delete"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              {/* Pagination */}
              {tableData.length > pageSize && (
                <div className="px-4 py-2 border-t border-border bg-surface-raised flex items-center justify-between shrink-0">
                  <span className="text-xs text-text-muted">
                    Showing {(currentPage - 1) * pageSize + 1} to{' '}
                    {Math.min(currentPage * pageSize, tableData.length)} of {tableData.length}
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                      disabled={currentPage === 1}
                      className="p-1.5 rounded text-text-secondary hover:text-text hover:bg-surface-overlay disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <span className="text-xs text-text px-2">
                      {currentPage} / {totalPages}
                    </span>
                    <button
                      onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                      disabled={currentPage === totalPages}
                      className="p-1.5 rounded text-text-secondary hover:text-text hover:bg-surface-overlay disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            /* No Table Selected */
            <div className="flex-1 flex items-center justify-center text-text-muted">
              <div className="text-center">
                <Database className="w-16 h-16 mx-auto mb-4" strokeWidth={1} />
                <p className="text-sm">Select a table from the sidebar</p>
                <p className="text-xs mt-1">or use SQL Query mode</p>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* Status Bar */}
      <footer className="border-t border-border bg-surface-raised px-4 py-1.5 flex items-center justify-between text-xs text-text-muted shrink-0">
        <div className="flex items-center gap-4">
          <span>
            {tables.length} table{tables.length !== 1 ? 's' : ''}
          </span>
          {selectedTable && (
            <span>
              {tableData.length} row{tableData.length !== 1 ? 's' : ''} in {selectedTable}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* TODO: Add connection status indicator */}
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-warning animate-pulse" />
            Mock Data
          </span>
        </div>
      </footer>
    </div>
  )
}

/**
 * TODO LIST FOR BACKEND IMPLEMENTATION:
 *
 * 1. Create SQLite database file for instance configuration
 *    - Location: /data/sanctum.db or configurable path
 *    - Initialize with schema on first run
 *
 * 2. Implement FastAPI router for admin database endpoints:
 *    - GET  /admin/db/tables              - List all tables
 *    - GET  /admin/db/tables/{name}       - Get table data (paginated)
 *    - GET  /admin/db/tables/{name}/schema - Get table schema
 *    - POST /admin/db/query               - Execute SQL (read-only for safety)
 *    - POST /admin/db/tables/{name}/rows  - Insert row
 *    - PUT  /admin/db/tables/{name}/rows/{id} - Update row
 *    - DELETE /admin/db/tables/{name}/rows/{id} - Delete row
 *
 * 3. Add admin authentication middleware
 *    - Verify admin pubkey/token on all /admin/* routes
 *    - Consider rate limiting for query endpoint
 *
 * 4. Implement audit logging
 *    - Log all write operations to audit_log table
 *    - Include admin pubkey, action, affected table/record
 *
 * 5. Safety features:
 *    - Prevent DROP TABLE, TRUNCATE, etc. in query endpoint
 *    - Add query timeout to prevent long-running queries
 *    - Consider read-only mode option
 *
 * 6. Frontend enhancements:
 *    - Add query history (localStorage)
 *    - Add saved queries feature
 *    - Add table creation UI
 *    - Add column editing UI
 *    - Add data export (CSV, JSON)
 *    - Add data import feature
 *    - Add full-text search across tables
 *    - Add foreign key visualization
 */
