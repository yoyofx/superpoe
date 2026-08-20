import { describe, expect, it } from 'vitest'
import type { EquipmentLibraryEntry } from '@/types/market'
import { filterEquipmentLibraryEntries } from './equipmentLibraryQuery'

function entry(overrides: Partial<EquipmentLibraryEntry> = {}): EquipmentLibraryEntry {
  return {
    schemaVersion: 3,
    id: overrides.id || 'entry',
    fingerprint: overrides.fingerprint || 'fingerprint',
    item: { format: 'pob2-item', raw: 'Rarity: RARE\nTest item' },
    view: {
      rarity: 'RARE', name: 'Test item', baseType: 'Expert Helmet', tradeCategory: 'armour.helmet',
      modifiers: [],
    },
    sources: [],
    collectionRoot: 'build',
    tags: [],
    archived: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('equipment library query', () => {
  it('limits results to explicitly allowed source roots', () => {
    const entries = [entry({ id: 'market', collectionRoot: 'market' }), entry({ id: 'build' }), entry({ id: 'custom', collectionRoot: 'custom' })]

    expect(filterEquipmentLibraryEntries(entries, { kind: 'workspace', allowedRoots: ['build'] }).map((item) => item.id)).toEqual(['build'])
  })

  it('filters jewel socket candidates without changing the original entries', () => {
    const jewel = entry({ id: 'jewel', view: { rarity: 'UNIQUE', name: 'Radius Jewel', baseType: 'Diamond', tradeCategory: 'jewel', modifiers: [] } })
    const helmet = entry({ id: 'helmet' })

    expect(filterEquipmentLibraryEntries([jewel, helmet], { kind: 'jewel-slot' }).map((item) => item.id)).toEqual(['jewel'])
    expect(helmet.view.baseType).toBe('Expert Helmet')
  })

  it('filters equipment candidates by slot and localized search text', () => {
    const helmet = entry({ id: 'helmet' })
    helmet.view.localized = { 'zh-CN': { name: '坚固头盔', baseType: '专家头盔' } }
    const boots = entry({ id: 'boots', view: { rarity: 'RARE', name: 'Test boots', baseType: 'Expert Boots', tradeCategory: 'armour.boots', modifiers: [] } })

    expect(filterEquipmentLibraryEntries([helmet, boots], { kind: 'equipment-slot', slotName: 'Helmet' }, '坚固头盔').map((item) => item.id)).toEqual(['helmet'])
    expect(filterEquipmentLibraryEntries([helmet, boots], { kind: 'equipment-slot', slotName: 'Boots' }).map((item) => item.id)).toEqual(['boots'])
  })
})

