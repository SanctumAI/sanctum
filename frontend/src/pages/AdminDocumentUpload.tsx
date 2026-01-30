import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Upload, FileText, X, CloudUpload, Loader2, Clock, ArrowLeft, HelpCircle, ChevronLeft, ChevronRight } from 'lucide-react'
import { OnboardingCard } from '../components/onboarding/OnboardingCard'
import { STORAGE_KEYS } from '../types/onboarding'
import {
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
  const { t } = useTranslation()
  const navigate = useNavigate()
  const fileInputRef = useRef<HTMLInputElement>(null)

  // State
  const [isDragging, setIsDragging] = useState(false)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [isUploading, setIsUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [recentJobs, setRecentJobs] = useState<JobStatus[]>([])
  const [isLoadingJobs, setIsLoadingJobs] = useState(true)

  // Pipeline help modal state
  const [showPipelineHelpModal, setShowPipelineHelpModal] = useState(false)
  const [pipelineHelpPage, setPipelineHelpPage] = useState(0)
  const pipelineHelpModalRef = useRef<HTMLDivElement>(null)

  // Check if admin is logged in
  useEffect(() => {
    const pubkey = localStorage.getItem(STORAGE_KEYS.ADMIN_PUBKEY)
    if (!pubkey) {
      navigate('/admin')
    }
  }, [navigate])

  // Fetch recent jobs
  const fetchJobs = useCallback(async () => {
    try {
      const response = await fetch(`${INGEST_API_BASE}/ingest/jobs`)
      if (!response.ok) throw new Error(t('errors.failedToFetchJobs'))
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
      console.error(t('errors.errorFetchingJobs'), error)
    } finally {
      setIsLoadingJobs(false)
    }
  }, [t])

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
      setUploadError(t('upload.invalidFileType', { extensions: getAllowedExtensionsDisplay() }))
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
        return { label: t('upload.status.queued'), color: 'text-text-muted', icon: '○' }
      case 'processing':
        return { label: t('upload.status.processing'), color: 'text-warning', icon: '◐' }
      case 'chunked':
        return { label: t('upload.status.chunked'), color: 'text-info', icon: '◑' }
      case 'completed':
        return { label: t('upload.status.complete'), color: 'text-success', icon: '●' }
      case 'failed':
        return { label: t('upload.status.failed'), color: 'text-error', icon: '✕' }
      default:
        return { label: status, color: 'text-text-muted', icon: '?' }
    }
  }

  // Close pipeline help modal
  const handleClosePipelineHelpModal = () => {
    setShowPipelineHelpModal(false)
    setPipelineHelpPage(0)
  }

  // Focus trap for pipeline help modal
  useEffect(() => {
    if (showPipelineHelpModal && pipelineHelpModalRef.current) {
      pipelineHelpModalRef.current.focus()
    }
  }, [showPipelineHelpModal])

  // Pipeline help pages data
  const PIPELINE_HELP_PAGES = [
    {
      title: t('upload.pipelineHelp.formatsTitle', 'Supported Formats'),
      content: 'formats',
    },
    {
      title: t('upload.pipelineHelp.pipelineTitle', 'Processing Pipeline'),
      content: 'pipeline',
    },
    {
      title: t('upload.pipelineHelp.troubleshootingTitle', 'Troubleshooting'),
      content: 'troubleshooting',
    },
    {
      title: t('upload.pipelineHelp.tipsTitle', 'Best Practices'),
      content: 'tips',
    },
  ]

  const footer = (
    <Link to="/" className="text-text-muted hover:text-text transition-colors">
      {t('upload.backToDashboard')}
    </Link>
  )

  return (
    <OnboardingCard
      title={t('upload.title')}
      subtitle={t('upload.subtitle')}
      footer={footer}
    >
      <div className="space-y-6">
        {/* File Upload Zone */}
        <div className="bg-surface-overlay border border-border rounded-xl p-5">
          <h3 className="text-sm font-semibold text-text mb-4 flex items-center gap-2">
            <Upload className="w-4 h-4 text-text-muted" />
            {t('upload.uploadFile')}
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
                  title={t('upload.removeFile')}
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
                {isDragging ? t('upload.dropFileHere') : t('upload.dropOrBrowse')}
              </p>
              <p className="text-xs text-text-muted">
                {t('upload.supported', { extensions: getAllowedExtensionsDisplay() })}
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
                  {t('upload.uploading')}
                </>
              ) : (
                <>
                  <Upload className="w-4 h-4" />
                  {t('upload.uploadDocument')}
                </>
              )}
            </button>
          )}
        </div>

        {/* Recent Uploads */}
        <div className="bg-surface-overlay border border-border rounded-xl p-5">
          <h3 className="text-sm font-semibold text-text mb-4 flex items-center gap-2">
            <Clock className="w-4 h-4 text-text-muted" />
            {t('upload.recentUploads')}
            <button
              onClick={() => setShowPipelineHelpModal(true)}
              className="ml-1 text-text-muted hover:text-accent transition-colors"
              aria-label={t('upload.pipelineHelp.ariaLabel', 'Document processing help')}
            >
              <HelpCircle className="w-5 h-5" />
            </button>
          </h3>

          {isLoadingJobs ? (
            <div className="text-center py-6">
              <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin mx-auto mb-2" />
              <p className="text-xs text-text-muted">{t('common.loading')}</p>
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
                              {t('upload.chunks', { processed: job.processed_chunks, total: job.total_chunks })}
                            </span>
                          )}
                        </div>
                        {job.error && (
                          <p className="text-xs text-error mt-1 truncate">
                            {job.error}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="text-center py-6 bg-surface border border-border border-dashed rounded-lg">
              <FileText className="w-8 h-8 text-text-muted mx-auto mb-2" strokeWidth={1.5} />
              <p className="text-xs text-text-muted">{t('upload.noUploads')}</p>
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
            {t('upload.backToSetup')}
          </Link>
          {/* TODO: Support multiple file upload with queue management */}
        </div>

        {/* Pipeline Help Modal */}
        {showPipelineHelpModal && (
          <div
            ref={pipelineHelpModalRef}
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
            role="dialog"
            aria-modal="true"
            aria-labelledby="pipeline-help-modal-title"
            onKeyDown={(e) => e.key === 'Escape' && handleClosePipelineHelpModal()}
            tabIndex={-1}
          >
            <div className="bg-surface border border-border rounded-xl p-6 w-full max-w-lg mx-4 shadow-xl">
              <div className="flex items-center justify-between mb-4">
                <h3 id="pipeline-help-modal-title" className="text-lg font-semibold text-text flex items-center gap-2">
                  <HelpCircle className="w-5 h-5" />
                  {PIPELINE_HELP_PAGES[pipelineHelpPage].title}
                </h3>
                <button
                  onClick={handleClosePipelineHelpModal}
                  className="text-text-muted hover:text-text transition-colors"
                  aria-label={t('common.close', 'Close')}
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Content */}
              <div className="min-h-[280px]">
                {PIPELINE_HELP_PAGES[pipelineHelpPage].content === 'formats' ? (
                  <div className="space-y-3">
                    <p className="text-sm text-text-muted mb-4">
                      {t('upload.pipelineHelp.formatsDesc', 'Currently supported document formats for upload:')}
                    </p>
                    <div className="space-y-2">
                      <div className="bg-surface-overlay border border-border rounded-lg p-3">
                        <p className="text-sm font-medium text-text">.pdf</p>
                        <p className="text-xs text-text-muted mt-1">
                          {t('upload.pipelineHelp.pdfDesc', 'PDF documents. Text is extracted; images and scanned PDFs are not yet supported.')}
                        </p>
                      </div>
                      <div className="bg-surface-overlay border border-border rounded-lg p-3">
                        <p className="text-sm font-medium text-text">.txt</p>
                        <p className="text-xs text-text-muted mt-1">
                          {t('upload.pipelineHelp.txtDesc', 'Plain text files. Best for simple, unformatted content.')}
                        </p>
                      </div>
                      <div className="bg-surface-overlay border border-border rounded-lg p-3">
                        <p className="text-sm font-medium text-text">.md</p>
                        <p className="text-xs text-text-muted mt-1">
                          {t('upload.pipelineHelp.mdDesc', 'Markdown files. Formatting is preserved as plain text.')}
                        </p>
                      </div>
                    </div>
                    <div className="bg-warning/10 border border-warning/20 rounded-lg p-3 mt-4">
                      <p className="text-xs text-warning">
                        {t('upload.pipelineHelp.notSupported', 'Not yet supported: .docx, .xlsx, images, scanned PDFs. Convert these to text or PDF first.')}
                      </p>
                    </div>
                  </div>
                ) : PIPELINE_HELP_PAGES[pipelineHelpPage].content === 'pipeline' ? (
                  <div className="space-y-3">
                    <p className="text-sm text-text-muted mb-4">
                      {t('upload.pipelineHelp.pipelineDesc', 'Documents go through these stages after upload:')}
                    </p>
                    <div className="space-y-2">
                      <div className="flex items-start gap-3 bg-surface-overlay border border-border rounded-lg p-3">
                        <span className="text-text-muted">○</span>
                        <div>
                          <p className="text-sm font-medium text-text">{t('upload.pipelineHelp.pending', 'Pending')}</p>
                          <p className="text-xs text-text-muted mt-1">
                            {t('upload.pipelineHelp.pendingDesc', 'File uploaded, waiting in queue for processing.')}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-start gap-3 bg-surface-overlay border border-border rounded-lg p-3">
                        <span className="text-warning">◐</span>
                        <div>
                          <p className="text-sm font-medium text-text">{t('upload.pipelineHelp.processing', 'Processing')}</p>
                          <p className="text-xs text-text-muted mt-1">
                            {t('upload.pipelineHelp.processingDesc', 'Text is being extracted from the document.')}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-start gap-3 bg-surface-overlay border border-border rounded-lg p-3">
                        <span className="text-info">◑</span>
                        <div>
                          <p className="text-sm font-medium text-text">{t('upload.pipelineHelp.chunked', 'Chunked')}</p>
                          <p className="text-xs text-text-muted mt-1">
                            {t('upload.pipelineHelp.chunkedDesc', 'Document split into searchable chunks. Embeddings being generated.')}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-start gap-3 bg-surface-overlay border border-border rounded-lg p-3">
                        <span className="text-success">●</span>
                        <div>
                          <p className="text-sm font-medium text-text">{t('upload.pipelineHelp.completed', 'Completed')}</p>
                          <p className="text-xs text-text-muted mt-1">
                            {t('upload.pipelineHelp.completedDesc', 'Document is now searchable and available to the AI.')}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : PIPELINE_HELP_PAGES[pipelineHelpPage].content === 'troubleshooting' ? (
                  <div className="space-y-3">
                    <p className="text-sm text-text-muted mb-4">
                      {t('upload.pipelineHelp.troubleshootingDesc', 'Common issues and how to resolve them:')}
                    </p>
                    <div className="space-y-2">
                      <div className="bg-surface-overlay border border-border rounded-lg p-3">
                        <p className="text-sm font-medium text-error">{t('upload.pipelineHelp.stuckPending', 'Stuck on "Pending"')}</p>
                        <p className="text-xs text-text-muted mt-1">
                          {t('upload.pipelineHelp.stuckPendingFix', 'The processing queue may be full. Wait a few minutes or check if the backend service is running.')}
                        </p>
                      </div>
                      <div className="bg-surface-overlay border border-border rounded-lg p-3">
                        <p className="text-sm font-medium text-error">{t('upload.pipelineHelp.failedProcessing', 'Failed during processing')}</p>
                        <p className="text-xs text-text-muted mt-1">
                          {t('upload.pipelineHelp.failedProcessingFix', 'The document may be corrupted or password-protected. Try re-saving it or converting to a different format.')}
                        </p>
                      </div>
                      <div className="bg-surface-overlay border border-border rounded-lg p-3">
                        <p className="text-sm font-medium text-error">{t('upload.pipelineHelp.noChunks', 'Completed but no chunks')}</p>
                        <p className="text-xs text-text-muted mt-1">
                          {t('upload.pipelineHelp.noChunksFix', 'Document may be empty or contain only images. Ensure it has extractable text content.')}
                        </p>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <p className="text-sm text-text-muted mb-4">
                      {t('upload.pipelineHelp.tipsDesc', 'For best results with your knowledge base:')}
                    </p>
                    <div className="space-y-2">
                      <div className="bg-surface-overlay border border-border rounded-lg p-3">
                        <p className="text-sm font-medium text-text">{t('upload.pipelineHelp.tipLength', 'Document Length')}</p>
                        <p className="text-xs text-text-muted mt-1">
                          {t('upload.pipelineHelp.tipLengthDesc', 'Moderate-length documents (5-50 pages) work best. Very long documents may need to be split.')}
                        </p>
                      </div>
                      <div className="bg-surface-overlay border border-border rounded-lg p-3">
                        <p className="text-sm font-medium text-text">{t('upload.pipelineHelp.tipQuality', 'Content Quality')}</p>
                        <p className="text-xs text-text-muted mt-1">
                          {t('upload.pipelineHelp.tipQualityDesc', 'Well-structured documents with clear headings and paragraphs produce better search results.')}
                        </p>
                      </div>
                      <div className="bg-surface-overlay border border-border rounded-lg p-3">
                        <p className="text-sm font-medium text-text">{t('upload.pipelineHelp.tipNaming', 'File Naming')}</p>
                        <p className="text-xs text-text-muted mt-1">
                          {t('upload.pipelineHelp.tipNamingDesc', 'Use descriptive file names. They help identify documents in the admin interface.')}
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Pagination */}
              <div className="flex items-center justify-between mt-6 pt-4 border-t border-border">
                <button
                  onClick={() => setPipelineHelpPage((prev) => Math.max(0, prev - 1))}
                  disabled={pipelineHelpPage === 0}
                  className="flex items-center gap-1 text-sm text-text-muted hover:text-text disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronLeft className="w-4 h-4" />
                  {t('common.previous', 'Previous')}
                </button>

                {/* Page indicators */}
                <div className="flex items-center gap-1.5">
                  {PIPELINE_HELP_PAGES.map((_, index) => (
                    <button
                      key={index}
                      onClick={() => setPipelineHelpPage(index)}
                      className={`w-2 h-2 rounded-full transition-colors ${
                        index === pipelineHelpPage
                          ? 'bg-accent'
                          : 'bg-border hover:bg-text-muted'
                      }`}
                      aria-label={`${t('common.goToPage', 'Go to page')} ${index + 1}`}
                    />
                  ))}
                </div>

                <button
                  onClick={() => setPipelineHelpPage((prev) => Math.min(PIPELINE_HELP_PAGES.length - 1, prev + 1))}
                  disabled={pipelineHelpPage === PIPELINE_HELP_PAGES.length - 1}
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
    </OnboardingCard>
  )
}
