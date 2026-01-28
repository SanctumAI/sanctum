import { useEffect, useRef } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuthFlow, clearAllAuth } from '../../hooks/useAuthFlow'

interface SettingsDrawerProps {
  open: boolean
  onClose: () => void
}

interface SettingsLinkProps {
  to: string
  icon: React.ReactNode
  label: string
  description?: string
  onClick?: () => void
}

function SettingsLink({ to, icon, label, description, onClick }: SettingsLinkProps) {
  return (
    <Link
      to={to}
      onClick={onClick}
      className="flex items-start gap-3 p-3 rounded-xl hover:bg-surface-overlay border border-transparent hover:border-border transition-all group"
    >
      <div className="w-8 h-8 rounded-lg bg-surface-overlay group-hover:bg-accent/10 flex items-center justify-center text-text-secondary group-hover:text-accent transition-all shrink-0">
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-text group-hover:text-accent transition-colors">{label}</p>
        {description && (
          <p className="text-xs text-text-muted mt-0.5">{description}</p>
        )}
      </div>
    </Link>
  )
}

export function SettingsDrawer({ open, onClose }: SettingsDrawerProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { isAdmin, userEmail } = useAuthFlow()
  const drawerRef = useRef<HTMLDivElement>(null)

  // Close on escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    if (open) {
      document.addEventListener('keydown', handleEscape)
      return () => document.removeEventListener('keydown', handleEscape)
    }
  }, [open, onClose])

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (drawerRef.current && !drawerRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    if (open) {
      // Delay to prevent immediate close from the button click
      setTimeout(() => {
        document.addEventListener('mousedown', handleClickOutside)
      }, 0)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [open, onClose])

  const handleSignOut = () => {
    clearAllAuth()
    onClose()
    navigate('/login')
  }

  if (!open) return null

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-40 animate-fade-in" />

      {/* Drawer */}
      <div
        ref={drawerRef}
        className="fixed right-0 top-0 h-full w-80 max-w-[90vw] bg-surface border-l border-border z-50 shadow-2xl animate-slide-in-right overflow-y-auto"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h2 className="heading-lg">{t('settings.title')}</h2>
          <button
            onClick={onClose}
            className="btn-ghost p-1.5 rounded-lg transition-all"
            aria-label={t('common.close')}
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-6">
          {/* User Info */}
          {userEmail && (
            <div className="pb-4 border-b border-border">
              <p className="label mb-2">{t('settings.signedInAs')}</p>
              <p className="text-sm font-medium text-text truncate">{userEmail}</p>
            </div>
          )}

          {/* Admin Section */}
          {isAdmin && (
            <div>
              <p className="label mb-3">{t('settings.adminTools')}</p>
              <div className="space-y-1">
                <SettingsLink
                  to="/admin/setup"
                  onClick={onClose}
                  label={t('settings.admin.instanceConfig')}
                  description={t('settings.admin.instanceConfigDesc')}
                  icon={
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 6h9.75M10.5 6a1.5 1.5 0 11-3 0m3 0a1.5 1.5 0 10-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-9.75 0h9.75" />
                    </svg>
                  }
                />
                <SettingsLink
                  to="/test-dashboard"
                  onClick={onClose}
                  label={t('settings.admin.testDashboard')}
                  description={t('settings.admin.testDashboardDesc')}
                  icon={
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 00-6.23.693L5 14.5m14.8.8l1.402 1.402c1.232 1.232.65 3.318-1.067 3.611A48.309 48.309 0 0112 21c-2.773 0-5.491-.235-8.135-.687-1.718-.293-2.3-2.379-1.067-3.61L5 14.5" />
                    </svg>
                  }
                />
                <SettingsLink
                  to="/admin/upload"
                  onClick={onClose}
                  label={t('settings.admin.documentUpload')}
                  description={t('settings.admin.documentUploadDesc')}
                  icon={
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                    </svg>
                  }
                />
                <SettingsLink
                  to="/admin/database"
                  onClick={onClose}
                  label={t('settings.admin.databaseExplorer')}
                  description={t('settings.admin.databaseExplorerDesc')}
                  icon={
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 0v3.75m-16.5-3.75v3.75m16.5 0v3.75C20.25 16.153 16.556 18 12 18s-8.25-1.847-8.25-4.125v-3.75m16.5 0c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125" />
                    </svg>
                  }
                />
              </div>
            </div>
          )}

          {/* Sign Out */}
          <div className="pt-4 border-t border-border">
            <button
              onClick={handleSignOut}
              className="w-full flex items-center gap-3 p-3 rounded-lg hover:bg-error-subtle text-text-secondary hover:text-error transition-colors"
            >
              <div className="w-8 h-8 rounded-lg bg-surface-overlay flex items-center justify-center shrink-0">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15M12 9l-3 3m0 0l3 3m-3-3h12.75" />
                </svg>
              </div>
              <span className="text-sm font-medium">{t('settings.signOut')}</span>
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
