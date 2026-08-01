export interface ItemBaseData {
  type?: string
  subType?: string
  weapon?: Record<string, number>
  armour?: Record<string, number>
  flask?: Record<string, number>
  charm?: Record<string, number>
  requirements?: Record<string, number>
}

interface ItemBaseIndex {
  bases: Record<string, ItemBaseData>
}

const EMPTY_ITEM_BASE_INDEX: ItemBaseIndex = { bases: {} }

export function normalizeItemBaseIndex(value: unknown): ItemBaseIndex {
  if (!value || typeof value !== 'object') return EMPTY_ITEM_BASE_INDEX
  const bases = (value as { bases?: unknown }).bases
  if (!bases || typeof bases !== 'object' || Array.isArray(bases)) return EMPTY_ITEM_BASE_INDEX
  return { bases: bases as Record<string, ItemBaseData> }
}

let indexPromise: Promise<ItemBaseIndex> | null = null

export function loadItemBaseData(): Promise<ItemBaseIndex> {
  if (!indexPromise) {
    indexPromise = fetch('/data/item-bases.json')
      .then(async (response) => response.ok ? normalizeItemBaseIndex(await response.json()) : EMPTY_ITEM_BASE_INDEX)
      .catch(() => EMPTY_ITEM_BASE_INDEX)
  }
  return indexPromise
}

export function resolveItemBaseData(baseType: string, bases: Record<string, ItemBaseData>): ItemBaseData | undefined {
  const withoutVariant = baseType.replace(/\s+\([^)]+\)\s*$/, '')
  if (bases[baseType]) return bases[baseType]
  if (bases[withoutVariant]) return bases[withoutVariant]

  // Magic exports may contain the affixes in the only available name line.
  let bestMatch = ''
  for (const name of Object.keys(bases)) {
    if (name.length > bestMatch.length && new RegExp(`(?:^|\\s)${escapeRegExp(name)}(?:$|\\s)`, 'i').test(withoutVariant)) {
      bestMatch = name
    }
  }
  return bestMatch ? bases[bestMatch] : undefined
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
