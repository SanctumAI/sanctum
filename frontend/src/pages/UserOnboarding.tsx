import { useState, useMemo } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Search, Check, HelpCircle, ArrowRight } from 'lucide-react'
import { OnboardingCard } from '../components/onboarding/OnboardingCard'
import { LANGUAGES, Language, STORAGE_KEY_LANGUAGE } from '../utils/languages'

function SearchInput({
  value,
  onChange,
  placeholder,
  label,
}: {
  value: string
  onChange: (value: string) => void
  placeholder: string
  label: string
}) {
  return (
    <div className="relative mb-6">
      <label htmlFor="language-search" className="sr-only">
        {label}
      </label>
      <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
        <Search className="w-5 h-5 text-text-muted" aria-hidden="true" />
      </div>
      <input
        id="language-search"
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full pl-12 pr-4 py-3 bg-surface border border-border rounded-xl text-text placeholder:text-text-muted text-sm focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition-all"
        autoComplete="off"
      />
    </div>
  )
}

function LanguageButton({
  language,
  isSelected,
  onSelect,
}: {
  language: Language
  isSelected: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={isSelected}
      aria-label={`${language.nativeName} (${language.englishName})`}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect()
        }
      }}
      className={`relative flex flex-col items-start p-4 rounded-xl border-2 transition-all text-left hover-lift cursor-pointer ${
        isSelected
          ? 'border-accent bg-accent-subtle/30'
          : 'border-border bg-surface-raised hover:border-accent/50'
      }`}
    >
      {isSelected && (
        <div className="absolute top-2 right-2">
          <div className="w-5 h-5 bg-accent rounded-full flex items-center justify-center">
            <Check className="w-3 h-3 text-accent-text" strokeWidth={3} aria-hidden="true" />
          </div>
        </div>
      )}
      <span className="text-2xl mb-1" role="img" aria-hidden="true">{language.flag}</span>
      <span className="text-base font-medium text-text">{language.nativeName}</span>
      <span className="text-sm text-text-muted mt-0.5">{language.englishName}</span>
    </button>
  )
}

function NoResults({ searchQuery, message }: { searchQuery: string; message: string }) {
  // Replace {{query}} placeholder with actual query
  const displayMessage = message.replace('{{query}}', searchQuery)

  return (
    <div className="text-center py-8">
      <div className="w-12 h-12 bg-surface-overlay rounded-full flex items-center justify-center mx-auto mb-3">
        <HelpCircle className="w-6 h-6 text-text-muted" />
      </div>
      <p className="text-sm text-text-muted">{displayMessage}</p>
    </div>
  )
}

export function UserOnboarding() {
  const navigate = useNavigate()
  const { t, i18n } = useTranslation()
  const [selectedLanguage, setSelectedLanguage] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')

  const filteredLanguages = useMemo(() => {
    if (!searchQuery.trim()) return LANGUAGES

    const query = searchQuery.toLowerCase().trim()
    return LANGUAGES.filter(
      (lang) =>
        lang.nativeName.toLowerCase().includes(query) ||
        lang.englishName.toLowerCase().includes(query) ||
        lang.code.toLowerCase().includes(query)
    )
  }, [searchQuery])

  const handleLanguageSelect = (code: string) => {
    setSelectedLanguage(code)
    // Change the UI language immediately when a language is selected
    i18n.changeLanguage(code)
  }

  const handleContinue = () => {
    if (selectedLanguage) {
      localStorage.setItem(STORAGE_KEY_LANGUAGE, selectedLanguage)
      navigate('/auth')
    }
  }

  const footer = (
    <>
      <span>{t('common.adminQuestion')} </span>
      <Link to="/admin" className="text-accent hover:text-accent-hover font-medium transition-colors">
        {t('common.signInNostr')}
      </Link>
    </>
  )

  return (
    <OnboardingCard
      title={t('onboarding.language.title')}
      subtitle={t('onboarding.language.subtitle')}
      footer={footer}
    >
      <SearchInput
        value={searchQuery}
        onChange={setSearchQuery}
        placeholder={t('onboarding.language.searchPlaceholder')}
        label={t('onboarding.language.searchLabel')}
      />

      {filteredLanguages.length === 0 ? (
        <NoResults
          searchQuery={searchQuery}
          message={t('onboarding.language.noResults', { query: searchQuery })}
        />
      ) : (
        <div
          role="radiogroup"
          aria-label="Select a language"
          className="grid grid-cols-2 sm:grid-cols-3 gap-3 max-h-80 overflow-y-auto pr-1 -mr-1"
        >
          {filteredLanguages.map((language) => (
            <LanguageButton
              key={language.code}
              language={language}
              isSelected={selectedLanguage === language.code}
              onSelect={() => handleLanguageSelect(language.code)}
            />
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={handleContinue}
        disabled={!selectedLanguage}
        aria-disabled={!selectedLanguage}
        className="w-full flex items-center justify-center gap-2 bg-accent text-accent-text rounded-xl px-6 py-3.5 font-medium hover:bg-accent-hover transition-all active-press disabled:opacity-50 disabled:cursor-not-allowed mt-6"
      >
        <span>{t('onboarding.language.continue')}</span>
        <ArrowRight className="w-5 h-5" aria-hidden="true" />
      </button>

      <p className="text-xs text-text-muted text-center mt-4">
        {t('onboarding.language.changeInSettings')}
      </p>
    </OnboardingCard>
  )
}
