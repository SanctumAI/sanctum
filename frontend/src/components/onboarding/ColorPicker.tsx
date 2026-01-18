import { Check } from 'lucide-react'
import { AccentColor, ACCENT_COLORS } from '../../types/instance'

interface ColorPickerProps {
  value: AccentColor
  onChange: (color: AccentColor) => void
}

export function ColorPicker({ value, onChange }: ColorPickerProps) {
  const colors = Object.entries(ACCENT_COLORS) as [AccentColor, typeof ACCENT_COLORS[AccentColor]][]

  return (
    <div className="grid grid-cols-3 gap-3">
      {colors.map(([colorKey, colorConfig]) => {
        const isSelected = value === colorKey
        return (
          <button
            key={colorKey}
            type="button"
            onClick={() => onChange(colorKey)}
            className={`relative flex items-center gap-3 p-3 rounded-xl border-2 transition-all ${
              isSelected
                ? 'border-current bg-surface-overlay shadow-sm'
                : 'border-transparent hover:bg-surface-overlay/50'
            }`}
            style={{
              borderColor: isSelected ? colorConfig.preview : undefined,
            }}
          >
            {/* Color swatch */}
            <div
              className="w-8 h-8 rounded-lg shadow-sm shrink-0"
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
