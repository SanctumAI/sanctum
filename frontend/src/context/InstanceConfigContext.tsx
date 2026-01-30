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
 * Map backend primary_color (hex or name) to frontend AccentColor
 */
function hexToAccentColor(value: string | undefined): AccentColor {
  if (!value) return DEFAULT_INSTANCE_CONFIG.accentColor

  // If it's already a valid accent color name, return it directly
  const validColors: AccentColor[] = ['blue', 'purple', 'green', 'orange', 'pink', 'teal']
  if (validColors.includes(value as AccentColor)) {
    return value as AccentColor
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

  const normalized = value.toLowerCase()
  if (colorMap[normalized]) {
    return colorMap[normalized]
  }

  return DEFAULT_INSTANCE_CONFIG.accentColor
}

/**
 * Validate icon name against CURATED_ICONS, fall back to default if invalid
 */
function validateIcon(value: string | undefined): string {
  if (!value) return DEFAULT_INSTANCE_CONFIG.icon

  if (CURATED_ICONS.includes(value as typeof CURATED_ICONS[number])) {
    return value
  }

  return DEFAULT_INSTANCE_CONFIG.icon
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
            accentColor: hexToAccentColor(settings.primary_color) || stored.accentColor,
            icon: validateIcon(settings.icon) || stored.icon,
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
