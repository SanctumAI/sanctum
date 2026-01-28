import { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useInstanceConfig } from '../../context/InstanceConfigContext'
import { DynamicIcon } from '../shared/DynamicIcon'

interface OnboardingCardProps {
  children: ReactNode
  footer?: ReactNode
  title?: string
  subtitle?: string
}

function InstanceLogo() {
  const { config } = useInstanceConfig()

  return (
    <div className="flex flex-col items-center mb-8">
      <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-accent to-accent-hover flex items-center justify-center shadow-xl ring-1 ring-white/10 mb-4">
        <DynamicIcon name={config.icon} size={32} className="text-white" />
      </div>
      <Link to="/" className="heading-xl hover:text-accent transition-colors">
        {config.name}
      </Link>
    </div>
  )
}

export function OnboardingCard({ children, footer, title, subtitle }: OnboardingCardProps) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-surface via-surface to-surface-raised/30 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-2xl">
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
