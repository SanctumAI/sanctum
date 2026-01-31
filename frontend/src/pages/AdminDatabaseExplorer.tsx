import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, SquareTerminal, RefreshCw, Loader2, Play, Database, Key, X, Pencil, Trash2, ChevronLeft, ChevronRight, HelpCircle, Download } from 'lucide-react'
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
  const { t } = useTranslation()
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

  // Database help modal state
  const [showDbHelpModal, setShowDbHelpModal] = useState(false)
  const [dbHelpPage, setDbHelpPage] = useState(0)
  const dbHelpModalRef = useRef<HTMLDivElement>(null)
  const previousActiveElementRef = useRef<HTMLElement | null>(null)

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
      if (!response.ok) throw new Error(t('errors.failedToFetchTables'))
      const data = await response.json()
      setTables(data.tables)

      // Auto-select first table
      if (data.tables.length > 0 && !selectedTable) {
        setSelectedTable(data.tables[0].name)
      }
    } catch (error) {
      console.error(t('errors.errorFetchingTables'), error)
      setTables([])
    } finally {
      setIsLoadingTables(false)
    }
  }, [selectedTable])

  // Export database
  const exportDatabase = async () => {
    try {
      const response = await adminFetch('/admin/database/export')
      if (!response.ok) throw new Error(t('errors.exportFailed'))
      
      // Get the filename from the Content-Disposition header
      const disposition = response.headers.get('Content-Disposition')
      let filename = 'sanctum_backup.db'
      if (disposition) {
        const filenameMatch = disposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/)
        if (filenameMatch) {
          filename = filenameMatch[1].replace(/['"]/g, '')
        }
      }
      
      // Create blob and download
      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)
    } catch (error) {
      console.error('Database export failed:', error)
      // You might want to add a toast notification here
    }
  }

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
      if (!response.ok) throw new Error(t('errors.failedToFetchTableData'))
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
              decrypted[i][col.name] = result ?? t('admin.database.encrypted')
            } else if (ciphertext) {
              decrypted[i][col.name] = t('admin.database.encryptedMissingKey')
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
    if (!confirm(t('admin.confirmDelete'))) return

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

  // Close database help modal
  const handleCloseDbHelpModal = () => {
    setShowDbHelpModal(false)
    setDbHelpPage(0)
    // Restore focus to previously focused element
    if (previousActiveElementRef.current && document.contains(previousActiveElementRef.current)) {
      previousActiveElementRef.current.focus()
    }
    previousActiveElementRef.current = null
  }

  // Focus trap for database help modal
  useEffect(() => {
    if (!showDbHelpModal || !dbHelpModalRef.current) {
      return
    }

    const modal = dbHelpModalRef.current

    /**
     * Get all focusable elements within the modal
     * Focusable elements include: button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])
     */
    function getFocusableElements(container: HTMLElement): HTMLElement[] {
      const selector = [
        'button:not([disabled])',
        '[href]',
        'input:not([disabled])',
        'select:not([disabled])',
        'textarea:not([disabled])',
        '[tabindex]:not([tabindex="-1"])',
      ].join(', ')

      return Array.from(container.querySelectorAll<HTMLElement>(selector)).filter(
        (el) => {
          // Filter out elements that are not visible
          const style = window.getComputedStyle(el)
          return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0'
        }
      )
    }

    /**
     * Handle Tab key navigation to trap focus within modal
     */
    function handleTabKey(e: KeyboardEvent) {
      if (e.key !== 'Tab') {
        return
      }

      const focusableElements = getFocusableElements(modal)
      if (focusableElements.length === 0) {
        e.preventDefault()
        return
      }

      const firstElement = focusableElements[0]
      const lastElement = focusableElements[focusableElements.length - 1]
      const currentFocusIndex = focusableElements.indexOf(document.activeElement as HTMLElement)

      // If Shift+Tab is pressed and focus is on first element, move to last
      if (e.shiftKey) {
        if (currentFocusIndex === 0 || currentFocusIndex === -1) {
          e.preventDefault()
          lastElement.focus()
        }
      } else {
        // If Tab is pressed and focus is on last element, move to first
        if (currentFocusIndex === focusableElements.length - 1 || currentFocusIndex === -1) {
          e.preventDefault()
          firstElement.focus()
        }
      }
    }

    // Set initial focus to first focusable element
    const focusableElements = getFocusableElements(modal)
    if (focusableElements.length > 0) {
      // Small delay to ensure modal is fully rendered
      setTimeout(() => {
        focusableElements[0].focus()
      }, 0)
    } else {
      // Fallback: focus the modal container itself
      modal.focus()
    }

    // Add event listener for Tab key trapping
    modal.addEventListener('keydown', handleTabKey)

    // Cleanup function: remove event listener
    return () => {
      modal.removeEventListener('keydown', handleTabKey)
    }
  }, [showDbHelpModal])

  // Database help pages data
  const DB_HELP_PAGES = [
    {
      title: t('admin.database.help.safetyTitle', 'Safety & Permissions'),
      content: 'safety',
    },
    {
      title: t('admin.database.help.encryptedTitle', 'Encrypted Fields'),
      content: 'encrypted',
    },
    {
      title: t('admin.database.help.queriesTitle', 'Query Examples'),
      content: 'queries',
    },
    {
      title: t('admin.database.help.warningsTitle', 'What to Avoid'),
      content: 'warnings',
    },
  ]

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
              className="btn-ghost p-1.5 -ml-1.5 rounded-lg transition-all"
              title={t('admin.database.backToSetup')}
            >
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <div>
              <h1 className="heading-lg">{t('admin.database.title')}</h1>
              <p className="text-xs text-text-muted">{t('admin.database.subtitle')}</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Help */}
            <button
              onClick={() => {
                // Capture the currently active element before opening modal
                if (document.activeElement instanceof HTMLElement) {
                  previousActiveElementRef.current = document.activeElement
                }
                setShowDbHelpModal(true)
              }}
              className="btn-ghost p-2 rounded-lg transition-all text-text-muted hover:text-accent"
              aria-label={t('admin.database.help.ariaLabel', 'Database explorer help')}
            >
              <HelpCircle className="w-4 h-4" />
            </button>

            {/* Export Database */}
            <button
              onClick={exportDatabase}
              className="btn-ghost p-2 rounded-lg transition-all"
              title={t('admin.database.exportDatabase', 'Export Database')}
            >
              <Download className="w-4 h-4" />
            </button>

            {/* Query Mode Toggle */}
            <button
              onClick={() => setQueryMode(!queryMode)}
              className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                queryMode
                  ? 'bg-accent text-accent-text shadow-md glow-accent'
                  : 'btn-secondary'
              }`}
            >
              <SquareTerminal className="w-4 h-4" />
              {t('admin.database.sqlQuery')}
            </button>

            {/* Refresh */}
            <button
              onClick={fetchTables}
              disabled={isLoadingTables}
              className="btn-ghost p-2 rounded-lg transition-all disabled:opacity-50"
              title={t('admin.database.refreshTables')}
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
            <h2 className="label mb-2 px-2">
              {t('admin.database.tables')}
            </h2>

            {isLoadingTables ? (
              <div className="flex items-center justify-center py-8">
                <div className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
              </div>
            ) : tables.length === 0 ? (
              <div className="text-center py-8 px-2">
                <p className="text-sm text-text-muted">{t('admin.database.noTables')}</p>
                <p className="text-xs text-text-muted mt-1">
                  {t('admin.database.notInitialized')}
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
                      {table.columns.length} {t('admin.database.columns')}
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
              <div className="card card-sm !p-4">
                <label className="heading-sm mb-3 block">
                  {t('admin.database.sqlQueryLabel')}
                </label>
                <div className="input-container !rounded-xl p-0 overflow-hidden">
                  <textarea
                    value={sqlQuery}
                    onChange={(e) => setSqlQuery(e.target.value)}
                    placeholder={t('admin.database.sqlPlaceholder')}
                    className="input-field w-full h-32 px-4 py-3 font-mono text-sm resize-none"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                        runQuery()
                      }
                    }}
                  />
                </div>
                <div className="flex items-center justify-between mt-4">
                  <p className="text-xs text-text-muted">
                    {t('admin.database.runHint')}
                  </p>
                  <button
                    onClick={runQuery}
                    disabled={isRunningQuery || !sqlQuery.trim()}
                    className="btn btn-primary btn-md inline-flex items-center gap-2"
                  >
                    {isRunningQuery ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        {t('admin.database.running')}
                      </>
                    ) : (
                      <>
                        <Play className="w-4 h-4" />
                        {t('admin.database.runQuery')}
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Query Results */}
              {queryResult && (
                <div className="flex-1 card overflow-hidden flex flex-col !p-0">
                  <div className="px-4 py-3 border-b border-border bg-surface-overlay flex items-center justify-between">
                    <span className="heading-sm">
                      {queryResult.success ? t('admin.database.results') : t('admin.database.error')}
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
                        {queryResult.rowsAffected} {t('admin.database.rowsAffected')}
                        {queryResult.lastInsertId !== undefined && (
                          <span className="text-text-muted ml-2">
                            ({t('admin.database.lastInsertId')} {queryResult.lastInsertId})
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
                      {t('admin.database.noResults')}
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
                  <h2 className="heading-md">{selectedTable}</h2>
                  <p className="text-xs text-text-muted mt-0.5">
                    {t('admin.database.tableInfo', { columns: currentTableInfo?.columns.length, rows: totalRows })}
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  {/* Add Record Button */}
                  <button
                    onClick={handleCreateRecord}
                    className="btn btn-primary btn-sm inline-flex items-center gap-1.5"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                    </svg>
                    {t('admin.database.addRow')}
                  </button>
                </div>
              </div>

              {/* Record Editor Form */}
              {(isCreatingRecord || editingRecord) && currentTableInfo && (
                <div className="px-4 py-4 border-b border-border bg-surface-raised animate-fade-in">
                  <div className="card card-sm !p-4 !bg-surface">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="heading-sm">
                        {isCreatingRecord ? t('admin.database.newRecord') : t('admin.database.editRecord')}
                      </h3>
                      <button
                        onClick={handleCancelEdit}
                        className="btn-ghost p-1.5 rounded-lg transition-all"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                      {currentTableInfo.columns
                        .filter((col) => !col.primaryKey || !isCreatingRecord)
                        .map((col) => (
                          <div key={col.name}>
                            <label className="text-xs font-medium text-text mb-1.5 block">
                              {col.name}
                              {!col.nullable && <span className="text-error ml-0.5">*</span>}
                              <span className="text-text-muted ml-1 font-normal">({col.type})</span>
                            </label>
                            <div className="input-container px-3 py-2">
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
                                placeholder={col.nullable ? t('common.nullPlaceholder') : ''}
                                className="input-field text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                              />
                            </div>
                          </div>
                        ))}
                    </div>

                    <div className="flex items-center gap-3 mt-4 pt-4 border-t border-border">
                      <button
                        onClick={handleSaveRecord}
                        disabled={isSavingRecord}
                        className="btn btn-primary btn-sm"
                      >
                        {isSavingRecord ? t('common.saving') : t('common.save')}
                      </button>
                      <button
                        onClick={handleCancelEdit}
                        className="btn btn-ghost btn-sm"
                      >
                        {t('common.cancel')}
                      </button>
                    </div>
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
                    <p className="text-sm">{t('admin.database.noData')}</p>
                    <button
                      onClick={handleCreateRecord}
                      className="mt-3 text-sm text-accent hover:text-accent-hover transition-colors"
                    >
                      {t('admin.database.addFirstRecord')}
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
                              ? decryptedData[rowIndex]?.[col.name] ?? t('admin.database.decrypting')
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
                                    title={isLongValue ? t('admin.database.clickToExpand') : undefined}
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
                                title={t('common.edit')}
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => handleDeleteRecord(row)}
                                className="p-1 text-text-muted hover:text-error transition-colors"
                                title={t('common.delete')}
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
                    {t('admin.database.pagination', {
                      from: (currentPage - 1) * pageSize + 1,
                      to: Math.min(currentPage * pageSize, totalRows),
                      total: totalRows
                    })}
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
                <p className="text-sm">{t('admin.database.selectTable')}</p>
                <p className="text-xs mt-1">{t('admin.database.orUseSqlQuery')}</p>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* Status Bar */}
      <footer className="border-t border-border bg-surface-raised px-4 py-1.5 flex items-center justify-between text-xs text-text-muted shrink-0">
        <div className="flex items-center gap-4">
          <span>
            {t('admin.database.tableCount', { count: tables.length })}
          </span>
          {selectedTable && (
            <span>
              {t('admin.database.rowsInTable', { count: totalRows, table: selectedTable })}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-success" />
            {t('admin.database.connected')}
          </span>
        </div>
      </footer>

      {/* Database Help Modal */}
      {showDbHelpModal && (
        <div
          ref={dbHelpModalRef}
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
          role="dialog"
          aria-modal="true"
          aria-labelledby="db-help-modal-title"
          onKeyDown={(e) => e.key === 'Escape' && handleCloseDbHelpModal()}
          tabIndex={-1}
        >
          <div className="bg-surface border border-border rounded-xl p-6 w-full max-w-lg mx-4 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h3 id="db-help-modal-title" className="text-lg font-semibold text-text flex items-center gap-2">
                <HelpCircle className="w-5 h-5" />
                {DB_HELP_PAGES[dbHelpPage].title}
              </h3>
              <button
                onClick={handleCloseDbHelpModal}
                className="text-text-muted hover:text-text transition-colors"
                aria-label={t('common.close', 'Close')}
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Content */}
            <div className="min-h-[280px]">
              {DB_HELP_PAGES[dbHelpPage].content === 'safety' ? (
                <div className="space-y-3">
                  <div className="bg-warning/10 border border-warning/20 rounded-lg p-4">
                    <p className="text-sm font-medium text-warning mb-2">
                      {t('admin.database.help.advancedWarning', 'This is an advanced feature')}
                    </p>
                    <p className="text-xs text-text-muted">
                      {t('admin.database.help.advancedWarningDesc', 'The database explorer gives direct access to your application data. Changes made here can affect how your application works.')}
                    </p>
                  </div>
                  <div className="space-y-2">
                    <div className="bg-surface-overlay border border-border rounded-lg p-3">
                      <p className="text-sm font-medium text-text">{t('admin.database.help.whoFor', 'Who should use this?')}</p>
                      <ul className="text-xs text-text-muted mt-2 space-y-1 list-disc list-inside">
                        <li>{t('admin.database.help.whoFor1', 'Technical admins troubleshooting issues')}</li>
                        <li>{t('admin.database.help.whoFor2', 'Developers debugging data problems')}</li>
                        <li>{t('admin.database.help.whoFor3', 'Advanced users who need to fix data')}</li>
                      </ul>
                    </div>
                  </div>
                </div>
              ) : DB_HELP_PAGES[dbHelpPage].content === 'encrypted' ? (
                <div className="space-y-3">
                  <p className="text-sm text-text-muted mb-4">
                    {t('admin.database.help.encryptedDesc', 'Some fields contain sensitive data that is encrypted for privacy.')}
                  </p>
                  <div className="space-y-2">
                    <div className="bg-surface-overlay border border-border rounded-lg p-3">
                      <p className="text-sm font-medium text-text flex items-center gap-2">
                        <Key className="w-4 h-4" />
                        {t('admin.database.help.lockIcon', 'The lock icon')}
                      </p>
                      <p className="text-xs text-text-muted mt-1">
                        {t('admin.database.help.lockIconDesc', 'Columns with a lock icon (🔓) store encrypted data. The browser automatically decrypts this using your admin keys.')}
                      </p>
                    </div>
                    <div className="bg-surface-overlay border border-border rounded-lg p-3">
                      <p className="text-sm font-medium text-text">{t('admin.database.help.asyncDecrypt', 'Async Decryption')}</p>
                      <p className="text-xs text-text-muted mt-1">
                        {t('admin.database.help.asyncDecryptDesc', 'You may see "Decrypting..." briefly as values are decrypted. This happens in the background.')}
                      </p>
                    </div>
                    <div className="bg-surface-overlay border border-border rounded-lg p-3">
                      <p className="text-sm font-medium text-text">{t('admin.database.help.rawValues', 'Raw vs Decrypted')}</p>
                      <p className="text-xs text-text-muted mt-1">
                        {t('admin.database.help.rawValuesDesc', 'The actual database stores encrypted ciphertext. What you see is the decrypted value for convenience.')}
                      </p>
                    </div>
                  </div>
                </div>
              ) : DB_HELP_PAGES[dbHelpPage].content === 'queries' ? (
                <div className="space-y-3">
                  <p className="text-sm text-text-muted mb-4">
                    {t('admin.database.help.queriesDesc', 'Safe query patterns for exploring data:')}
                  </p>
                  <div className="bg-surface-overlay border border-border rounded-lg p-3 font-mono text-xs space-y-2">
                    <div>
                      <p className="text-text-muted mb-1">-- {t('admin.database.help.viewAll', 'View all rows in a table')}</p>
                      <p className="text-accent">SELECT * FROM users LIMIT 100;</p>
                    </div>
                    <div>
                      <p className="text-text-muted mb-1">-- {t('admin.database.help.filterRows', 'Filter rows')}</p>
                      <p className="text-accent">SELECT * FROM sessions WHERE created_at {'>'} date('now', '-7 days');</p>
                    </div>
                    <div>
                      <p className="text-text-muted mb-1">-- {t('admin.database.help.countRows', 'Count rows')}</p>
                      <p className="text-accent">SELECT COUNT(*) FROM documents;</p>
                    </div>
                    <div>
                      <p className="text-text-muted mb-1">-- {t('admin.database.help.joinTables', 'Join tables')}</p>
                      <p className="text-accent">SELECT u.*, s.created_at FROM users u JOIN sessions s ON u.id = s.user_id;</p>
                    </div>
                  </div>
                  <p className="text-xs text-text-muted mt-3">
                    {t('admin.database.help.sqliteNote', 'This uses SQLite syntax. Results are limited for safety.')}
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="text-sm text-text-muted mb-4">
                    {t('admin.database.help.warningsDesc', 'Operations that can cause problems:')}
                  </p>
                  <div className="space-y-2">
                    <div className="bg-error/10 border border-error/20 rounded-lg p-3">
                      <p className="text-sm font-medium text-error">DELETE {t('admin.database.help.without', 'without')} WHERE</p>
                      <p className="text-xs text-text-muted mt-1">
                        {t('admin.database.help.deleteWarning', 'Deletes ALL rows in a table. Always use a WHERE clause.')}
                      </p>
                    </div>
                    <div className="bg-error/10 border border-error/20 rounded-lg p-3">
                      <p className="text-sm font-medium text-error">DROP TABLE</p>
                      <p className="text-xs text-text-muted mt-1">
                        {t('admin.database.help.dropWarning', 'Permanently deletes a table and all its data. Cannot be undone.')}
                      </p>
                    </div>
                    <div className="bg-error/10 border border-error/20 rounded-lg p-3">
                      <p className="text-sm font-medium text-error">UPDATE {t('admin.database.help.without', 'without')} WHERE</p>
                      <p className="text-xs text-text-muted mt-1">
                        {t('admin.database.help.updateWarning', 'Changes ALL rows in a table. Always specify which rows to update.')}
                      </p>
                    </div>
                  </div>
                  <div className="bg-warning/10 border border-warning/20 rounded-lg p-3 mt-4">
                    <p className="text-xs text-warning">
                      {t('admin.database.help.backupTip', 'Tip: Export your data regularly. There is no undo for destructive operations.')}
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Pagination */}
            <div className="flex items-center justify-between mt-6 pt-4 border-t border-border">
              <button
                onClick={() => setDbHelpPage((prev) => Math.max(0, prev - 1))}
                disabled={dbHelpPage === 0}
                className="flex items-center gap-1 text-sm text-text-muted hover:text-text disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
                {t('common.previous', 'Previous')}
              </button>

              {/* Page indicators */}
              <div className="flex items-center gap-1.5">
                {DB_HELP_PAGES.map((_, index) => (
                  <button
                    key={index}
                    onClick={() => setDbHelpPage(index)}
                    className={`w-2 h-2 rounded-full transition-colors ${
                      index === dbHelpPage
                        ? 'bg-accent'
                        : 'bg-border hover:bg-text-muted'
                    }`}
                    aria-label={`${t('common.goToPage', 'Go to page')} ${index + 1}`}
                  />
                ))}
              </div>

              <button
                onClick={() => setDbHelpPage((prev) => Math.min(DB_HELP_PAGES.length - 1, prev + 1))}
                disabled={dbHelpPage === DB_HELP_PAGES.length - 1}
                className="flex items-center gap-1 text-sm text-text-muted hover:text-text disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                {t('common.next', 'Next')}
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}
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
