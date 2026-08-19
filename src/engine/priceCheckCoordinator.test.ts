import { describe, expect, it, vi } from 'vitest'
import { PriceCheckCoordinator } from '../../electron/priceCheck/PriceCheckCoordinator'
import type { LibraryItemSnapshot, PriceCheckListingView, TradePriceCheckDraft } from '@/types/market'

const draft: TradePriceCheckDraft = {
  realm: 'global', rarity: 'RARE', name: 'Test Item', baseType: 'Quarterstaff', unique: false,
  modifiers: [{ id: 'explicit-0', group: 'explicit', lines: ['+10 to Strength'], searchable: true, valueMode: 'numeric', currentValue: 10 }],
}
const preparedItem: LibraryItemSnapshot = { rarity: 'RARE', name: 'Test Item', baseType: 'Quarterstaff', modifiers: [] }
const prepared = (value: TradePriceCheckDraft = draft) => ({ draft: value, item: preparedItem })

describe('PriceCheckCoordinator', () => {
  it('ignores stale preparation after a newer item opens', async () => {
    let finishFirst: ((value: ReturnType<typeof prepared>) => void) | undefined
    const prepare = vi.fn((_realm, source: { kind: string; raw?: string }) => source.raw === 'first'
      ? new Promise<ReturnType<typeof prepared>>((resolve) => { finishFirst = resolve })
      : Promise.resolve(prepared({ ...draft, name: 'Second' })))
    const coordinator = new PriceCheckCoordinator({
      context: () => ({ realm: 'global', language: 'en' }), prepare,
      leagues: async () => [{ id: 'league', text: 'League' }],
      search: vi.fn(), fetch: vi.fn(), visitHideout: vi.fn(), changed: vi.fn(),
    })
    const first = coordinator.open({ source: { kind: 'raw', raw: 'first' } })
    await coordinator.open({ source: { kind: 'raw', raw: 'second' } })
    finishFirst?.(prepared())
    await first
    expect(coordinator.snapshot().draft?.name).toBe('Second')
    expect(coordinator.snapshot().generation).toBe(2)
  })

  it('fetches official results in ten-item pages', async () => {
    const ids = Array.from({ length: 12 }, (_, index) => `listing-${index}`)
    const fetch = vi.fn(async (_realm, pageIds: string[]) => ({ result: pageIds.map((id) => ({
      id, item: { name: 'Item', baseType: 'Quarterstaff', explicitMods: ['+10 to Strength'] },
      listing: { price: { amount: 1, currency: 'divine' }, account: { name: 'Seller', online: {} } },
    })) }))
    const coordinator = new PriceCheckCoordinator({
      context: () => ({ realm: 'global', language: 'en' }), prepare: async () => prepared(),
      leagues: async () => [{ id: 'league', text: 'League' }], fetch, visitHideout: vi.fn(async () => ({ ok: true as const })), changed: vi.fn(),
      search: async () => ({ searchId: 'search', url: 'https://www.pathofexile.com/trade2/search/poe2/league/search', total: 12, resolvedModifierCount: 1, unresolvedModifierCount: 0, listingIds: ids }),
    })
    await coordinator.open({ source: { kind: 'raw', raw: 'item' } })
    await coordinator.search('league', { listedStatus: 'online', useBaseType: true, modifiers: [] })
    expect(coordinator.snapshot().listings).toHaveLength(10)
    expect(coordinator.snapshot().search?.pageCount).toBe(2)
    await coordinator.fetchPage(2)
    expect(coordinator.snapshot().listings.map((listing) => listing.id)).toEqual(['listing-10', 'listing-11'])
  })

  it('delegates PoB2 stat-value modes to local candidate ranking', async () => {
    const rankListings = vi.fn(async (listings: PriceCheckListingView[]) => listings
      .map((listing, index) => ({ ...listing, tradeScore: listings.length - index }))
      .reverse())
    const coordinator = new PriceCheckCoordinator({
      context: () => ({ realm: 'global', language: 'en' }), prepare: async () => prepared(),
      leagues: async () => [{ id: 'league', text: 'League' }], visitHideout: vi.fn(), changed: vi.fn(), rankListings,
      search: async () => ({ searchId: 'search', url: 'https://www.pathofexile.com/trade2/search/poe2/league/search', total: 2, resolvedModifierCount: 1, unresolvedModifierCount: 0, listingIds: ['first', 'second'] }),
      fetch: async () => ({ result: ['first', 'second'].map((id) => ({ id, item: { name: 'Item', baseType: 'Quarterstaff', explicitMods: ['+10 to Strength'] }, listing: { price: { amount: 1, currency: 'divine' }, account: { name: 'Seller', online: {} } } })) }),
    })
    await coordinator.open({
      source: { kind: 'raw', raw: 'item' }, mode: 'find-better', slotName: 'Weapon 1',
      buildContext: { xml: '<PathOfBuilding2/>', slotName: 'Weapon 1' },
    })
    await coordinator.search('league', {
      listedStatus: 'online', useBaseType: true, modifiers: [],
      findBetter: {
        sortBy: 'stat-value', statWeights: [{ stat: 'FullDPS', label: 'Full DPS', weightMult: 1 }],
        includeCorrupted: true, includeMirrored: false, runeBehavior: 'copy-current', anointBehavior: 'copy-current',
      },
    })
    expect(rankListings).toHaveBeenCalledOnce()
    expect(rankListings.mock.calls[0]?.[0][0].raw).toContain('Rarity:')
    expect(coordinator.snapshot().listings.map((listing) => listing.id)).toEqual(['second', 'first'])
  })

  it('keeps localized capture diagnostics while allowing recognized modifiers to load', async () => {
    const coordinator = new PriceCheckCoordinator({
      context: () => ({ realm: 'global', language: 'zh-rCN' }), prepare: async () => prepared(),
      leagues: async () => [{ id: 'league', text: 'League' }], search: vi.fn(), fetch: vi.fn(), visitHideout: vi.fn(), changed: vi.fn(),
    })
    await coordinator.open({
      source: { kind: 'raw', raw: 'item' },
      captureWarnings: ['效果期间，每秒回复符文结界上限的 3.9 (2.5-5.0)%'],
    })
    expect(coordinator.snapshot().phase).toBe('configuring')
    expect(coordinator.snapshot().captureWarnings).toEqual(['效果期间，每秒回复符文结界上限的 3.9 (2.5-5.0)%'])
  })

  it('recovers placeholder listing descriptions from official stat hashes', async () => {
    const coordinator = new PriceCheckCoordinator({
      context: () => ({ realm: 'cn', language: 'zh-rCN' }), prepare: async () => prepared(),
      leagues: async () => [{ id: 'league', text: 'League' }], visitHideout: vi.fn(), changed: vi.fn(),
      search: async () => ({ searchId: 'search', url: 'https://poe.game.qq.com/trade2/search/poe2/league/search', total: 1, resolvedModifierCount: 1, unresolvedModifierCount: 0, listingIds: ['listing'] }),
      fetch: async () => ({ result: [{ id: 'listing', item: {
        name: 'Mageblood', baseType: 'Utility Belt', explicitMods: ['?????? (??????-??????) 继承'],
        extended: { hashes: { explicit: [['explicit.stat_264262054|4', [0]]] } },
      }, listing: { price: { amount: 1, currency: 'divine' }, account: { name: 'Seller', online: {} } } }] }),
      resolveListingStatText: async (_realm, id) => id === 'explicit.stat_264262054|4'
        ? { displayText: '钻石 继承', canonicalText: 'Legacy of Diamond' }
        : undefined,
    })
    await coordinator.open({ source: { kind: 'raw', raw: 'item' } })
    await coordinator.search('league', { listedStatus: 'securable', useBaseType: true, modifiers: [] })
    expect(coordinator.snapshot().listings[0].item.modifiers[0].text).toBe('Legacy of Diamond')
  })

  it('fills numeric values into canonical catalog templates for translated detail views', async () => {
    const coordinator = new PriceCheckCoordinator({
      context: () => ({ realm: 'cn', language: 'zh-rTW' }), prepare: async () => prepared(),
      leagues: async () => [{ id: 'league', text: 'League' }], visitHideout: vi.fn(), changed: vi.fn(),
      search: async () => ({ searchId: 'search', url: 'https://poe.game.qq.com/trade2/search/poe2/league/search', total: 1, resolvedModifierCount: 1, unresolvedModifierCount: 0, listingIds: ['listing'] }),
      fetch: async () => ({ result: [{ id: 'listing', item: {
        name: 'Mageblood', baseType: 'Utility Belt', explicitMods: ['+109 最大生命'],
        extended: { hashes: { explicit: [['explicit.stat_life', [0]]] } },
      }, listing: { price: { amount: 1, currency: 'divine' }, account: { name: 'Seller', online: {} } } }] }),
      resolveListingStatText: async () => ({ displayText: '+109 最大生命', canonicalText: '+# to maximum Life' }),
    })
    await coordinator.open({ source: { kind: 'raw', raw: 'item' } })
    await coordinator.search('league', { listedStatus: 'securable', useBaseType: true, modifiers: [] })
    expect(coordinator.snapshot().listings[0].item.modifiers[0].text).toBe('+109 to maximum Life')
  })

  it('does not overwrite valid official listing text with a duplicate stat-ID template', async () => {
    const resolveListingStatText = vi.fn(async () => ({
      displayText: '地图内的裂隙生成的魔法怪物数量提高 #%',
      canonicalText: 'Breaches in Map spawn #% increased Magic Monsters',
    }))
    const coordinator = new PriceCheckCoordinator({
      context: () => ({ realm: 'cn', language: 'zh-rCN' }), prepare: async () => prepared(),
      leagues: async () => [{ id: 'league', text: 'League' }], visitHideout: vi.fn(), changed: vi.fn(),
      search: async () => ({ searchId: 'search', url: 'https://poe.game.qq.com/trade2/search/poe2/league/search', total: 1, resolvedModifierCount: 1, unresolvedModifierCount: 0, listingIds: ['listing'] }),
      fetch: async () => ({ result: [{ id: 'listing', item: {
        name: 'Test', baseType: 'Test Base', explicitMods: ['区域内的裂隙生成的魔法怪物数量提高 20%'],
        extended: { hashes: { explicit: [['explicit.stat_1090596078', [0]]] } },
      }, listing: { price: { amount: 1, currency: 'divine' }, account: { name: 'Seller', online: {} } } }] }),
      resolveListingStatText,
    })
    await coordinator.open({ source: { kind: 'raw', raw: 'item' } })
    await coordinator.search('league', { listedStatus: 'securable', useBaseType: true, modifiers: [] })

    const modifier = coordinator.snapshot().listings[0].item.modifiers[0]
    expect(modifier.text).toBe('区域内的裂隙生成的魔法怪物数量提高 20%')
    expect(modifier.localized?.['zh-CN']).toBe('区域内的裂隙生成的魔法怪物数量提高 20%')
    expect(modifier.tradeStatIds).toEqual(['explicit.stat_1090596078'])
    expect(resolveListingStatText).toHaveBeenCalledOnce()
  })

  it('keeps a Tencent object modifier direct hash in the detail snapshot', async () => {
    const coordinator = new PriceCheckCoordinator({
      context: () => ({ realm: 'cn', language: 'zh-rCN' }), prepare: async () => prepared(),
      leagues: async () => [{ id: 'league', text: 'League' }], visitHideout: vi.fn(), changed: vi.fn(),
      search: async () => ({ searchId: 'search', url: 'https://poe.game.qq.com/trade2/search/poe2/league/search', total: 1, resolvedModifierCount: 1, unresolvedModifierCount: 0, listingIds: ['listing'] }),
      fetch: async () => ({ result: [{ id: 'listing', item: {
        name: 'Test', baseType: 'Test Base', explicitMods: [{ description: '+128 [Armour|护甲]', hash: 'stat.explicit.stat_809229260' }],
      }, listing: { price: { amount: 1, currency: 'divine' }, account: { name: 'Seller', online: {} } } }] }),
    })
    await coordinator.open({ source: { kind: 'raw', raw: 'item' } })
    await coordinator.search('league', { listedStatus: 'securable', useBaseType: true, modifiers: [] })

    expect(coordinator.snapshot().listings[0].item.modifiers[0]).toMatchObject({
      text: '+128 [Armour|护甲]', tradeStatIds: ['explicit.stat_809229260'],
    })
  })
})
