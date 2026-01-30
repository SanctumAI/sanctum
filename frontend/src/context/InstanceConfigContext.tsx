/**
 * Instance Configuration Context
 *
 * Fetches instance settings from the backend and caches in localStorage.
 * Settings include: instance name, accent color, icon (configured by admin)
 */
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import {
  InstanceConfig,
  DEFAULT_INSTANCE_CONFIG,
  getInstanceConfig,
  saveInstanceConfig,
  applyAccentColor,
  AccentColor,
  CURATED_ICONS,
} from '../types/instance'
import { API_BASE } from '../types/onboarding'

interface InstanceConfigContextValue {
  config: InstanceConfig
  setConfig: (config: InstanceConfig) => void
  updateConfig: (updates: Partial<InstanceConfig>) => void
}

const InstanceConfigContext = createContext<InstanceConfigContextValue | undefined>(undefined)

/**
 * Map backend primary_color (hex or name) to frontend AccentColor.
 * Returns undefined for invalid/missing values to allow fallback to cached config.
 */
function hexToAccentColor(value: string | undefined): AccentColor | undefined {
  if (!value) return undefined

  const normalized = value.trim().toLowerCase()

  // If it's already a valid accent color name, return it directly
  const validColors: AccentColor[] = ['blue', 'purple', 'green', 'orange', 'pink', 'teal']
  if (validColors.includes(normalized as AccentColor)) {
    return normalized as AccentColor
  }

  // Otherwise try to match hex values
  const colorMap: Record<string, AccentColor> = {
    '#2563eb': 'blue',
    '#3b82f6': 'blue',
    '#7c3aed': 'purple',
    '#059669': 'green',
    '#ea580c': 'orange',
    '#db2777': 'pink',
    '#0d9488': 'teal',
  }

  if (colorMap[normalized]) {
    return colorMap[normalized]
  }

  return undefined
}

/**
 * Validate icon name against CURATED_ICONS.
 * Returns undefined for invalid/missing values to allow fallback to cached config.
 */
function validateIcon(value: string | undefined): string | undefined {
  if (!value) return undefined

  const normalizedValue = value.trim().toLowerCase()
  const matchedIcon = CURATED_ICONS.find(
    icon => icon.toLowerCase() === normalizedValue
  )
  if (matchedIcon) {
    return matchedIcon
  }

  return undefined
}

export function InstanceConfigProvider({ children }: { children: ReactNode }) {
  const [config, setConfigState] = useState<InstanceConfig>(DEFAULT_INSTANCE_CONFIG)

  // Load config: first from localStorage (immediate), then fetch from backend
  useEffect(() => {
    // Immediately apply cached config
    const stored = getInstanceConfig()
    setConfigState(stored)
    applyAccentColor(stored.accentColor)

    // Then fetch from backend to get the latest
    async function fetchSettings() {
      try {
        const response = await fetch(`${API_BASE}/settings/public`)
        if (response.ok) {
          const data = await response.json()
          const settings = data.settings || {}
          
          const newConfig: InstanceConfig = {
            name: settings.instance_name || stored.name || DEFAULT_INSTANCE_CONFIG.name,
            accentColor:
              hexToAccentColor(settings.primary_color) ??
              stored.accentColor ??
              DEFAULT_INSTANCE_CONFIG.accentColor,
            icon: validateIcon(settings.icon) ?? stored.icon ?? DEFAULT_INSTANCE_CONFIG.icon,
          }
          
          setConfigState(newConfig)
          saveInstanceConfig(newConfig)
          applyAccentColor(newConfig.accentColor)
        }
      } catch (error) {
        console.warn('Failed to fetch instance settings, using cached config:', error)
      }
    }

    fetchSettings()
  }, [])

  const setConfig = (newConfig: InstanceConfig) => {
    setConfigState(newConfig)
    saveInstanceConfig(newConfig)
    applyAccentColor(newConfig.accentColor)
  }

  const updateConfig = (updates: Partial<InstanceConfig>) => {
    const newConfig = { ...config, ...updates }
    setConfig(newConfig)
  }

  return (
    <InstanceConfigContext.Provider value={{ config, setConfig, updateConfig }}>
      {children}
    </InstanceConfigContext.Provider>
  )
}

export function useInstanceConfig(): InstanceConfigContextValue {
  const context = useContext(InstanceConfigContext)
  if (!context) {
    throw new Error('useInstanceConfig must be used within an InstanceConfigProvider')
  }
  return context
}
