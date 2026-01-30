import { Check } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { AccentColor, getAccentColors } from '../../types/instance'

interface ColorPickerProps {
  value: AccentColor
  onChange: (color: AccentColor) => void
}

export function ColorPicker({ value, onChange }: ColorPickerProps) {
  const { t } = useTranslation()
  const accentColors = getAccentColors(t)
  const colors = Object.entries(accentColors) as [AccentColor, typeof accentColors[AccentColor]][]

  return (
    <div className="grid grid-cols-3 gap-3">
      {colors.map(([colorKey, colorConfig]) => {
        const isSelected = value === colorKey
        return (
          <button
            key={colorKey}
            type="button"
            onClick={() => onChange(colorKey)}
            className={`relative flex items-center gap-3 p-3 rounded-xl border-2 transition-all hover:-translate-y-0.5 ${
              isSelected
                ? 'bg-surface-overlay shadow-md'
                : 'border-transparent hover:bg-surface-overlay/50 hover:shadow-sm'
            }`}
            style={{
              borderColor: isSelected ? colorConfig.preview : 'transparent',
            }}
          >
            {/* Color swatch */}
            <div
              className={`w-8 h-8 rounded-lg shrink-0 transition-shadow ${isSelected ? 'shadow-md' : 'shadow-sm'}`}
              style={{ backgroundColor: colorConfig.preview }}
            >
              {/* Checkmark for selected */}
              {isSelected && (
                <div className="w-full h-full flex items-center justify-center">
                  <Check className="w-5 h-5 text-white" strokeWidth={3} />
                </div>
              )}
            </div>

            {/* Label */}
            <span className={`text-sm font-medium ${isSelected ? 'text-text' : 'text-text-secondary'}`}>
              {colorConfig.name}
            </span>
          </button>
        )
      })}
    </div>
  )
}
