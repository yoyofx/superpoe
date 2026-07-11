import { describe, expect, it } from 'vitest'
import { clearPersistedImportedBuild, readPersistedImportedBuild, writePersistedImportedBuild } from '@/engine/buildPersistence'

function memoryStorage(): Storage {
  const values = new Map<string, string>()
  return {
    get length() { return values.size },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key) },
    setItem: (key, value) => { values.set(key, value) },
  }
}

describe('imported build persistence', () => {
  it('restores a build only for the matching passive-tree hash', () => {
    const storage = memoryStorage()
    writePersistedImportedBuild(storage, 'tree-a', 'full-pob-code')
    expect(readPersistedImportedBuild(storage, 'tree-a')).toBe('full-pob-code')
    expect(readPersistedImportedBuild(storage, 'tree-b')).toBeNull()
  })

  it('clears persisted data when the imported build is removed', () => {
    const storage = memoryStorage()
    writePersistedImportedBuild(storage, 'tree-a', 'full-pob-code')
    writePersistedImportedBuild(storage, 'tree-a', null)
    expect(readPersistedImportedBuild(storage, 'tree-a')).toBeNull()
  })

  it('supports explicit clearing without another tab writing an empty build', () => {
    const storage = memoryStorage()
    writePersistedImportedBuild(storage, 'tree-a', 'full-pob-code')
    clearPersistedImportedBuild(storage)
    expect(readPersistedImportedBuild(storage, 'tree-a')).toBeNull()
  })
})
