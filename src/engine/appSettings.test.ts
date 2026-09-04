import { describe, expect, it } from 'vitest'
import { loadAppSettings, normalizeUiScalePercent, saveAppSettings } from '@/engine/appSettings'

function createStorage(initial?: string) {
  const values = new Map<string, string>()
  if (initial !== undefined) values.set('superpoe-global-settings', initial)
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
  }
}

describe('global app settings', () => {
  it('loads defaults for empty or invalid storage', () => {
    expect(loadAppSettings(createStorage())).toMatchObject({ confirmUnsavedExit: true, uiScalePercent: 120, updateChannel: 'release', updateCheckIntervalMinutes: 60, proxyDomains: [], priceCheckEnabled: true, analyticsEnabled: true })
    expect(loadAppSettings(createStorage('{invalid'))).toMatchObject({ confirmUnsavedExit: true, uiScalePercent: 120, updateChannel: 'release', updateCheckIntervalMinutes: 60, proxyDomains: [], priceCheckEnabled: true, analyticsEnabled: true })
  })

  it('persists supported settings', () => {
    const storage = createStorage()
    saveAppSettings({ defaultRealm: 'cn', confirmUnsavedExit: false, uiScalePercent: 125, updateChannel: 'dev', updateCheckIntervalMinutes: 30, proxyDomains: ['https://proxy.example'], priceCheckEnabled: true, priceCheckHotkey: 'Alt+D', analyticsEnabled: true }, storage)
    expect(loadAppSettings(storage)).toEqual({ defaultRealm: 'cn', confirmUnsavedExit: false, uiScalePercent: 125, updateChannel: 'dev', updateCheckIntervalMinutes: 30, proxyDomains: ['https://proxy.example'], priceCheckEnabled: true, priceCheckHotkey: 'Alt+D', analyticsEnabled: true })
  })

  it('normalizes UI scale to supported five-percent steps', () => {
    expect(normalizeUiScalePercent(70)).toBe(80)
    expect(normalizeUiScalePercent(123)).toBe(125)
    expect(normalizeUiScalePercent(200)).toBe(150)
    expect(normalizeUiScalePercent('125')).toBe(100)
  })

  it('clamps invalid updateCheckIntervalMinutes to default', () => {
    const storage = createStorage(JSON.stringify({ updateCheckIntervalMinutes: 5 }))
    expect(loadAppSettings(storage).updateCheckIntervalMinutes).toBe(60)
  })

  it('normalizes proxyDomains entries', () => {
    const storage = createStorage(JSON.stringify({ proxyDomains: [' https://a.example/ ', '', 12, 'https://b.example//'] }))
    expect(loadAppSettings(storage).proxyDomains).toEqual(['https://a.example', 'https://b.example'])
  })

  it('does not fail when persistent storage is unavailable', () => {
    expect(() => saveAppSettings({ defaultRealm: 'global', confirmUnsavedExit: true, uiScalePercent: 100, updateChannel: 'release', updateCheckIntervalMinutes: 60, proxyDomains: [], priceCheckEnabled: false, priceCheckHotkey: 'Ctrl+D', analyticsEnabled: true }, {
      getItem: () => null,
      setItem: () => { throw new Error('storage unavailable') },
    })).not.toThrow()
  })
})
