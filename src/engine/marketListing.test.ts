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
    expect(result.item.preview.quality).toBe(20)
    expect(result.item.preview.modifiers.map((modifier) => modifier.group)).toEqual(['implicit', 'explicit', 'explicit', 'explicit'])
    expect(result.item.preview.modifiers[1].tradeResolutions[0]).toMatchObject({
      queryStatId: 'explicit.stat_3299347043', baseStatId: 'explicit.stat_3299347043', status: 'resolved',
    })
    expect(result.item.preview.modifiers[2].tradeResolutions[0]).toMatchObject({
      queryStatId: 'explicit.stat_200|3', baseStatId: 'explicit.stat_200', optionId: '3', valueMode: 'fixed-option', status: 'resolved',
    })
    expect(result.item.preview.modifiers[2].currentValues).toEqual([])
    expect(result.item.preview.modifiers[3].sourceTags).toEqual(['crafted'])
    expect(result.item.raw).toContain('+109 to maximum Life')
  })

  it('keeps duplicate official candidates ambiguous instead of selecting one', () => {
    const result = normalizeMarketListing({ result: [{ id: 'listing_1234', item: {
      rarity: 'MAGIC', baseType: 'Ring', explicitMods: ['Test'],
      extended: { hashes: { explicit: [['explicit.stat_1', [0]], ['explicit.stat_2', [0]]] } },
    } }] }, {
      realm: 'cn', listingId: 'listing_1234', sourceUrl: 'https://poe.game.qq.com/trade2/search/poe2/Standard/query_5678',
    })
    expect(result.item.preview.modifiers[0].tradeResolutions[0]).toMatchObject({
      status: 'ambiguous', candidateStatIds: ['explicit.stat_1', 'explicit.stat_2'],
    })
  })

  it('normalizes Tencent object modifiers with localized descriptions, hashes and embedded tiers', () => {
    const result = normalizeMarketListing({ result: [{ id: 'listing_1234', item: {
      rarity: 'RARE', name: '巨龙 神袍', baseType: '懦夫护甲',
      implicitMods: ['[Flask|药剂]的魔力回复提高 20%'],
      explicitMods: [{
        description: '+128 [Armour|护甲]', hash: 'stat.explicit.stat_809229260',
        mods: [{ name: '电镀的', tier: 'P6', level: 33, magnitudes: [{ min: '108', max: '140' }] }],
      }],
      extended: { hashes: { explicit: [['explicit.stat_wrong', [0]]] } },
    } }] }, {
      realm: 'cn', listingId: 'listing_1234', queryId: 'query_5678',
      sourceUrl: 'https://poe.game.qq.com/trade2/search/poe2/Standard/query_5678',
    }, (value) => value === '懦夫护甲' ? 'Dastard Armour' : undefined, (value) => ({
      '药剂的魔力回复提高 20%': '20% increased Mana Recovery from Flasks',
      '+128 护甲': '+128 to Armour',
    }[value]))

    expect(result.item.preview.modifiers.map((modifier) => modifier.original.displayText)).toEqual(['药剂的魔力回复提高 20%', '+128 护甲'])
    expect(result.item.preview.modifiers[1]).toMatchObject({
      affixKind: 'prefix', tier: { name: '电镀的', rank: 6, level: 33 }, tierRanges: [{ min: 108, max: 140 }],
      tradeResolutions: [{ queryStatId: 'explicit.stat_809229260', status: 'resolved' }],
    })
    expect(result.item.raw).toContain('Dastard Armour')
    expect(result.item.raw).toContain('+128 to Armour')
  })

  it('never writes an untranslated CN rare name into PoB raw', () => {
    const result = normalizeMarketListing({ result: [{ id: 'listing_1234', item: {
      rarity: 'RARE', name: '\u66b4\u6012 \u4e4b\u672f', baseType: '\u795e\u5723\u957f\u6756', explicitMods: [],
    } }] }, {
      realm: 'cn', listingId: 'listing_1234', sourceUrl: 'https://poe.game.qq.com/trade2/search/poe2/Standard/query_5678',
    }, (value) => ({ '\u66b4\u6012 \u4e4b\u672f': 'Wrath Spell', '\u795e\u5723\u957f\u6756': 'Sanctified Staff' }[value]))

    expect(result.item.raw).toContain('Wrath Spell\nSanctified Staff')
    expect(result.item.raw).not.toMatch(/[\u3400-\u9fff?]/)
  })

  it('recovers placeholder modifier text from the official stat hash', () => {
    const result = normalizeMarketListing({ result: [{ id: 'listing_1234', item: {
      rarity: 'UNIQUE', name: 'Mageblood', baseType: 'Utility Belt',
      explicitMods: ['?????? (??????-??????) 继承'],
      extended: { hashes: { explicit: [['explicit.stat_264262054|4', [0]]] } },
    } }] }, {
      realm: 'cn', listingId: 'listing_1234', sourceUrl: 'https://poe.game.qq.com/trade2/search/poe2/Standard/query_5678',
    }, undefined, undefined, (id) => id === 'explicit.stat_264262054|4'
      ? { displayText: '钻石 继承', canonicalText: 'Legacy of Diamond' }
      : undefined)

    expect(result.item.preview.modifiers[0].original.displayText).toBe('钻石 继承')
    expect(result.item.raw).toContain('Legacy of Diamond')
  })

  it('preserves radius jewel metadata needed by PoB replacement calculations', () => {
    const result = normalizeMarketListing({ result: [{ id: 'listing_1234', item: {
      rarity: 'UNIQUE', name: 'From Nothing', baseType: 'Diamond', ilvl: 82, limit: 1,
      properties: [{ name: 'Radius', values: [['Small', 0]] }],
      explicitMods: ['Passives in Radius of Eldritch Battery can be Allocated without being connected to your tree'],
    } }] }, {
      realm: 'global', listingId: 'listing_1234',
      sourceUrl: 'https://www.pathofexile.com/trade2/search/poe2/Standard/query_5678',
    })

    expect(result.item.raw).toContain('Limited to: 1')
    expect(result.item.raw).toContain('Radius: Small')
  })

  it('persists the Find Better target slot on a market source', () => {
    const result = normalizeMarketListing({ result: [{ id: 'listing_1234', item: {
      rarity: 'RARE', name: 'Doom Shell', baseType: 'Expert Hexer Robe', explicitMods: [],
    } }] }, {
      realm: 'global', listingId: 'listing_1234', slotName: 'Body Armour',
      runeBehavior: 'remove', anointBehavior: 'keep',
      sourceUrl: 'https://www.pathofexile.com/trade2/search/poe2/Standard/query_5678',
    })

    expect(result.source).toMatchObject({ slotName: 'Body Armour', runeBehavior: 'remove', anointBehavior: 'keep' })
  })
})
