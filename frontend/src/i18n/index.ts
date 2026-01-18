import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'

// Import all locale files
import en from './locales/en.json'
import es from './locales/es.json'
import pt from './locales/pt.json'
import fr from './locales/fr.json'
import de from './locales/de.json'
import it from './locales/it.json'
import nl from './locales/nl.json'
import ru from './locales/ru.json'
import zhHans from './locales/zh-Hans.json'
import zhHant from './locales/zh-Hant.json'
import ja from './locales/ja.json'
import ko from './locales/ko.json'
import ar from './locales/ar.json'
import fa from './locales/fa.json'
import hi from './locales/hi.json'
import bn from './locales/bn.json'
import id from './locales/id.json'
import th from './locales/th.json'
import vi from './locales/vi.json'
import tr from './locales/tr.json'
import pl from './locales/pl.json'
import uk from './locales/uk.json'
import sv from './locales/sv.json'
import no from './locales/no.json'
import da from './locales/da.json'
import fi from './locales/fi.json'
import el from './locales/el.json'
import he from './locales/he.json'
import cs from './locales/cs.json'
import ro from './locales/ro.json'
import hu from './locales/hu.json'

const resources = {
  en: { translation: en },
  es: { translation: es },
  pt: { translation: pt },
  fr: { translation: fr },
  de: { translation: de },
  it: { translation: it },
  nl: { translation: nl },
  ru: { translation: ru },
  'zh-Hans': { translation: zhHans },
  'zh-Hant': { translation: zhHant },
  ja: { translation: ja },
  ko: { translation: ko },
  ar: { translation: ar },
  fa: { translation: fa },
  hi: { translation: hi },
  bn: { translation: bn },
  id: { translation: id },
  th: { translation: th },
  vi: { translation: vi },
  tr: { translation: tr },
  pl: { translation: pl },
  uk: { translation: uk },
  sv: { translation: sv },
  no: { translation: no },
  da: { translation: da },
  fi: { translation: fi },
  el: { translation: el },
  he: { translation: he },
  cs: { translation: cs },
  ro: { translation: ro },
  hu: { translation: hu },
}

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: 'en',
    interpolation: {
      escapeValue: false, // React already escapes values
    },
    detection: {
      order: ['localStorage', 'navigator'],
      lookupLocalStorage: 'sanctum_language',
      caches: ['localStorage'],
    },
  })

export default i18n
