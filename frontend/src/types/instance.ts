/**
 * Instance Configuration Types & Storage
 *
 * Settings are persisted to the backend SQLite database and cached in localStorage.
 * The backend serves as the source of truth; localStorage provides fast initial load.
 */

import type { TFunction } from 'i18next'

export type AccentColor = 'blue' | 'purple' | 'green' | 'orange' | 'pink' | 'teal'

export interface InstanceConfig {
  name: string
  accentColor: AccentColor
  icon: string
}

export const DEFAULT_INSTANCE_CONFIG: InstanceConfig = {
  name: 'Sanctum',
  accentColor: 'blue',
  icon: 'Sparkles',
}

// Curated icons suitable for branding/logo use
export const CURATED_ICONS = [
  // Abstract/Decorative
  'Sparkles', 'Star', 'Gem', 'Diamond', 'Hexagon', 'Pentagon', 'Octagon',
  'Circle', 'Square', 'Triangle', 'Flower2', 'Snowflake', 'Sun', 'Moon',
  // Tech/AI
  'Brain', 'Cpu', 'Bot', 'Wand2', 'Lightbulb', 'Zap', 'Rocket', 'Atom',
  // Knowledge/Learning
  'Book', 'BookOpen', 'GraduationCap', 'Library', 'Scroll', 'FileText',
  // Communication
  'MessageCircle', 'MessageSquare', 'Mail', 'Send', 'Radio',
  // Security/Trust
  'Shield', 'ShieldCheck', 'Lock', 'Key', 'Fingerprint', 'Eye',
  // Navigation/Discovery
  'Compass', 'Map', 'Navigation', 'Crosshair', 'Target', 'Waypoints',
  // Growth/Success
  'TrendingUp', 'BarChart3', 'Activity', 'Award', 'Crown', 'Trophy',
  // Nature/Organic
  'Leaf', 'TreePine', 'Flame', 'Droplet', 'Cloud', 'Mountain',
  // Objects
  'Home', 'Building2', 'Landmark', 'Briefcase', 'Package', 'Blocks',
  // Creative
  'Palette', 'PenTool', 'Brush', 'Aperture', 'Layers', 'Grid3X3',
] as const

export const INSTANCE_CONFIG_KEY = 'sanctum_instance_config'

export interface AccentColorConfig {
  name: string
  preview: string  // Tailwind color for preview swatch
  gradient: string // Tailwind gradient classes
}

export const ACCENT_COLORS: Record<AccentColor, Omit<AccentColorConfig, 'name'> & { nameKey: string }> = {
  blue: {
    nameKey: 'colors.blue',
    preview: '#2563eb',
    gradient: 'from-blue-500 to-blue-700',
  },
  purple: {
    nameKey: 'colors.purple',
    preview: '#7c3aed',
    gradient: 'from-violet-500 to-purple-700',
  },
  green: {
    nameKey: 'colors.green',
    preview: '#059669',
    gradient: 'from-emerald-500 to-green-700',
  },
  orange: {
    nameKey: 'colors.orange',
    preview: '#ea580c',
    gradient: 'from-orange-500 to-orange-700',
  },
  pink: {
    nameKey: 'colors.pink',
    preview: '#db2777',
    gradient: 'from-pink-500 to-pink-700',
  },
  teal: {
    nameKey: 'colors.teal',
    preview: '#0d9488',
    gradient: 'from-teal-500 to-teal-700',
  },
}

/** Get accent colors with translated names */
export function getAccentColors(t: TFunction): Record<AccentColor, AccentColorConfig> {
  return Object.fromEntries(
    Object.entries(ACCENT_COLORS).map(([key, value]) => [
      key,
      {
        name: t(value.nameKey),
        preview: value.preview,
        gradient: value.gradient,
      },
    ])
  ) as Record<AccentColor, AccentColorConfig>
}

/** Load config from localStorage (browser-local only for now) */
export function getInstanceConfig(): InstanceConfig {
  const stored = localStorage.getItem(INSTANCE_CONFIG_KEY)
  if (!stored) return DEFAULT_INSTANCE_CONFIG
  try {
    const parsed = JSON.parse(stored)
    return {
      name: parsed.name || DEFAULT_INSTANCE_CONFIG.name,
      accentColor: parsed.accentColor || DEFAULT_INSTANCE_CONFIG.accentColor,
      icon: parsed.icon || DEFAULT_INSTANCE_CONFIG.icon,
    }
  } catch {
    return DEFAULT_INSTANCE_CONFIG
  }
}

/** Save config to localStorage (browser-local only for now) */
export function saveInstanceConfig(config: InstanceConfig): void {
  localStorage.setItem(INSTANCE_CONFIG_KEY, JSON.stringify(config))
}

export function applyAccentColor(color: AccentColor): void {
  const root = document.documentElement
  // Remove all accent classes
  Object.keys(ACCENT_COLORS).forEach((c) => {
    root.classList.remove(`accent-${c}`)
  })
  // Add the new one
  root.classList.add(`accent-${color}`)
}
