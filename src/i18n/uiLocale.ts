import type { Language } from '@/i18n/translationLoader'

export type UiMessage = Readonly<Record<Language, string>>

export const LANGUAGE_LOCALES: Readonly<Record<Language, string>> = {
  en: 'en-US',
  'zh-rCN': 'zh-CN',
  'zh-rTW': 'zh-TW',
  'ko-KR': 'ko-KR',
}

export function defineUiMessages<const T extends Record<string, UiMessage>>(messages: T): T {
  return messages
}

export function uiMessage(message: UiMessage, language: Language, params?: Record<string, string | number>): string {
  let value = message[language]
  if (params) {
    for (const [key, replacement] of Object.entries(params)) {
      value = value.split(`{${key}}`).join(String(replacement))
    }
  }
  return value
}

export function uiText(language: Language, en: string, zhCN: string, zhTW: string, koKR: string): string {
  return ({ en, 'zh-rCN': zhCN, 'zh-rTW': zhTW, 'ko-KR': koKR } satisfies UiMessage)[language]
}

export function formatUiNumber(value: number, language: Language, options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(LANGUAGE_LOCALES[language], options).format(value)
}

export function formatUiDate(value: string | number | Date, language: Language, options?: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(LANGUAGE_LOCALES[language], options).format(new Date(value))
}
