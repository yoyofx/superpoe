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
})
