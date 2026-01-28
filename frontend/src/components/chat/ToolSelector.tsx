import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

export interface Tool {
  id: string
  name: string
  icon: React.ReactNode
  description: string
}

interface ToolSelectorProps {
  tools?: Tool[]
  selectedTools: string[]
  onToggle: (toolId: string) => void
  compact?: boolean
}

export function ToolSelector({
  tools,
  selectedTools,
  onToggle,
  compact = false,
}: ToolSelectorProps) {
  const { t } = useTranslation()

  const defaultTools: Tool[] = useMemo(
    () => [
      {
        id: 'web-search',
        name: t('chat.tools.webSearchName'),
        description: t('chat.tools.webSearch'),
        icon: (
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
          </svg>
        ),
      },
      {
        id: 'db-query',
        name: t('chat.tools.databaseName'),
        description: t('chat.tools.database'),
        icon: (
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 0v3.75m-16.5-3.75v3.75m16.5 0v3.75C20.25 16.153 16.556 18 12 18s-8.25-1.847-8.25-4.125v-3.75m16.5 0c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125" />
          </svg>
        ),
      },
    ],
    [t]
  )

  const activeTools = tools ?? defaultTools

  return (
    <div className="flex items-center gap-1.5">
      {!compact && (
        <span className="label mr-1">{t('chat.tools.label')}</span>
      )}
      {activeTools.map((tool) => {
        const isSelected = selectedTools.includes(tool.id)
        return (
          <button
            key={tool.id}
            onClick={() => onToggle(tool.id)}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all active:scale-95 ${
              isSelected
                ? 'bg-accent text-accent-text shadow-md glow-accent'
                : 'text-text-secondary hover:text-text hover:bg-surface-overlay border border-transparent hover:border-border'
            }`}
            title={tool.description}
          >
            {tool.icon}
            {tool.name}
          </button>
        )
      })}
    </div>
  )
}
