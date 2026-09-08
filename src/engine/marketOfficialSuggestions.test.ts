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
})
