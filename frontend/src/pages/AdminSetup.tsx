import { useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Paintbrush, Brain, Server, Upload, Database, ArrowRight, Users } from 'lucide-react'
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
