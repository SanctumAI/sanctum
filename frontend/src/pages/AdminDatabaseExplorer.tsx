import { useState, useEffect, useCallback } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { ArrowLeft, SquareTerminal, RefreshCw, Loader2, Play, Database, Key, X, Pencil, Trash2, ChevronLeft, ChevronRight } from 'lucide-react'
import {
  TableInfo,
  QueryResponse,
  formatCellValue,
  truncateValue,
  isJsonValue,
} from '../types/database'
import { adminFetch, isAdminAuthenticated } from '../utils/adminApi'
import { decryptField } from '../utils/encryption'

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
  const [totalPages, setTotalPages] = useState(1)
  const [totalRows, setTotalRows] = useState(0)
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

  // Decrypted values cache: maps rowIndex -> { columnName -> decryptedValue }
  const [decryptedData, setDecryptedData] = useState<Record<number, Record<string, string>>>({})

  // Get current table info (moved up so useEffects can reference it)
  const currentTableInfo = tables.find((t) => t.name === selectedTable)

  // Check if admin is logged in
  useEffect(() => {
    if (!isAdminAuthenticated()) {
      navigate('/admin')
    } else {
      setIsAuthorized(true)
    }
  }, [navigate])

  // Fetch tables list
  const fetchTables = useCallback(async () => {
    setIsLoadingTables(true)
    try {
      const response = await adminFetch('/admin/db/tables')
      if (!response.ok) throw new Error('Failed to fetch tables')
      const data = await response.json()
      setTables(data.tables)

      // Auto-select first table
      if (data.tables.length > 0 && !selectedTable) {
        setSelectedTable(data.tables[0].name)
      }
    } catch (error) {
      console.error('Error fetching tables:', error)
      setTables([])
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
  const fetchTableData = useCallback(async (tableName: string, page: number = 1, isRetry: boolean = false): Promise<void> => {
    setIsLoadingData(true)
    setExpandedCell(null)  // Clear expanded cell on any data fetch to avoid stale row index references
    try {
      const response = await adminFetch(
        `/admin/db/tables/${tableName}?page=${page}&page_size=${pageSize}`
      )
      if (!response.ok) throw new Error('Failed to fetch table data')
      const data = await response.json()

      // Handle out-of-range page (e.g., after deleting the last record on a page)
      if (data.page > data.totalPages && data.totalPages > 0) {
        if (isRetry) {
          console.error('Page still out of range after retry, using returned data')
        } else {
          // Refetch the last valid page instead of showing invalid state
          return await fetchTableData(tableName, data.totalPages, true)
        }
      }

      setTableData(data.rows)
      setCurrentPage(data.page)
      setTotalPages(data.totalPages)
      setTotalRows(data.totalRows)
    } catch (error) {
      console.error('Error fetching table data:', error)
      setTableData([])
      setTotalPages(1)
      setTotalRows(0)
    } finally {
      setIsLoadingData(false)
    }
  }, [pageSize])

  useEffect(() => {
    if (selectedTable) {
      fetchTableData(selectedTable)
    }
  }, [selectedTable, fetchTableData])

  // Decrypt encrypted columns when table data loads
  useEffect(() => {
    if (!tableData.length || !currentTableInfo) {
      setDecryptedData({})
      return
    }

    // Clear stale decrypted data immediately when dependencies change
    setDecryptedData({})

    let cancelled = false

    const decryptRows = async () => {
      const decrypted: Record<number, Record<string, string>> = {}

      for (let i = 0; i < tableData.length; i++) {
        if (cancelled) return

        const row = tableData[i]
        decrypted[i] = {}

        for (const col of currentTableInfo.columns) {
          if (col.name.startsWith('encrypted_')) {
            const fieldName = col.name.replace('encrypted_', '')
            const ephemeralCol = `ephemeral_pubkey_${fieldName}`
            const ciphertext = row[col.name] as string | null
            const ephemeralPubkey = row[ephemeralCol] as string | null

            if (ciphertext && ephemeralPubkey) {
              const result = await decryptField({ ciphertext, ephemeral_pubkey: ephemeralPubkey })
              if (cancelled) return
              decrypted[i][col.name] = result ?? '[Encrypted]'
            } else if (ciphertext) {
              decrypted[i][col.name] = '[Encrypted - Missing Key]'
            }
          }
        }
      }
      if (!cancelled) {
        setDecryptedData(decrypted)
      }
    }

    decryptRows()

    return () => {
      cancelled = true
    }
  }, [tableData, currentTableInfo])

  // Run SQL query
  const runQuery = async () => {
    if (!sqlQuery.trim()) return

    setIsRunningQuery(true)
    setQueryResult(null)

    try {
      const response = await adminFetch('/admin/db/query', {
        method: 'POST',
        body: JSON.stringify({ sql: sqlQuery }),
      })
      const data = await response.json()
      setQueryResult(data)
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
    if (!selectedTable) return
    setIsSavingRecord(true)

    try {
      if (isCreatingRecord) {
        const response = await adminFetch(`/admin/db/tables/${selectedTable}/rows`, {
          method: 'POST',
          body: JSON.stringify({ data: recordFormData }),
        })
        const result = await response.json()
        if (!result.success) {
          throw new Error(result.error || 'Failed to create record')
        }
      } else if (editingRecord) {
        const recordId = editingRecord.id
        const response = await adminFetch(`/admin/db/tables/${selectedTable}/rows/${recordId}`, {
          method: 'PUT',
          body: JSON.stringify({ data: recordFormData }),
        })
        const result = await response.json()
        if (!result.success) {
          throw new Error(result.error || 'Failed to update record')
        }
      }

      // Reset form and refresh data
      setIsCreatingRecord(false)
      setEditingRecord(null)
      setRecordFormData({})

      // Refresh table data after save (preserve current page)
      fetchTableData(selectedTable, currentPage)
    } catch (error) {
      console.error('Error saving record:', error)
      alert(error instanceof Error ? error.message : 'Failed to save record')
    } finally {
      setIsSavingRecord(false)
    }
  }

  // Handle record delete
  const handleDeleteRecord = async (record: Record<string, unknown>) => {
    if (!selectedTable) return
    if (!confirm('Are you sure you want to delete this record?')) return

    try {
      const recordId = record.id
      const response = await adminFetch(`/admin/db/tables/${selectedTable}/rows/${recordId}`, {
        method: 'DELETE',
      })
      const result = await response.json()
      if (!result.success) {
        throw new Error(result.error || 'Failed to delete record')
      }

      // Refresh table data after delete (preserve current page)
      fetchTableData(selectedTable, currentPage)
    } catch (error) {
      console.error('Error deleting record:', error)
      alert(error instanceof Error ? error.message : 'Failed to delete record')
    }
  }

  // Cancel editing
  const handleCancelEdit = () => {
    setIsCreatingRecord(false)
    setEditingRecord(null)
    setRecordFormData({})
  }

  // tableData is already server-paginated, so use it directly

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
                    {currentTableInfo?.columns.length} columns, {totalRows} rows
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
                        {currentTableInfo?.columns
                          .filter(col => !col.name.startsWith('ephemeral_pubkey_'))
                          .map((col) => (
                          <th
                            key={col.name}
                            className="text-left px-3 py-2 font-medium text-text-secondary border-b border-border whitespace-nowrap"
                          >
                            <div className="flex items-center gap-1">
                              {col.primaryKey && (
                                <Key className="w-3 h-3 text-warning" />
                              )}
                              {col.name.startsWith('encrypted_')
                                ? col.name.replace('encrypted_', '') + ' 🔓'
                                : col.name}
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
                      {tableData.map((row, rowIndex) => {
                        // Use page-local rowIndex for decryptedData since tableData is already server-paginated
                        return (
                        <tr
                          key={rowIndex}
                          className="border-b border-border/50 hover:bg-surface-overlay/50 group"
                        >
                          {currentTableInfo?.columns
                            .filter(col => !col.name.startsWith('ephemeral_pubkey_'))
                            .map((col) => {
                            const value = col.name.startsWith('encrypted_')
                              ? decryptedData[rowIndex]?.[col.name] ?? '[Decrypting...]'
                              : row[col.name]
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
                                        {col.name.startsWith('encrypted_')
                                          ? col.name.replace('encrypted_', '') + ' 🔓'
                                          : col.name}
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
                      )})}

                    </tbody>
                  </table>
                )}
              </div>

              {/* Pagination */}
              {totalRows > pageSize && (
                <div className="px-4 py-2 border-t border-border bg-surface-raised flex items-center justify-between shrink-0">
                  <span className="text-xs text-text-muted">
                    Showing {(currentPage - 1) * pageSize + 1} to{' '}
                    {Math.min(currentPage * pageSize, totalRows)} of {totalRows}
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => {
                        const newPage = Math.max(1, currentPage - 1)
                        if (selectedTable) {
                          fetchTableData(selectedTable, newPage)
                        }
                      }}
                      disabled={currentPage === 1 || isLoadingData}
                      className="p-1.5 rounded text-text-secondary hover:text-text hover:bg-surface-overlay disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <span className="text-xs text-text px-2">
                      {currentPage} / {totalPages}
                    </span>
                    <button
                      onClick={() => {
                        const newPage = Math.min(totalPages, currentPage + 1)
                        if (selectedTable) {
                          fetchTableData(selectedTable, newPage)
                        }
                      }}
                      disabled={currentPage === totalPages || isLoadingData}
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
              {totalRows} row{totalRows !== 1 ? 's' : ''} in {selectedTable}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-success" />
            SQLite Connected
          </span>
        </div>
      </footer>
    </div>
  )
}

/**
 * Future enhancements:
 * - Add audit logging for write operations
 * - Add query history (localStorage)
 * - Add saved queries feature
 * - Add data export (CSV, JSON)
 * - Add data import feature
 */
