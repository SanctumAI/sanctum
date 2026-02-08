import { useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Paintbrush, Brain, Server, Upload, Database, ArrowRight, Users, ShieldCheck } from 'lucide-react'
import { OnboardingCard } from '../components/onboarding/OnboardingCard'
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
      className="block card card-sm bg-surface-overlay hover:border-accent/50 hover:shadow-lg transition-all group"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="text-text-muted group-hover:text-accent transition-colors shrink-0">
            {icon}
          </div>
          <h3 className="text-sm font-semibold text-text">{title}</h3>
        </div>
        <ArrowRight className="w-4 h-4 text-text-muted group-hover:text-accent group-hover:translate-x-0.5 transition-all shrink-0" />
      </div>
      <p className="text-xs text-text-muted mt-2 pl-8">{description}</p>
    </Link>
  )
}

interface SecurityStepCardProps {
  step: string
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
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="text-xs font-semibold text-accent mb-2">{step}</div>
      <h3 className="text-sm font-semibold text-text mb-1">{title}</h3>
      <p className="text-xs text-text-muted leading-relaxed">{description}</p>
      <div className="flex items-center gap-3 mt-3">
        <Link to={primaryActionTo} className="text-xs font-medium text-accent hover:text-accent-hover transition-colors">
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

  // Check if admin is logged in
  useEffect(() => {
    if (!isAdminAuthenticated()) {
      navigate('/')
    }
  }, [navigate])

  const handleBack = () => {
    navigate('/chat')
  }

  const footer = (
    <button
      onClick={handleBack}
      className="text-text-muted hover:text-text transition-colors"
    >
      {t('admin.setup.backToChat')}
    </button>
  )

  return (
    <OnboardingCard
      size="xl"
      title={t('adminDashboard.title', 'Admin Dashboard')}
      subtitle={t('adminDashboard.subtitle', 'Manage your Sanctum instance configuration')}
      footer={footer}
    >
      <div className="space-y-4 stagger-children">
        <div className="rounded-xl border border-border bg-surface-overlay p-4">
          <h2 className="text-sm font-semibold text-text mb-1">{t('adminDashboard.configureTitle')}</h2>
          <p className="text-xs text-text-muted">{t('adminDashboard.configureSubtitle')}</p>
          <div className="flex flex-wrap gap-2 mt-3">
            <span className="text-xs px-2.5 py-1 rounded-full border border-border bg-surface text-text-muted">{t('adminDashboard.instance')}</span>
            <span className="text-xs px-2.5 py-1 rounded-full border border-border bg-surface text-text-muted">{t('adminDashboard.user')}</span>
            <span className="text-xs px-2.5 py-1 rounded-full border border-border bg-surface text-text-muted">{t('adminDashboard.ai')}</span>
            <span className="text-xs px-2.5 py-1 rounded-full border border-border bg-surface text-text-muted">{t('adminDashboard.deployment')}</span>
            <span className="text-xs px-2.5 py-1 rounded-full border border-border bg-surface text-text-muted">{t('adminDashboard.upload')}</span>
            <span className="text-xs px-2.5 py-1 rounded-full border border-border bg-surface text-text-muted">{t('adminDashboard.database')}</span>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-surface-overlay p-4">
          <div className="flex items-center gap-2 mb-3">
            <ShieldCheck className="w-4 h-4 text-accent" />
            <h2 className="text-sm font-semibold text-text">{t('adminDashboard.securityBreadcrumbTitle')}</h2>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <SecurityStepCard
              step={t('adminDashboard.securityStep1Label')}
              title={t('adminDashboard.securityStep1Title')}
              description={t('adminDashboard.securityStep1Body')}
              primaryActionTo="/admin/deployment"
              primaryActionLabel={t('adminDashboard.securityStep1Primary')}
              secondaryActionTo="/admin/users"
              secondaryActionLabel={t('adminDashboard.securityStep1Secondary')}
            />
            <SecurityStepCard
              step={t('adminDashboard.securityStep2Label')}
              title={t('adminDashboard.securityStep2Title')}
              description={t('adminDashboard.securityStep2Body')}
              primaryActionTo="/admin/users"
              primaryActionLabel={t('adminDashboard.securityStep2Primary')}
              secondaryActionTo="/admin/ai"
              secondaryActionLabel={t('adminDashboard.securityStep2Secondary')}
            />
            <SecurityStepCard
              step={t('adminDashboard.securityStep3Label')}
              title={t('adminDashboard.securityStep3Title')}
              description={t('adminDashboard.securityStep3Body')}
              primaryActionTo="/admin/deployment"
              primaryActionLabel={t('adminDashboard.securityStep3Primary')}
              secondaryActionTo="/admin/database"
              secondaryActionLabel={t('adminDashboard.securityStep3Secondary')}
            />
          </div>
        </div>

        {/* Instance Configuration */}
        <DashboardCard
          to="/admin/instance"
          icon={<Paintbrush className="w-5 h-5" />}
          title={t('adminDashboard.instance', 'Instance Configuration')}
          description={t('adminDashboard.instanceDesc', 'Branding, chat style, and theme settings')}
        />

        {/* User Configuration */}
        <DashboardCard
          to="/admin/users"
          icon={<Users className="w-5 h-5" />}
          title={t('adminDashboard.user', 'User Configuration')}
          description={t('adminDashboard.userDesc', 'Define user types and onboarding questions')}
        />

        {/* AI Configuration */}
        <DashboardCard
          to="/admin/ai"
          icon={<Brain className="w-5 h-5" />}
          title={t('adminDashboard.ai', 'AI Configuration')}
          description={t('adminDashboard.aiDesc', 'Configure prompts, LLM parameters, and document defaults')}
        />

        {/* Deployment Configuration */}
        <DashboardCard
          to="/admin/deployment"
          icon={<Server className="w-5 h-5" />}
          title={t('adminDashboard.deployment', 'Deployment Configuration')}
          description={t('adminDashboard.deploymentDesc', 'Manage environment settings and service health')}
        />

        <div className="border-t border-border pt-4 mt-4" />

        {/* Document Upload */}
        <DashboardCard
          to="/admin/upload"
          icon={<Upload className="w-5 h-5" />}
          title={t('adminDashboard.upload', 'Document Upload')}
          description={t('adminDashboard.uploadDesc', 'Add documents to your knowledge base')}
        />

        {/* Database Explorer */}
        <DashboardCard
          to="/admin/database"
          icon={<Database className="w-5 h-5" />}
          title={t('adminDashboard.database', 'Database Explorer')}
          description={t('adminDashboard.databaseDesc', 'Browse and query the SQLite database')}
        />
      </div>
    </OnboardingCard>
  )
}
