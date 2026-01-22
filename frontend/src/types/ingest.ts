/**
 * Types for the Ingest API endpoints
 * Used by AdminDocumentUpload page
 */

// Upload response
export interface UploadResponse {
  job_id: string
  filename: string
  status: string
  message: string
}

// Job status
export interface JobStatus {
  job_id: string
  filename: string
  status: 'pending' | 'processing' | 'chunked' | 'completed' | 'failed'
  created_at: string
  updated_at: string
  total_chunks: number
  processed_chunks: number
  error?: string
}

// Jobs list response
export interface JobsListResponse {
  total: number
  jobs: {
    job_id: string
    filename: string
    status: string
    total_chunks: number
    created_at: string
  }[]
}

// Chunk info (for future use when implementing extraction UI)
export interface ChunkInfo {
  chunk_id: string
  job_id: string
  index: number
  text: string
  char_count: number
  status: 'pending' | 'extracted' | 'stored'
  source_file: string
}

// Ingest stats
export interface IngestStats {
  jobs: {
    total: number
    by_status: Record<string, number>
  }
  chunks: {
    total: number
    by_status: Record<string, number>
  }
}

// API base URL - uses Vite proxy in development
export const INGEST_API_BASE = import.meta.env.VITE_API_BASE || '/api'

// Allowed file extensions (matching backend)
export const ALLOWED_EXTENSIONS = ['.pdf', '.txt', '.md'] as const
export type AllowedExtension = typeof ALLOWED_EXTENSIONS[number]

// Helper to check if file is allowed
export function isAllowedFileType(filename: string): boolean {
  const ext = filename.toLowerCase().slice(filename.lastIndexOf('.'))
  return ALLOWED_EXTENSIONS.includes(ext as AllowedExtension)
}

// Helper to get file extension display
export function getAllowedExtensionsDisplay(): string {
  return ALLOWED_EXTENSIONS.map(ext => ext.toUpperCase().slice(1)).join(', ')
}
