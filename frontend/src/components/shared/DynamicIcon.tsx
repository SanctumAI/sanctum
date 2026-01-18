import { icons } from 'lucide-react'

interface DynamicIconProps {
  name: string
  size?: number
  className?: string
  strokeWidth?: number
}

export function DynamicIcon({
  name,
  size = 24,
  className = '',
  strokeWidth = 2
}: DynamicIconProps) {
  const Icon = icons[name as keyof typeof icons]

  if (!Icon) {
    // Fallback to Sparkles if icon not found
    const FallbackIcon = icons['Sparkles']
    return <FallbackIcon size={size} className={className} strokeWidth={strokeWidth} />
  }

  return <Icon size={size} className={className} strokeWidth={strokeWidth} />
}
