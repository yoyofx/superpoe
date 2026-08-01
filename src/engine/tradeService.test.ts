import { describe, expect, it } from 'vitest'
import { buildTradeQuery, TradeStatResolver } from '../../electron/tradeService'
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

  it('uses the Tencent securable status instead of the empty online market scope', () => {
    const resolved = new TradeStatResolver().resolve(item(['+109 to maximum Life']), { ...catalog, realm: 'cn' })
    expect(buildTradeQuery(resolved, 'cn').query).toMatchObject({ query: { status: { option: 'securable' } } })
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
})
