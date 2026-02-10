import { ReactNode } from 'react'
import { InstanceLogo } from '../shared/InstanceLogo'

interface OnboardingCardProps {
  children: ReactNode
  footer?: ReactNode
  title?: string
  subtitle?: string
  size?: 'md' | 'lg' | 'xl'
  topRight?: ReactNode
}

export function OnboardingCard({ children, footer, title, subtitle, size, topRight }: OnboardingCardProps) {
  const maxWidthClass = {
    md: 'max-w-2xl',
    lg: 'max-w-4xl',
    xl: 'max-w-5xl',
  }[size ?? 'md']

  return (
    <div className="relative min-h-screen bg-gradient-to-br from-surface via-surface to-surface-raised/30 flex flex-col items-center justify-center p-4">
      {topRight && (
        <div className="absolute top-4 right-4">
          {topRight}
        </div>
      )}

      <div className={`w-full ${maxWidthClass}`}>
        <InstanceLogo />

        <div className="card card-lg animate-fade-in-up">
          {(title || subtitle) && (
            <div className="text-center mb-8">
              {title && <h1 className="heading-xl">{title}</h1>}
              {subtitle && <p className="text-sm text-text-muted mt-2 max-w-md mx-auto">{subtitle}</p>}
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
