/**
 * Instance Configuration Context
 *
 * Fetches instance settings from the backend and caches in localStorage.
 * Settings include: instance name, accent color, and icon choices (configured by admin)
 */
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import {
  InstanceConfig,
  DEFAULT_INSTANCE_CONFIG,
  getInstanceConfig,
  saveInstanceConfig,
  applyAccentColor,
  applyDocumentTitle,
  applyFavicon,
  applyAppleTouchIcon,
  AccentColor,
  CURATED_ICONS,
  HeaderLayout,
  ChatBubbleStyle,
  SurfaceStyle,
  StatusIconSet,
  TypographyPreset,
  HEADER_LAYOUTS,
  CHAT_BUBBLE_STYLES,
  SURFACE_STYLES,
  STATUS_ICON_SETS,
  TYPOGRAPHY_PRESETS,
  applySurfaceStyle,
  applyTypographyPreset,
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

function parseBoolean(value: string | number | boolean | undefined): boolean | undefined {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value === 1 ? true : value === 0 ? false : undefined
  if (!value) return undefined
  const normalized = value.trim().toLowerCase()
  if (['true', '1', 'yes', 'on'].includes(normalized)) return true
  if (['false', '0', 'no', 'off'].includes(normalized)) return false
  return undefined
}

function validateHeaderLayout(value: string | undefined): HeaderLayout | undefined {
  if (!value) return undefined
  return HEADER_LAYOUTS.includes(value as HeaderLayout) ? (value as HeaderLayout) : undefined
}

function validateChatBubbleStyle(value: string | undefined): ChatBubbleStyle | undefined {
  if (!value) return undefined
  return CHAT_BUBBLE_STYLES.includes(value as ChatBubbleStyle) ? (value as ChatBubbleStyle) : undefined
}

function validateSurfaceStyle(value: string | undefined): SurfaceStyle | undefined {
  if (!value) return undefined
  return SURFACE_STYLES.includes(value as SurfaceStyle) ? (value as SurfaceStyle) : undefined
}

function validateStatusIconSet(value: string | undefined): StatusIconSet | undefined {
  if (!value) return undefined
  return STATUS_ICON_SETS.includes(value as StatusIconSet) ? (value as StatusIconSet) : undefined
}

function validateTypographyPreset(value: string | undefined): TypographyPreset | undefined {
  if (!value) return undefined
  return TYPOGRAPHY_PRESETS.includes(value as TypographyPreset) ? (value as TypographyPreset) : undefined
}

export function InstanceConfigProvider({ children }: { children: ReactNode }) {
  const [config, setConfigState] = useState<InstanceConfig>(DEFAULT_INSTANCE_CONFIG)

  // Load config: first from localStorage (immediate), then fetch from backend
  useEffect(() => {
    // Immediately apply cached config
    const stored = getInstanceConfig()
    setConfigState(stored)
    applyAccentColor(stored.accentColor)
    applySurfaceStyle(stored.surfaceStyle)
    applyTypographyPreset(stored.typographyPreset)
    applyDocumentTitle(stored.name)
    applyFavicon(stored.faviconUrl)
    applyAppleTouchIcon(stored.appleTouchIconUrl)

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
            logoUrl:
              typeof settings.logo_url === 'string'
                ? settings.logo_url
                : (stored.logoUrl ?? DEFAULT_INSTANCE_CONFIG.logoUrl),
            faviconUrl:
              typeof settings.favicon_url === 'string'
                ? settings.favicon_url
                : (stored.faviconUrl ?? DEFAULT_INSTANCE_CONFIG.faviconUrl),
            appleTouchIconUrl:
              typeof settings.apple_touch_icon_url === 'string'
                ? settings.apple_touch_icon_url
                : (stored.appleTouchIconUrl ?? DEFAULT_INSTANCE_CONFIG.appleTouchIconUrl),
            assistantIcon:
              validateIcon(settings.assistant_icon) ??
              stored.assistantIcon ??
              DEFAULT_INSTANCE_CONFIG.assistantIcon,
            userIcon:
              validateIcon(settings.user_icon) ??
              stored.userIcon ??
              DEFAULT_INSTANCE_CONFIG.userIcon,
            assistantName:
              typeof settings.assistant_name === 'string'
                ? settings.assistant_name
                : (stored.assistantName ?? DEFAULT_INSTANCE_CONFIG.assistantName),
            userLabel:
              typeof settings.user_label === 'string'
                ? settings.user_label
                : (stored.userLabel ?? DEFAULT_INSTANCE_CONFIG.userLabel),
            headerLayout:
              validateHeaderLayout(settings.header_layout) ??
              stored.headerLayout ??
              DEFAULT_INSTANCE_CONFIG.headerLayout,
            headerTagline:
              typeof settings.header_tagline === 'string'
                ? settings.header_tagline
                : (stored.headerTagline ?? DEFAULT_INSTANCE_CONFIG.headerTagline),
            chatBubbleStyle:
              validateChatBubbleStyle(settings.chat_bubble_style) ??
              stored.chatBubbleStyle ??
              DEFAULT_INSTANCE_CONFIG.chatBubbleStyle,
            chatBubbleShadow:
              parseBoolean(settings.chat_bubble_shadow) ??
              stored.chatBubbleShadow ??
              DEFAULT_INSTANCE_CONFIG.chatBubbleShadow,
            surfaceStyle:
              validateSurfaceStyle(settings.surface_style) ??
              stored.surfaceStyle ??
              DEFAULT_INSTANCE_CONFIG.surfaceStyle,
            statusIconSet:
              validateStatusIconSet(settings.status_icon_set) ??
              stored.statusIconSet ??
              DEFAULT_INSTANCE_CONFIG.statusIconSet,
            typographyPreset:
              validateTypographyPreset(settings.typography_preset) ??
              stored.typographyPreset ??
              DEFAULT_INSTANCE_CONFIG.typographyPreset,
          }
          
          setConfigState(newConfig)
          saveInstanceConfig(newConfig)
          applyAccentColor(newConfig.accentColor)
          applySurfaceStyle(newConfig.surfaceStyle)
          applyTypographyPreset(newConfig.typographyPreset)
          applyDocumentTitle(newConfig.name)
          applyFavicon(newConfig.faviconUrl)
          applyAppleTouchIcon(newConfig.appleTouchIconUrl)
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
    applySurfaceStyle(newConfig.surfaceStyle)
    applyTypographyPreset(newConfig.typographyPreset)
    applyDocumentTitle(newConfig.name)
    applyFavicon(newConfig.faviconUrl)
    applyAppleTouchIcon(newConfig.appleTouchIconUrl)
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

let hasWarnedMissingProvider = false

export function useInstanceConfig(): InstanceConfigContextValue {
  const context = useContext(InstanceConfigContext)
  if (!context) {
    if (import.meta.env.DEV) {
      if (!hasWarnedMissingProvider) {
        console.warn('useInstanceConfig used without InstanceConfigProvider (dev fallback enabled).')
        hasWarnedMissingProvider = true
      }
      return {
        config: DEFAULT_INSTANCE_CONFIG,
        setConfig: () => {},
        updateConfig: () => {},
      }
    }
    throw new Error('useInstanceConfig must be used within an InstanceConfigProvider')
  }
  return context
}
