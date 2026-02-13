/**
 * Instance Configuration Types & Storage
 *
 * Settings are persisted to the backend SQLite database and cached in localStorage.
 * The backend serves as the source of truth; localStorage provides fast initial load.
 */

import type { TFunction } from 'i18next'

export type AccentColor = 'blue' | 'purple' | 'green' | 'orange' | 'pink' | 'teal'
export type HeaderLayout = 'icon_name' | 'icon_only' | 'name_only'
export type ChatBubbleStyle = 'soft' | 'round' | 'square' | 'pill'
export type SurfaceStyle = 'plain' | 'gradient' | 'noise' | 'grid'
export type StatusIconSet = 'classic' | 'minimal' | 'playful'
export type TypographyPreset = 'modern' | 'grotesk' | 'humanist'

export interface InstanceConfig {
  name: string
  accentColor: AccentColor
  /** Raw primary_color from backend. When a custom hex, overrides accentColor for styling. */
  primaryColor?: string
  icon: string
  logoUrl: string
  faviconUrl: string
  appleTouchIconUrl: string
  assistantIcon: string
  userIcon: string
  assistantName: string
  userLabel: string
  headerLayout: HeaderLayout
  headerTagline: string
  chatBubbleStyle: ChatBubbleStyle
  chatBubbleShadow: boolean
  surfaceStyle: SurfaceStyle
  statusIconSet: StatusIconSet
  typographyPreset: TypographyPreset
}

export const DEFAULT_INSTANCE_CONFIG: InstanceConfig = {
  name: 'Sanctum',
  accentColor: 'blue',
  icon: 'Sparkles',
  logoUrl: '',
  faviconUrl: '',
  appleTouchIconUrl: '',
  assistantIcon: 'Sparkles',
  userIcon: 'User',
  assistantName: 'Sanctum AI',
  userLabel: 'You',
  headerLayout: 'icon_name',
  headerTagline: '',
  chatBubbleStyle: 'soft',
  chatBubbleShadow: true,
  surfaceStyle: 'plain',
  statusIconSet: 'classic',
  typographyPreset: 'modern',
}

export const HEADER_LAYOUTS: HeaderLayout[] = ['icon_name', 'icon_only', 'name_only']
export const CHAT_BUBBLE_STYLES: ChatBubbleStyle[] = ['soft', 'round', 'square', 'pill']
export const SURFACE_STYLES: SurfaceStyle[] = ['plain', 'gradient', 'noise', 'grid']
export const STATUS_ICON_SETS: StatusIconSet[] = ['classic', 'minimal', 'playful']
export const TYPOGRAPHY_PRESETS: TypographyPreset[] = ['modern', 'grotesk', 'humanist']

// Curated icons suitable for branding/logo use (~175 icons)
// Removed Pentagon, Octagon - they look like circles at 18px
export const CURATED_ICONS = [
  // Abstract/Decorative
  'Sparkles', 'Star', 'Gem', 'Diamond', 'Hexagon', 'Circle', 'Square',
  'Triangle', 'Flower2', 'Snowflake', 'Sun', 'Moon', 'Infinity',
  // Tech/AI
  'Brain', 'Cpu', 'Bot', 'Wand2', 'Lightbulb', 'Zap', 'Rocket', 'Atom',
  'Binary', 'Code', 'Terminal', 'Database', 'Server', 'Wifi',
  // Knowledge/Learning
  'Book', 'BookOpen', 'GraduationCap', 'Library', 'Scroll', 'FileText',
  'Notebook', 'ClipboardList',
  // Communication
  'MessageCircle', 'MessageSquare', 'Mail', 'Send', 'Radio', 'Bell',
  'Megaphone',
  // People
  'User', 'UserCircle', 'UserSquare', 'UserRound', 'Users', 'UserPlus',
  'UserCheck', 'Contact',
  // Security/Trust
  'Shield', 'ShieldCheck', 'Lock', 'Key', 'Fingerprint', 'Eye',
  'KeyRound', 'ScanFace',
  // Navigation/Discovery
  'Compass', 'Map', 'Navigation', 'Crosshair', 'Target', 'Waypoints',
  'MapPin', 'Globe', 'Search',
  // Growth/Success
  'TrendingUp', 'BarChart3', 'Activity', 'Award', 'Crown', 'Trophy',
  'Medal', 'ThumbsUp', 'PartyPopper',
  // Nature/Organic
  'Leaf', 'TreePine', 'Flame', 'Droplet', 'Cloud', 'Mountain', 'Waves',
  'Wind', 'Sunrise',
  // Business/Professional
  'Briefcase', 'Building', 'Building2', 'Calendar', 'Clock', 'CreditCard',
  'DollarSign', 'FileCheck', 'Folder', 'Inbox', 'Receipt', 'Scale',
  'Timer', 'Wallet', 'Landmark',
  // Health/Wellness
  'Heart', 'HeartPulse', 'Pill', 'Stethoscope', 'Thermometer', 'Apple',
  'Dumbbell', 'Smile',
  // Media/Entertainment
  'Camera', 'Film', 'Headphones', 'Music', 'Play', 'Mic', 'Video', 'Tv',
  'Gamepad2', 'Speaker', 'Image',
  // Food/Lifestyle
  'Coffee', 'UtensilsCrossed', 'Wine', 'Pizza', 'Cookie', 'IceCream',
  'Cake', 'Beer',
  // Travel/Transport
  'Plane', 'Car', 'Train', 'Ship', 'Bike', 'Bus', 'Truck', 'Luggage',
  'Anchor',
  // Tools/Utilities
  'Wrench', 'Hammer', 'Scissors', 'Settings', 'Cog', 'SlidersHorizontal',
  'Filter', 'Calculator',
  // Social/Community
  'Share2', 'Link', 'Gift', 'Handshake', 'HeartHandshake', 'Hand',
  // Science/Education
  'Flask', 'Microscope', 'TestTube', 'Dna', 'Beaker', 'Orbit', 'Telescope',
  // Objects/Home
  'Home', 'Package', 'Blocks', 'Box', 'Archive', 'Trash2', 'Recycle', 'Lamp',
  // Creative
  'Palette', 'PenTool', 'Brush', 'Aperture', 'Layers', 'Grid3X3',
  'Crop', 'Eraser', 'Shapes',
  // Misc Visual
  'QrCode', 'Barcode', 'Scan', 'Focus', 'Minimize2', 'Maximize2',
  'RotateCw', 'RefreshCw',
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
      primaryColor: typeof parsed.primaryColor === 'string' ? parsed.primaryColor : undefined,
      icon: parsed.icon || DEFAULT_INSTANCE_CONFIG.icon,
      logoUrl: typeof parsed.logoUrl === 'string' ? parsed.logoUrl : DEFAULT_INSTANCE_CONFIG.logoUrl,
      faviconUrl: typeof parsed.faviconUrl === 'string' ? parsed.faviconUrl : DEFAULT_INSTANCE_CONFIG.faviconUrl,
      appleTouchIconUrl: typeof parsed.appleTouchIconUrl === 'string' ? parsed.appleTouchIconUrl : DEFAULT_INSTANCE_CONFIG.appleTouchIconUrl,
      assistantIcon: parsed.assistantIcon || DEFAULT_INSTANCE_CONFIG.assistantIcon,
      userIcon: parsed.userIcon || DEFAULT_INSTANCE_CONFIG.userIcon,
      assistantName: typeof parsed.assistantName === 'string' ? parsed.assistantName : DEFAULT_INSTANCE_CONFIG.assistantName,
      userLabel: typeof parsed.userLabel === 'string' ? parsed.userLabel : DEFAULT_INSTANCE_CONFIG.userLabel,
      headerLayout: parsed.headerLayout || DEFAULT_INSTANCE_CONFIG.headerLayout,
      headerTagline: typeof parsed.headerTagline === 'string' ? parsed.headerTagline : DEFAULT_INSTANCE_CONFIG.headerTagline,
      chatBubbleStyle: parsed.chatBubbleStyle || DEFAULT_INSTANCE_CONFIG.chatBubbleStyle,
      chatBubbleShadow: typeof parsed.chatBubbleShadow === 'boolean'
        ? parsed.chatBubbleShadow
        : DEFAULT_INSTANCE_CONFIG.chatBubbleShadow,
      surfaceStyle: parsed.surfaceStyle || DEFAULT_INSTANCE_CONFIG.surfaceStyle,
      statusIconSet: parsed.statusIconSet || DEFAULT_INSTANCE_CONFIG.statusIconSet,
      typographyPreset: parsed.typographyPreset || DEFAULT_INSTANCE_CONFIG.typographyPreset,
    }
  } catch {
    return DEFAULT_INSTANCE_CONFIG
  }
}

/** Save config to localStorage (browser-local only for now) */
export function saveInstanceConfig(config: InstanceConfig): void {
  localStorage.setItem(INSTANCE_CONFIG_KEY, JSON.stringify(config))
}

const CUSTOM_ACCENT_CSS_VARS = [
  '--color-accent',
  '--color-accent-hover',
  '--color-accent-subtle',
  '--color-accent-text',
] as const

function normalizeHexColor(value: string): string | null {
  const v = value.trim().toLowerCase()
  if (!v) return null
  const m6 = /^#([0-9a-f]{6})$/.exec(v)
  if (m6) return `#${m6[1]}`
  const m3 = /^#([0-9a-f]{3})$/.exec(v)
  if (m3) {
    const [r, g, b] = m3[1].split('')
    return `#${r}${r}${g}${g}${b}${b}`
  }
  return null
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace('#', '')
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  return { r, g, b }
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x))
}

function mixRgb(a: { r: number; g: number; b: number }, b: { r: number; g: number; b: number }, t: number) {
  const tt = clamp01(t)
  return {
    r: Math.round(a.r * (1 - tt) + b.r * tt),
    g: Math.round(a.g * (1 - tt) + b.g * tt),
    b: Math.round(a.b * (1 - tt) + b.b * tt),
  }
}

function rgbToHex(rgb: { r: number; g: number; b: number }): string {
  const to2 = (n: number) => n.toString(16).padStart(2, '0')
  return `#${to2(rgb.r)}${to2(rgb.g)}${to2(rgb.b)}`
}

function pickReadableTextColor(bg: { r: number; g: number; b: number }): string {
  // Rough perceived luminance; good enough for deciding white vs dark text.
  const lum = (0.2126 * bg.r + 0.7152 * bg.g + 0.0722 * bg.b) / 255
  return lum > 0.62 ? '#1a1815' : '#ffffff'
}

export function applyAccentColor(color: AccentColor): void {
  const root = document.documentElement
  // If a custom accent was previously applied via CSS vars, clear it so the class-based
  // theme takes effect again.
  for (const v of CUSTOM_ACCENT_CSS_VARS) root.style.removeProperty(v)
  // Remove all accent classes
  Object.keys(ACCENT_COLORS).forEach((c) => {
    root.classList.remove(`accent-${c}`)
  })
  // Add the new one
  root.classList.add(`accent-${color}`)
}

/**
 * Apply a custom accent directly from a hex color value.
 * This bypasses the limited preset accent-* classes and allows the admin assistant
 * to set `primary_color` to any valid hex string.
 */
export function applyCustomAccentColor(hex: string): boolean {
  const normalized = normalizeHexColor(hex)
  if (!normalized) return false

  const root = document.documentElement
  // Remove preset accent classes so they don't fight the inline CSS vars.
  Object.keys(ACCENT_COLORS).forEach((c) => {
    root.classList.remove(`accent-${c}`)
  })

  const base = hexToRgb(normalized)
  const white = { r: 255, g: 255, b: 255 }
  const black = { r: 0, g: 0, b: 0 }

  // Keep this simple and deterministic:
  // - hover: slightly darker than base
  // - subtle: very light tint for chips/selected backgrounds
  const hover = mixRgb(base, black, 0.18)
  const subtle = mixRgb(base, white, 0.84)

  root.style.setProperty('--color-accent', normalized)
  root.style.setProperty('--color-accent-hover', rgbToHex(hover))
  root.style.setProperty('--color-accent-subtle', rgbToHex(subtle))
  root.style.setProperty('--color-accent-text', pickReadableTextColor(base))

  return true
}

function upsertLinkTag(rel: string, href: string): void {
  const selector = `link[rel="${rel}"][data-instance-branding="true"]`
  const existing = document.head.querySelector<HTMLLinkElement>(selector)

  if (!href || !href.trim()) {
    if (existing) existing.remove()
    return
  }

  const link = existing ?? document.createElement('link')
  link.rel = rel
  link.href = href.trim()
  link.setAttribute('data-instance-branding', 'true')

  if (!existing) {
    document.head.appendChild(link)
  }
}

export function applyDocumentTitle(name: string): void {
  const trimmed = name?.trim()
  if (trimmed) {
    document.title = trimmed
  }
}

export function applyFavicon(url: string): void {
  upsertLinkTag('icon', url)
}

export function applyAppleTouchIcon(url: string): void {
  upsertLinkTag('apple-touch-icon', url)
}

export function applySurfaceStyle(style: SurfaceStyle): void {
  const root = document.documentElement
  SURFACE_STYLES.forEach((value) => {
    root.classList.remove(`surface-${value}`)
  })
  root.classList.add(`surface-${style}`)
}

export function applyTypographyPreset(preset: TypographyPreset): void {
  const root = document.documentElement
  TYPOGRAPHY_PRESETS.forEach((value) => {
    root.classList.remove(`type-${value}`)
  })
  root.classList.add(`type-${preset}`)
}
