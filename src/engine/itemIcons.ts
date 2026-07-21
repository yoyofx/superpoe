import type { EquipmentItem } from '@/types/equipment'

export interface ItemIconIndex {
  lookup?: Record<string, string>
}

let itemIconIndexPromise: Promise<ItemIconIndex | null> | null = null

function normalizeItemKey(value: string): string {
  return value
    .replace(/\{[^}]*\}/g, '')
    .replace(/[^a-z0-9]+/gi, '')
    .toLowerCase()
}

export async function loadItemIconIndex(): Promise<ItemIconIndex | null> {
  if (!itemIconIndexPromise) {
    itemIconIndexPromise = fetch('/data/item-icons.json')
      .then(async (response) => response.ok ? response.json() as Promise<ItemIconIndex> : null)
      .catch(() => null)
  }
  return itemIconIndexPromise
}

export function resolveItemIcon(item: EquipmentItem, index: ItemIconIndex | null): string | undefined {
  if (item.imageUrl) return item.imageUrl
  const lookup = index?.lookup
  if (!lookup) return undefined
  const keys = item.rarity.toUpperCase() === 'UNIQUE'
    ? [item.name, item.baseType]
    : [item.baseType, item.name]
  for (const key of keys) {
    const path = lookup[normalizeItemKey(key)]
    if (path) return path
  }
  return undefined
}

export function resolveItemIconName(name: string, index: ItemIconIndex | null): string | undefined {
  return index?.lookup?.[normalizeItemKey(name)]
}
