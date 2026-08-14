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
    expect(built.query).toMatchObject({ query: { status: { option: 'online' }, stats: [{ filters: [{ id: 'explicit.stat_3299347043', value: { min: 109 } }] }] } })
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
      status: { option: 'securable' }, type: '专家咒术长袍',
      stats: [{ filters: [{ id: 'explicit.stat_3299347043', value: { min: 109 } }] }],
    } })
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
    const result = await new OfficialTradeProvider(
      manager,
      cache,
      undefined,
      (_realm, source) => withResolution(source, 0, 'explicit.stat_life'),
    ).search('global', 'Runes of Aldur', item(['+109 to maximum Life']))

    expect(result).toMatchObject({ searchId: 'fallback-search', resolvedModifierCount: 0, unresolvedModifierCount: 1 })
    expect(calls).toHaveLength(3)
    expect(calls[1]).toMatchObject({ query: { type: 'Expert Hexer Robe', stats: [] } })
    expect(calls[2]).toMatchObject({ query: { type: 'Expert Hexer Robe', stats: [] } })
  })
})
