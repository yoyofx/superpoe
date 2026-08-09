import { describe, expect, it } from 'vitest'
import { canonicalToLegacySnapshot, type NormalizedPobItem } from '../../electron/pobItemBridge'

function normalized(text: string): NormalizedPobItem {
  return {
    item: { format: 'pob2-item', raw: text },
    view: {
      rarity: 'UNIQUE',
      name: 'Runeseeker\'s Call',
      baseType: 'Runic Fork',
      modifiers: [{
        id: 'implicit-0',
        displayOrder: 0,
        group: 'implicit',
        sourceTags: ['implicit'],
        text,
        tradeStatIds: ['skill.the_stars_answer'],
      }],
    },
  }
}

describe('PoB item trade snapshot conversion', () => {
  it('infers granted skill levels as numeric price-check values', () => {
    const snapshot = canonicalToLegacySnapshot(normalized('Grants Skill: Level 19 The Stars Answer'), undefined, 'cn')
    expect(snapshot.modifiers[0]).toMatchObject({
      valueMode: 'numeric',
      currentValues: [19],
    })
    expect(snapshot.modifiers[0].tradeResolutions[0].valueMode).toBe('numeric')
  })

  it('keeps granted skills without a level as presence-only values', () => {
    const snapshot = canonicalToLegacySnapshot(normalized('Grants Skill: Raise Shield'), undefined, 'cn')
    expect(snapshot.modifiers[0]).toMatchObject({ valueMode: 'presence', currentValues: [] })
  })
})
