import { getCurrentLocale, t, translate, type Locale } from '../i18n'
import type { ChatSettingsResponse } from '../types'

type SupportedLanguage = 'auto' | 'en' | 'ko'

const LOCALES: Locale[] = ['en', 'ko']

const LANGUAGE_KEYS: Record<SupportedLanguage, string> = {
  auto: 'language.auto',
  en: 'language.english',
  ko: 'language.korean',
}

const DEFAULT_SYSTEM_PROMPTS = new Set(
  LOCALES.map((locale) => translate(locale, 'defaults.systemPrompt')),
)

const KNOWN_VOICE_LABELS = new Set(
  ['Agent Voice', ...LOCALES.map((locale) => translate(locale, 'voices.defaultLabel.agent'))].map((value) => value.trim().toLowerCase()),
)

const KNOWN_REFERENCE_TEXTS = new Set(
  ['Uploaded sample transcript.', ...LOCALES.map((locale) => translate(locale, 'voices.defaultReferenceText.uploadedSample'))].map((value) => value.trim().toLowerCase()),
)

const LANGUAGE_ALIASES = new Map<string, SupportedLanguage>()

for (const locale of LOCALES) {
  for (const [language, key] of Object.entries(LANGUAGE_KEYS) as Array<[SupportedLanguage, string]>) {
    LANGUAGE_ALIASES.set(translate(locale, key).toLowerCase(), language)
  }
}

LANGUAGE_ALIASES.set('auto', 'auto')
LANGUAGE_ALIASES.set('automatic', 'auto')
LANGUAGE_ALIASES.set('en', 'en')
LANGUAGE_ALIASES.set('english', 'en')
LANGUAGE_ALIASES.set('en-us', 'en')
LANGUAGE_ALIASES.set('en-gb', 'en')
LANGUAGE_ALIASES.set('ko', 'ko')
LANGUAGE_ALIASES.set('kr', 'ko')
LANGUAGE_ALIASES.set('ko-kr', 'ko')
LANGUAGE_ALIASES.set('korean', 'ko')

export function normalizeLanguageValue(value: string | null | undefined): SupportedLanguage | null {
  const normalized = value?.trim().toLowerCase()
  if (!normalized) {
    return null
  }

  return LANGUAGE_ALIASES.get(normalized) ?? null
}

export function formatLanguageLabel(value: string | null | undefined): string {
  const normalized = normalizeLanguageValue(value)
  return normalized ? t(LANGUAGE_KEYS[normalized]) : value?.trim() ?? ''
}

export function getLanguageFilterValue(value: string | null | undefined): string {
  return normalizeLanguageValue(value) ?? value?.trim() ?? ''
}

export function formatAppDate(
  value: string | number | Date,
  options?: Intl.DateTimeFormatOptions,
): string {
  return new Intl.DateTimeFormat(getCurrentLocale(), options).format(new Date(value))
}

export function formatAppTime(
  value: string | number | Date,
  options?: Intl.DateTimeFormatOptions,
): string {
  return new Intl.DateTimeFormat(getCurrentLocale(), {
    timeStyle: 'short',
    ...options,
  }).format(new Date(value))
}

export function formatAppDateTime(
  value: string | number | Date,
  options?: Intl.DateTimeFormatOptions,
): string {
  return new Intl.DateTimeFormat(getCurrentLocale(), {
    dateStyle: 'medium',
    timeStyle: 'short',
    ...options,
  }).format(new Date(value))
}

export function localizeDefaultSystemPrompt(value: string | null | undefined): string {
  const trimmed = value?.trim()
  if (!trimmed) {
    return ''
  }

  return DEFAULT_SYSTEM_PROMPTS.has(trimmed) ? t('defaults.systemPrompt') : trimmed
}

function shouldLocalizeKnownValue(value: string | null | undefined, knownValues: Set<string>): boolean {
  const trimmed = value?.trim()
  if (!trimmed) {
    return false
  }

  return knownValues.has(trimmed.toLowerCase())
}

export function localizeKnownVoiceLabel(value: string | null | undefined): string {
  const trimmed = value?.trim()
  if (!trimmed) {
    return ''
  }

  return shouldLocalizeKnownValue(trimmed, KNOWN_VOICE_LABELS) ? t('voices.defaultLabel.agent') : trimmed
}

export function localizeKnownReferenceText(value: string | null | undefined): string {
  const trimmed = value?.trim()
  if (!trimmed) {
    return ''
  }

  return shouldLocalizeKnownValue(trimmed, KNOWN_REFERENCE_TEXTS) ? t('voices.defaultReferenceText.uploadedSample') : trimmed
}

export function localizeChatSettings(settings: ChatSettingsResponse): ChatSettingsResponse {
  return {
    ...settings,
    defaults: {
      ...settings.defaults,
      system_prompt: localizeDefaultSystemPrompt(settings.defaults.system_prompt),
    },
  }
}
