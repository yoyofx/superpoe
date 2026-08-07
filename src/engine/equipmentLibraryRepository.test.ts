import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { EquipmentLibraryRepository, equipmentSourceKey, fingerprintLibraryItem, marketSourceKey } from '../../electron/equipmentLibraryRepository'
import type { EquipmentFavoriteSource, MarketFavoriteSource } from '@/types/market'
import type { NormalizedPobItem } from '../../electron/pobItemBridge'

const temporaryDirectories: string[] = []

function repository(): EquipmentLibraryRepository {
  const directory = mkdtempSync(path.join(tmpdir(), 'superpoe-library-test-'))
  temporaryDirectories.push(directory)
  return new EquipmentLibraryRepository(path.join(directory, 'library.json'))
}

function item(name = 'Doom Shell'): NormalizedPobItem {
  const raw = `Rarity: RARE\n${name}\nExpert Hexer's Robe\nItem Level: 80\nImplicits: 0\n+100 to maximum Life`
  return {
    item: { format: 'pob2-item', raw },
    view: {
      rarity: 'RARE', name, baseType: "Expert Hexer's Robe", itemLevel: 80,
      modifiers: [{ id: 'explicit-0', displayOrder: 0, group: 'explicit', sourceTags: ['explicit'], text: '+100 to maximum Life', tradeStatIds: [] }],
    },
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
    expect(fingerprintLibraryItem(snapshot.item)).toBe(fingerprintLibraryItem(snapshot.item))
  })

  it('searches localized item, base, and modifier text', () => {
    const store = repository()
    const snapshot = item()
    snapshot.view.localized = { 'zh-CN': { name: '灾厄外壳', baseType: '专家六翼战袍' } }
    snapshot.view.modifiers[0].localized = { 'zh-CN': '+100 最大生命' }
    store.upsert(snapshot, marketSource(2))

    expect(store.list({ query: '灾厄外壳' })).toHaveLength(1)
    expect(store.list({ query: '专家六翼' })).toHaveLength(1)
    expect(store.list({ query: '最大生命' })).toHaveLength(1)
  })

  it('updates a source idempotently without merging a different collection record by fingerprint', () => {
    const store = repository()
    store.upsert(item(), marketSource(2))
    store.upsert(item(), marketSource(3))
    const equipment: EquipmentFavoriteSource = {
      kind: 'equipment-favorite', sourceKey: equipmentSourceKey('build-1', 'set-1', 'item-1'),
      capturedAt: '2026-07-29T00:00:00.000Z', updatedAt: '2026-07-29T00:00:00.000Z',
      buildId: 'build-1', equipmentSetId: 'set-1', itemId: 'item-1', slotName: 'Body Armour',
    }
    store.upsert(item(), equipment)

    expect(store.count()).toBe(2)
    expect(store.list({ collectionRoot: 'market' })[0].sources).toHaveLength(1)
    expect(store.list({ collectionRoot: 'market' })[0].sources[0]).toMatchObject({ price: { amount: 3 } })
    expect(store.list({ collectionRoot: 'build' })[0].sources[0]).toMatchObject({ kind: 'equipment-favorite' })
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
    const parent = store.createFolder({ scope: 'items', collectionRoot: 'market', name: 'Upgrades' })
    const child = store.createFolder({ scope: 'items', collectionRoot: 'market', name: 'Armour', parentId: parent.id })
    const entry = store.upsert(item(), marketSource(2), { folderId: child.id })
    expect(entry.folderId).toBe(child.id)

    store.deleteFolder(parent.id)
    expect(store.list()[0]).toMatchObject({ id: entry.id, folderId: child.id })
    expect(store.sidebarSnapshot().folders).toEqual([expect.objectContaining({ id: child.id, parentId: undefined })])
  })

  it('moves direct contents to the parent when deleting a child folder', () => {
    const store = repository()
    const parent = store.createFolder({ scope: 'items', collectionRoot: 'market', name: 'Upgrades' })
    const child = store.createFolder({ scope: 'items', collectionRoot: 'market', name: 'Armour', parentId: parent.id })
    const entry = store.upsert(item(), marketSource(2), { folderId: child.id })
    store.deleteFolder(child.id)
    expect(store.list()[0]).toMatchObject({ id: entry.id, folderId: parent.id })
    expect(store.list()[0].folderId).toBe(parent.id)
  })

  it('moves folders and equipment between directory targets', () => {
    const store = repository()
    const source = store.createFolder({ scope: 'items', collectionRoot: 'market', name: 'Source' })
    const nested = store.createFolder({ scope: 'items', collectionRoot: 'market', name: 'Nested', parentId: source.id })
    const target = store.createFolder({ scope: 'items', collectionRoot: 'market', name: 'Target' })
    const entry = store.upsert(item(), marketSource(2), { folderId: source.id })

    store.updateMetadata({ id: entry.id, folderId: target.id })
    store.updateFolder({ id: nested.id, parentId: target.id })

    expect(store.list()[0]).toMatchObject({ id: entry.id, folderId: target.id })
    expect(store.sidebarSnapshot().folders).toContainEqual(expect.objectContaining({ id: nested.id, parentId: target.id }))
    expect(() => store.updateFolder({ id: target.id, parentId: nested.id })).toThrow('A folder cannot be moved into itself')
  })

  it('rejects moving equipment or folders across fixed collection roots', () => {
    const store = repository()
    const marketFolder = store.createFolder({ scope: 'items', collectionRoot: 'market', name: 'Market' })
    const customFolder = store.createFolder({ scope: 'items', collectionRoot: 'custom', name: 'Custom' })
    const entry = store.upsert(item(), marketSource(2), { folderId: marketFolder.id })

    expect(() => store.updateMetadata({ id: entry.id, folderId: customFolder.id })).toThrow('Equipment library folder not found')
    expect(() => store.updateFolder({ id: marketFolder.id, parentId: customFolder.id })).toThrow('Equipment library folder not found')
  })

  it('persists drag ordering between sibling folders', () => {
    const store = repository()
    const first = store.createFolder({ scope: 'items', collectionRoot: 'market', name: 'First' })
    const second = store.createFolder({ scope: 'items', collectionRoot: 'market', name: 'Second' })
    const third = store.createFolder({ scope: 'items', collectionRoot: 'market', name: 'Third' })

    store.updateFolder({ id: third.id, parentId: null, beforeId: first.id })

    expect(store.sidebarSnapshot().folders.map((folder) => [folder.name, folder.sortOrder])).toEqual([
      ['Third', 0], ['First', 1], ['Second', 2],
    ])
  })

  it('stores saved searches in the selected search folder', () => {
    const store = repository()
    const folder = store.createFolder({ scope: 'searches', name: 'Jewels' })
    const search = store.saveSearch({
      realm: 'cn', leagueId: 'Test', searchCode: 'query-1', captureSource: 'code-only',
      canonicalUrl: 'https://poe.game.qq.com/trade2/search/poe2/Test/query-1',
      name: '暴击珠宝', note: '升级用',
    })
    expect(search.folderId).toBe(folder.id)
    expect(store.sidebarSnapshot().searches).toEqual([search])
    store.updateSearch({ id: search.id, note: '已复核' })
    expect(store.getSearch(search.id)?.note).toBe('已复核')
  })

  it('deduplicates official references and persists search ordering', () => {
    const store = repository()
    const first = store.saveSearch({
      realm: 'global', leagueId: 'Rise of the Abyssal', searchCode: 'abc_123', captureSource: 'code-only',
      canonicalUrl: 'https://www.pathofexile.com/trade2/search/poe2/Rise%20of%20the%20Abyssal/abc_123', name: 'First',
    })
    const duplicate = store.saveSearch({
      realm: 'global', leagueId: 'Rise of the Abyssal', searchCode: 'abc_123', captureSource: 'code-only',
      canonicalUrl: 'https://www.pathofexile.com/trade2/search/poe2/Rise%20of%20the%20Abyssal/abc_123', name: 'Duplicate',
    })
    const second = store.saveSearch({
      realm: 'global', leagueId: 'Rise of the Abyssal', searchCode: 'def-456', captureSource: 'code-only',
      canonicalUrl: 'https://www.pathofexile.com/trade2/search/poe2/Rise%20of%20the%20Abyssal/def-456', name: 'Second',
    })

    expect(duplicate.id).toBe(first.id)
    expect(store.sidebarSnapshot().searches).toHaveLength(2)
    store.updateSearch({ id: second.id, beforeId: first.id })
    expect(store.sidebarSnapshot().searches.map((search) => [search.name, search.sortOrder])).toEqual([
      ['Second', 0], ['First', 1],
    ])
  })

  it('migrates legacy URL bookmarks without deleting invalid user records', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'superpoe-library-test-'))
    temporaryDirectories.push(directory)
    const filePath = path.join(directory, 'library.json')
    writeFileSync(filePath, JSON.stringify({
      schemaVersion: 2,
      entries: [],
      searches: [
        { id: 'valid', realm: 'cn', name: 'Valid', url: 'https://poe.game.qq.com/trade2/search/poe2/Test/abc123', createdAt: '2026-01-01', updatedAt: '2026-01-01' },
        { id: 'invalid', realm: 'cn', name: 'Homepage', url: 'https://poe.game.qq.com/trade2', createdAt: '2026-01-02', updatedAt: '2026-01-02' },
      ],
      updatedAt: '2026-01-02',
    }))

    const searches = new EquipmentLibraryRepository(filePath).sidebarSnapshot().searches
    expect(searches).toEqual([
      expect.objectContaining({ id: 'valid', leagueId: 'Test', searchCode: 'abc123', validity: 'valid', monitorStatus: 'saved' }),
      expect.objectContaining({ id: 'invalid', leagueId: '', searchCode: '', validity: 'invalid', monitorStatus: 'saved' }),
    ])
  })

  it('migrates raw v1 equipment to the canonical library and preserves unresolved legacy records', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'superpoe-library-migration-test-'))
    temporaryDirectories.push(directory)
    const v1Path = path.join(directory, 'equipment-library.v1.json')
    const v2Path = path.join(directory, 'equipment-library.v2.json')
    const legacyItem = {
      rarity: 'RARE', name: 'Doom Shell', baseType: "Expert Hexer's Robe", rawText: item().item.raw,
      modifiers: [],
    }
    writeFileSync(v1Path, JSON.stringify({
      schemaVersion: 1,
      entries: [
        { schemaVersion: 1, id: 'raw-entry', fingerprint: 'old', item: legacyItem, sources: [marketSource(2)], tags: [], archived: false, createdAt: '2026-01-01', updatedAt: '2026-01-01' },
        { schemaVersion: 1, id: 'unresolved-entry', fingerprint: 'old-2', item: { ...legacyItem, rawText: undefined }, sources: [marketSource(3)], tags: [], archived: false, createdAt: '2026-01-01', updatedAt: '2026-01-01' },
      ],
      folders: [], searches: [], updatedAt: '2026-01-01',
    }))
    const store = new EquipmentLibraryRepository(v2Path, v1Path)
    const result = await store.migrateLegacy({ normalize: async () => item() } as never)

    expect(result).toEqual({ migrated: 1, unresolved: 1 })
    expect(store.list()).toHaveLength(1)
    expect(readFileSync(v2Path, 'utf8')).toContain('unresolvedLegacyEntries')
    expect(readFileSync(`${v1Path}.migration-backup.json`, 'utf8')).toContain('unresolved-entry')
  })

  it('migrates v2 mixed-source entries into independent collection records', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'superpoe-library-v3-migration-test-'))
    temporaryDirectories.push(directory)
    const filePath = path.join(directory, 'equipment-library.v2.json')
    const market = marketSource(2)
    const equipment: EquipmentFavoriteSource = {
      kind: 'equipment-favorite', sourceKey: equipmentSourceKey('build-1', 'set-1', 'item-1'),
      capturedAt: '2026-07-29T00:00:00.000Z', updatedAt: '2026-07-29T00:00:00.000Z',
      buildId: 'build-1', equipmentSetId: 'set-1', itemId: 'item-1',
    }
    writeFileSync(filePath, JSON.stringify({
      schemaVersion: 2,
      entries: [{
        schemaVersion: 2, id: 'mixed', fingerprint: fingerprintLibraryItem(item().item), item: item().item,
        sources: [market, equipment], folderId: 'legacy-folder', tags: [], archived: false,
        createdAt: '2026-01-01', updatedAt: '2026-01-01',
      }],
      folders: [{ id: 'legacy-folder', scope: 'items', name: 'Upgrades', sortOrder: 0, expanded: true, createdAt: '2026-01-01', updatedAt: '2026-01-01' }],
      searches: [], selectedFolders: { items: 'legacy-folder' }, updatedAt: '2026-01-01',
    }))

    const store = new EquipmentLibraryRepository(filePath)
    expect(store.list()).toHaveLength(2)
    expect(store.list().map((entry) => entry.collectionRoot).sort()).toEqual(['build', 'market'])
    expect(store.list().every((entry) => !!entry.folderId)).toBe(true)
    expect(store.sidebarSnapshot().folders.filter((folder) => folder.scope === 'items')).toHaveLength(2)
    expect(JSON.parse(readFileSync(filePath, 'utf8')).schemaVersion).toBe(3)
    expect(JSON.parse(readFileSync(`${filePath}.backup.json`, 'utf8')).schemaVersion).toBe(2)
    expect(JSON.parse(readFileSync(`${filePath}.v2-migration-backup.json`, 'utf8')).schemaVersion).toBe(2)
  })

  it('repairs a previously corrupted CN market title from its source evidence', async () => {
    const store = repository()
    const corrupted = item('?????? a?????')
    store.upsert(corrupted, {
      ...marketSource(2),
      realm: 'cn',
      display: { locale: 'zh-CN', name: '\u66b4\u6012 \u4e4b\u672f', baseType: '\u795e\u5723\u957f\u6756' },
    })
    const repairedItem = item('Wrath Spell')

    const repaired = await store.repairCorruptedMarketTitles(
      { normalize: async () => repairedItem } as never,
      (value) => value === '\u66b4\u6012 \u4e4b\u672f' ? 'Wrath Spell' : undefined,
    )

    expect(repaired).toBe(1)
    expect(store.list()[0].item.raw).toContain('Wrath Spell')
    expect(store.list()[0].view.localized?.['zh-CN']?.name).toBe('\u66b4\u6012 \u4e4b\u672f')
  })

  it('enriches custom items with derived localization and icons', () => {
    const store = repository()
    store.upsert(item('Wrath Spell'), {
      kind: 'manual', sourceKey: 'manual:test', capturedAt: '2026-01-01', updatedAt: '2026-01-01',
      display: { locale: 'en', name: 'Wrath Spell', baseType: "Expert Hexer's Robe" },
    })

    const enriched = store.enrichManualPresentation(
      (value) => value === 'Wrath Spell' ? '\u66b4\u6012 \u4e4b\u672f' : value === "Expert Hexer's Robe" ? '\u4e13\u5bb6\u5492\u672f\u957f\u888d' : undefined,
      (value) => value === '+100 to maximum Life' ? '+100 \u6700\u5927\u751f\u547d' : undefined,
      () => '/assets/items/test.webp',
    )

    const entry = store.list()[0]
    expect(enriched).toBe(1)
    expect(entry.view.iconUrl).toBe('/assets/items/test.webp')
    expect(entry.view.localized?.['zh-CN']).toEqual({ name: '\u66b4\u6012 \u4e4b\u672f', baseType: '\u4e13\u5bb6\u5492\u672f\u957f\u888d' })
    expect(entry.view.modifiers[0].localized?.['zh-CN']).toBe('+100 \u6700\u5927\u751f\u547d')
  })

  it('persists saved, armed, paused, and completed target states and rejects invalid targets', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'superpoe-library-state-test-'))
    temporaryDirectories.push(directory)
    const filePath = path.join(directory, 'library.json')
    const repository = new EquipmentLibraryRepository(filePath)
    const search = repository.saveSearch({
      realm: 'global', leagueId: 'Test', searchCode: 'state-code', captureSource: 'code-only',
      canonicalUrl: 'https://www.pathofexile.com/trade2/search/poe2/Test/state-code', name: 'State target',
    })
    expect(search.monitorStatus).toBe('saved')
    expect(repository.updateSearch({ id: search.id, monitorStatus: 'armed' }).monitorStatus).toBe('armed')
    expect(repository.updateSearch({ id: search.id, monitorStatus: 'paused' }).monitorStatus).toBe('paused')
    expect(repository.updateSearch({ id: search.id, monitorStatus: 'completed' }).monitorStatus).toBe('completed')
    expect(new EquipmentLibraryRepository(filePath).getSearch(search.id)?.monitorStatus).toBe('completed')

    writeFileSync(filePath, JSON.stringify({
      schemaVersion: 2, entries: [], folders: [], selectedFolders: {}, updatedAt: new Date().toISOString(),
      searches: [{ id: 'invalid-target', realm: 'global', name: 'Invalid', canonicalUrl: 'https://www.pathofexile.com/trade2', createdAt: '2026-01-01', updatedAt: '2026-01-01' }],
    }))
    const invalidRepository = new EquipmentLibraryRepository(filePath)
    expect(() => invalidRepository.updateSearch({ id: 'invalid-target', monitorStatus: 'armed' })).toThrow('Invalid searches cannot be monitored')
  })

  it('removes a filed collection record when its final source is removed', () => {
    const store = repository()
    const folder = store.createFolder({ scope: 'items', collectionRoot: 'market', name: 'Current target' })
    store.upsert(item(), marketSource(2), { folderId: folder.id })
    store.removeSource(marketSourceKey('global', 'listing-1'))
    expect(store.list()).toEqual([])
  })

  it('removes an unfiled entry with no metadata when its final source is removed', () => {
    const store = repository()
    store.upsert(item(), marketSource(2))
    store.removeSource(marketSourceKey('global', 'listing-1'))
    expect(store.list()).toEqual([])
  })

  it('deletes multiple selected entries in one operation', () => {
    const store = repository()
    const first = store.upsert(item(), marketSource(2))
    const second = store.upsert(
      item('Doom Ward'),
      { ...marketSource(3), sourceKey: marketSourceKey('global', 'listing-2'), listingId: 'listing-2' },
    )

    expect(store.deleteMany([first.id, second.id, 'missing-entry'])).toBe(2)
    expect(store.list()).toEqual([])
    expect(store.deleteMany([])).toBe(0)
  })

  it('does not persist the derived item view', () => {
    const store = repository()
    const entry = store.upsert(item(), marketSource(2))
    expect(entry.view.modifiers[0].text).toBe('+100 to maximum Life')
    const directory = temporaryDirectories[temporaryDirectories.length - 1]
    const persisted = JSON.parse(readFileSync(path.join(directory, 'library.json'), 'utf8'))
    expect(persisted.entries[0].item.raw).toContain('+100 to maximum Life')
    expect(persisted.entries[0].view).toBeUndefined()
  })
})
