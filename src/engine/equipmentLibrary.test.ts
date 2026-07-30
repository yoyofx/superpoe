import { describe, expect, it } from 'vitest'
import { equipmentItemToLibrarySnapshot } from '@/engine/equipmentLibrary'

describe('equipment library snapshot conversion', () => {
  it('preserves PoB modifier source tags without inventing trade stat IDs', () => {
    const snapshot = equipmentItemToLibrarySnapshot({
      id: '7', rarity: 'RARE', name: 'Doom Shell', baseType: 'Expert Hexer Robe',
      itemLevel: '81', quality: '+20%', socketCount: 0, runes: [], lines: [], raw: 'raw',
      modifiers: [{ text: '{crafted}+22 to Strength', tags: ['crafted'], group: 'explicit' }],
    })
    expect(snapshot).toMatchObject({ itemLevel: 81, quality: 20 })
    expect(snapshot.modifiers[0].sourceTags).toEqual(['crafted'])
    expect(snapshot.modifiers[0].tradeResolutions).toEqual([])
  })
})
