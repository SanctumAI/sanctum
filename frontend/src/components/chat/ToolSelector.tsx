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

const defaultTools: Tool[] = [
  {
    id: 'web-search',
    name: 'Web',
    description: 'Search the web for current information',
    icon: (
      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
      </svg>
    ),
  },
  {
    id: 'db-query',
    name: 'Database',
    description: 'Query the knowledge graph',
    icon: (
      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 0v3.75m-16.5-3.75v3.75m16.5 0v3.75C20.25 16.153 16.556 18 12 18s-8.25-1.847-8.25-4.125v-3.75m16.5 0c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125" />
      </svg>
    ),
  },
]

export function ToolSelector({
  tools = defaultTools,
  selectedTools,
  onToggle,
  compact = false,
}: ToolSelectorProps) {
  return (
    <div className="flex items-center gap-1.5">
      {!compact && (
        <span className="text-[11px] text-text-muted uppercase tracking-wider font-medium mr-1">Tools</span>
      )}
      {tools.map((tool) => {
        const isSelected = selectedTools.includes(tool.id)
        return (
          <button
            key={tool.id}
            onClick={() => onToggle(tool.id)}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-all hover-scale active-press ${
              isSelected
                ? 'bg-accent text-accent-text shadow-sm'
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
