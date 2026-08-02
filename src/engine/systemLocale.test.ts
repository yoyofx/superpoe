import { describe, expect, it } from 'vitest'
import { mapSystemLanguage, mapSystemRealm } from '@/engine/systemLocale'

describe('system locale mapping', () => {
  it.each([
    ['zh-CN', 'zh-rCN'],
    ['zh-Hans', 'zh-rCN'],
    ['zh-TW', 'zh-rTW'],
    ['zh-HK', 'zh-rTW'],
    ['ko-KR', 'ko-KR'],
    ['en-US', 'en'],
  ])('maps %s to %s', (locale, expected) => {
    expect(mapSystemLanguage(locale)).toBe(expected)
  })

  it.each([
    ['zh-CN', 'cn'],
    ['zh-Hans', 'cn'],
    ['zh-TW', 'global'],
    ['en-US', 'global'],
  ])('maps %s to the %s realm', (locale, expected) => {
    expect(mapSystemRealm(locale)).toBe(expected)
  })
})
