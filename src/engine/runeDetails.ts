import type { EquipmentItem } from '@/types/equipment'

export interface RuneDetailVariant {
  type: string
  stats: string[]
}

export interface RuneDetail {
  name: string
  localizedNames?: Record<string, string>
  variants: Record<string, RuneDetailVariant>
}

export interface RuneDetailIndex {
  lookup: Record<string, RuneDetail>
}

let runeDetailPromise: Promise<RuneDetailIndex | null> | null = null

function normalizeRuneKey(value: string): string {
  return value.replace(/[^a-z0-9]+/gi, '').toLowerCase()
}

export function loadRuneDetails(): Promise<RuneDetailIndex | null> {
  if (!runeDetailPromise) {
    runeDetailPromise = fetch('/data/rune-details.json')
      .then(async (response) => response.ok ? response.json() as Promise<RuneDetailIndex> : null)
      .catch(() => null)
  }
  return runeDetailPromise
}

export function resolveRuneDetail(name: string, index: RuneDetailIndex | null): RuneDetail | undefined {
  return index?.lookup?.[normalizeRuneKey(name)]
}

export function resolveRuneVariant(
  detail: RuneDetail | undefined,
  item: EquipmentItem,
  slotName?: string,
): { category: string; variant: RuneDetailVariant } | undefined {
  if (!detail) return undefined
  const base = item.baseType.toLowerCase()
  const slot = (slotName || '').toLowerCase()
  const candidates = slot.includes('weapon')
    ? [
        base.includes('wand') ? 'wand' : '',
        base.includes('staff') ? 'staff' : '',
        base.includes('sceptre') ? 'sceptre' : '',
        base.includes('buckler') ? 'buckler' : '',
        base.includes('shield') ? 'shield' : '',
        'weapon',
      ]
    : slot.includes('helmet') ? ['helmet', 'armour']
      : slot.includes('body armour') ? ['body armour', 'armour']
        : slot.includes('gloves') ? ['gloves', 'armour']
          : slot.includes('boots') ? ['boots', 'armour']
            : []

  for (const category of candidates) {
    if (category && detail.variants[category]) return { category, variant: detail.variants[category] }
  }
  const fallback = Object.entries(detail.variants)[0]
  return fallback ? { category: fallback[0], variant: fallback[1] } : undefined
}
