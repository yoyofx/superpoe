import type { EquipmentItem } from '@/types/equipment'
import type { LibraryItemSnapshot, LibraryModifier, LibraryModifierSource, LibraryModifierTag } from '@/types/market'

function parseNumber(value: string | undefined): number | undefined {
  if (!value) return undefined
  const match = value.match(/[-+]?\d+(?:\.\d+)?/)
  return match ? Number(match[0]) : undefined
}

function sourceFromTags(tags: string[]): LibraryModifierSource {
  return (['fractured', 'crafted', 'desecrated', 'enchant', 'rune', 'implicit', 'explicit'] as const)
    .find((tag) => tags.includes(tag)) || 'unknown'
}

export function equipmentItemToLibrarySnapshot(item: EquipmentItem, iconUrl?: string): LibraryItemSnapshot {
  const inputModifiers = item.modifiers || item.lines.map((text) => ({ text, tags: [], group: 'explicit' as const }))
  const modifiers: LibraryModifier[] = inputModifiers.flatMap((modifier, index) => {
    const text = modifier.text.replace(/\{[^}]+\}/g, '').trim()
    const currentValues = [...text.matchAll(/[-+]?\d+(?:\.\d+)?/g)].map((match) => Number(match[0]))
    const source = sourceFromTags(modifier.tags)
    const sourceTags: LibraryModifierTag[] = [...new Set<LibraryModifierTag>([
      ...(source === 'unknown' ? [] : [source]),
      ...modifier.tags.filter((tag): tag is LibraryModifierTag => ['enchant', 'rune', 'implicit', 'explicit', 'fractured', 'crafted', 'desecrated', 'corrupted', 'mutated'].includes(tag)),
    ])]
    if (!text) return []
    const normalized: LibraryModifier = {
      id: `${modifier.group}-${index}`,
      displayOrder: index,
      group: modifier.group,
      sourceTags,
      original: { locale: 'unknown', lines: [text], displayText: text },
      valueMode: currentValues.length ? 'numeric' : 'presence',
      currentValues,
      tierRanges: [],
      tradeResolutions: [],
    }
    return [normalized]
  })

  return {
    rarity: item.rarity,
    name: item.name || item.baseType,
    baseType: item.baseType || item.name,
    itemLevel: parseNumber(item.itemLevel),
    quality: parseNumber(item.quality),
    sockets: item.sockets,
    iconUrl: iconUrl || item.imageUrl,
    rawText: item.raw,
    modifiers,
  }
}
