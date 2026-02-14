import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router-dom'
import { Link2, AlertCircle, Check, ShieldCheck, CheckCircle2, Key, Shield, Sliders, Fingerprint, FileSignature, ArrowRight, ChevronDown, Globe } from 'lucide-react'
import { OnboardingCard } from '../components/onboarding/OnboardingCard'
import { NostrInfo, NostrExtensionLinks } from '../components/onboarding/NostrInfo'
import { STORAGE_KEYS } from '../types/onboarding'
import { authenticateWithNostr, hasNostrExtension, type AuthResult } from '../utils/nostrAuth'
import { fetchPublicConfig } from '../utils/publicConfig'
import { fetchInstanceStatus } from '../utils/instanceStatus'
import { LANGUAGES } from '../utils/languages'

type ConnectionState = 'idle' | 'connecting' | 'success' | 'no-extension' | 'error'

function LanguageSwitcher() {
  const { i18n, t } = useTranslation()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const currentLang = LANGUAGES.find((l) => l.code === i18n.language) ?? LANGUAGES[0]

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    if (open) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [open])

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="btn-ghost flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs text-text-muted hover:text-text transition-colors"
        aria-label={t('adminOnboarding.extracted.change_language_789b14', 'Change language')}
      >
        <Globe className="w-3.5 h-3.5" />
        <span>{currentLang.nativeName}</span>
        <ChevronDown className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-52 max-h-64 overflow-y-auto bg-surface-raised border border-border rounded-xl shadow-lg z-50 animate-fade-in-scale">
          {LANGUAGES.map((lang) => (
            <button
              key={lang.code}
              type="button"
              onClick={() => {
                i18n.changeLanguage(lang.code)
                setOpen(false)
              }}
              className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 transition-colors ${
                lang.code === i18n.language
                  ? 'text-accent bg-accent/5'
                  : 'text-text-secondary hover:text-text hover:bg-surface-overlay'
              }`}
            >
              <span className="text-base leading-none">{lang.flag}</span>
              <span>{lang.nativeName}</span>
              {lang.code === i18n.language && (
                <Check className="w-3.5 h-3.5 text-accent ml-auto shrink-0" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function NostrIcon({ variant = 'initiation' }: { variant?: 'initiation' | 'login' }) {
  const Icon = variant === 'login' ? Link2 : ShieldCheck
  return (
    <div className="relative w-16 h-16 mx-auto mb-6">
      <div className="absolute inset-0 rounded-2xl bg-accent/20 blur-xl animate-pulse-subtle" />
      <div className="relative w-16 h-16 rounded-2xl bg-gradient-to-br from-[var(--color-accent)] to-[var(--color-accent-hover)] flex items-center justify-center shadow-lg ring-1 ring-white/10">
        <Icon className="w-8 h-8 text-accent-text" strokeWidth={1.5} />
      </div>
    </div>
  )
}

function truncatePubkey(pubkey: string): string {
  if (pubkey.length <= 16) return pubkey
  return `${pubkey.slice(0, 8)}...${pubkey.slice(-8)}`
}

function InitiationStepper({
  step,
  labels,
}: {
  step: 1 | 2 | 3
  labels: [string, string, string]
}) {
  const steps: Array<{ n: 1 | 2 | 3; label: string }> = [
    { n: 1, label: labels[0] },
    { n: 2, label: labels[1] },
    { n: 3, label: labels[2] },
  ]

  return (
    <div className="mb-8">
      <div className="flex items-start">
        {steps.map((s, i) => {
          const isDone = s.n < step
          const isActive = s.n === step

          return (
            <div key={s.n} className="contents">
              {/* Dot + label column */}
              <div className="flex flex-col items-center gap-1.5 shrink-0">
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold transition-all duration-200 ${
                    isDone
                      ? 'bg-accent text-accent-text shadow-sm'
                      : isActive
                        ? 'bg-accent/10 text-accent ring-2 ring-accent/30'
                        : 'bg-surface-overlay text-text-muted ring-1 ring-border/60'
                  }`}
                >
                  {isDone ? <Check className="w-4 h-4" /> : s.n}
                </div>
                <span
                  className={`text-xs font-medium transition-colors text-center ${
                    isActive ? 'text-text' : isDone ? 'text-accent' : 'text-text-muted'
                  }`}
                >
                  {s.label}
                </span>
              </div>

              {/* Connecting line -- vertically centered on the dot (h-8 / 2 = top 1rem) */}
              {i < steps.length - 1 && (
                <div className="flex-1 mt-4 px-3">
                  <div
                    className={`h-px transition-colors duration-300 ${
                      s.n < step ? 'bg-accent' : 'bg-border'
                    }`}
                  />
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function AdminOnboarding() {
  const navigate = useNavigate()
  const { t } = useTranslation()
  const [state, setState] = useState<ConnectionState>('idle')
  const [pubkey, setPubkey] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [statusError, setStatusError] = useState<string | null>(null)
  const [simulateAdminAuth, setSimulateAdminAuth] = useState(false)
  const [instanceInitialized, setInstanceInitialized] = useState<boolean | null>(null)
  const [initStep, setInitStep] = useState<1 | 2 | 3>(1)

  // Fetch simulation setting on mount
  useEffect(() => {
    fetchPublicConfig().then((config) => {
      setSimulateAdminAuth(config.simulateAdminAuth)
    })
  }, [])

  // Determine if this instance has been initiated (admin exists).
  useEffect(() => {
    let active = true

    const loadStatus = async () => {
      try {
        const status = await fetchInstanceStatus()
        if (!active) return
        setStatusError(null)
        setInstanceInitialized(status.initialized)
        setInitStep(status.initialized ? 3 : 1)
      } catch (err) {
        console.error('Failed to fetch instance status (admin onboarding):', err)
        if (!active) return
        setStatusError(err instanceof Error ? err.message : 'Failed to check instance status')
        // Fail open: allow admin connection UI to render instead of hanging.
        setInstanceInitialized(true)
      }
    }

    void loadStatus()

    return () => {
      active = false
    }
  }, [])

  const handleConnect = async () => {
    setState('connecting')
    setError(null)

    // Check if NIP-07 extension is available
    if (!hasNostrExtension()) {
      // Give extension time to inject
      await new Promise((resolve) => setTimeout(resolve, 800))
      if (!hasNostrExtension()) {
        setState('no-extension')
        return
      }
    }

    try {
      // Full auth flow: create event, sign with extension, verify on backend
      const result: AuthResult = await authenticateWithNostr()

      setPubkey(result.admin.pubkey)
      localStorage.setItem(STORAGE_KEYS.ADMIN_PUBKEY, result.admin.pubkey)

      // Track if this is a new admin (first time setup)
      if (result.is_new) {
        localStorage.setItem('sanctum_admin_is_new', 'true')
      }

      setState('success')

      // Redirect after showing success
      setTimeout(() => {
        navigate('/admin/setup')
      }, 2000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect')
      setState('error')
    }
  }

  const handleMockConnect = async () => {
    setState('connecting')
    setError(null)

    // Simulate connection delay
    await new Promise((resolve) => setTimeout(resolve, 1200))

    // Generate mock pubkey (64 hex chars like a real nostr pubkey)
    const mockPubkey = Array.from({ length: 64 }, () =>
      '0123456789abcdef'[Math.floor(Math.random() * 16)]
    ).join('')

    setPubkey(mockPubkey)
    localStorage.setItem(STORAGE_KEYS.ADMIN_PUBKEY, mockPubkey)
    // Note: Mock mode has no valid session token - admin API calls will fail with 401
    // Use a real Nostr extension for full functionality
    localStorage.setItem('sanctum_admin_is_new', 'true')
    setState('success')

    // Redirect after showing success
    setTimeout(() => {
      navigate('/admin/setup')
    }, 2000)
  }

  const handleRetry = () => {
    setState('idle')
    setError(null)
    setPubkey(null)
  }

  const footer = (
    <>
      <span>{t('adminOnboarding.notAdmin')} </span>
      <Link to="/login" className="text-accent hover:text-accent-hover font-medium transition-colors">
        {t('adminOnboarding.signInAsUser')}
      </Link>
    </>
  )

  const isInitiationFlow = instanceInitialized === false

  return (
    <OnboardingCard
      topRight={<LanguageSwitcher />}
      title={
        isInitiationFlow
          ? t('instanceInitiation.title', 'Set Up Your Instance')
          : t('adminOnboarding.title')
      }
      subtitle={
        isInitiationFlow
          ? t(
            'instanceInitiation.subtitle',
            'Welcome. Connect your Nostr identity to become the first admin.'
          )
          : t('adminOnboarding.subtitle')
      }
      footer={footer}
    >
      {statusError && (
        <div className="mb-4 bg-warning-subtle border border-warning/20 rounded-xl p-3">
          <p className="text-xs text-text-secondary">
            {t('instanceInitiation.statusError', 'Unable to check instance status.')}
            {statusError ? ` ${statusError}` : ''}
          </p>
        </div>
      )}

      {/* Instance status loading */}
      {instanceInitialized === null && (
        <div className="text-center py-4 animate-fade-in">
          <div className="w-8 h-8 border-2 border-accent/30 border-t-accent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-text-secondary">
            {t('instanceInitiation.checkingStatus', 'Checking instance status...')}
          </p>
        </div>
      )}

      {/* Instance initiation wizard (only when uninitiated) */}
      {isInitiationFlow && instanceInitialized !== null && (
        <div className="animate-fade-in">
          <NostrIcon variant="initiation" />

          <InitiationStepper
            step={initStep}
            labels={[
              t('instanceInitiation.step1.label', 'Welcome'),
              t('instanceInitiation.step2.label', 'Learn'),
              t('instanceInitiation.step3.label', 'Connect'),
            ]}
          />

          {initStep === 1 && (
            <div className="space-y-6 stagger-children">
              <div className="text-center">
                <h3 className="heading-md mb-2">
                  {t('instanceInitiation.step1.title', 'Claim your Sanctum')}
                </h3>
                <p className="text-sm text-text-secondary leading-relaxed max-w-sm mx-auto">
                  {t(
                    'instanceInitiation.step1.body',
                    'You are setting up this instance for the first time. Here is what that means.'
                  )}
                </p>
              </div>

              <div className="space-y-3">
                <div className="flex items-start gap-4 p-4 rounded-xl bg-surface-overlay/50 hover-lift">
                  <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center shrink-0">
                    <Key className="w-5 h-5 text-accent" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-text">
                      {t('instanceInitiation.step1.feature1Title', 'Your key, your instance')}
                    </p>
                    <p className="text-xs text-text-muted mt-0.5 leading-relaxed">
                      {t(
                        'instanceInitiation.step1.feature1Desc',
                        'Connect via your browser Nostr extension. Your private key never leaves the extension.'
                      )}
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-4 p-4 rounded-xl bg-surface-overlay/50 hover-lift">
                  <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center shrink-0">
                    <Shield className="w-5 h-5 text-accent" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-text">
                      {t('instanceInitiation.step1.feature2Title', 'Become the admin')}
                    </p>
                    <p className="text-xs text-text-muted mt-0.5 leading-relaxed">
                      {t(
                        'instanceInitiation.step1.feature2Desc',
                        'The first key to connect becomes the administrator for this instance.'
                      )}
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-4 p-4 rounded-xl bg-surface-overlay/50 hover-lift">
                  <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center shrink-0">
                    <Sliders className="w-5 h-5 text-accent" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-text">
                      {t('instanceInitiation.step1.feature3Title', 'Full control')}
                    </p>
                    <p className="text-xs text-text-muted mt-0.5 leading-relaxed">
                      {t(
                        'instanceInitiation.step1.feature3Desc',
                        'Configure branding, AI behavior, user onboarding, and more from the admin dashboard.'
                      )}
                    </p>
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setInitStep(2)}
                className="btn btn-primary btn-lg w-full"
              >
                {t('common.continue')}
              </button>
            </div>
          )}

          {initStep === 2 && (
            <div className="space-y-6 animate-fade-in">
              <div className="text-center">
                <h3 className="heading-md mb-2">
                  {t('instanceInitiation.step2.title', 'Sign in with Nostr')}
                </h3>
                <p className="text-sm text-text-secondary leading-relaxed max-w-sm mx-auto">
                  {t(
                    'instanceInitiation.step2.body',
                    'Your browser extension will ask you to approve a one-time signature. No passwords, no email \u2014 just your key.'
                  )}
                </p>
              </div>

              <div className="flex items-center justify-center gap-3 py-2">
                <div className="flex flex-col items-center gap-2">
                  <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center">
                    <Fingerprint className="w-5 h-5 text-accent" />
                  </div>
                  <span className="text-xs text-text-muted">
                    {t('instanceInitiation.step2.flow1', 'Extension')}
                  </span>
                </div>

                <ArrowRight className="w-4 h-4 text-text-muted shrink-0" />

                <div className="flex flex-col items-center gap-2">
                  <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center">
                    <FileSignature className="w-5 h-5 text-accent" />
                  </div>
                  <span className="text-xs text-text-muted">
                    {t('instanceInitiation.step2.flow2', 'Approve')}
                  </span>
                </div>

                <ArrowRight className="w-4 h-4 text-text-muted shrink-0" />

                <div className="flex flex-col items-center gap-2">
                  <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center">
                    <CheckCircle2 className="w-5 h-5 text-accent" />
                  </div>
                  <span className="text-xs text-text-muted">
                    {t('instanceInitiation.step2.flow3', 'Connected')}
                  </span>
                </div>
              </div>

              <NostrInfo />

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setInitStep(1)}
                  className="btn btn-secondary btn-lg flex-1"
                >
                  {t('common.back')}
                </button>
                <button
                  type="button"
                  onClick={() => setInitStep(3)}
                  className="btn btn-primary btn-lg flex-1"
                >
                  {t('common.continue')}
                </button>
              </div>
            </div>
          )}

          {initStep === 3 && (
            <div className="space-y-4">
              {state === 'idle' && (
                <div className="space-y-6 stagger-children">
                  <div className="text-center">
                    <h3 className="heading-md mb-2">
                      {t('instanceInitiation.step3.title', 'Ready to connect')}
                    </h3>
                    <p className="text-sm text-text-secondary leading-relaxed max-w-sm mx-auto">
                      {t(
                        'instanceInitiation.step3.body',
                        'Click below and approve the signature in your extension. This takes about 5 seconds.'
                      )}
                    </p>
                  </div>

                  <button
                    onClick={handleConnect}
                    className="btn btn-primary btn-lg w-full flex items-center justify-center gap-2 glow-accent"
                  >
                    <Link2 className="w-5 h-5" />
                    {t('instanceInitiation.connect', 'Connect with Nostr')}
                  </button>

                  {simulateAdminAuth && (
                    <>
                      <div className="relative">
                        <div className="absolute inset-0 flex items-center">
                          <div className="w-full border-t border-border" />
                        </div>
                        <div className="relative flex justify-center text-xs">
                          <span className="px-3 bg-surface-raised text-text-muted">{t('adminOnboarding.orForTesting')}</span>
                        </div>
                      </div>

                      <button
                        onClick={handleMockConnect}
                        className="w-full text-sm text-text-muted hover:text-text py-2 transition-colors"
                      >
                        {t('adminOnboarding.continueMock')}
                      </button>
                    </>
                  )}

                  <div className="pt-4 border-t border-border/50">
                    <div className="flex items-center gap-2 mb-3">
                      <ShieldCheck className="w-4 h-4 text-accent shrink-0" />
                      <span className="text-xs font-medium text-text">
                        {t('instanceInitiation.after.title', 'What happens next')}
                      </span>
                    </div>
                    <p className="text-xs text-text-secondary leading-relaxed">
                      {t(
                        'instanceInitiation.after.body',
                        'You will land on the admin dashboard where you can configure branding, user onboarding, AI behavior, and more.'
                      )}
                    </p>
                    <p className="text-xs text-text-muted leading-relaxed mt-2">
                      {t(
                        'instanceInitiation.after.note',
                        'Only initiate from a trusted device with the key you intend to use for this instance.'
                      )}
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => setInitStep(2)}
                    className="btn btn-ghost btn-md w-full"
                  >
                    {t('common.back')}
                  </button>
                </div>
              )}

              {state === 'connecting' && (
                <div className="text-center py-4 animate-fade-in">
                  <div className="w-8 h-8 border-2 border-accent/30 border-t-accent rounded-full animate-spin mx-auto mb-4" />
                  <p className="text-text-secondary">{t('adminOnboarding.connecting')}</p>
                </div>
              )}

              {state === 'no-extension' && (
                <div className="space-y-6 animate-fade-in">
                  <div className="bg-warning-subtle border border-warning/20 rounded-xl p-4 text-center">
                    <AlertCircle className="w-8 h-8 text-warning mx-auto mb-2" />
                    <p className="text-sm text-text font-medium mb-1">{t('adminOnboarding.noExtension')}</p>
                    <p className="text-xs text-text-muted">{t('adminOnboarding.installExtension')}</p>
                  </div>

                  <NostrExtensionLinks />

                  <div className="flex gap-3">
                    <button
                      onClick={handleRetry}
                      className={`btn btn-secondary btn-md ${simulateAdminAuth ? 'flex-1' : 'w-full'}`}
                    >
                      {t('common.tryAgain')}
                    </button>
                    {simulateAdminAuth && (
                      <button
                        onClick={handleMockConnect}
                        className="btn btn-primary btn-md flex-1"
                      >
                        {t('adminOnboarding.useMock')}
                      </button>
                    )}
                  </div>
                </div>
              )}

              {state === 'success' && pubkey && (
                <div className="text-center py-4 animate-fade-in">
                  <div className="w-12 h-12 bg-success/10 rounded-full flex items-center justify-center mx-auto mb-4">
                    <Check className="w-6 h-6 text-success" />
                  </div>
                  <h3 className="text-lg font-semibold text-text mb-2">{t('adminOnboarding.welcomeAdmin')}</h3>
                  <p className="text-sm text-text-muted mb-3">{t('adminOnboarding.connectedAs')}</p>
                  <code className="inline-block bg-surface-overlay px-3 py-1.5 rounded-lg text-xs font-mono text-text-secondary break-all">
                    {truncatePubkey(pubkey)}
                  </code>
                  <p className="text-xs text-text-muted mt-4">{t('adminOnboarding.redirecting')}</p>
                </div>
              )}

              {state === 'error' && (
                <div className="space-y-4 animate-fade-in">
                  <div className="bg-error/10 border border-error/20 rounded-xl p-5 text-center">
                    <div className="w-10 h-10 bg-error/10 rounded-full flex items-center justify-center mx-auto mb-3">
                      <AlertCircle className="w-5 h-5 text-error" />
                    </div>
                    <p className="text-sm text-text font-medium mb-1.5">{t('adminOnboarding.connectionFailed')}</p>
                    <p className="text-xs text-text-muted leading-relaxed">{error || t('common.unexpectedError')}</p>
                  </div>

                  <button
                    onClick={handleRetry}
                    className="btn btn-primary btn-lg w-full"
                  >
                    {t('common.tryAgain')}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Regular admin login (initiated instances) */}
      {!isInitiationFlow && instanceInitialized !== null && (
        <>
          <NostrIcon variant="login" />

          {/* Idle State */}
          {state === 'idle' && (
            <div className="space-y-5 stagger-children">
              <button
                onClick={handleConnect}
                className="btn btn-primary btn-lg w-full flex items-center justify-center gap-2 glow-accent"
              >
                <Link2 className="w-5 h-5" />
                {t('adminOnboarding.connectNostr')}
              </button>

              {simulateAdminAuth && (
                <>
                  <div className="relative">
                    <div className="absolute inset-0 flex items-center">
                      <div className="w-full border-t border-border" />
                    </div>
                    <div className="relative flex justify-center text-xs">
                      <span className="px-3 bg-surface-raised text-text-muted">{t('adminOnboarding.orForTesting')}</span>
                    </div>
                  </div>

                  <button
                    onClick={handleMockConnect}
                    className="w-full text-sm text-text-muted hover:text-text py-2 transition-colors"
                  >
                    {t('adminOnboarding.continueMock')}
                  </button>
                </>
              )}

              <details className="group pt-2">
                <summary className="flex items-center justify-center gap-2 text-sm text-text-muted hover:text-text cursor-pointer transition-colors py-2 list-none [&::-webkit-details-marker]:hidden">
                  <ShieldCheck className="w-4 h-4" />
                  <span>{t('adminOnboarding.securityJourneyTitle')}</span>
                  <ChevronDown className="w-4 h-4 transition-transform group-open:rotate-180" />
                </summary>

                <div className="mt-4 space-y-3 animate-fade-in">
                  <p className="text-xs text-text-secondary leading-relaxed">
                    {t('adminOnboarding.securityJourneyIntro')}
                  </p>
                  <div className="space-y-3">
                    <div className="flex gap-3 items-start">
                      <div className="w-6 h-6 rounded-full bg-accent/10 flex items-center justify-center shrink-0 mt-0.5">
                        <span className="text-xs font-semibold text-accent">1</span>
                      </div>
                      <p className="text-xs text-text-secondary leading-relaxed">
                        {t('adminOnboarding.securityJourneyStep1')}
                      </p>
                    </div>
                    <div className="flex gap-3 items-start">
                      <div className="w-6 h-6 rounded-full bg-accent/10 flex items-center justify-center shrink-0 mt-0.5">
                        <span className="text-xs font-semibold text-accent">2</span>
                      </div>
                      <p className="text-xs text-text-secondary leading-relaxed">
                        {t('adminOnboarding.securityJourneyStep2')}
                      </p>
                    </div>
                    <div className="flex gap-3 items-start">
                      <div className="w-6 h-6 rounded-full bg-accent/10 flex items-center justify-center shrink-0 mt-0.5">
                        <span className="text-xs font-semibold text-accent">3</span>
                      </div>
                      <p className="text-xs text-text-secondary leading-relaxed">
                        {t('adminOnboarding.securityJourneyStep3')}
                      </p>
                    </div>
                  </div>
                  <div className="pt-3 border-t border-border/50">
                    <p className="text-xs text-text-muted leading-relaxed flex items-center gap-1.5">
                      <CheckCircle2 className="w-3.5 h-3.5 text-accent shrink-0" />
                      {t('adminOnboarding.securityJourneyNote')}
                    </p>
                    <p className="text-xs text-text-muted leading-relaxed mt-2">
                      {t('adminOnboarding.legalResponsibilityNotice')}
                    </p>
                  </div>
                </div>
              </details>

              <NostrInfo />
            </div>
          )}

          {/* Connecting State */}
          {state === 'connecting' && (
            <div className="text-center py-4 animate-fade-in">
              <div className="w-8 h-8 border-2 border-accent/30 border-t-accent rounded-full animate-spin mx-auto mb-4" />
              <p className="text-text-secondary">{t('adminOnboarding.connecting')}</p>
            </div>
          )}

          {/* No Extension State */}
          {state === 'no-extension' && (
            <div className="space-y-6 animate-fade-in">
              <div className="bg-warning-subtle border border-warning/20 rounded-xl p-4 text-center">
                <AlertCircle className="w-8 h-8 text-warning mx-auto mb-2" />
                <p className="text-sm text-text font-medium mb-1">{t('adminOnboarding.noExtension')}</p>
                <p className="text-xs text-text-muted">{t('adminOnboarding.installExtension')}</p>
              </div>

              <NostrExtensionLinks />

              <div className="flex gap-3">
                <button
                  onClick={handleRetry}
                  className={`btn btn-secondary btn-md ${simulateAdminAuth ? 'flex-1' : 'w-full'}`}
                >
                  {t('common.tryAgain')}
                </button>
                {simulateAdminAuth && (
                  <button
                    onClick={handleMockConnect}
                    className="btn btn-primary btn-md flex-1"
                  >
                    {t('adminOnboarding.useMock')}
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Success State */}
          {state === 'success' && pubkey && (
            <div className="text-center py-4 animate-fade-in">
              <div className="w-12 h-12 bg-success/10 rounded-full flex items-center justify-center mx-auto mb-4">
                <Check className="w-6 h-6 text-success" />
              </div>
              <h3 className="text-lg font-semibold text-text mb-2">{t('adminOnboarding.welcomeAdmin')}</h3>
              <p className="text-sm text-text-muted mb-3">{t('adminOnboarding.connectedAs')}</p>
              <code className="inline-block bg-surface-overlay px-3 py-1.5 rounded-lg text-xs font-mono text-text-secondary break-all">
                {truncatePubkey(pubkey)}
              </code>
              <p className="text-xs text-text-muted mt-4">{t('adminOnboarding.redirecting')}</p>
            </div>
          )}

          {/* Error State */}
          {state === 'error' && (
            <div className="space-y-4 animate-fade-in">
              <div className="bg-error/10 border border-error/20 rounded-xl p-5 text-center">
                <div className="w-10 h-10 bg-error/10 rounded-full flex items-center justify-center mx-auto mb-3">
                  <AlertCircle className="w-5 h-5 text-error" />
                </div>
                <p className="text-sm text-text font-medium mb-1.5">{t('adminOnboarding.connectionFailed')}</p>
                <p className="text-xs text-text-muted leading-relaxed">{error || t('common.unexpectedError')}</p>
              </div>

              <button
                onClick={handleRetry}
                className="btn btn-primary btn-lg w-full"
              >
                {t('common.tryAgain')}
              </button>
            </div>
          )}
        </>
      )}
    </OnboardingCard>
  )
}
