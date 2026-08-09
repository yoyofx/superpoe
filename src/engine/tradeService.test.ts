import { describe, expect, it } from 'vitest'
import { buildTradeQuery, createPriceCheckDraft, OfficialTradeProvider, TradeStatResolver } from '../../electron/tradeService'
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

const catalog = {
  realm: 'global' as const,
  fetchedAt: '2026-07-29T00:00:00.000Z', payloadHash: 'catalog-hash',
  entries: [
    { id: 'explicit.stat_3299347043', text: '# to maximum Life' },
    { id: 'enchant.stat_10', text: 'Allocates #', option: { options: [{ id: '42', text: 'Beef' }] } },
  ],
}

describe('shared trade resolver and query builder', () => {
  it('resolves numeric templates and builds queries only from resolved snapshots', () => {
    const resolved = new TradeStatResolver().resolve(item(['+109 to maximum Life', 'Unknown modifier']), catalog)
    expect(resolved.modifiers[0].tradeResolutions[0]).toMatchObject({
      queryStatId: 'explicit.stat_3299347043', status: 'resolved', catalogPayloadHash: 'catalog-hash',
    })
    expect(resolved.modifiers[1].tradeResolutions[0].status).toBe('unresolved')
    const built = buildTradeQuery(resolved, 'global')
    expect(built).toMatchObject({ resolved: 1, unresolved: 1 })
    expect(built.query).toMatchObject({ query: { status: { option: 'online' }, stats: [{ filters: [{ id: 'explicit.stat_3299347043', value: { min: 109 } }] }] } })
  })

  it('keeps fixed option IDs intact and does not submit a numeric range', () => {
    const resolved = new TradeStatResolver().resolve(item(['Allocates Beef']), catalog)
    expect(resolved.modifiers[0].tradeResolutions[0]).toMatchObject({
      queryStatId: 'enchant.stat_10|42', baseStatId: 'enchant.stat_10', optionId: '42', valueMode: 'fixed-option', status: 'resolved',
    })
    const built = buildTradeQuery(resolved, 'global')
    expect(built.query).toMatchObject({ query: { stats: [{ filters: [{ id: 'enchant.stat_10|42' }] }] } })
  })

  it('deduplicates repeated catalog IDs before deciding ambiguity', () => {
    const duplicateCatalog = { ...catalog, entries: [catalog.entries[0], catalog.entries[0]] }
    const resolved = new TradeStatResolver().resolve(item(['+109 to maximum Life']), duplicateCatalog)
    expect(resolved.modifiers[0].tradeResolutions[0].status).toBe('resolved')
  })

  it('matches positive numeric values against signed catalog placeholders', () => {
    const signedCatalog = {
      ...catalog,
      entries: [{ id: 'explicit.stat_spirit', text: '+# to Spirit' }],
    }
    const resolved = new TradeStatResolver().resolve(item(['+2 to Spirit']), signedCatalog)
    expect(resolved.modifiers[0].tradeResolutions[0]).toMatchObject({
      queryStatId: 'explicit.stat_spirit', status: 'resolved',
    })
  })

  it('uses the modifier group to disambiguate repeated official stat templates', () => {
    const scopedCatalog = {
      ...catalog,
      entries: [
        { id: 'explicit.stat_spirit', text: '# to Spirit' },
        { id: 'implicit.stat_spirit', text: '# to Spirit' },
      ],
    }
    const implicit = item(['+2 to Spirit'])
    implicit.modifiers[0].group = 'implicit'
    implicit.modifiers[0].sourceTags = []
    const resolved = new TradeStatResolver().resolve(implicit, scopedCatalog)
    expect(resolved.modifiers[0].tradeResolutions[0]).toMatchObject({
      queryStatId: 'implicit.stat_spirit', status: 'resolved', candidateStatIds: ['implicit.stat_spirit'],
    })
  })

  it('queries duplicate same-scope stat IDs as an OR-like count group', () => {
    const duplicateCatalog = {
      ...catalog,
      entries: [
        { id: 'explicit.stat_spirit_a', text: '# to Spirit' },
        { id: 'explicit.stat_spirit_b', text: '# to Spirit' },
      ],
    }
    const resolved = new TradeStatResolver().resolve(item(['+2 to Spirit']), duplicateCatalog)
    const built = buildTradeQuery(resolved, 'global')
    expect(built).toMatchObject({ resolved: 1, unresolved: 0 })
    expect(built.query).toMatchObject({ query: { stats: [{ type: 'count', value: { min: 1 }, filters: [{ id: 'explicit.stat_spirit_a' }, { id: 'explicit.stat_spirit_b' }] }] } })
  })

  it('uses the Tencent securable status instead of the empty online market scope', () => {
    const resolved = new TradeStatResolver().resolve(item(['+109 to maximum Life']), { ...catalog, realm: 'cn' })
    expect(buildTradeQuery(resolved, 'cn').query).toMatchObject({ query: { status: { option: 'securable' } } })
  })

  it('does not submit an untranslated English base type to Tencent', () => {
    const resolved = new TradeStatResolver().resolve(item(['+109 to maximum Life']), { ...catalog, realm: 'cn' })
    expect(buildTradeQuery(resolved, 'cn').query).not.toHaveProperty('query.type')
  })

  it('uses localized base types and modifier text for Tencent searches', () => {
    const localizedItem = item(['+109 to maximum Life'])
    localizedItem.localized = { 'zh-CN': { name: '灾厄之壳', baseType: '专家咒术长袍' } }
    localizedItem.modifiers[0].localized = {
      'zh-CN': { lines: ['+109 最大生命'], displayText: '+109 最大生命' },
    }
    const cnCatalog = {
      ...catalog,
      realm: 'cn' as const,
      entries: [{ id: 'explicit.stat_3299347043', text: '# 最大生命' }],
    }

    const resolved = new TradeStatResolver().resolve(localizedItem, cnCatalog)
    const built = buildTradeQuery(resolved, 'cn')

    expect(resolved.modifiers[0].tradeResolutions[0]).toMatchObject({
      queryStatId: 'explicit.stat_3299347043', status: 'resolved',
    })
    expect(built.query).toMatchObject({
      query: {
        status: { option: 'securable' },
        type: '专家咒术长袍',
        stats: [{ filters: [{ id: 'explicit.stat_3299347043', value: { min: 109 } }] }],
      },
    })
  })

  it('matches Chinese skill level stats when the catalog adds the Bonded presentation prefix', () => {
    const localizedItem = item(['+3 to Level of all Attack Skills'])
    localizedItem.modifiers[0].group = 'rune'
    localizedItem.modifiers[0].sourceTags = ['rune']
    localizedItem.modifiers[0].localized = {
      'zh-CN': { lines: ['所有攻击技能等级 +3'], displayText: '所有攻击技能等级 +3' },
    }
    const cnCatalog = {
      ...catalog,
      realm: 'cn' as const,
      entries: [{ id: 'rune.stat_attack_level', text: '羁绊： 所有攻击技能等级 #' }],
    }

    const resolved = new TradeStatResolver().resolve(localizedItem, cnCatalog)
    expect(resolved.modifiers[0].tradeResolutions[0]).toMatchObject({
      queryStatId: 'rune.stat_attack_level', status: 'resolved',
    })
  })

  it('matches Chinese granted skills despite the catalog and UI using different level order', () => {
    const localizedItem = item(['Grants Skill: Level 19 The Stars Answer'])
    localizedItem.modifiers[0].group = 'implicit'
    localizedItem.modifiers[0].sourceTags = ['implicit']
    localizedItem.modifiers[0].localized = {
      'zh-CN': { lines: ['获得技能: 19 级群星召唤'], displayText: '获得技能: 19 级群星召唤' },
    }
    const cnCatalog = {
      ...catalog,
      realm: 'cn' as const,
      entries: [{ id: 'skill.the_stars_answer', text: '获得技能: 等级 # 群星召唤', type: 'skill' }],
    }

    const resolved = new TradeStatResolver().resolve(localizedItem, cnCatalog)
    expect(resolved.modifiers[0].tradeResolutions[0]).toMatchObject({
      queryStatId: 'skill.the_stars_answer', status: 'resolved',
    })
  })

  it('builds a PoB-style query from only the user-selected modifiers and ranges', () => {
    const source = item(['+109 to maximum Life', 'Unknown modifier'])
    source.tradeCategory = 'armour.chest'
    source.itemLevel = 82
    const resolved = new TradeStatResolver().resolve(source, catalog)
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
          type_filters: { filters: { category: { option: 'armour.chest' } } },
          misc_filters: { filters: { ilvl: { min: 80 } } },
        },
      },
    })
    expect((built.query as { query: Record<string, unknown> }).query).not.toHaveProperty('type')
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

  it('falls back to a type-only search when the official API rejects detailed stats', async () => {
    const calls: unknown[] = []
    const manager = {
      fetchStats: async () => ({ result: [{ entries: [{ id: 'explicit.stat_life', text: '# to maximum Life' }] }] }),
      search: async (_realm: string, _leagueId: string, query: unknown) => {
        calls.push(query)
        if (calls.length === 1) throw new OfficialTradeRequestError(400, 'invalid query')
        return { id: 'fallback-search', total: 0 }
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
    const result = await new OfficialTradeProvider(manager, cache).search('global', 'Runes of Aldur', item(['+109 to maximum Life']))

    expect(result).toMatchObject({ searchId: 'fallback-search', resolvedModifierCount: 0, unresolvedModifierCount: 1 })
    expect(calls).toHaveLength(3)
    expect(calls[1]).toMatchObject({ query: { type: 'Expert Hexer Robe', stats: [] } })
    expect(calls[2]).toMatchObject({ query: { type: 'Expert Hexer Robe', stats: [] } })
  })
})
