import { describe, expect, it } from 'vitest'
import { loadAppSettings, saveAppSettings } from '@/engine/appSettings'

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
    expect(loadAppSettings(createStorage())).toEqual({ defaultRealm: 'global', confirmUnsavedExit: true, updateChannel: 'release', updateCheckIntervalMinutes: 60, proxyDomains: [] })
    expect(loadAppSettings(createStorage('{invalid'))).toEqual({ defaultRealm: 'global', confirmUnsavedExit: true, updateChannel: 'release', updateCheckIntervalMinutes: 60, proxyDomains: [] })
  })

  it('persists supported settings', () => {
    const storage = createStorage()
    saveAppSettings({ defaultRealm: 'cn', confirmUnsavedExit: false, updateChannel: 'dev', updateCheckIntervalMinutes: 30, proxyDomains: ['https://proxy.example'] }, storage)
    expect(loadAppSettings(storage)).toEqual({ defaultRealm: 'cn', confirmUnsavedExit: false, updateChannel: 'dev', updateCheckIntervalMinutes: 30, proxyDomains: ['https://proxy.example'] })
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
    expect(() => saveAppSettings({ defaultRealm: 'global', confirmUnsavedExit: true, updateChannel: 'release', updateCheckIntervalMinutes: 60, proxyDomains: [] }, {
      getItem: () => null,
      setItem: () => { throw new Error('storage unavailable') },
    })).not.toThrow()
  })
})
