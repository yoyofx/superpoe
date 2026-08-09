import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { extname, resolve } from 'node:path'
import { LANGUAGE_OPTIONS } from '@/i18n/translationLoader'
import { LANGUAGE_LOCALES, defineUiMessages, formatUiNumber, uiMessage } from '@/i18n/uiLocale'
import { getTranslations } from '@/i18n/useTranslation'

describe('UI locale infrastructure', () => {
  it('keeps the legacy UI catalog complete for all four languages', () => {
    const expectedKeys = Object.keys(getTranslations('en')).sort()
    for (const language of ['zh-rCN', 'zh-rTW', 'ko-KR'] as const) {
      expect(Object.keys(getTranslations(language)).sort()).toEqual(expectedKeys)
    }
  })

  it('keeps every supported language mapped to a concrete locale', () => {
    expect(Object.keys(LANGUAGE_LOCALES)).toEqual(LANGUAGE_OPTIONS.map((option) => option.value))
  })

  it('resolves complete four-language messages and parameters', () => {
    const messages = defineUiMessages({
      count: {
        en: '{count} items',
        'zh-rCN': '{count} 件装备',
        'zh-rTW': '{count} 件裝備',
        'ko-KR': '아이템 {count}개',
      },
    })
    expect(uiMessage(messages.count, 'zh-rTW', { count: 2 })).toBe('2 件裝備')
    expect(uiMessage(messages.count, 'ko-KR', { count: 2 })).toBe('아이템 2개')
  })

  it('formats numbers with the selected interface locale', () => {
    expect(formatUiNumber(1234.5, 'en')).toContain('1,234.5')
    expect(formatUiNumber(1234.5, 'ko-KR')).toContain('1,234.5')
  })

  it('rejects binary Chinese/English language branches in SuperPoE UI components', () => {
    const componentRoot = resolve(process.cwd(), 'src/components')
    const sourceFiles = [resolve(process.cwd(), 'src/App.tsx')]
    const visit = (directory: string) => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const target = resolve(directory, entry.name)
        if (entry.isDirectory()) visit(target)
        else if (['.ts', '.tsx'].includes(extname(entry.name))) sourceFiles.push(target)
      }
    }
    visit(componentRoot)

    const forbidden = [
      /\bzh\s*:\s*boolean\b/,
      /const\s+zh\s*=\s*(?:lang|language)\s*={2,3}\s*['"]zh-rCN['"]/,
      /(?:lang|language)\s*={2,3}\s*['"]zh-rCN['"]\s*\?/,
    ]
    const violations = sourceFiles.flatMap((file) => {
      const lines = readFileSync(file, 'utf8').split(/\r?\n/)
      return lines.flatMap((line, index) => {
        // Selecting a genuinely zh-CN-only backend field is data localization, not a UI-language branch.
        if (/localized(?:Name|BaseType|Lines)?|\.localized/.test(line)) return []
        return forbidden.filter((pattern) => pattern.test(line)).map((pattern) => `${file}:${index + 1}: ${pattern}`)
      })
    })
    expect(violations).toEqual([])
  })
})
