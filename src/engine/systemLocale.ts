import type { Language } from '@/i18n/translationLoader'
import type { BuildRealm } from '@/types/tree'

function normalizeLocale(locale: string | undefined): string {
  return (locale || '').trim().replace('_', '-').toLowerCase()
}

export function getSystemLocale(): string {
  if (typeof navigator !== 'undefined' && typeof navigator.language === 'string') return navigator.language
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale
  } catch {
    return ''
  }
}

export function mapSystemLanguage(locale = getSystemLocale()): Language {
  const normalized = normalizeLocale(locale)
  if (normalized === 'zh-tw' || normalized === 'zh-hk' || normalized === 'zh-mo' || normalized.includes('hant')) return 'zh-rTW'
  if (normalized === 'zh' || normalized.startsWith('zh-') || normalized.includes('hans')) return 'zh-rCN'
  if (normalized.startsWith('ko')) return 'ko-KR'
  return 'en'
}

export function mapSystemRealm(locale = getSystemLocale()): BuildRealm {
  const normalized = normalizeLocale(locale)
  return normalized === 'zh-cn' || normalized === 'zh' || normalized.includes('hans') ? 'cn' : 'global'
}
