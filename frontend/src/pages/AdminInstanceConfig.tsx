import { useState, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Paintbrush, Loader2, ArrowLeft } from 'lucide-react'
import { OnboardingCard } from '../components/onboarding/OnboardingCard'
import { ColorPicker } from '../components/onboarding/ColorPicker'
import { IconPicker } from '../components/onboarding/IconPicker'
import { adminFetch, isAdminAuthenticated } from '../utils/adminApi'
import { useInstanceConfig } from '../context/InstanceConfigContext'
import { AccentColor } from '../types/instance'

export function AdminInstanceConfig() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { config, updateConfig } = useInstanceConfig()

  const [instanceName, setInstanceName] = useState(config.name)
  // Preview state - only applies on save, not immediately
  const [previewAccentColor, setPreviewAccentColor] = useState<AccentColor>(config.accentColor)
  const [previewIcon, setPreviewIcon] = useState(config.icon)
  const [previewAssistantIcon, setPreviewAssistantIcon] = useState(config.assistantIcon)
  const [previewUserIcon, setPreviewUserIcon] = useState(config.userIcon)
  const [previewAssistantName, setPreviewAssistantName] = useState(config.assistantName)
  const [previewUserLabel, setPreviewUserLabel] = useState(config.userLabel)
  const [previewHeaderLayout, setPreviewHeaderLayout] = useState(config.headerLayout)
  const [previewHeaderTagline, setPreviewHeaderTagline] = useState(config.headerTagline)
  const [previewChatBubbleStyle, setPreviewChatBubbleStyle] = useState(config.chatBubbleStyle)
  const [previewChatBubbleShadow, setPreviewChatBubbleShadow] = useState(config.chatBubbleShadow)
  const [previewSurfaceStyle, setPreviewSurfaceStyle] = useState(config.surfaceStyle)
  const [previewStatusIconSet, setPreviewStatusIconSet] = useState(config.statusIconSet)
  const [previewTypographyPreset, setPreviewTypographyPreset] = useState(config.typographyPreset)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [isDirty, setIsDirty] = useState(false)

  // Check if admin is logged in
  useEffect(() => {
    if (!isAdminAuthenticated()) {
      navigate('/admin')
    }
  }, [navigate])

  // Sync config (only on initial load or external changes, skip if user has made edits)
  useEffect(() => {
    if (!isDirty) {
      setInstanceName(config.name)
      setPreviewAccentColor(config.accentColor)
      setPreviewIcon(config.icon)
      setPreviewAssistantIcon(config.assistantIcon)
      setPreviewUserIcon(config.userIcon)
      setPreviewAssistantName(config.assistantName)
      setPreviewUserLabel(config.userLabel)
      setPreviewHeaderLayout(config.headerLayout)
      setPreviewHeaderTagline(config.headerTagline)
      setPreviewChatBubbleStyle(config.chatBubbleStyle)
      setPreviewChatBubbleShadow(config.chatBubbleShadow)
      setPreviewSurfaceStyle(config.surfaceStyle)
      setPreviewStatusIconSet(config.statusIconSet)
      setPreviewTypographyPreset(config.typographyPreset)
    }
  }, [config, isDirty])

  // Preview handlers - only update local state, apply on save
  const handleColorChange = (color: AccentColor) => {
    setPreviewAccentColor(color)
    setIsDirty(true)
  }

  const handleIconChange = (newIcon: string) => {
    setPreviewIcon(newIcon)
    setIsDirty(true)
  }

  const handleAssistantIconChange = (newIcon: string) => {
    setPreviewAssistantIcon(newIcon)
    setIsDirty(true)
  }

  const handleUserIconChange = (newIcon: string) => {
    setPreviewUserIcon(newIcon)
    setIsDirty(true)
  }

  const handleAssistantNameChange = (value: string) => {
    setPreviewAssistantName(value)
    setIsDirty(true)
  }

  const handleUserLabelChange = (value: string) => {
    setPreviewUserLabel(value)
    setIsDirty(true)
  }

  const handleHeaderLayoutChange = (value: typeof previewHeaderLayout) => {
    setPreviewHeaderLayout(value)
    setIsDirty(true)
  }

  const handleHeaderTaglineChange = (value: string) => {
    setPreviewHeaderTagline(value)
    setIsDirty(true)
  }

  const handleChatBubbleStyleChange = (value: typeof previewChatBubbleStyle) => {
    setPreviewChatBubbleStyle(value)
    setIsDirty(true)
  }

  const handleChatBubbleShadowChange = (value: boolean) => {
    setPreviewChatBubbleShadow(value)
    setIsDirty(true)
  }

  const handleSurfaceStyleChange = (value: typeof previewSurfaceStyle) => {
    setPreviewSurfaceStyle(value)
    setIsDirty(true)
  }

  const handleStatusIconSetChange = (value: typeof previewStatusIconSet) => {
    setPreviewStatusIconSet(value)
    setIsDirty(true)
  }

  const handleTypographyPresetChange = (value: typeof previewTypographyPreset) => {
    setPreviewTypographyPreset(value)
    setIsDirty(true)
  }

  const handleSave = async () => {
    // Save instance config to local context (for immediate UI updates)
    const name = instanceName.trim() || t('admin.setup.defaultName')

    setIsSaving(true)
    setSaveError(null)

    // Persist to backend API
    try {
      const response = await adminFetch('/admin/settings', {
        method: 'PUT',
        body: JSON.stringify({
          instance_name: name,
          primary_color: previewAccentColor,
          icon: previewIcon,
          assistant_icon: previewAssistantIcon,
          user_icon: previewUserIcon,
          assistant_name: previewAssistantName.trim(),
          user_label: previewUserLabel.trim(),
          header_layout: previewHeaderLayout,
          header_tagline: previewHeaderTagline.trim(),
          chat_bubble_style: previewChatBubbleStyle,
          chat_bubble_shadow: String(previewChatBubbleShadow),
          surface_style: previewSurfaceStyle,
          status_icon_set: previewStatusIconSet,
          typography_preset: previewTypographyPreset,
        }),
      })

      if (response.ok) {
        // Only update context after successful save
        updateConfig({
          name,
          accentColor: previewAccentColor,
          icon: previewIcon,
          assistantIcon: previewAssistantIcon,
          userIcon: previewUserIcon,
          assistantName: previewAssistantName.trim() || '',
          userLabel: previewUserLabel.trim() || '',
          headerLayout: previewHeaderLayout,
          headerTagline: previewHeaderTagline.trim(),
          chatBubbleStyle: previewChatBubbleStyle,
          chatBubbleShadow: previewChatBubbleShadow,
          surfaceStyle: previewSurfaceStyle,
          statusIconSet: previewStatusIconSet,
          typographyPreset: previewTypographyPreset,
        })
        setIsDirty(false)
        navigate('/admin/setup')
      } else {
        console.error('Failed to save settings:', response.status)
        setSaveError(t('admin.errors.saveFailed', 'Failed to save settings. Please try again.'))
      }
    } catch (err) {
      console.error('Error saving instance settings:', err)
      setSaveError(err instanceof Error ? err.message : t('admin.errors.saveFailed', 'Failed to save settings. Please try again.'))
    } finally {
      setIsSaving(false)
    }
  }

  const footer = (
    <Link to="/admin/setup" className="text-text-muted hover:text-text transition-colors">
      {t('common.back', 'Back to Dashboard')}
    </Link>
  )

  const optionButtonClass = (active: boolean) =>
    `w-full text-left border rounded-lg px-3 py-2 text-sm transition-all ${
      active
        ? 'border-accent bg-accent/10 text-text'
        : 'border-border bg-surface hover:border-accent/40 text-text-muted hover:text-text'
    }`

  const headerLayoutOptions = [
    {
      value: 'icon_name',
      title: t('admin.instanceConfig.headerLayoutIconName', 'Icon + Name'),
      description: t('admin.instanceConfig.headerLayoutIconNameDesc', 'Show both the icon and instance name.'),
    },
    {
      value: 'icon_only',
      title: t('admin.instanceConfig.headerLayoutIconOnly', 'Icon Only'),
      description: t('admin.instanceConfig.headerLayoutIconOnlyDesc', 'Minimal header with just the icon.'),
    },
    {
      value: 'name_only',
      title: t('admin.instanceConfig.headerLayoutNameOnly', 'Name Only'),
      description: t('admin.instanceConfig.headerLayoutNameOnlyDesc', 'Text-only header with the instance name.'),
    },
  ]

  const bubbleStyleOptions = [
    {
      value: 'soft',
      title: t('admin.instanceConfig.bubbleStyleSoft', 'Soft'),
      description: t('admin.instanceConfig.bubbleStyleSoftDesc', 'Rounded corners with a subtle chat feel.'),
    },
    {
      value: 'round',
      title: t('admin.instanceConfig.bubbleStyleRound', 'Round'),
      description: t('admin.instanceConfig.bubbleStyleRoundDesc', 'Extra-round bubbles with a friendly shape.'),
    },
    {
      value: 'square',
      title: t('admin.instanceConfig.bubbleStyleSquare', 'Square'),
      description: t('admin.instanceConfig.bubbleStyleSquareDesc', 'Sharper corners for a structured look.'),
    },
    {
      value: 'pill',
      title: t('admin.instanceConfig.bubbleStylePill', 'Pill'),
      description: t('admin.instanceConfig.bubbleStylePillDesc', 'Full pill style for a bold look.'),
    },
  ]

  const surfaceStyleOptions = [
    {
      value: 'plain',
      title: t('admin.instanceConfig.surfacePlain', 'Plain'),
      description: t('admin.instanceConfig.surfacePlainDesc', 'Clean and minimal background.'),
    },
    {
      value: 'gradient',
      title: t('admin.instanceConfig.surfaceGradient', 'Soft Gradient'),
      description: t('admin.instanceConfig.surfaceGradientDesc', 'Subtle gradient glow in the background.'),
    },
    {
      value: 'noise',
      title: t('admin.instanceConfig.surfaceNoise', 'Paper Grain'),
      description: t('admin.instanceConfig.surfaceNoiseDesc', 'Gentle texture for warmth.'),
    },
    {
      value: 'grid',
      title: t('admin.instanceConfig.surfaceGrid', 'Grid'),
      description: t('admin.instanceConfig.surfaceGridDesc', 'Faint grid for a technical vibe.'),
    },
  ]

  const statusIconOptions = [
    {
      value: 'classic',
      title: t('admin.instanceConfig.statusIconsClassic', 'Classic'),
      description: t('admin.instanceConfig.statusIconsClassicDesc', 'Simple dots and symbols (○ ◐ ●).'),
    },
    {
      value: 'minimal',
      title: t('admin.instanceConfig.statusIconsMinimal', 'Minimal'),
      description: t('admin.instanceConfig.statusIconsMinimalDesc', 'Tiny glyphs and arrows.'),
    },
    {
      value: 'playful',
      title: t('admin.instanceConfig.statusIconsPlayful', 'Playful'),
      description: t('admin.instanceConfig.statusIconsPlayfulDesc', 'Emoji-style icons for friendly feedback.'),
    },
  ]

  const typographyOptions = [
    {
      value: 'modern',
      title: t('admin.instanceConfig.typographyModern', 'Modern'),
      description: t('admin.instanceConfig.typographyModernDesc', 'Clean and familiar sans-serif.'),
    },
    {
      value: 'grotesk',
      title: t('admin.instanceConfig.typographyGrotesk', 'Grotesk'),
      description: t('admin.instanceConfig.typographyGroteskDesc', 'Bold, contemporary type with personality.'),
    },
    {
      value: 'humanist',
      title: t('admin.instanceConfig.typographyHumanist', 'Humanist'),
      description: t('admin.instanceConfig.typographyHumanistDesc', 'Warm, readable typography with clarity.'),
    },
  ]

  return (
    <OnboardingCard
      title={t('admin.instanceConfig.title', 'Instance Configuration')}
      subtitle={t('admin.instanceConfig.subtitle', 'Set the name, icon, and colors shown across your instance.')}
      footer={footer}
    >
      <div className="space-y-6 stagger-children">
        {/* Instance Branding Section */}
        <div className="card card-sm p-5! bg-surface-overlay!">
          <h3 className="heading-sm mb-4 flex items-center gap-2">
            <Paintbrush className="w-4 h-4 text-text-muted" />
            {t('admin.setup.branding')}
          </h3>

          <div className="space-y-4">
            {/* Instance Name */}
            <div>
              <label htmlFor="instance-name" className="text-sm font-medium text-text mb-1.5 block">
                {t('admin.setup.displayName')}
              </label>
              <div className="input-container px-4 py-3">
                <input
                  id="instance-name"
                  type="text"
                  value={instanceName}
                  onChange={(e) => { setInstanceName(e.target.value); setIsDirty(true) }}
                  placeholder={t('admin.setup.defaultName')}
                  className="input-field text-sm"
                />
              </div>
              <p className="text-xs text-text-muted mt-1.5">
                {t('admin.setup.displayNameHint')}
              </p>
            </div>

            {/* Icon */}
            <div>
              <span id="instance-icon-label" className="text-sm font-medium text-text mb-2 block">
                {t('admin.setup.icon')}
              </span>
              <IconPicker value={previewIcon} onChange={handleIconChange} aria-labelledby="instance-icon-label" />
            </div>

            {/* Accent Color */}
            <div>
              <span id="accent-color-label" className="text-sm font-medium text-text mb-2 block">
                {t('admin.setup.accentColor')}
              </span>
              <ColorPicker value={previewAccentColor} onChange={handleColorChange} aria-labelledby="accent-color-label" />
            </div>
          </div>
        </div>

        {/* Chat Icons Section */}
        <div className="card card-sm p-5! bg-surface-overlay!">
          <h3 className="heading-sm mb-2 flex items-center gap-2">
            <Paintbrush className="w-4 h-4 text-text-muted" />
            {t('admin.instanceConfig.chatIconsTitle', 'Chat Icons')}
          </h3>
          <p className="text-xs text-text-muted mb-4">
            {t('admin.instanceConfig.chatIconsDesc', 'Set the default icons used in chat messages.')}
          </p>

          <div className="space-y-4">
            <div>
              <span id="assistant-icon-label" className="text-sm font-medium text-text mb-2 block">
                {t('admin.instanceConfig.assistantIconLabel', 'AI assistant icon')}
              </span>
              <IconPicker value={previewAssistantIcon} onChange={handleAssistantIconChange} aria-labelledby="assistant-icon-label" />
            </div>

            <div>
              <span id="user-icon-label" className="text-sm font-medium text-text mb-2 block">
                {t('admin.instanceConfig.userIconLabel', 'User icon')}
              </span>
              <IconPicker value={previewUserIcon} onChange={handleUserIconChange} aria-labelledby="user-icon-label" />
            </div>
          </div>
        </div>

        {/* Header Branding Section */}
        <div className="card card-sm p-5! bg-surface-overlay!">
          <h3 className="heading-sm mb-2 flex items-center gap-2">
            <Paintbrush className="w-4 h-4 text-text-muted" />
            {t('admin.instanceConfig.headerTitle', 'Header Branding')}
          </h3>
          <p className="text-xs text-text-muted mb-4">
            {t('admin.instanceConfig.headerDesc', 'Control how your instance appears in the top header.')}
          </p>

          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium text-text mb-2 block">
                {t('admin.instanceConfig.headerLayoutLabel', 'Header layout')}
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {headerLayoutOptions.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => handleHeaderLayoutChange(option.value as typeof previewHeaderLayout)}
                    className={optionButtonClass(previewHeaderLayout === option.value)}
                    aria-pressed={previewHeaderLayout === option.value}
                  >
                    <p className="text-sm font-medium text-text">{option.title}</p>
                    <p className="text-xs text-text-muted mt-1">{option.description}</p>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-sm font-medium text-text mb-1.5 block">
                {t('admin.instanceConfig.headerTaglineLabel', 'Tagline (optional)')}
              </label>
              <input
                type="text"
                value={previewHeaderTagline}
                onChange={(e) => handleHeaderTaglineChange(e.target.value)}
                placeholder={t('admin.instanceConfig.headerTaglinePlaceholder', 'Short descriptor shown under the name')}
                className="w-full border border-border rounded-lg px-3 py-2 bg-surface text-text placeholder:text-text-muted text-sm focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
              />
              <p className="text-xs text-text-muted mt-1.5">
                {t('admin.instanceConfig.headerTaglineHint', 'Leave blank to hide the tagline.')}
              </p>
            </div>
          </div>
        </div>

        {/* Chat Identity Section */}
        <div className="card card-sm p-5! bg-surface-overlay!">
          <h3 className="heading-sm mb-2 flex items-center gap-2">
            <Paintbrush className="w-4 h-4 text-text-muted" />
            {t('admin.instanceConfig.chatIdentityTitle', 'Chat Identity')}
          </h3>
          <p className="text-xs text-text-muted mb-4">
            {t('admin.instanceConfig.chatIdentityDesc', 'Set the labels shown above chat messages.')}
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium text-text mb-1.5 block">
                {t('admin.instanceConfig.assistantNameLabel', 'Assistant display name')}
              </label>
              <input
                type="text"
                value={previewAssistantName}
                onChange={(e) => handleAssistantNameChange(e.target.value)}
                placeholder={t('admin.instanceConfig.assistantNamePlaceholder', 'e.g., Sanctum AI')}
                className="w-full border border-border rounded-lg px-3 py-2 bg-surface text-text placeholder:text-text-muted text-sm focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-text mb-1.5 block">
                {t('admin.instanceConfig.userLabelLabel', 'User label')}
              </label>
              <input
                type="text"
                value={previewUserLabel}
                onChange={(e) => handleUserLabelChange(e.target.value)}
                placeholder={t('admin.instanceConfig.userLabelPlaceholder', 'e.g., You')}
                className="w-full border border-border rounded-lg px-3 py-2 bg-surface text-text placeholder:text-text-muted text-sm focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
              />
            </div>
          </div>
          <p className="text-xs text-text-muted mt-2">
            {t('admin.instanceConfig.chatIdentityHint', 'Leave a label empty to hide it.')}
          </p>
        </div>

        {/* Chat Bubble Style Section */}
        <div className="card card-sm p-5! bg-surface-overlay!">
          <h3 className="heading-sm mb-2 flex items-center gap-2">
            <Paintbrush className="w-4 h-4 text-text-muted" />
            {t('admin.instanceConfig.bubbleStyleTitle', 'Chat Bubble Style')}
          </h3>
          <p className="text-xs text-text-muted mb-4">
            {t('admin.instanceConfig.bubbleStyleDesc', 'Choose the shape and depth of chat bubbles.')}
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-4">
            {bubbleStyleOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => handleChatBubbleStyleChange(option.value as typeof previewChatBubbleStyle)}
                className={optionButtonClass(previewChatBubbleStyle === option.value)}
                aria-pressed={previewChatBubbleStyle === option.value}
              >
                <p className="text-sm font-medium text-text">{option.title}</p>
                <p className="text-xs text-text-muted mt-1">{option.description}</p>
              </button>
            ))}
          </div>

          <label className="flex items-center gap-2 text-sm text-text">
            <input
              type="checkbox"
              checked={previewChatBubbleShadow}
              onChange={(e) => handleChatBubbleShadowChange(e.target.checked)}
              className="h-4 w-4 rounded border-border text-accent focus:ring-accent"
            />
            {t('admin.instanceConfig.bubbleShadowLabel', 'Add subtle bubble shadow')}
          </label>
        </div>

        {/* Surface Style Section */}
        <div className="card card-sm p-5! bg-surface-overlay!">
          <h3 className="heading-sm mb-2 flex items-center gap-2">
            <Paintbrush className="w-4 h-4 text-text-muted" />
            {t('admin.instanceConfig.surfaceTitle', 'Background Style')}
          </h3>
          <p className="text-xs text-text-muted mb-4">
            {t('admin.instanceConfig.surfaceDesc', 'Pick the background texture for your instance.')}
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {surfaceStyleOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => handleSurfaceStyleChange(option.value as typeof previewSurfaceStyle)}
                className={optionButtonClass(previewSurfaceStyle === option.value)}
                aria-pressed={previewSurfaceStyle === option.value}
              >
                <p className="text-sm font-medium text-text">{option.title}</p>
                <p className="text-xs text-text-muted mt-1">{option.description}</p>
              </button>
            ))}
          </div>
        </div>

        {/* Status Icons Section */}
        <div className="card card-sm p-5! bg-surface-overlay!">
          <h3 className="heading-sm mb-2 flex items-center gap-2">
            <Paintbrush className="w-4 h-4 text-text-muted" />
            {t('admin.instanceConfig.statusIconsTitle', 'Status Icons')}
          </h3>
          <p className="text-xs text-text-muted mb-4">
            {t('admin.instanceConfig.statusIconsDesc', 'Choose how status updates are displayed.')}
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {statusIconOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => handleStatusIconSetChange(option.value as typeof previewStatusIconSet)}
                className={optionButtonClass(previewStatusIconSet === option.value)}
                aria-pressed={previewStatusIconSet === option.value}
              >
                <p className="text-sm font-medium text-text">{option.title}</p>
                <p className="text-xs text-text-muted mt-1">{option.description}</p>
              </button>
            ))}
          </div>
        </div>

        {/* Typography Section */}
        <div className="card card-sm p-5! bg-surface-overlay!">
          <h3 className="heading-sm mb-2 flex items-center gap-2">
            <Paintbrush className="w-4 h-4 text-text-muted" />
            {t('admin.instanceConfig.typographyTitle', 'Typography')}
          </h3>
          <p className="text-xs text-text-muted mb-4">
            {t('admin.instanceConfig.typographyDesc', 'Pick a font pairing for the entire interface.')}
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {typographyOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => handleTypographyPresetChange(option.value as typeof previewTypographyPreset)}
                className={optionButtonClass(previewTypographyPreset === option.value)}
                aria-pressed={previewTypographyPreset === option.value}
              >
                <p className="text-sm font-medium text-text">{option.title}</p>
                <p className="text-xs text-text-muted mt-1">{option.description}</p>
              </button>
            ))}
          </div>
        </div>

        {/* Save Error display */}
        {saveError && (
          <div className="bg-error/10 border border-error/20 rounded-xl p-4">
            <p className="text-sm text-error">{saveError}</p>
          </div>
        )}

        {/* Navigation */}
        <div className="flex gap-3">
          <Link
            to="/admin/setup"
            className="flex-1 flex items-center justify-center gap-2 border border-border hover:border-accent/50 text-text rounded-xl px-4 py-3 text-sm font-medium transition-all hover:bg-surface"
          >
            <ArrowLeft className="w-4 h-4" />
            {t('common.back', 'Back')}
          </Link>
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="flex-1 btn btn-primary disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {isSaving && <Loader2 className="w-4 h-4 animate-spin" />}
            {isSaving ? t('common.saving', 'Saving...') : t('admin.setup.save')}
          </button>
        </div>
      </div>
    </OnboardingCard>
  )
}
