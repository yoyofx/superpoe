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
    expect(loadAppSettings(createStorage())).toEqual({ defaultRealm: 'global', confirmUnsavedExit: true })
    expect(loadAppSettings(createStorage('{invalid'))).toEqual({ defaultRealm: 'global', confirmUnsavedExit: true })
  })

  it('persists supported settings', () => {
    const storage = createStorage()
    saveAppSettings({ defaultRealm: 'cn', confirmUnsavedExit: false }, storage)
    expect(loadAppSettings(storage)).toEqual({ defaultRealm: 'cn', confirmUnsavedExit: false })
  })

  it('does not fail when persistent storage is unavailable', () => {
    expect(() => saveAppSettings({ defaultRealm: 'global', confirmUnsavedExit: true }, {
      getItem: () => null,
      setItem: () => { throw new Error('storage unavailable') },
    })).not.toThrow()
  })
})
