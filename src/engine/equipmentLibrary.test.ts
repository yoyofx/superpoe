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

  it('stores localized display text without replacing the trade-resolution source text', () => {
    const snapshot = equipmentItemToLibrarySnapshot({
      id: '8', rarity: 'RARE', name: 'Doom Shell', baseType: 'Expert Hexer Robe',
      itemLevel: '81', socketCount: 0, runes: [], lines: [], raw: 'raw',
      modifiers: [{ text: '+100 to maximum Life', tags: [], group: 'explicit' }],
    }, undefined, {
      locale: 'zh-CN', name: '灾厄之壳', baseType: '专家咒术长袍',
      translate: (text) => text === '+100 to maximum Life' ? '+100 最大生命' : text,
    })

    expect(snapshot.localized?.['zh-CN']).toEqual({ name: '灾厄之壳', baseType: '专家咒术长袍' })
    expect(snapshot.modifiers[0].original.displayText).toBe('+100 to maximum Life')
    expect(snapshot.modifiers[0].localized?.['zh-CN']?.displayText).toBe('+100 最大生命')
  })

  it('excludes socketed-content and Bonded modifiers from saved equipment', () => {
    const snapshot = equipmentItemToLibrarySnapshot({
      id: '9', rarity: 'RARE', name: 'Doom Shell', baseType: 'Expert Hexer Robe',
      itemLevel: '81', socketCount: 2, runes: ['Greater Iron Rune'], lines: [], raw: 'raw',
      modifiers: [
        { text: '{enchant}{rune}+20 to maximum Life', tags: ['enchant', 'rune'], group: 'rune' },
        { text: 'Bonded: +15% to Fire Resistance', tags: [], group: 'explicit' },
        { text: '羁绊：+15% 火焰抗性', tags: [], group: 'explicit' },
        { text: '{crafted}+22 to Strength', tags: ['crafted'], group: 'explicit' },
        { text: '{enchant}10% increased Movement Speed', tags: ['enchant'], group: 'enchant' },
      ],
    })

    expect(snapshot.modifiers.map((modifier) => modifier.original.displayText)).toEqual([
      '+22 to Strength',
      '10% increased Movement Speed',
    ])
  })
})
