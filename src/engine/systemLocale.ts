import type { Language } from '@/i18n/translationLoader'
import type { BuildRealm } from '@/types/tree'

function normalizeLocale(locale: string | undefined): string {
  return (locale || '').trim().replace('_', '-').toLowerCase()
}

export function getSystemLocale(): string {
  // Electron's navigator.language can reflect the app locale (often en-US)
  // instead of the operating system region. Prefer the main-process locale
  // when the desktop preload exposes it, while keeping browser/dev fallback.
  try {
    const desktop = (globalThis as { pob2Desktop?: { getSystemLocale?: () => unknown } }).pob2Desktop
    const electronLocale = desktop?.getSystemLocale?.()
    if (typeof electronLocale === 'string' && electronLocale.trim()) return electronLocale
  } catch {
    // Browser-only environments do not expose the desktop bridge.
  }
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
