export type UiLanguage = 'en' | 'zh-rCN' | 'zh-rTW' | 'ko-KR'

export type DesktopUiMessage = Readonly<Record<UiLanguage, string>>

export function isUiLanguage(value: unknown): value is UiLanguage {
  return value === 'en' || value === 'zh-rCN' || value === 'zh-rTW' || value === 'ko-KR'
}

export function desktopText(language: UiLanguage, en: string, zhCN: string, zhTW: string, koKR: string): string {
  return ({ en, 'zh-rCN': zhCN, 'zh-rTW': zhTW, 'ko-KR': koKR } satisfies DesktopUiMessage)[language]
}
