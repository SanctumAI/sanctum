import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Search } from 'lucide-react'
import { CURATED_ICONS } from '../../types/instance'
import { DynamicIcon } from '../shared/DynamicIcon'

interface IconPickerProps {
  value: string
  onChange: (icon: string) => void
  'aria-labelledby'?: string
}

export function IconPicker({ value, onChange, 'aria-labelledby': ariaLabelledby }: IconPickerProps) {
  const { t } = useTranslation()
  const [search, setSearch] = useState('')

  const filteredIcons = CURATED_ICONS.filter(name =>
    name.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="space-y-3" role="group" aria-labelledby={ariaLabelledby}>
      {/* Search input */}
      <div className="relative">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted pointer-events-none" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('admin.icons.searchPlaceholder')}
          className="input-field w-full pl-10 pr-4 py-2.5 bg-surface border border-border rounded-xl text-sm focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition-all"
        />
      </div>

      {/* Icon grid */}
      <div className="border border-border rounded-xl bg-surface p-2 max-h-[200px] overflow-y-auto">
        {filteredIcons.length > 0 ? (
          <div className="grid grid-cols-6 gap-1">
            {filteredIcons.map(iconName => {
              const isSelected = value === iconName
              return (
                <button
                  key={iconName}
                  type="button"
                  onClick={() => onChange(iconName)}
                  className={`p-2.5 rounded-lg transition-all flex items-center justify-center hover:-translate-y-0.5 ${
                    isSelected
                      ? 'bg-accent text-white ring-2 ring-accent ring-offset-2 ring-offset-surface shadow-md'
                      : 'text-text-secondary hover:bg-surface-overlay hover:text-text hover:shadow-sm'
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
            {t('admin.icons.noMatch', { search })}
          </div>
        )}
      </div>

      {/* Selected indicator */}
      <div className="flex items-center gap-2.5 text-sm text-text-muted bg-surface-overlay rounded-xl px-4 py-2.5 border border-border">
        <div className="w-6 h-6 rounded-md bg-accent/10 flex items-center justify-center">
          <DynamicIcon name={value} size={14} className="text-accent" />
        </div>
        <span>{t('admin.icons.selected')} <span className="text-text font-medium">{value}</span></span>
      </div>
    </div>
  )
}
