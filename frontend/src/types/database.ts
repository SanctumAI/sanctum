/**
 * Types for the Admin Database Explorer
 * Used by AdminDatabaseExplorer page
 *
 * TODO: These types should match the backend API once implemented.
 * The backend should expose SQLite management endpoints under /admin/db/*
 */

// Column definition for a table
export interface ColumnInfo {
  name: string
  type: string // SQLite types: TEXT, INTEGER, REAL, BLOB, NULL
  nullable: boolean
  primaryKey: boolean
  defaultValue?: string | null
}

// Table metadata
export interface TableInfo {
  name: string
  columns: ColumnInfo[]
  rowCount: number
}

// List of tables response
export interface TablesListResponse {
  tables: TableInfo[]
}

// Table data response (paginated)
export interface TableDataResponse {
  table: string
  columns: ColumnInfo[]
  rows: Record<string, unknown>[]
  totalRows: number
  page: number
  pageSize: number
  totalPages: number
}

// Query execution request
export interface QueryRequest {
  sql: string
  params?: (string | number | boolean | null)[]
}

// Query execution response
export interface QueryResponse {
  success: boolean
  columns?: string[]
  rows?: Record<string, unknown>[]
  rowsAffected?: number
  lastInsertId?: number
  error?: string
  executionTimeMs?: number
}

// Record insert/update request
export interface RecordMutationRequest {
  data: Record<string, unknown>
}

// Record mutation response
export interface RecordMutationResponse {
  success: boolean
  id?: number | string
  error?: string
}

// API base URL - uses Vite proxy in development
export const DB_API_BASE = import.meta.env.VITE_API_BASE || '/api'

/**
 * Expected API Endpoints (not yet implemented in backend):
 *
 * GET  /admin/db/tables              - List all tables with metadata
 * GET  /admin/db/tables/{name}       - Get table schema and paginated data
 * GET  /admin/db/tables/{name}/schema - Get just the table schema
 * POST /admin/db/query               - Execute read-only SQL query
 * POST /admin/db/tables/{name}/rows  - Insert a new row
 * PUT  /admin/db/tables/{name}/rows/{id} - Update a row
 * DELETE /admin/db/tables/{name}/rows/{id} - Delete a row
 *
 * All endpoints should require admin authentication.
 */

// Common SQLite table names that might exist
export const EXPECTED_TABLES = [
  'instance_config',    // Instance settings (name, icon, color, etc.)
  'users',              // User accounts
  'sessions',           // User sessions
  'custom_fields',      // Admin-defined custom fields
  'user_profiles',      // User profile data
  'documents',          // Uploaded document metadata
  'audit_log',          // Admin action audit trail
] as const

// SQLite data types
export const SQLITE_TYPES = ['TEXT', 'INTEGER', 'REAL', 'BLOB', 'NULL'] as const
export type SQLiteType = typeof SQLITE_TYPES[number]

// Helper to format cell values for display
export function formatCellValue(value: unknown): string {
  if (value === null || value === undefined) {
    return 'NULL'
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false'
  }
  if (typeof value === 'object') {
    return JSON.stringify(value)
  }
  return String(value)
}

// Helper to determine if a value looks like JSON
export function isJsonValue(value: unknown): boolean {
  if (typeof value !== 'string') return false
  const trimmed = value.trim()
  return (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
         (trimmed.startsWith('[') && trimmed.endsWith(']'))
}

// Helper to truncate long values for table display
export function truncateValue(value: string, maxLength: number = 50): string {
  if (value.length <= maxLength) return value
  return value.slice(0, maxLength) + '...'
}
