import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useInstanceConfig } from '../../context/InstanceConfigContext'
import { DynamicIcon } from './DynamicIcon'

export function InstanceLogo() {
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
