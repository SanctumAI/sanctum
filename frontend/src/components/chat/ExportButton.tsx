import { useState, useRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Message } from './ChatMessage'
import { downloadExport, ExportFormat } from '../../utils/exportChat'

interface ExportButtonProps {
  messages: Message[]
  disabled?: boolean
  iconOnly?: boolean
}

export function ExportButton({ messages, disabled, iconOnly = false }: ExportButtonProps) {
  const { t } = useTranslation()
  const [isOpen, setIsOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleExport = (format: ExportFormat) => {
    downloadExport({ messages, format })
    setIsOpen(false)
  }

  const isDisabled = disabled || messages.length === 0

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => !isDisabled && setIsOpen(!isOpen)}
        disabled={isDisabled}
        className={`btn-ghost inline-flex items-center justify-center gap-1.5 rounded-lg text-xs font-medium transition-all ${
          iconOnly ? 'p-2' : 'px-2.5 py-1.5'
        } ${
          isDisabled
            ? 'text-text-muted! cursor-not-allowed'
            : ''
        }`}
        title={isDisabled ? t('chat.export.disabled') : t('chat.export.title')}
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
        </svg>
        {!iconOnly && t('chat.export.button')}
      </button>

      {isOpen && (
        <div className="absolute top-full right-0 mt-1.5 w-44 bg-surface-raised border border-border rounded-xl shadow-xl z-50 overflow-hidden animate-fade-in-scale backdrop-blur-dropdown">
          <div className="p-1.5">
            <button
              onClick={() => handleExport('md')}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-text hover:bg-surface-overlay rounded-lg transition-colors text-left"
            >
              <svg className="w-4 h-4 text-text-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
              </svg>
              <div>
                <p className="font-medium">{t('chat.export.markdown')}</p>
                <p className="text-[10px] text-text-muted">{t('chat.export.markdownExt')}</p>
              </div>
            </button>
            <button
              onClick={() => handleExport('txt')}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-text hover:bg-surface-overlay rounded-lg transition-colors text-left"
            >
              <svg className="w-4 h-4 text-text-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
              </svg>
              <div>
                <p className="font-medium">{t('chat.export.plainText')}</p>
                <p className="text-[10px] text-text-muted">{t('chat.export.plainTextExt')}</p>
              </div>
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
