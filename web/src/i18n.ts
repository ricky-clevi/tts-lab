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
