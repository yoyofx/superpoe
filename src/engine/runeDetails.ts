import type { EquipmentItem } from '@/types/equipment'

export interface RuneDetailVariant {
  type: string
  stats: string[]
  localizedStats?: Record<string, string[]>
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

export function normalizeRuneDetailIndex(value: unknown): RuneDetailIndex | null {
  if (!value || typeof value !== 'object') return null
  const lookup = (value as { lookup?: unknown }).lookup
  if (!lookup || typeof lookup !== 'object' || Array.isArray(lookup)) return null
  const entries = Object.entries(lookup).filter((entry): entry is [string, RuneDetail] => {
    const detail = entry[1]
    return !!detail && typeof detail === 'object'
      && typeof (detail as RuneDetail).name === 'string'
      && !!(detail as RuneDetail).variants
      && typeof (detail as RuneDetail).variants === 'object'
      && !Array.isArray((detail as RuneDetail).variants)
  })
  return { lookup: Object.fromEntries(entries) }
}

function normalizeRuneKey(value: string): string {
  return value.replace(/[^a-z0-9]+/gi, '').toLowerCase()
}

export function loadRuneDetails(): Promise<RuneDetailIndex | null> {
  if (!runeDetailPromise) {
    runeDetailPromise = fetch('/data/rune-details.json')
      .then(async (response) => response.ok ? normalizeRuneDetailIndex(await response.json()) : null)
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
    if (category && detail.variants?.[category]) return { category, variant: detail.variants[category] }
  }
  const fallback = Object.entries(detail.variants || {})[0]
  return fallback ? { category: fallback[0], variant: fallback[1] } : undefined
}
