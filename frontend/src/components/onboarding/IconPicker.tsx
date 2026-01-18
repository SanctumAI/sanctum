import { useState } from 'react'
import { Search } from 'lucide-react'
import { CURATED_ICONS } from '../../types/instance'
import { DynamicIcon } from '../shared/DynamicIcon'

interface IconPickerProps {
  value: string
  onChange: (icon: string) => void
}

export function IconPicker({ value, onChange }: IconPickerProps) {
  const [search, setSearch] = useState('')

  const filteredIcons = CURATED_ICONS.filter(name =>
    name.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="space-y-3">
      {/* Search input */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted pointer-events-none" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search icons..."
          className="w-full pl-9 pr-4 py-2 bg-surface border border-border rounded-lg text-sm text-text placeholder:text-text-muted focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition-all"
        />
      </div>

      {/* Icon grid */}
      <div className="border border-border rounded-lg bg-surface p-2 max-h-[200px] overflow-y-auto">
        {filteredIcons.length > 0 ? (
          <div className="grid grid-cols-6 gap-1">
            {filteredIcons.map(iconName => {
              const isSelected = value === iconName
              return (
                <button
                  key={iconName}
                  type="button"
                  onClick={() => onChange(iconName)}
                  className={`p-2.5 rounded-lg transition-all flex items-center justify-center ${
                    isSelected
                      ? 'bg-accent text-white ring-2 ring-accent ring-offset-1 ring-offset-surface'
                      : 'text-text-secondary hover:bg-surface-overlay hover:text-text'
                  }`}
                  title={iconName}
                >
                  <DynamicIcon name={iconName} size={18} strokeWidth={isSelected ? 2.5 : 2} />
                </button>
              )
            })}
          </div>
        ) : (
          <div className="text-center py-6 text-text-muted text-sm">
            No icons match "{search}"
          </div>
        )}
      </div>

      {/* Selected indicator */}
      <div className="flex items-center gap-2 text-sm text-text-muted bg-surface-overlay rounded-lg px-3 py-2">
        <DynamicIcon name={value} size={16} className="text-accent" />
        <span>Selected: <span className="text-text font-medium">{value}</span></span>
      </div>
    </div>
  )
}
