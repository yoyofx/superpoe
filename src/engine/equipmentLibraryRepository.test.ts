import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { EquipmentLibraryRepository, equipmentSourceKey, fingerprintLibraryItem, marketSourceKey } from '../../electron/equipmentLibraryRepository'
import type { EquipmentFavoriteSource, LibraryItemSnapshot, MarketFavoriteSource } from '@/types/market'

const temporaryDirectories: string[] = []

function repository(): EquipmentLibraryRepository {
  const directory = mkdtempSync(path.join(tmpdir(), 'superpoe-library-test-'))
  temporaryDirectories.push(directory)
  return new EquipmentLibraryRepository(path.join(directory, 'library.json'))
}

function item(): LibraryItemSnapshot {
  return {
    rarity: 'RARE', name: 'Doom Shell', baseType: "Expert Hexer's Robe", itemLevel: 80,
    modifiers: [{
      id: 'explicit-0', displayOrder: 0, group: 'explicit', sourceTags: ['explicit'],
      original: { locale: 'en', lines: ['+100 to maximum Life'], displayText: '+100 to maximum Life' },
      valueMode: 'numeric', currentValues: [100], tierRanges: [], tradeResolutions: [],
    }],
  }
}

function marketSource(price: number): MarketFavoriteSource {
  return {
    kind: 'market-favorite', sourceKey: marketSourceKey('global', 'listing-1'),
    capturedAt: '2026-07-29T00:00:00.000Z', updatedAt: '2026-07-29T00:00:00.000Z',
    realm: 'global', listingId: 'listing-1', sourceUrl: 'https://www.pathofexile.com/trade2/search/poe2/Test/query-1',
    state: 'available', price: { amount: price, currency: 'divine', display: `${price} divine` },
  }
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('EquipmentLibraryRepository', () => {
  it('keeps the fingerprint independent from mutable market data', () => {
    const snapshot = item()
    expect(fingerprintLibraryItem(snapshot)).toBe(fingerprintLibraryItem({ ...snapshot, iconUrl: 'https://example.test/new.png' }))
  })

  it('updates a source idempotently and merges another source by item fingerprint', () => {
    const store = repository()
    store.upsert(item(), marketSource(2))
    store.upsert(item(), marketSource(3))
    const equipment: EquipmentFavoriteSource = {
      kind: 'equipment-favorite', sourceKey: equipmentSourceKey('build-1', 'set-1', 'item-1'),
      capturedAt: '2026-07-29T00:00:00.000Z', updatedAt: '2026-07-29T00:00:00.000Z',
      buildId: 'build-1', equipmentSetId: 'set-1', itemId: 'item-1', slotName: 'Body Armour',
    }
    store.upsert(item(), equipment)

    expect(store.count()).toBe(1)
    expect(store.list()[0].sources).toHaveLength(2)
    expect(store.list()[0].sources.find((source) => source.kind === 'market-favorite')).toMatchObject({ price: { amount: 3 } })
  })

  it('removes only the selected source and preserves the shared entry', () => {
    const store = repository()
    store.upsert(item(), marketSource(2))
    const equipment: EquipmentFavoriteSource = {
      kind: 'equipment-favorite', sourceKey: equipmentSourceKey('build-1', 'set-1', 'item-1'),
      capturedAt: '2026-07-29T00:00:00.000Z', updatedAt: '2026-07-29T00:00:00.000Z',
      buildId: 'build-1', equipmentSetId: 'set-1', itemId: 'item-1',
    }
    store.upsert(item(), equipment)
    store.removeSource(marketSourceKey('global', 'listing-1'))

    expect(store.list()).toHaveLength(1)
    expect(store.list()[0].sources).toEqual([equipment])
  })

  it('stores nested folders and promotes children when deleting their parent folder', () => {
    const store = repository()
    const parent = store.createFolder({ scope: 'items', name: 'Upgrades' })
    const child = store.createFolder({ scope: 'items', name: 'Armour', parentId: parent.id })
    store.selectFolder('items', child.id)
    const entry = store.upsert(item(), marketSource(2))
    expect(entry.folderId).toBe(child.id)

    store.deleteFolder(parent.id)
    expect(store.list()[0]).toMatchObject({ id: entry.id, folderId: child.id })
    expect(store.sidebarSnapshot().folders).toEqual([expect.objectContaining({ id: child.id, parentId: undefined })])
  })

  it('moves direct contents to the parent when deleting a child folder', () => {
    const store = repository()
    const parent = store.createFolder({ scope: 'items', name: 'Upgrades' })
    const child = store.createFolder({ scope: 'items', name: 'Armour', parentId: parent.id })
    store.selectFolder('items', child.id)
    const entry = store.upsert(item(), marketSource(2))
    store.deleteFolder(child.id)
    expect(store.list()[0]).toMatchObject({ id: entry.id, folderId: parent.id })
    expect(store.sidebarSnapshot().selectedItemFolderId).toBe(parent.id)
  })

  it('moves folders and equipment between directory targets', () => {
    const store = repository()
    const source = store.createFolder({ scope: 'items', name: 'Source' })
    const nested = store.createFolder({ scope: 'items', name: 'Nested', parentId: source.id })
    const target = store.createFolder({ scope: 'items', name: 'Target' })
    store.selectFolder('items', source.id)
    const entry = store.upsert(item(), marketSource(2))

    store.updateMetadata({ id: entry.id, folderId: target.id })
    store.updateFolder({ id: nested.id, parentId: target.id })

    expect(store.list()[0]).toMatchObject({ id: entry.id, folderId: target.id })
    expect(store.sidebarSnapshot().folders).toContainEqual(expect.objectContaining({ id: nested.id, parentId: target.id }))
    expect(() => store.updateFolder({ id: target.id, parentId: nested.id })).toThrow('A folder cannot be moved into itself')
  })

  it('persists drag ordering between sibling folders', () => {
    const store = repository()
    const first = store.createFolder({ scope: 'items', name: 'First' })
    const second = store.createFolder({ scope: 'items', name: 'Second' })
    const third = store.createFolder({ scope: 'items', name: 'Third' })

    store.updateFolder({ id: third.id, parentId: null, beforeId: first.id })

    expect(store.sidebarSnapshot().folders.map((folder) => [folder.name, folder.sortOrder])).toEqual([
      ['Third', 0], ['First', 1], ['Second', 2],
    ])
  })

  it('stores saved searches in the selected search folder', () => {
    const store = repository()
    const folder = store.createFolder({ scope: 'searches', name: 'Jewels' })
    const search = store.saveSearch({
      realm: 'cn', name: '暴击珠宝', note: '升级用',
      url: 'https://poe.game.qq.com/trade2/search/poe2/Test/query-1',
    })
    expect(search.folderId).toBe(folder.id)
    expect(store.sidebarSnapshot().searches).toEqual([search])
    store.updateSearch({ id: search.id, note: '已复核' })
    expect(store.getSearch(search.id)?.note).toBe('已复核')
  })

  it('removes the entry when its final source is removed even when it was filed in a folder', () => {
    const store = repository()
    store.createFolder({ scope: 'items', name: 'Current target' })
    store.upsert(item(), marketSource(2))
    store.removeSource(marketSourceKey('global', 'listing-1'))
    expect(store.list()).toEqual([])
  })

  it('deletes multiple selected entries in one operation', () => {
    const store = repository()
    const first = store.upsert(item(), marketSource(2))
    const second = store.upsert(
      { ...item(), name: 'Doom Ward' },
      { ...marketSource(3), sourceKey: marketSourceKey('global', 'listing-2'), listingId: 'listing-2' },
    )

    expect(store.deleteMany([first.id, second.id, 'missing-entry'])).toBe(2)
    expect(store.list()).toEqual([])
    expect(store.deleteMany([])).toBe(0)
  })

  it('can enrich an item without changing its library sort timestamp', () => {
    const store = repository()
    const entry = store.upsert(item(), marketSource(2))
    const enriched = structuredClone(entry.item)
    enriched.modifiers[0].tradeResolutions = [{
      realm: 'global', queryStatId: 'explicit.stat_3299347043', baseStatId: 'explicit.stat_3299347043',
      candidateStatIds: ['explicit.stat_3299347043'], source: 'explicit', valueMode: 'numeric', valueTransform: 'identity',
      resolvedBy: 'exact-text', status: 'resolved',
    }]

    const updated = store.updateItem(entry.id, enriched, { touchUpdatedAt: false })

    expect(updated.updatedAt).toBe(entry.updatedAt)
    expect(updated.item.modifiers[0].tradeResolutions[0]?.queryStatId).toBe('explicit.stat_3299347043')
  })
})
