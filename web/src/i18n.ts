import en from './locales/en.json'
import ko from './locales/ko.json'

export type Locale = 'en' | 'ko'

type TranslationDictionary = Record<string, string>
type TranslationVariables = Record<string, number | string>

const LOCALE_STORAGE_KEY = 'tts-lab-locale'

const dictionaries: Record<Locale, TranslationDictionary> = {
  en,
  ko,
}

// Current locale state
let currentLocale: Locale = 'en'

function isLocale(value: string | null): value is Locale {
  return value === 'en' || value === 'ko'
}

export function detectLocale(): Locale {
  if (typeof window === 'undefined') {
    return 'en'
  }

  const storedLocale = window.localStorage.getItem(LOCALE_STORAGE_KEY)
  if (isLocale(storedLocale)) {
    return storedLocale
  }

  return window.navigator.language.toLowerCase().startsWith('ko') ? 'ko' : 'en'
}

export function persistLocale(locale: Locale) {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.setItem(LOCALE_STORAGE_KEY, locale)
  document.documentElement.lang = locale === 'ko' ? 'ko' : 'en'
}

export function translate(locale: Locale, key: string, variables?: TranslationVariables): string {
  const template = dictionaries[locale][key] ?? dictionaries.en[key] ?? key

  if (!variables) {
    return template
  }

  return template.replace(/\{\{(\w+)\}\}/g, (_, variableName: string) => {
    const value = variables[variableName]
    return value === undefined ? '' : String(value)
  })
}

// Initialize locale on module load
if (typeof window !== 'undefined') {
  currentLocale = detectLocale()
  document.documentElement.lang = currentLocale
}

/**
 * Get the current locale
 */
export function getCurrentLocale(): Locale {
  return currentLocale
}

/**
 * Set the locale and persist it
 */
export function setLocale(locale: Locale): void {
  currentLocale = locale
  persistLocale(locale)
  // Trigger a re-render by dispatching a custom event
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('locale-change', { detail: locale }))
  }
}

/**
 * Translate a key using the current locale
 */
export function t(key: string, variables?: TranslationVariables): string {
  return translate(currentLocale, key, variables)
}
