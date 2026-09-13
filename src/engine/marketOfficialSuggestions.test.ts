import { describe, expect, it } from 'vitest'
import { buildOfficialMarketSuggestionCatalog } from './marketOfficialSuggestions'

const localize = (source: string): string => ({
  'Rawhide Belt': '粗皮腰带',
  'Belt': '腰带',
  'Any': '全部',
  'Rare': '稀有',
  '+#% total to Cold Resistance': '+#% 冰霜抗性总和',
}[source] || source)

describe('official market suggestion catalog', () => {
  it('keeps item, filter, and stat candidates in their official field scopes', () => {
    const catalog = buildOfficialMarketSuggestionCatalog(
      {
        result: [{
          id: 'armour',
          entries: [{ type: 'Rawhide Belt' }, { type: 'Belt' }],
        }],
      },
      {
        result: [{
          id: 'type_filters',
          filters: [
            { id: 'category', text: 'Item Category', option: { options: [{ id: 'accessory.belt', text: 'Belt' }] } },
            { id: 'rarity', text: 'Item Rarity', option: { options: [{ id: null, text: 'Any' }, { id: 'rare', text: 'Rare' }] } },
          ],
        }],
      },
      {
        result: [{
          id: 'pseudo',
          entries: [{ id: 'pseudo.cold', text: '+#% total to Cold Resistance', type: 'pseudo' }],
        }],
      },
      localize,
    )

    expect(catalog.itemPairs).toEqual([
      ['Rawhide Belt', '粗皮腰带'],
      ['Belt', '腰带'],
    ])
    expect(catalog.filterLabelsById.get('category')).toBe('Item Category')
    expect(catalog.filterPairsById.get('category')).toEqual([['Belt', '腰带']])
    expect(catalog.filterPairsById.get('rarity')).toEqual([
      ['Any', '全部'],
      ['Rare', '稀有'],
    ])
    expect(catalog.statPairs).toEqual([['+#% total to Cold Resistance', '+#% 冰霜抗性总和']])
  })

  it('resolves localized CN endpoint values back to canonical suggestions', () => {
    const catalog = buildOfficialMarketSuggestionCatalog(
      {
        result: [{ entries: [{ type: '粗皮腰带' }] }],
      },
      {
        result: [{ filters: [{ id: 'status', option: { options: [{ id: 'securable', text: '立即购买' }] } }] }],
      },
      {
        result: [{ entries: [{ text: '+#% 总冰霜抗性' }] }],
      },
      localize,
      (localized) => ({
        粗皮腰带: 'Rawhide Belt',
        立即购买: 'Instant Buyout',
        '+#% 总冰霜抗性': '+#% total to Cold Resistance',
      }[localized]),
    )

    expect(catalog.itemPairs).toEqual([['Rawhide Belt', '粗皮腰带']])
    expect(catalog.filterPairsById.get('status')).toEqual([['Instant Buyout', '立即购买']])
    expect(catalog.statPairs).toEqual([['+#% total to Cold Resistance', '+#% 总冰霜抗性']])
  })
})
