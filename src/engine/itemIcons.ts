import type { EquipmentItem } from '@/types/equipment'
import { buildSkillIconLookup, loadSkillCatalog } from '@/engine/skillCatalog'

export interface ItemIconIndex {
  lookup?: Record<string, string>
}

let itemIconIndexPromise: Promise<ItemIconIndex | null> | null = null

export function normalizeItemIconIndex(value: unknown): ItemIconIndex | null {
  if (!value || typeof value !== 'object') return null
  const lookup = (value as { lookup?: unknown }).lookup
  if (!lookup || typeof lookup !== 'object' || Array.isArray(lookup)) return null
  return {
    lookup: Object.fromEntries(Object.entries(lookup).filter((entry): entry is [string, string] => (
      typeof entry[1] === 'string' && entry[1].length > 0
    ))),
  }
}

function normalizeItemKey(value: string): string {
  return value
    .replace(/\{[^}]*\}/g, '')
    .replace(/[^a-z0-9]+/gi, '')
    .toLowerCase()
}

function resolveContainedIcon(value: string, lookup: Record<string, string>): string | undefined {
  const normalized = normalizeItemKey(value)
  if (!normalized) return undefined
  let bestKey = ''
  let bestPath: string | undefined
  for (const [key, path] of Object.entries(lookup)) {
    if (key.length < 6 || key.length <= bestKey.length || !normalized.includes(key)) continue
    bestKey = key
    bestPath = path
  }
  return bestPath
}

export async function loadItemIconIndex(): Promise<ItemIconIndex | null> {
  if (!itemIconIndexPromise) {
    itemIconIndexPromise = Promise.all([
      fetch('/data/item-icons.json').then(async (response) => response.ok ? normalizeItemIconIndex(await response.json()) : null),
      loadSkillCatalog(),
    ])
      .then(([items, skills]) => items || skills
        ? { lookup: { ...buildSkillIconLookup(skills), ...items?.lookup } }
        : null)
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
  for (const key of keys) {
    const path = resolveContainedIcon(key, lookup)
    if (path) return path
  }
  return undefined
}

export function resolveItemIconName(name: string, index: ItemIconIndex | null): string | undefined {
  return index?.lookup?.[normalizeItemKey(name)]
}
