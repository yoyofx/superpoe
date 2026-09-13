import { describe, expect, it } from 'vitest'
import { DEFAULT_REFERENCE_SITES, loadReferenceSites, normalizeReferenceSites, saveReferenceSites } from '@/engine/referenceSites'

function createStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial))
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
    values,
  }
}

describe('reference site settings', () => {
  it('uses the built-in sites when storage is empty', () => {
    expect(loadReferenceSites(createStorage())).toEqual(DEFAULT_REFERENCE_SITES)
  })

  it('keeps only valid HTTPS sites and unique ids', () => {
    expect(normalizeReferenceSites([
      { id: 'custom', name: 'Custom', url: 'https://example.com' },
      { id: 'custom', name: 'Duplicate', url: 'https://other.example.com' },
      { id: 'insecure', name: 'Insecure', url: 'http://example.com' },
    ])).toEqual([{ id: 'custom', name: 'Custom', url: 'https://example.com' }])
  })

  it('round-trips custom sites through local storage', () => {
    const storage = createStorage()
    const sites = [{ id: 'custom', name: 'Custom', url: 'https://example.com/docs' }]
    saveReferenceSites(sites, storage)
    expect(loadReferenceSites(storage)).toEqual(sites)
  })
})
