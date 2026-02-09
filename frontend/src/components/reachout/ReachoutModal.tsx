import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { API_BASE } from '../../types/onboarding'

export type ReachoutMode = 'feedback' | 'help' | 'support'

interface ReachoutOverrides {
  title?: string
  description?: string
  buttonLabel?: string
  successMessage?: string
}

interface ReachoutModalProps {
  open: boolean
  mode: ReachoutMode
  overrides?: ReachoutOverrides
  onClose: () => void
}

function nonEmpty(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}

export function ReachoutModal({ open, mode, overrides, onClose }: ReachoutModalProps) {
  const { t } = useTranslation()
  const modalRef = useRef<HTMLDivElement | null>(null)
  const [message, setMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const title =
    nonEmpty(overrides?.title) ??
    t(`reachout.mode.${mode}.title`, mode === 'feedback' ? 'Feedback' : mode === 'help' ? 'Help' : 'Support')
  const description =
    nonEmpty(overrides?.description) ??
    t(
      `reachout.mode.${mode}.description`,
      mode === 'feedback'
        ? 'Send feedback or suggestions to the team.'
        : mode === 'help'
          ? 'Ask for help using this instance.'
          : 'Contact support about an issue or request.'
    )
  const sendLabel = nonEmpty(overrides?.buttonLabel) ?? t('reachout.form.send', 'Send')
  const successMessage = nonEmpty(overrides?.successMessage) ?? t('reachout.status.success', 'Thanks. Your message was sent.')

  useEffect(() => {
    if (!open) return
    setError(null)
    setSuccess(false)
    setMessage('')
    // Focus trap minimal: focus the dialog container so Escape works consistently.
    setTimeout(() => modalRef.current?.focus(), 0)
  }, [open])

  const handleSubmit = async () => {
    const trimmed = message.trim()
    if (!trimmed) {
      setError(t('reachout.errors.required', 'Message is required.'))
      return
    }

    setSubmitting(true)
    setError(null)

    try {
      const res = await fetch(`${API_BASE}/reachout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({ message: trimmed }),
      })

      if (res.status === 429) {
        setError(t('reachout.errors.rateLimited', 'Too many messages. Please try again later.'))
        return
      }
      if (res.status === 404) {
        setError(t('reachout.errors.unavailable', 'Reachout is unavailable.'))
        return
      }
      if (res.status === 503) {
        setError(t('reachout.errors.notConfigured', 'This feature is not configured.'))
        return
      }
      if (!res.ok) {
        setError(t('reachout.errors.failed', 'Failed to send message. Please try again.'))
        return
      }

      setSuccess(true)
    } catch (e) {
      setError(t('reachout.errors.failed', 'Failed to send message. Please try again.'))
    } finally {
      setSubmitting(false)
    }
  }

  if (!open) return null

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
      role="dialog"
      aria-modal="true"
      aria-labelledby="reachout-modal-title"
    >
      <div
        ref={modalRef}
        tabIndex={-1}
        onKeyDown={(e) => e.key === 'Escape' && onClose()}
        className="bg-surface border border-border rounded-xl max-w-lg w-full shadow-xl overflow-hidden"
      >
        <div className="flex items-start justify-between gap-4 p-4 border-b border-border">
          <div>
            <h3 id="reachout-modal-title" className="font-semibold text-text">{title}</h3>
            <p className="text-xs text-text-muted mt-1">{description}</p>
          </div>
          <button
            onClick={onClose}
            className="text-text-muted hover:text-text transition-colors text-sm"
            aria-label={t('common.close', 'Close')}
          >
            {t('common.close', 'Close')}
          </button>
        </div>

        <div className="p-4">
          {success ? (
            <div className="bg-surface-overlay border border-border rounded-xl p-4">
              <p className="text-sm text-text">{successMessage}</p>
            </div>
          ) : (
            <>
              <label htmlFor="reachout-message" className="text-sm font-medium text-text mb-1.5 block">
                {t('reachout.form.messageLabel', 'Message')}
              </label>
              <textarea
                id="reachout-message"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder={t('reachout.form.placeholder', 'Write your message...')}
                rows={6}
                className="w-full border border-border rounded-lg px-3 py-2 bg-surface text-text placeholder:text-text-muted text-sm focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 resize-y"
              />
              {error && (
                <p className="text-xs text-error mt-2" role="alert">{error}</p>
              )}
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 p-4 border-t border-border bg-surface-overlay">
          <button
            type="button"
            onClick={onClose}
            className="btn-ghost px-3 py-2 rounded-lg transition-all"
            disabled={submitting}
          >
            {t('common.cancel', 'Cancel')}
          </button>
          {!success && (
            <button
              type="button"
              onClick={handleSubmit}
              className="btn btn-primary disabled:opacity-50"
              disabled={submitting}
            >
              {submitting ? t('common.sending', 'Sending...') : sendLabel}
            </button>
          )}
          {success && (
            <button
              type="button"
              onClick={onClose}
              className="btn btn-primary"
            >
              {t('common.close', 'Close')}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

