import { ReactNode, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useInstanceConfig } from '../../context/InstanceConfigContext'
import { DynamicIcon } from '../shared/DynamicIcon'

interface OnboardingCardProps {
  children: ReactNode
  footer?: ReactNode
  title?: string
  subtitle?: string
  size?: 'md' | 'lg' | 'xl'
}

function InstanceLogo() {
  const { config } = useInstanceConfig()
  const [logoError, setLogoError] = useState(false)
  const hasLogoImage = Boolean(config.logoUrl?.trim()) && !logoError
  const brandingBadgeClass = hasLogoImage
    ? 'bg-surface'
    : 'bg-gradient-to-br from-accent to-accent-hover'

  useEffect(() => {
    setLogoError(false)
  }, [config.logoUrl])

  return (
    <div className="flex flex-col items-center mb-8">
      <div className={`w-16 h-16 rounded-2xl ${brandingBadgeClass} flex items-center justify-center shadow-xl ring-1 ring-white/10 mb-4`}>
        {hasLogoImage ? (
          <img
            src={config.logoUrl}
            alt={`${config.name} logo`}
            className="w-10 h-10 object-contain"
            onError={() => setLogoError(true)}
          />
        ) : (
          <DynamicIcon name={config.icon} size={32} className="text-white" />
        )}
      </div>
      <Link to="/" className="heading-xl hover:text-accent transition-colors">
        {config.name}
      </Link>
    </div>
  )
}

export function OnboardingCard({ children, footer, title, subtitle, size }: OnboardingCardProps) {
  const maxWidthClass = {
    md: 'max-w-2xl',
    lg: 'max-w-4xl',
    xl: 'max-w-5xl',
  }[size ?? 'md']

  return (
    <div className="min-h-screen bg-gradient-to-br from-surface via-surface to-surface-raised/30 flex flex-col items-center justify-center p-4">
      <div className={`w-full ${maxWidthClass}`}>
        <InstanceLogo />

        <div className="card card-lg animate-fade-in-up">
          {(title || subtitle) && (
            <div className="text-center mb-8">
              {title && <h1 className="heading-xl">{title}</h1>}
              {subtitle && <p className="text-sm text-text-muted mt-2">{subtitle}</p>}
            </div>
          )}
          {children}
        </div>

        {footer && (
          <div className="text-center mt-6 text-sm text-text-muted animate-fade-in">
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}
