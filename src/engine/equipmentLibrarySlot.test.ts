import { describe, expect, it } from 'vitest'
import type { EquipmentLibraryEntry } from '@/types/market'
import { equipmentLibraryEntryKind, fitsEquipmentLibrarySlot, isEquipmentLibraryJewel } from './equipmentLibrarySlot'

function entry(baseType: string, tradeCategory?: string): EquipmentLibraryEntry {
  return {
    schemaVersion: 3,
    id: baseType,
    fingerprint: baseType,
    item: { format: 'pob2-item', raw: `Rarity: RARE\nTest\n${baseType}`, ...(tradeCategory ? { tradeCategory } : {}) },
    view: { rarity: 'RARE', name: 'Test', baseType, ...(tradeCategory ? { tradeCategory } : {}), modifiers: [] },
    sources: [],
    collectionRoot: 'custom',
    tags: [],
    archived: false,
    createdAt: '',
    updatedAt: '',
  }
}

describe('equipment library slot matching', () => {
  it('keeps each armour slot restricted to its own type', () => {
    expect(fitsEquipmentLibrarySlot(entry('Expert Hexer\'s Robe', 'armour.chest'), 'Helmet')).toBe(false)
    expect(fitsEquipmentLibrarySlot(entry('Expert Hexer\'s Gloves', 'armour.gloves'), 'Gloves')).toBe(true)
    expect(fitsEquipmentLibrarySlot(entry('Crucible Tower Shield', 'armour.shield'), 'Gloves')).toBe(false)
  })

  it('allows weapons and shields in a weapon slot', () => {
    expect(fitsEquipmentLibrarySlot(entry('Advanced Quarterstaff', 'weapon.warstaff'), 'Weapon 1')).toBe(true)
    expect(fitsEquipmentLibrarySlot(entry('Crucible Tower Shield', 'armour.shield'), 'Weapon 2')).toBe(true)
  })

  it('does not allow an unclassified legacy entry to cross slots', () => {
    expect(fitsEquipmentLibrarySlot(entry('Unclear Item'), 'Helmet')).toBe(false)
  })

  it('infers jewels for legacy entries without a category', () => {
    const jewel = entry('Emerald Jewel')
    expect(equipmentLibraryEntryKind(jewel)).toBe('jewel')
    expect(isEquipmentLibraryJewel(jewel)).toBe(true)
  })
})
