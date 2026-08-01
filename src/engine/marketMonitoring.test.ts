import { afterEach, describe, expect, it, vi } from 'vitest'
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { EquipmentLibraryRepository } from '../../electron/equipmentLibraryRepository'
import { MarketMonitoringCoordinator } from '../../electron/marketMonitoring'
import type { MarketMonitoringSnapshot, MarketOpportunity } from '@/types/market'
import type { MarketViewManager } from '../../electron/marketView'

const temporaryDirectories: string[] = []

function setup() {
  const directory = mkdtempSync(path.join(tmpdir(), 'superpoe-monitor-test-'))
  temporaryDirectories.push(directory)
  const library = new EquipmentLibraryRepository(path.join(directory, 'library.json'))
  const search = library.saveSearch({
    realm: 'global', leagueId: 'Test', searchCode: 'query-1', captureSource: 'code-only',
    canonicalUrl: 'https://www.pathofexile.com/trade2/search/poe2/Test/query-1', name: 'Life amulet',
  })
  const syncCalls: unknown[][] = []
  const manager = {
    ensureMonitoringView: vi.fn(),
    sendMonitorSync: vi.fn((_realm: string, configs: unknown[]) => syncCalls.push(configs)),
    fetchListings: vi.fn(async (_realm: string, listingIds: string[]) => ({
      result: listingIds.map((id) => ({
        id,
        item: { name: 'Doom Beads', baseType: 'Gold Amulet', rarity: 'Rare', explicitMods: ['+100 to maximum Life'] },
        listing: { price: { amount: 5, currency: 'exalted' } },
      })),
    })),
    fetchLiveResult: vi.fn(async () => ({
      result: [{ id: 'live-listing', item: { name: 'Live Beads', baseType: 'Azure Amulet', rarity: 'Rare' }, listing: { price: { amount: 2, currency: 'exalted' } } }],
    })),
    fetchListing: vi.fn(async () => ({ result: [] })),
    visitHideout: vi.fn(async () => ({ ok: true })),
  } as unknown as MarketViewManager
  const snapshots: MarketMonitoringSnapshot[] = []
  const actionable: MarketOpportunity[][] = []
  const coordinator = new MarketMonitoringCoordinator(manager, library, path.join(directory, 'opportunities.json'), {
    changed: (snapshot) => snapshots.push(snapshot),
    actionable: (opportunities) => actionable.push(opportunities),
  })
  return { library, search, manager, syncCalls, coordinator, snapshots, actionable, directory }
}

afterEach(() => {
  vi.useRealTimers()
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('MarketMonitoringCoordinator', () => {
  it('arms validated targets and suppresses duplicate live listing IDs', async () => {
    vi.useFakeTimers()
    const { coordinator, search, manager, actionable } = setup()
    coordinator.start()
    coordinator.setTarget(search.id, 'armed', 'high')
    coordinator.handleLiveResult('global', { searchId: search.id, listingIds: ['listing-1', 'listing-1'] })
    coordinator.handleLiveResult('global', { searchId: search.id, listingIds: ['listing-1'] })
    await vi.advanceTimersByTimeAsync(300)

    expect(manager.fetchListings).toHaveBeenCalledTimes(1)
    expect(actionable).toHaveLength(1)
    expect(coordinator.snapshot().opportunities).toEqual([
      expect.objectContaining({ listingId: 'listing-1', status: 'actionable', batchId: expect.any(String), item: expect.objectContaining({ price: '5 exalted', modifiers: [expect.objectContaining({ original: expect.objectContaining({ displayText: '+100 to maximum Life' }) })] }) }),
    ])
    expect(coordinator.snapshot().batches).toEqual([expect.objectContaining({ targetId: search.id, opportunityIds: [expect.any(String)] })])
    coordinator.dispose()
  })

  it('stops connections when globally paused and restores persisted history', async () => {
    vi.useFakeTimers()
    const { coordinator, search, syncCalls, directory, library, manager } = setup()
    coordinator.start()
    coordinator.setTarget(search.id, 'armed')
    coordinator.handleLiveResult('global', { searchId: search.id, listingIds: ['listing-2'] })
    await vi.advanceTimersByTimeAsync(300)
    coordinator.setGlobalPaused(true)
    expect(syncCalls.some((configs) => configs.length === 0)).toBe(true)
    coordinator.dispose()

    const restored = new MarketMonitoringCoordinator(manager, library, path.join(directory, 'opportunities.json'), {
      changed: () => {}, actionable: () => {},
    })
    expect(restored.snapshot().opportunities).toEqual([expect.objectContaining({ listingId: 'listing-2', status: 'actionable' })])
    restored.dispose()
  })

  it('redeems signed CN live result tokens before creating opportunities', async () => {
    vi.useFakeTimers()
    const { coordinator, search, manager } = setup()
    coordinator.start()
    coordinator.setTarget(search.id, 'armed')
    coordinator.handleLiveResult('global', { searchId: search.id, listingIds: [], resultTokens: ['header.payload.signature'] })
    await vi.advanceTimersByTimeAsync(300)

    expect(manager.fetchLiveResult).toHaveBeenCalledTimes(1)
    expect(coordinator.snapshot().opportunities).toEqual([
      expect.objectContaining({ listingId: 'live-listing', status: 'actionable', item: expect.objectContaining({ name: 'Live Beads' }) }),
    ])
    coordinator.dispose()
  })

  it('round-robins actionable opportunities across targets and skips duplicate target matches together', async () => {
    vi.useFakeTimers()
    const { coordinator, search, library, actionable } = setup()
    const second = library.saveSearch({
      realm: 'global', leagueId: 'Test', searchCode: 'query-2', captureSource: 'code-only',
      canonicalUrl: 'https://www.pathofexile.com/trade2/search/poe2/Test/query-2', name: 'Second target',
    })
    coordinator.start()
    coordinator.setTarget(search.id, 'armed', 'high')
    coordinator.setTarget(second.id, 'armed', 'normal')
    coordinator.handleLiveResult('global', { searchId: search.id, listingIds: ['shared', 'first-only'] })
    coordinator.handleLiveResult('global', { searchId: second.id, listingIds: ['shared', 'second-only'] })
    await vi.advanceTimersByTimeAsync(300)

    const lastBatch = actionable[actionable.length - 1]
    expect(lastBatch.map((item) => item.searchId)).toEqual([search.id, second.id, search.id, second.id])
    const shared = coordinator.snapshot().opportunities.filter((item) => item.listingId === 'shared')
    coordinator.skipOpportunity(shared[0].id)
    expect(coordinator.snapshot().opportunities.filter((item) => item.listingId === 'shared').every((item) => item.status === 'skipped')).toBe(true)
    coordinator.dispose()
  })

  it('recovers opportunity history from the atomic backup when the primary file is damaged', () => {
    const { coordinator, directory, library, manager } = setup()
    const filePath = path.join(directory, 'opportunities.json')
    coordinator.updateSettings({ soundVolume: 0.35 })
    coordinator.dispose()
    copyFileSync(filePath, `${filePath}.backup.json`)
    writeFileSync(filePath, '{damaged')

    const restored = new MarketMonitoringCoordinator(manager, library, filePath, { changed: () => {}, actionable: () => {} })
    expect(restored.snapshot().settings.soundVolume).toBe(0.35)
    restored.dispose()
  })

  it('keeps purchase targets independent when their saved search is edited or deleted', () => {
    const { coordinator, search, library } = setup()
    const target = coordinator.createTarget(search.id, 'high')
    library.updateSearch({ id: search.id, name: 'Edited saved search' })
    expect(coordinator.snapshot().purchaseTargets[0].sourceSearchChanged).toBe(true)
    expect(coordinator.refreshTargetFromSource(target.id).name).toBe('Edited saved search')
    library.deleteSearch(search.id)

    expect(coordinator.snapshot().purchaseTargets).toEqual([
      expect.objectContaining({ id: target.id, name: 'Edited saved search', priority: 'high', search: expect.objectContaining({ searchCode: 'query-1' }) }),
    ])
    expect(coordinator.deleteTarget(target.id)).toBe(true)
    expect(coordinator.snapshot().purchaseTargets).toEqual([])
    coordinator.dispose()
  })

  it('limits active purchase targets to five', () => {
    const { coordinator, search, library } = setup()
    coordinator.createTarget(search.id)
    for (let index = 2; index <= 6; index += 1) {
      const saved = library.saveSearch({
        realm: 'global', leagueId: 'Test', searchCode: `query-${index}`, captureSource: 'code-only',
        canonicalUrl: `https://www.pathofexile.com/trade2/search/poe2/Test/query-${index}`, name: `Target ${index}`,
      })
      if (index <= 5) coordinator.createTarget(saved.id)
      else expect(() => coordinator.createTarget(saved.id)).toThrow('At most 5 purchase targets')
    }
    expect(coordinator.snapshot().purchaseTargets.filter((target) => target.status === 'armed')).toHaveLength(5)
    coordinator.dispose()
  })
})
