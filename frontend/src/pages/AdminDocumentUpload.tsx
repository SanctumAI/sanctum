import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { Tag, Upload, FileText, X, CloudUpload, Loader2, Clock, ArrowLeft } from 'lucide-react'
import { OnboardingCard } from '../components/onboarding/OnboardingCard'
import { STORAGE_KEYS } from '../types/onboarding'
import {
  Ontology,
  OntologiesResponse,
  UploadResponse,
  JobStatus,
  JobsListResponse,
  INGEST_API_BASE,
  isAllowedFileType,
  getAllowedExtensionsDisplay,
} from '../types/ingest'

// TODO: Replace localStorage check with proper auth token validation
// Current implementation only checks for admin pubkey in localStorage

export function AdminDocumentUpload() {
  const navigate = useNavigate()
  const fileInputRef = useRef<HTMLInputElement>(null)

  // State
  const [ontologies, setOntologies] = useState<Ontology[]>([])
  const [selectedOntology, setSelectedOntology] = useState<string>('bitcoin_technical')
  const [isDragging, setIsDragging] = useState(false)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [isUploading, setIsUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [recentJobs, setRecentJobs] = useState<JobStatus[]>([])
  const [isLoadingOntologies, setIsLoadingOntologies] = useState(true)
  const [isLoadingJobs, setIsLoadingJobs] = useState(true)

  // Check if admin is logged in
  useEffect(() => {
    const pubkey = localStorage.getItem(STORAGE_KEYS.ADMIN_PUBKEY)
    if (!pubkey) {
      navigate('/admin')
    }
  }, [navigate])

  // Fetch available ontologies
  useEffect(() => {
    async function fetchOntologies() {
      try {
        const response = await fetch(`${INGEST_API_BASE}/ingest/ontologies`)
        if (!response.ok) throw new Error('Failed to fetch ontologies')
        const data: OntologiesResponse = await response.json()
        setOntologies(data.ontologies)
        setSelectedOntology(data.default)
      } catch (error) {
        console.error('Error fetching ontologies:', error)
        // TODO: Show user-friendly error message
      } finally {
        setIsLoadingOntologies(false)
      }
    }
    fetchOntologies()
  }, [])

  // Fetch recent jobs
  const fetchJobs = useCallback(async () => {
    try {
      const response = await fetch(`${INGEST_API_BASE}/ingest/jobs`)
      if (!response.ok) throw new Error('Failed to fetch jobs')
      const data: JobsListResponse = await response.json()

      // Fetch full status for each job
      const jobStatuses = await Promise.all(
        data.jobs.slice(0, 10).map(async (job) => {
          const statusResponse = await fetch(`${INGEST_API_BASE}/ingest/status/${job.job_id}`)
          if (!statusResponse.ok) return null
          return statusResponse.json() as Promise<JobStatus>
        })
      )

      setRecentJobs(jobStatuses.filter((j): j is JobStatus => j !== null))
    } catch (error) {
      console.error('Error fetching jobs:', error)
    } finally {
      setIsLoadingJobs(false)
    }
  }, [])

  useEffect(() => {
    fetchJobs()
  }, [fetchJobs])

  // Poll for job status updates
  // TODO: Consider WebSocket or SSE for real-time job status updates
  useEffect(() => {
    const hasActiveJobs = recentJobs.some(
      (job) => job.status === 'pending' || job.status === 'processing'
    )

    if (hasActiveJobs) {
      const interval = setInterval(fetchJobs, 3000)
      return () => clearInterval(interval)
    }
  }, [recentJobs, fetchJobs])

  // Handle file selection
  const handleFileSelect = (file: File) => {
    setUploadError(null)

    // TODO: Add file size validation (check backend MAX_UPLOAD_SIZE)
    if (!isAllowedFileType(file.name)) {
      setUploadError(`Invalid file type. Allowed: ${getAllowedExtensionsDisplay()}`)
      return
    }

    setSelectedFile(file)
  }

  // Handle drag events
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)

    const file = e.dataTransfer.files[0]
    if (file) {
      handleFileSelect(file)
    }
  }

  // Handle file input change
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      handleFileSelect(file)
    }
  }

  // Handle upload
  const handleUpload = async () => {
    if (!selectedFile) return

    setIsUploading(true)
    setUploadError(null)

    try {
      const formData = new FormData()
      formData.append('file', selectedFile)
      formData.append('ontology_id', selectedOntology)

      const response = await fetch(`${INGEST_API_BASE}/ingest/upload`, {
        method: 'POST',
        body: formData,
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.detail || 'Upload failed')
      }

      const data: UploadResponse = await response.json()
      console.log('Upload successful:', data)

      // Clear selected file and refresh jobs
      setSelectedFile(null)
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }

      // Refresh job list
      await fetchJobs()
    } catch (error) {
      console.error('Upload error:', error)
      setUploadError(error instanceof Error ? error.message : 'Upload failed')
    } finally {
      setIsUploading(false)
    }
  }

  // Cancel file selection
  const handleCancelFile = () => {
    setSelectedFile(null)
    setUploadError(null)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  // Get status display info
  const getStatusDisplay = (status: JobStatus['status']) => {
    switch (status) {
      case 'pending':
        return { label: 'Queued', color: 'text-text-muted', icon: '○' }
      case 'processing':
        return { label: 'Processing', color: 'text-warning', icon: '◐' }
      case 'chunked':
        return { label: 'Chunked', color: 'text-info', icon: '◑' }
      case 'completed':
        return { label: 'Complete', color: 'text-success', icon: '●' }
      case 'failed':
        return { label: 'Failed', color: 'text-error', icon: '✕' }
      default:
        return { label: status, color: 'text-text-muted', icon: '?' }
    }
  }

  const footer = (
    <Link to="/" className="text-text-muted hover:text-text transition-colors">
      Back to Dashboard
    </Link>
  )

  return (
    <OnboardingCard
      title="Upload Documents"
      subtitle="Add documents to your knowledge base for RAG"
      footer={footer}
    >
      <div className="space-y-6">
        {/* Ontology Selection */}
        <div className="bg-surface-overlay border border-border rounded-xl p-5">
          <h3 className="text-sm font-semibold text-text mb-4 flex items-center gap-2">
            <Tag className="w-4 h-4 text-text-muted" />
            Ontology
          </h3>

          <div>
            <label className="text-sm font-medium text-text mb-1.5 block">
              Knowledge Schema
            </label>
            <div className="border border-border rounded-xl px-4 py-3 bg-surface focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/20 transition-all">
              {isLoadingOntologies ? (
                <div className="text-text-muted text-sm">Loading ontologies...</div>
              ) : (
                <select
                  value={selectedOntology}
                  onChange={(e) => setSelectedOntology(e.target.value)}
                  className="w-full bg-transparent outline-none text-text text-sm cursor-pointer"
                >
                  {ontologies.map((ontology) => (
                    <option key={ontology.id} value={ontology.id}>
                      {ontology.name}
                    </option>
                  ))}
                </select>
              )}
            </div>
            {ontologies.find((o) => o.id === selectedOntology)?.description && (
              <p className="text-xs text-text-muted mt-1.5">
                {ontologies.find((o) => o.id === selectedOntology)?.description}
              </p>
            )}
          </div>
        </div>

        {/* File Upload Zone */}
        <div className="bg-surface-overlay border border-border rounded-xl p-5">
          <h3 className="text-sm font-semibold text-text mb-4 flex items-center gap-2">
            <Upload className="w-4 h-4 text-text-muted" />
            Upload File
          </h3>

          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.txt,.md"
            onChange={handleInputChange}
            className="hidden"
          />

          {/* Drop zone or selected file */}
          {selectedFile ? (
            <div className="border border-accent/50 bg-accent-subtle rounded-xl p-4 animate-fade-in">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-10 rounded-lg bg-accent/10 flex items-center justify-center shrink-0">
                    <FileText className="w-5 h-5 text-accent" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-text truncate">
                      {selectedFile.name}
                    </p>
                    <p className="text-xs text-text-muted">
                      {(selectedFile.size / 1024).toFixed(1)} KB
                    </p>
                  </div>
                </div>

                <button
                  onClick={handleCancelFile}
                  className="p-1.5 text-text-muted hover:text-error transition-colors shrink-0"
                  title="Remove file"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>
          ) : (
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`
                border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all
                ${
                  isDragging
                    ? 'border-accent bg-accent-subtle'
                    : 'border-border hover:border-accent/50 hover:bg-surface'
                }
              `}
            >
              <CloudUpload
                className={`w-10 h-10 mx-auto mb-3 transition-colors ${
                  isDragging ? 'text-accent' : 'text-text-muted'
                }`}
                strokeWidth={1.5}
              />
              <p className="text-sm font-medium text-text mb-1">
                {isDragging ? 'Drop file here' : 'Drop file here or click to browse'}
              </p>
              <p className="text-xs text-text-muted">
                Supported: {getAllowedExtensionsDisplay()}
              </p>
            </div>
          )}

          {/* Error message */}
          {uploadError && (
            <div className="mt-3 p-3 bg-error/10 border border-error/20 rounded-lg animate-fade-in">
              <p className="text-sm text-error">{uploadError}</p>
            </div>
          )}

          {/* Upload button */}
          {selectedFile && (
            <button
              onClick={handleUpload}
              disabled={isUploading}
              className="w-full mt-4 bg-accent text-accent-text rounded-xl px-6 py-3 font-medium hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed transition-all active-press flex items-center justify-center gap-2"
            >
              {isUploading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Uploading...
                </>
              ) : (
                <>
                  <Upload className="w-4 h-4" />
                  Upload Document
                </>
              )}
            </button>
          )}
        </div>

        {/* Recent Uploads */}
        <div className="bg-surface-overlay border border-border rounded-xl p-5">
          <h3 className="text-sm font-semibold text-text mb-4 flex items-center gap-2">
            <Clock className="w-4 h-4 text-text-muted" />
            Recent Uploads
          </h3>

          {isLoadingJobs ? (
            <div className="text-center py-6">
              <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin mx-auto mb-2" />
              <p className="text-xs text-text-muted">Loading...</p>
            </div>
          ) : recentJobs.length > 0 ? (
            <div className="space-y-2">
              {recentJobs.map((job) => {
                const statusInfo = getStatusDisplay(job.status)
                return (
                  <div
                    key={job.job_id}
                    className="bg-surface border border-border rounded-lg p-3 animate-fade-in"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-text truncate">
                          {job.filename}
                        </p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className={`text-xs ${statusInfo.color}`}>
                            {statusInfo.icon} {statusInfo.label}
                          </span>
                          {job.total_chunks > 0 && (
                            <span className="text-xs text-text-muted">
                              {job.processed_chunks}/{job.total_chunks} chunks
                            </span>
                          )}
                        </div>
                        {job.error && (
                          <p className="text-xs text-error mt-1 truncate">
                            {job.error}
                          </p>
                        )}
                      </div>
                      <span className="text-xs text-text-muted shrink-0">
                        {job.ontology_id}
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="text-center py-6 bg-surface border border-border border-dashed rounded-lg">
              <FileText className="w-8 h-8 text-text-muted mx-auto mb-2" strokeWidth={1.5} />
              <p className="text-xs text-text-muted">No uploads yet</p>
            </div>
          )}

          {/* TODO: Add UI for manual LLM extraction workflow (copy prompt, paste results) */}
          {/* The backend supports a manual extraction flow where users copy prompts to their LLM */}
          {/* and paste back the extracted entities/relationships. This UI is not yet implemented. */}
        </div>

        {/* Navigation */}
        <div className="flex gap-3">
          <Link
            to="/admin/setup"
            className="flex-1 flex items-center justify-center gap-2 border border-border hover:border-accent/50 text-text rounded-xl px-4 py-3 text-sm font-medium transition-all hover:bg-surface"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Setup
          </Link>
          {/* TODO: Support multiple file upload with queue management */}
        </div>
      </div>
    </OnboardingCard>
  )
}
