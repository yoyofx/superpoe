import { describe, expect, it } from 'vitest'
import {
  applyRendererStorage,
  buildBackupFileName,
  createSuperPoeBackup,
  parseSuperPoeBackup,
} from '@/engine/superPoeBackup'

function createStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial))
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
    removeItem: (key: string) => { values.delete(key) },
    values,
  }
}

describe('SuperPoE backup files', () => {
  it('round-trips renderer and main data with a payload hash', async () => {
    const storage = createStorage({
      'superpoe-global-settings': '{"defaultRealm":"global"}',
      'pob2-language': 'zh-rCN',
      'not-app-data': 'ignored',
    })
    const content = await createSuperPoeBackup({
      storage,
      urlHash: '#share-code',
      main: { equipmentLibrary: { schemaVersion: 3, entries: [] }, marketMonitoring: null },
      appVersion: '0.5.3',
      channel: 'dev',
      platform: 'win32',
    })
    const parsed = await parseSuperPoeBackup(content)

    expect(parsed.format).toBe('superpoe-backup')
    expect(parsed.data.urlHash).toBe('share-code')
    expect(parsed.data.rendererStorage['pob2-language']).toBe('zh-rCN')
    expect(parsed.data.rendererStorage).not.toHaveProperty('not-app-data')
    expect(parsed.payloadHash).toMatch(/^sha256:[a-f0-9]{64}$/)
  })

  it('rejects a modified payload', async () => {
    const content = await createSuperPoeBackup({
      main: { equipmentLibrary: null, marketMonitoring: null },
      appVersion: '0.5.3',
      channel: 'release',
      platform: 'darwin',
    })
    const envelope = JSON.parse(content)
    envelope.data.urlHash = 'tampered'
    await expect(parseSuperPoeBackup(JSON.stringify(envelope))).rejects.toThrow('payload hash')
  })

  it('restores only application storage keys', () => {
    const storage = createStorage({
      'superpoe-global-settings': 'old',
      'pob2-language': 'old',
      'pob2-saved-builds': 'old',
      unrelated: 'keep',
    })
    applyRendererStorage({ 'superpoe-global-settings': 'new', 'pob2-language': 'zh-rCN' }, storage)

    expect(storage.values.get('superpoe-global-settings')).toBe('new')
    expect(storage.values.get('pob2-language')).toBe('zh-rCN')
    expect(storage.values.has('pob2-saved-builds')).toBe(false)
    expect(storage.values.get('unrelated')).toBe('keep')
  })

  it('creates a portable timestamped file name', () => {
    expect(buildBackupFileName(new Date('2026-08-15T12:34:56.000Z'))).toBe('SuperPoE-backup-20260815T123456Z.spoe-backup')
  })
})
