import { describe, expect, it } from 'vitest'
import { normalizeMarketListing } from '../../electron/marketListing'

describe('official market listing normalization', () => {
  it('stores official stat hashes, fixed options, modifier groups and listing price', () => {
    const result = normalizeMarketListing({ result: [{
      id: 'listing_1234',
      item: {
        rarity: 'RARE', name: 'Doom Shell', baseType: 'Expert Hexer Robe', ilvl: 81,
        properties: [{ name: 'Quality', values: [['+20%', 1]] }],
        implicitMods: ['Grants Skill: Level 20 Test'],
        explicitMods: ['+109 to maximum Life', 'Fire Resistance is 35%'],
        craftedMods: ['+22 to Strength'],
        extended: {
          hashes: {
            implicit: [['implicit.stat_100', [0]]],
            explicit: [['explicit.stat_3299347043', [0]], ['explicit.stat_200|3', [1]]],
            crafted: [['explicit.stat_300', [0]]],
          },
          mods: { explicit: [{ tier: 'Tier 1', magnitudes: [{ min: 100, max: 109 }] }, {}] },
        },
      },
      listing: { indexed: '2026-07-29T00:00:00Z', price: { amount: 2.5, currency: 'divine' } },
    }] }, {
      realm: 'global', listingId: 'listing_1234', queryId: 'query_5678',
      sourceUrl: 'https://www.pathofexile.com/trade2/search/poe2/Standard/query_5678',
    })

    expect(result.source).toMatchObject({ leagueId: 'Standard', price: { amount: 2.5, currency: 'divine' } })
    expect(result.item.quality).toBe(20)
    expect(result.item.modifiers.map((modifier) => modifier.group)).toEqual(['implicit', 'explicit', 'explicit', 'explicit'])
    expect(result.item.modifiers[1].tradeResolutions[0]).toMatchObject({
      queryStatId: 'explicit.stat_3299347043', baseStatId: 'explicit.stat_3299347043', status: 'resolved',
    })
    expect(result.item.modifiers[2].tradeResolutions[0]).toMatchObject({
      queryStatId: 'explicit.stat_200|3', baseStatId: 'explicit.stat_200', optionId: '3', valueMode: 'fixed-option', status: 'resolved',
    })
    expect(result.item.modifiers[2].currentValues).toEqual([])
    expect(result.item.modifiers[3].sourceTags).toEqual(['crafted'])
  })

  it('keeps duplicate official candidates ambiguous instead of selecting one', () => {
    const result = normalizeMarketListing({ result: [{ id: 'listing_1234', item: {
      rarity: 'MAGIC', baseType: 'Ring', explicitMods: ['Test'],
      extended: { hashes: { explicit: [['explicit.stat_1', [0]], ['explicit.stat_2', [0]]] } },
    } }] }, {
      realm: 'cn', listingId: 'listing_1234', sourceUrl: 'https://poe.game.qq.com/trade2/search/poe2/Standard/query_5678',
    })
    expect(result.item.modifiers[0].tradeResolutions[0]).toMatchObject({
      status: 'ambiguous', candidateStatIds: ['explicit.stat_1', 'explicit.stat_2'],
    })
  })
})
