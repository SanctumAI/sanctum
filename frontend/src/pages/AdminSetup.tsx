import { useState, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Paintbrush, Brain, Server, Upload, Database, ArrowRight, Users, ShieldCheck } from 'lucide-react'
import { InstanceLogo } from '../components/shared/InstanceLogo'
import { isAdminAuthenticated } from '../utils/adminApi'

interface DashboardCardProps {
  to: string
  icon: React.ReactNode
  title: string
  description: string
}

function DashboardCard({ to, icon, title, description }: DashboardCardProps) {
  return (
    <Link
      to={to}
      className="card card-sm bg-surface-raised card-interactive group flex items-center gap-4"
    >
      <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center shrink-0 group-hover:bg-accent/20 transition-colors">
        <div className="text-accent transition-colors">
          {icon}
        </div>
      </div>
      <div className="flex-1 min-w-0">
        <h3 className="text-sm font-semibold text-text">{title}</h3>
        <p className="text-xs text-text-muted mt-0.5 truncate">{description}</p>
      </div>
      <ArrowRight className="w-4 h-4 text-text-muted group-hover:text-accent group-hover:translate-x-0.5 transition-all shrink-0" />
    </Link>
  )
}

interface SecurityStepCardProps {
  step: number
  title: string
  description: string
  primaryActionTo: string
  primaryActionLabel: string
  secondaryActionTo?: string
  secondaryActionLabel?: string
}

function SecurityStepCard({
  step,
  title,
  description,
  primaryActionTo,
  primaryActionLabel,
  secondaryActionTo,
  secondaryActionLabel,
}: SecurityStepCardProps) {
  return (
    <div className="card card-sm bg-surface-raised">
      <div className="flex items-center gap-2 mb-2">
        <div className="w-6 h-6 rounded-full bg-accent/10 flex items-center justify-center shrink-0">
          <span className="text-xs font-semibold text-accent">{step}</span>
        </div>
        <h3 className="text-sm font-semibold text-text">{title}</h3>
      </div>
      <p className="text-sm text-text-secondary leading-relaxed">{description}</p>
      <div className="flex items-center gap-3 mt-3">
        <Link to={primaryActionTo} className="btn btn-sm btn-secondary">
          {primaryActionLabel}
        </Link>
        {secondaryActionTo && secondaryActionLabel && (
          <Link to={secondaryActionTo} className="text-xs font-medium text-text-muted hover:text-text transition-colors">
            {secondaryActionLabel}
          </Link>
        )}
      </div>
    </div>
  )
}

export function AdminSetup() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [authChecked, setAuthChecked] = useState(false)

  useEffect(() => {
    if (!isAdminAuthenticated()) {
      navigate('/')
    } else {
      setAuthChecked(true)
    }
  }, [navigate])

  if (!authChecked) return null

  return (
    <div className="min-h-screen bg-gradient-to-br from-surface via-surface to-surface-raised/30 flex flex-col items-center p-6 md:p-10">
      <div className="w-full max-w-5xl">
        <InstanceLogo />

        {/* Header */}
        <div className="text-center mb-10 animate-fade-in-up">
          <h1 className="heading-xl">{t('adminDashboard.title', 'Admin Dashboard')}</h1>
          <p className="text-sm text-text-muted mt-2">{t('adminDashboard.subtitle', 'Manage your Sanctum instance configuration')}</p>
        </div>

        {/* Security section */}
        <div className="mb-8 animate-fade-in-up">
          <div className="flex items-center gap-2 mb-4">
            <ShieldCheck className="w-5 h-5 text-accent" />
            <h2 className="heading-sm">{t('adminDashboard.securityBreadcrumbTitle')}</h2>
          </div>
          <div className="grid gap-4 md:grid-cols-3 stagger-children">
            <SecurityStepCard
              step={1}
              title={t('adminDashboard.securityStep1Title')}
              description={t('adminDashboard.securityStep1Body')}
              primaryActionTo="/admin/deployment"
              primaryActionLabel={t('adminDashboard.securityStep1Primary')}
              secondaryActionTo="/admin/users"
              secondaryActionLabel={t('adminDashboard.securityStep1Secondary')}
            />
            <SecurityStepCard
              step={2}
              title={t('adminDashboard.securityStep2Title')}
              description={t('adminDashboard.securityStep2Body')}
              primaryActionTo="/admin/users"
              primaryActionLabel={t('adminDashboard.securityStep2Primary')}
              secondaryActionTo="/admin/ai"
              secondaryActionLabel={t('adminDashboard.securityStep2Secondary')}
            />
            <SecurityStepCard
              step={3}
              title={t('adminDashboard.securityStep3Title')}
              description={t('adminDashboard.securityStep3Body')}
              primaryActionTo="/admin/deployment"
              primaryActionLabel={t('adminDashboard.securityStep3Primary')}
              secondaryActionTo="/admin/database"
              secondaryActionLabel={t('adminDashboard.securityStep3Secondary')}
            />
          </div>
        </div>

        {/* Configuration section */}
        <div className="mb-8">
          <div className="label mb-3">{t('adminDashboard.configSectionLabel', 'Configuration')}</div>
          <div className="grid gap-4 sm:grid-cols-2 stagger-children">
            <DashboardCard
              to="/admin/instance"
              icon={<Paintbrush className="w-5 h-5" />}
              title={t('adminDashboard.instance', 'Instance Configuration')}
              description={t('adminDashboard.instanceDesc', 'Branding, chat style, and theme settings')}
            />
            <DashboardCard
              to="/admin/users"
              icon={<Users className="w-5 h-5" />}
              title={t('adminDashboard.user', 'User Configuration')}
              description={t('adminDashboard.userDesc', 'Define user types and onboarding questions')}
            />
            <DashboardCard
              to="/admin/ai"
              icon={<Brain className="w-5 h-5" />}
              title={t('adminDashboard.ai', 'AI Configuration')}
              description={t('adminDashboard.aiDesc', 'Configure prompts, LLM parameters, and document defaults')}
            />
            <DashboardCard
              to="/admin/deployment"
              icon={<Server className="w-5 h-5" />}
              title={t('adminDashboard.deployment', 'Deployment Configuration')}
              description={t('adminDashboard.deploymentDesc', 'Manage environment settings and service health')}
            />
          </div>
        </div>

        {/* Data & Content section */}
        <div className="mb-8">
          <div className="label mb-3">{t('adminDashboard.dataSectionLabel', 'Data & Content')}</div>
          <div className="grid gap-4 sm:grid-cols-2 stagger-children">
            <DashboardCard
              to="/admin/upload"
              icon={<Upload className="w-5 h-5" />}
              title={t('adminDashboard.upload', 'Document Upload')}
              description={t('adminDashboard.uploadDesc', 'Add documents to your knowledge base')}
            />
            <DashboardCard
              to="/admin/database"
              icon={<Database className="w-5 h-5" />}
              title={t('adminDashboard.database', 'Database Explorer')}
              description={t('adminDashboard.databaseDesc', 'Browse and query the SQLite database')}
            />
          </div>
        </div>

        {/* Footer */}
        <div className="text-center mt-6 animate-fade-in">
          <button
            onClick={() => navigate('/chat')}
            className="btn btn-sm btn-ghost"
          >
            {t('admin.setup.backToChat')}
          </button>
        </div>
      </div>
    </div>
  )
}
