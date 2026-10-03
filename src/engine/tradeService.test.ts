import { describe, expect, it } from 'vitest'
import { buildTradeQuery, createPriceCheckDraft, OfficialTradeProvider } from '../../electron/tradeService'
import { OfficialTradeRequestError } from '../../electron/officialTradeRequestError'
import type { MarketViewManager } from '../../electron/marketView'
import type { TradeReferenceDataCache } from '../../electron/tradeService'
import type { LibraryItemSnapshot } from '@/types/market'

function item(lines: string[]): LibraryItemSnapshot {
  return {
    rarity: 'RARE', name: 'Doom Shell', baseType: 'Expert Hexer Robe',
    modifiers: lines.map((line, index) => ({
      id: `explicit-${index}`, displayOrder: index, group: 'explicit', sourceTags: ['explicit'],
      original: { locale: 'en', lines: [line], displayText: line },
      valueMode: /\d/.test(line) ? 'numeric' : 'presence',
      currentValues: [...line.matchAll(/[-+]?\d+(?:\.\d+)?/g)].map((match) => Number(match[0])),
      tierRanges: [], tradeResolutions: [],
    })),
  }
}

function withResolution(source: LibraryItemSnapshot, index: number, statId: string, realm: 'global' | 'cn' = 'global', valueMode: 'numeric' | 'presence' | 'fixed-option' = 'numeric'): LibraryItemSnapshot {
  const resolved = structuredClone(source)
  resolved.modifiers[index].tradeResolutions = [{
    realm, queryStatId: statId, candidateStatIds: [statId], source: 'explicit',
    valueMode, valueTransform: 'identity', resolvedBy: 'exact-text', status: 'resolved',
  }]
  return resolved
}

describe('trade query builder', () => {
  it('builds queries only from Xiletrade-resolved snapshots', () => {
    const resolved = withResolution(item(['+109 to maximum Life', 'Unknown modifier']), 0, 'explicit.stat_3299347043')
    const built = buildTradeQuery(resolved, 'global')
    expect(built).toMatchObject({ resolved: 1, unresolved: 1 })
    expect(built.query).toMatchObject({ query: { status: { option: 'securable' }, stats: [{ filters: [{ id: 'explicit.stat_3299347043', value: { min: 109 } }] }] } })
  })

  it('keeps fixed option IDs intact and does not submit a numeric range', () => {
    const resolved = withResolution(item(['Allocates Beef']), 0, 'enchant.stat_10|42', 'global', 'fixed-option')
    const built = buildTradeQuery(resolved, 'global')
    expect(built.query).toMatchObject({ query: { stats: [{ filters: [{ id: 'enchant.stat_10|42' }] }] } })
  })

  it('uses Tencent status and localized base type without rematching text', () => {
    const source = item(['+109 to maximum Life'])
    source.localized = { 'zh-CN': { name: '灾厄之壳', baseType: '专家咒术长袍' } }
    const resolved = withResolution(source, 0, 'explicit.stat_3299347043', 'cn')
    expect(buildTradeQuery(resolved, 'cn').query).toMatchObject({ query: {
      status: { option: 'securable' },
      stats: [{ filters: [{ id: 'explicit.stat_3299347043', value: { min: 109 } }] }],
    } })
    expect((buildTradeQuery(resolved, 'cn').query as { query: Record<string, unknown> }).query).not.toHaveProperty('type')
  })

  it('uses Xiletrade realm defaults when no listing status is supplied', () => {
    expect(buildTradeQuery(item([]), 'global').query).toMatchObject({ query: { status: { option: 'securable' } } })
    expect(buildTradeQuery(item([]), 'cn').query).toMatchObject({ query: { status: { option: 'securable' } } })
  })

  it('builds a PoB-style query from only the user-selected modifiers and ranges', () => {
    const source = item(['+109 to maximum Life', 'Unknown modifier'])
    source.tradeCategory = 'armour.chest'
    source.itemLevel = 82
    const resolved = withResolution(source, 0, 'explicit.stat_3299347043')
    const draft = createPriceCheckDraft(resolved, 'global')
    expect(draft.modifiers).toMatchObject([
      { id: 'explicit-0', searchable: true, currentValue: 109, sourceTags: ['explicit'] },
      { id: 'explicit-1', searchable: false },
    ])

    const built = buildTradeQuery(resolved, 'global', {
      listedStatus: 'available',
      useBaseType: false,
      itemLevelMin: 80,
      modifiers: [{ id: 'explicit-0', min: 100, max: 120 }],
    })

    expect(built).toMatchObject({ resolved: 1, unresolved: 0 })
    expect(built.query).toMatchObject({
      query: {
        status: { option: 'available' },
        stats: [{ filters: [{ id: 'explicit.stat_3299347043', value: { min: 100, max: 120 } }] }],
        filters: {
          type_filters: { filters: { category: { option: 'armour.chest' }, ilvl: { min: 80 } } },
        },
      },
    })
    expect((built.query as { query: Record<string, unknown> }).query).not.toHaveProperty('type')
  })

  it('maps Xiletrade item, equipment, state, and trade filters to Trade2 sections', () => {
    const source = item(['+109 to maximum Life'])
    source.tradeCategory = 'armour.chest'
    const resolved = withResolution(source, 0, 'explicit.stat_3299347043')
    const built = buildTradeQuery(resolved, 'global', {
      listedStatus: 'online',
      useBaseType: false,
      modifiers: [{ id: 'explicit-0' }],
      xiletrade: {
        rarity: 'rare',
        itemLevel: { min: 80, max: 86 },
        quality: { min: 20 },
        requiredLevel: { max: 70 },
        equipment: {
          armour: { min: 500 },
          energyShield: { min: 100, max: 300 },
          damagePerSecond: { min: 250 },
          runeSockets: { min: 2 },
        },
        misc: { corrupted: 'false', fractured: 'true' },
        trade: { price: { max: 10, currency: 'exalted' }, indexed: '3days' },
      },
    })
    expect(built.query).toMatchObject({ query: {
      filters: {
        type_filters: { disabled: false, filters: {
          category: { option: 'armour.chest' },
          rarity: { option: 'rare' },
          ilvl: { min: 80, max: 86 },
          quality: { min: 20 },
        } },
        req_filters: { filters: { lvl: { max: 70 } } },
        equipment_filters: { filters: { ar: { min: 500 }, es: { min: 100, max: 300 }, dps: { min: 250 }, rune_sockets: { min: 2 } } },
        misc_filters: { filters: { corrupted: { option: 'false' }, fractured_item: { option: 'true' } } },
        trade_filters: { disabled: false, filters: { price: { max: 10, option: 'exalted' }, indexed: { option: '3days' }, sale_type: { option: 'priced' } } },
      },
    } })
  })

  it('retains canonical item text for checker-side weapon metrics', () => {
    const source = item(['+109 to maximum Life'])
    source.rawText = ['Rarity: RARE', 'Doom Shell', 'Expert Hexer Robe', '+109 to maximum Life'].join('\n')
    expect(createPriceCheckDraft(source, 'global').rawText).toBe(source.rawText)
  })

  it('uses Xiletrade priced sale type by default', () => {
    const built = buildTradeQuery(item([]), 'global')
    expect(built.query).toMatchObject({ query: { filters: { trade_filters: { filters: { sale_type: { option: 'priced' } } } } } })
  })

  it('projects waystone filters into Xiletrade map filters', () => {
    const source = item([])
    source.baseType = 'Waystone (Tier 16)'
    source.tradeCategory = 'map.waystone'
    const built = buildTradeQuery(source, 'global', {
      listedStatus: 'online', useBaseType: true, modifiers: [],
      xiletrade: {
      itemLevel: { min: 16, max: 16 },
      map: {
          itemRarity: { min: 20 }, packSize: { min: 15 }, rareMonsters: { min: 20 },
          magicMonsters: { min: 10 }, bonus: { min: 100 }, revives: { min: 1 },
        },
      },
    })
    expect(built.query).toMatchObject({ query: {
      type: 'Waystone (Tier 16)',
        filters: {
          type_filters: { filters: { category: { option: 'map.waystone' } } },
          map_filters: { disabled: false, filters: {
          map_iir: { min: 20 }, map_packsize: { min: 15 }, map_rare_monsters: { min: 20 },
          map_magic_monsters: { min: 10 }, map_bonus: { min: 100 }, map_revives: { min: 1 },
        } },
      },
    } })
  })

  it('fixes unique searches to their name and base type', () => {
    const unique = item([])
    unique.rarity = 'UNIQUE'
    unique.name = 'Svalinn'
    unique.baseType = 'Runemastered Crucible Tower Shield'
    const built = buildTradeQuery(unique, 'global', {
      listedStatus: 'online', useBaseType: false, modifiers: [],
    })
    expect(built.query).toMatchObject({ query: {
      name: 'Svalinn', type: 'Runemastered Crucible Tower Shield', status: { option: 'online' }, stats: [],
    } })
  })

  it('retries a global unique search without an unknown item name', async () => {
    const submitted: unknown[] = []
    const manager = {
      search: async (_realm: string, _leagueId: string, query: unknown) => {
        submitted.push(query)
        if (submitted.length === 1) throw new OfficialTradeRequestError(400, 'Unknown item name')
        return { id: 'fallback-search', total: 3, result: [] }
      },
      rememberGeneratedSearch: () => undefined,
    } as unknown as MarketViewManager
    const cache = {
      get: async () => ({ realm: 'global' as const, fetchedAt: '2026-08-04T00:00:00.000Z', payloadHash: 'test-catalog', entries: [] }),
    } as unknown as TradeReferenceDataCache
    const unique = item([])
    unique.rarity = 'UNIQUE'
    unique.name = 'Legacy Unique Name'
    unique.baseType = 'Diamond'

    const result = await new OfficialTradeProvider(manager, cache, undefined, (_realm, source) => source).search(
      'global', 'Standard', unique,
      { listedStatus: 'securable', useBaseType: true, modifiers: [] },
    )

    expect(result.searchId).toBe('fallback-search')
    expect((submitted[0] as { query: Record<string, unknown> }).query.name).toBe('Legacy Unique Name')
    expect((submitted[1] as { query: Record<string, unknown> }).query).not.toHaveProperty('name')
  })

  it('keeps the lightweight fallback distinct from a price check', () => {
    const resolved = withResolution(item(['+109 to maximum Life']), 0, 'explicit.stat_3299347043')
    const built = buildTradeQuery(resolved, 'global', {
      listedStatus: 'online', useBaseType: false, modifiers: [{ id: 'explicit-0' }],
    }, 'find-better')
    expect(built.query).toMatchObject({ query: {
      stats: [{ type: 'weight', value: { min: 0 }, filters: [{ id: 'explicit.stat_3299347043', value: { weight: 1 } }] }],
    }, sort: { 'statgroup.0': 'desc' } })
    expect((built.query as { query: Record<string, unknown> }).query).not.toHaveProperty('name')
  })

  it('keeps Xiletrade identity in a weighted replacement search', () => {
    const unique = withResolution(item(['+109 to maximum Life']), 0, 'explicit.stat_3299347043')
    unique.rarity = 'UNIQUE'
    unique.name = 'Alpha\'s Howl'
    unique.baseType = 'Secutor Casque'
    unique.tradeCategory = 'armour.helmet'
    const built = buildTradeQuery(unique, 'global', {
      listedStatus: 'online', useBaseType: false, modifiers: [{ id: 'explicit-0' }],
    }, 'find-better')
    const query = (built.query as { query: Record<string, unknown> }).query
    expect(query).toMatchObject({
      name: 'Alpha\'s Howl', type: 'Secutor Casque',
      filters: { type_filters: { filters: { category: { option: 'armour.helmet' }, rarity: { option: 'unique' } } } },
      stats: [{ type: 'weight' }],
    })
  })

  it('follows Xiletrade automatic base-search routing by item flag', () => {
    const uniqueWeapon = item([])
    uniqueWeapon.rarity = 'UNIQUE'
    uniqueWeapon.name = 'Svalinn'
    uniqueWeapon.baseType = 'Runemastered Crucible Tower Shield'
    uniqueWeapon.tradeCategory = 'armour.shield'
    expect(buildTradeQuery(uniqueWeapon, 'global').query).toMatchObject({ query: {
      name: 'Svalinn', type: 'Runemastered Crucible Tower Shield',
      filters: { type_filters: { filters: { category: { option: 'armour.shield' }, rarity: { option: 'unique' } } } },
    } })

    const normalWeapon = item([])
    normalWeapon.rarity = 'NORMAL'
    normalWeapon.baseType = 'Expert Quarterstaff'
    normalWeapon.tradeCategory = 'weapon.warstaff'
    expect(buildTradeQuery(normalWeapon, 'global').query).toMatchObject({ query: {
      type: 'Expert Quarterstaff',
      filters: { type_filters: { filters: { category: { option: 'weapon.warstaff' }, rarity: { option: 'normal' } } } },
    } })

    const rareWeapon = item([])
    rareWeapon.rarity = 'RARE'
    rareWeapon.baseType = 'Expert Quarterstaff'
    rareWeapon.tradeCategory = 'weapon.warstaff'
    const rareQuery = (buildTradeQuery(rareWeapon, 'global').query as { query: Record<string, unknown> }).query
    expect(rareQuery).toMatchObject({
      type: 'Expert Quarterstaff',
      filters: { type_filters: { filters: { category: { option: 'weapon.warstaff' }, rarity: { option: 'rare' } } } },
    })

    const skillWeapon = item([])
    skillWeapon.rarity = 'RARE'
    skillWeapon.baseType = 'Expert Wand'
    skillWeapon.tradeCategory = 'weapon.wand'
    expect(buildTradeQuery(skillWeapon, 'global').query).toMatchObject({ query: { type: 'Expert Wand' } })

    const specialBase = item([])
    specialBase.rarity = 'RARE'
    specialBase.baseType = 'Stygian Vise'
    specialBase.tradeCategory = 'accessory.belt'
    expect(buildTradeQuery(specialBase, 'global').query).toMatchObject({ query: { type: 'Stygian Vise' } })

    const nexusGloves = item([])
    nexusGloves.rarity = 'RARE'
    nexusGloves.baseType = 'Nexus Gloves'
    nexusGloves.tradeCategory = 'armour.gloves'
    expect(buildTradeQuery(nexusGloves, 'global').query).toMatchObject({ query: { type: 'Nexus Gloves' } })

    const foilUnique = item([])
    foilUnique.rarity = 'UNIQUEFOIL'
    foilUnique.name = 'Foil Relic'
    foilUnique.baseType = 'Expert Quarterstaff'
    foilUnique.tradeCategory = 'weapon.warstaff'
    expect(buildTradeQuery(foilUnique, 'global').query).toMatchObject({ query: {
      name: 'Foil Relic', type: 'Expert Quarterstaff',
      filters: { type_filters: { filters: { rarity: { option: 'uniquefoil' } } } },
    } })
  })

  it('does not broaden Xiletrade base routing to unrelated item classes', () => {
    const rareCrossbow = item([])
    rareCrossbow.rarity = 'RARE'
    rareCrossbow.baseType = 'Expert Crossbow'
    rareCrossbow.tradeCategory = 'weapon.crossbow'
    const query = (buildTradeQuery(rareCrossbow, 'global').query as { query: Record<string, unknown> }).query
    expect(query).not.toHaveProperty('type')
    expect(query).toMatchObject({
      filters: { type_filters: { filters: {
        category: { option: 'weapon.crossbow' }, rarity: { option: 'rare' },
      } } },
    })

    const uncutGem = item([])
    uncutGem.rarity = 'NORMAL'
    uncutGem.itemClass = 'Uncut Gems'
    uncutGem.tradeCategory = ''
    uncutGem.baseType = 'Uncut Skill Gem'
    const uncutQuery = (buildTradeQuery(uncutGem, 'global', {
      listedStatus: 'online', useBaseType: false, itemLevelMin: 3, modifiers: [],
    }).query as { query: Record<string, unknown> }).query
    expect(uncutQuery).toHaveProperty('type', 'Uncut Skill Gem')
    expect(uncutQuery).not.toHaveProperty('filters.map_filters')
    expect(uncutQuery).not.toHaveProperty('filters.misc_filters.filters.gem_level')
    expect(uncutQuery).toMatchObject({ filters: { type_filters: { filters: { ilvl: { min: 3 } } } } })

    const charm = item([])
    charm.rarity = 'NORMAL'
    charm.itemClass = 'Charms'
    charm.tradeCategory = ''
    charm.baseType = 'Stellar Charm'
    const charmQuery = (buildTradeQuery(charm, 'global').query as { query: Record<string, unknown> }).query
    expect(charmQuery).not.toHaveProperty('filters.map_filters')
    expect(charmQuery).not.toHaveProperty('filters.misc_filters.filters.gem_level')
  })

  it('lets an explicit Any rarity override Xiletrade automatic rarity', () => {
    const source = item([])
    source.tradeCategory = 'armour.chest'
    const query = (buildTradeQuery(source, 'global', {
      listedStatus: 'online', useBaseType: false, modifiers: [],
      xiletrade: { rarity: 'any' },
    }).query as { query: Record<string, unknown> }).query
    expect(query).toMatchObject({ filters: { type_filters: { filters: { category: { option: 'armour.chest' } } } } })
    expect(query).not.toMatchObject({ filters: { type_filters: { filters: { rarity: expect.anything() } } } })
  })

  it('routes waystone and area levels like JsonDataTwoFactory', () => {
    const waystone = item([])
    waystone.rarity = 'NORMAL'
    waystone.baseType = 'Waystone (Tier 16)'
    waystone.tradeCategory = 'map.waystone'
    waystone.itemLevel = 16
    expect(buildTradeQuery(waystone, 'global', {
      listedStatus: 'online', useBaseType: false, itemLevelMin: 16, modifiers: [],
    }).query).toMatchObject({ query: {
      type: 'Waystone (Tier 16)',
      filters: { type_filters: { filters: { rarity: { option: 'nonunique' } } } },
    } })

    const logbook = item([])
    logbook.rarity = 'NORMAL'
    logbook.itemClass = 'Logbook'
    logbook.tradeCategory = ''
    logbook.itemLevel = 80
    const query = buildTradeQuery(logbook, 'global', {
      listedStatus: 'online', useBaseType: false, itemLevelMin: 80, modifiers: [],
    }).query
    expect(query).toMatchObject({ query: {
      filters: {
        type_filters: { filters: { rarity: { option: 'nonunique' } } },
        misc_filters: { filters: { area_level: { min: 80 } } },
      },
    } })

    const gem = item([])
    gem.rarity = 'NORMAL'
    gem.itemClass = 'Skill Gems'
    gem.tradeCategory = 'gem'
    gem.baseType = 'Spark'
    gem.itemLevel = 20
    expect(buildTradeQuery(gem, 'global', {
      listedStatus: 'online', useBaseType: false, itemLevelMin: 20, modifiers: [],
    }).query).toMatchObject({ query: {
      type: 'Spark',
      filters: {
        type_filters: { filters: { category: { option: 'gem' }, rarity: { option: 'normal' } } },
        misc_filters: { filters: { gem_level: { min: 20 } } },
      },
    } })
  })

  it('combines legacy item-level input with Xiletrade item-state filters', () => {
    const source = item(['+109 to maximum Life'])
    source.tradeCategory = 'armour.chest'
    const resolved = withResolution(source, 0, 'explicit.stat_3299347043')
    const built = buildTradeQuery(resolved, 'global', {
      listedStatus: 'online',
      useBaseType: false,
      itemLevelMin: 80,
      modifiers: [{ id: 'explicit-0' }],
      xiletrade: { misc: { corrupted: 'false' } },
    })
    expect(built.query).toMatchObject({ query: {
      filters: {
        type_filters: { filters: { ilvl: { min: 80 } } },
        misc_filters: { filters: { corrupted: { option: 'false' } } },
      },
    } })
  })

  it('replaces generated identity filters in a weighted query override with Xiletrade routing', async () => {
    const submitted: unknown[] = []
    const manager = {
      fetchStats: async () => ({ result: [{ entries: [] }] }),
      search: async (_realm: string, _leagueId: string, query: unknown) => {
        submitted.push(query)
        return {
          id: 'weighted-search',
          total: 21,
          result: Array.from({ length: 20 }, (_, index) => `candidate-${index}`),
        }
      },
      rememberGeneratedSearch: () => undefined,
    } as unknown as MarketViewManager
    const cache = {
      get: async () => ({
        realm: 'global' as const,
        fetchedAt: '2026-08-04T00:00:00.000Z',
        payloadHash: 'test-catalog',
        entries: [],
      }),
    } as unknown as TradeReferenceDataCache
    const provider = new OfficialTradeProvider(manager, cache, undefined, (_realm, source) => source)
    await provider.search(
      'global',
      'League',
      item([]),
      {
        listedStatus: 'online',
        useBaseType: false,
        modifiers: [],
        findBetter: {
          sortBy: 'weight',
          statWeights: [],
          includeCorrupted: true,
          includeMirrored: true,
          runeBehavior: 'copy-current',
          anointBehavior: 'copy-current',
        },
      },
      'find-better',
      {
        query: {
          query: {
            name: 'Alpha\'s Howl',
            type: 'Secutor Casque',
            status: { option: 'online' },
            stats: [{ type: 'weight', value: { min: 1 }, filters: [] }],
            filters: {
              type_filters: { filters: { category: { option: 'armour.helmet' }, rarity: { option: 'nonunique' }, ilvl: { min: 70 }, damage: { min: 999 } } },
              req_filters: { filters: { lvl: { max: 86 }, str: { min: 100 } } },
              equipment_filters: { filters: { rune_sockets: { min: 2 }, crit: { min: 10 } } },
              misc_filters: { filters: { stack_size: { min: 2 } } },
              trade_filters: { filters: { price: { max: 4 }, account: { input: 'seller' } } },
            },
          },
          sort: { 'statgroup.0': 'desc' },
        },
      },
    )
    const submittedRoot = (submitted[0] as { query: Record<string, unknown> }).query
    expect(submittedRoot).not.toHaveProperty('name')
    expect(submittedRoot).not.toHaveProperty('type')
    expect(submittedRoot).toMatchObject({
      filters: {
        type_filters: { filters: { rarity: { option: 'rare' } } },
        req_filters: { filters: { lvl: { max: 86 } } },
        equipment_filters: { filters: { rune_sockets: { min: 2 } } },
        trade_filters: { filters: { price: { max: 4 }, sale_type: { option: 'priced' } } },
      },
      stats: [{ type: 'weight' }],
    })
    expect(JSON.stringify(submittedRoot)).not.toMatch(/damage|str|crit|stack_size|account/)
  })

  it('matches PoB2 weighted threshold adjustment and bounded candidate batches', async () => {
    const searches: unknown[] = []
    const remembered: unknown[] = []
    const manager = {
      fetchStats: async () => ({ result: [{ entries: [] }] }),
      search: async (_realm: string, _leagueId: string, query: unknown) => {
        searches.push(query)
        if (searches.length === 1) {
          return { id: 'first-search', total: 10000, result: Array.from({ length: 30 }, (_, index) => `first-${index}`) }
        }
        return { id: 'final-search', total: 25, result: Array.from({ length: 25 }, (_, index) => `final-${index}`) }
      },
      fetchListings: async () => ({ result: [{ item: { pseudoMods: ['Sum: 100'] } }] }),
      rememberGeneratedSearch: (_realm: string, _leagueId: string, id: string, query: unknown) => remembered.push({ id, query }),
    } as unknown as MarketViewManager
    const cache = {
      get: async () => ({
        realm: 'global' as const,
        fetchedAt: '2026-08-04T00:00:00.000Z',
        payloadHash: 'test-catalog',
        entries: [],
      }),
    } as unknown as TradeReferenceDataCache
    const provider = new OfficialTradeProvider(manager, cache, undefined, (_realm, source) => source)
    const result = await provider.search(
      'global',
      'League',
      item(['+109 to maximum Life']),
      { listedStatus: 'online', useBaseType: false, modifiers: [] },
      'find-better',
      {
        query: {
          query: {
            status: { option: 'online' },
            stats: [{ type: 'weight', value: { min: 10 }, filters: [{ id: 'explicit.stat_life', value: { weight: 1 } }] }],
          },
          sort: { 'statgroup.0': 'desc' },
        },
        resolved: 1,
      },
    )

    expect(searches).toHaveLength(2)
    expect((searches[1] as { query: { stats: [{ value: { min: number } }] } }).query.stats[0].value.min).toBe(55)
    expect(result.searchId).toBe('final-search')
    expect(result.listingIds).toHaveLength(20)
    expect(remembered).toHaveLength(1)
  })

  it('uses the configured Fetch Pages limit for weighted candidates', async () => {
    const manager = {
      fetchStats: async () => ({ result: [{ entries: [] }] }),
      search: async () => ({
        id: 'fetch-pages-search',
        total: 45,
        result: Array.from({ length: 45 }, (_, index) => `candidate-${index}`),
      }),
      rememberGeneratedSearch: () => undefined,
    } as unknown as MarketViewManager
    const cache = {
      get: async () => ({
        realm: 'global' as const,
        fetchedAt: '2026-08-04T00:00:00.000Z',
        payloadHash: 'test-catalog',
        entries: [],
      }),
    } as unknown as TradeReferenceDataCache
    const result = await new OfficialTradeProvider(manager, cache, undefined, (_realm, source) => source).search(
      'global',
      'League',
      item([]),
      {
        listedStatus: 'online',
        useBaseType: false,
        modifiers: [],
        findBetter: {
          sortBy: 'weight',
          statWeights: [],
          fetchPages: 3,
          includeCorrupted: true,
          includeMirrored: true,
          runeBehavior: 'copy-current',
          anointBehavior: 'copy-current',
        },
      },
      'find-better',
      {
        query: {
          query: {
            status: { option: 'online' },
            stats: [{ type: 'weight', value: { min: 1 }, filters: [] }],
          },
          sort: { 'statgroup.0': 'desc' },
        },
      },
    )

    expect(result.listingIds).toHaveLength(30)
  })

  it('does not fall back to a type-only search when the official API rejects detailed stats', async () => {
    const calls: unknown[] = []
    const manager = {
      fetchStats: async () => ({ result: [{ entries: [{ id: 'explicit.stat_life', text: '# to maximum Life' }] }] }),
      search: async (_realm: string, _leagueId: string, query: unknown) => {
        calls.push(query)
        throw new OfficialTradeRequestError(400, 'invalid query')
      },
      rememberGeneratedSearch: (_realm: string, _leagueId: string, _searchId: string, query: unknown) => calls.push(query),
    } as unknown as MarketViewManager
    const cache = {
      get: async () => ({
        realm: 'global' as const,
        fetchedAt: '2026-08-04T00:00:00.000Z',
        payloadHash: 'test-catalog',
        entries: [{ id: 'explicit.stat_life', text: '# to maximum Life' }],
      }),
    } as unknown as TradeReferenceDataCache
    const search = new OfficialTradeProvider(
      manager,
      cache,
      undefined,
      (_realm, source) => withResolution(source, 0, 'explicit.stat_life'),
    ).search('global', 'Runes of Aldur', item(['+109 to maximum Life']))

    await expect(search).rejects.toThrow('invalid query')
    expect(calls).toHaveLength(1)
  })

})
