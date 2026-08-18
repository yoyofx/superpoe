import type { AnalysisDimension } from '@/engine/attributeAnalysis'

export type AffixCatalogSource = 'item' | 'exclusive' | 'corrupted' | 'veiled' | 'rune' | 'jewel' | 'charm' | 'flask' | 'incursion'
export type AffixCatalogSupport = 'probe' | 'cataloged' | 'unsupported'

export interface AffixCatalogEntry {
  id: string
  source: AffixCatalogSource
  type: string
  text: string
  affix: string
  group: string
  level?: number
  tags: string[]
  dimensions: AnalysisDimension[]
  support: AffixCatalogSupport
}

const CATALOG_FILES: Array<{ source: AffixCatalogSource; path: string }> = [
  { source: 'item', path: '/pob-lua/Data/ModItem.lua' },
  { source: 'jewel', path: '/pob-lua/Data/ModJewel.lua' },
  { source: 'charm', path: '/pob-lua/Data/ModCharm.lua' },
  { source: 'flask', path: '/pob-lua/Data/ModFlask.lua' },
  { source: 'exclusive', path: '/pob-lua/Data/ModItemExclusive.lua' },
  { source: 'corrupted', path: '/pob-lua/Data/ModCorrupted.lua' },
  { source: 'veiled', path: '/pob-lua/Data/ModVeiled.lua' },
  { source: 'rune', path: '/pob-lua/Data/ModRunes.lua' },
  { source: 'incursion', path: '/pob-lua/Data/ModIncursionLimb.lua' },
]

function parseTags(value: string): string[] {
  return [...value.matchAll(/"([^"]+)"/g)].map((match) => match[1]).filter(Boolean)
}

function unescapeLua(value: string): string {
  return value.replace(/\\"/g, '"').replace(/\\\\/g, '\\')
}

function dimensionsFor(text: string, tags: string[]): AnalysisDimension[] {
  const value = `${text} ${tags.join(' ')}`.toLowerCase()
  const dimensions = new Set<AnalysisDimension>()
  if (/damage|attack|spell|critical|crit|projectile|hit|accuracy|penetration|physical|elemental|fire|cold|lightning|chaos|bleed|ignite|poison|ailment|cast speed|attack speed|trigger|cooldown|skill|minion/.test(value)) dimensions.add('attack')
  if (/life|defen[cs]e|armou?r|evasion|energy shield|resistance|block|avoid|damage taken|ward|mitigation|barrier|suppression|mana|spirit|resource|regeneration|regen|leech|cost|reservation|soul|stun|freeze|movement|action|duration|charge/.test(value)) dimensions.add('defense')
  // Keep special utility modifiers visible without creating a third report
  // dimension. They are shown as defense-side context and never get a DPS
  // result unless a matching probe exists.
  if (!dimensions.size) dimensions.add('defense')
  return [...dimensions]
}

function isCoveredByProbe(entry: AffixCatalogEntry): boolean {
  const value = `${entry.text} ${entry.tags.join(' ')} ${entry.group}`.toLowerCase()
  return [
    /increased damage|added .* damage|more damage/,
    /increased attack speed/,
    /increased cast speed/,
    /level of (?:all|.+) skills/,
    /maximum life/,
    /maximum energy shield/,
    /increased armour/,
    /increased evasion/,
    /resistance/,
    /maximum mana/,
    /mana regeneration/,
    /movement speed/,
  ].some((pattern) => pattern.test(value))
}

function parseStandardEntries(source: AffixCatalogSource, text: string): AffixCatalogEntry[] {
  const entries: AffixCatalogEntry[] = []
  for (const line of text.split(/\r?\n/)) {
    const idMatch = line.match(/^\s*\["((?:\\.|[^"])*)"\]\s*=\s*\{(.*)$/)
    if (!idMatch || !line.includes('affix =')) continue
    const id = unescapeLua(idMatch[1])
    const body = idMatch[2]
    const affix = body.match(/affix\s*=\s*"((?:\\.|[^"])*)"/)?.[1] || ''
    const textMatch = body.match(/affix\s*=\s*"(?:\\.|[^"])*"\s*,\s*"((?:\\.|[^"])*)"/)
    const modText = textMatch ? unescapeLua(textMatch[1]) : ''
    if (!modText) continue
    const type = body.match(/type\s*=\s*"([^"]+)"/)?.[1] || (source === 'item' ? 'Explicit' : 'Special')
    const group = body.match(/group\s*=\s*"([^"]+)"/)?.[1] || ''
    const level = Number(body.match(/level\s*=\s*(\d+)/)?.[1]) || undefined
    const tags = parseTags(body.match(/modTags\s*=\s*\{([^}]*)\}/)?.[1] || '')
    entries.push({ id, source, type, text: modText, affix: unescapeLua(affix), group, level, tags, dimensions: dimensionsFor(modText, tags), support: 'cataloged' })
  }
  return entries
}

function parseRuneEntries(text: string): AffixCatalogEntry[] {
  const entries: AffixCatalogEntry[] = []
  let root = ''
  let slot = ''
  let type = 'Rune'
  let modText = ''
  let index = 0
  const flush = () => {
    if (!root || !modText) return
    const id = `${root}:${slot || index}`
    entries.push({ id, source: 'rune', type, text: modText, affix: root, group: slot, tags: [], dimensions: dimensionsFor(modText, []), support: 'cataloged' })
    index += 1
    modText = ''
  }
  for (const line of text.split(/\r?\n/)) {
    const rootMatch = line.match(/^\s*\["((?:\\.|[^"])*)"\]\s*=\s*\{\s*$/)
    if (rootMatch && !line.startsWith('\t\t')) {
      flush()
      root = unescapeLua(rootMatch[1])
      slot = ''
      type = 'Rune'
      continue
    }
    const slotMatch = line.match(/^\s{2,}\["((?:\\.|[^"])*)"\]\s*=\s*\{\s*$/)
    if (slotMatch) {
      flush()
      slot = unescapeLua(slotMatch[1])
      continue
    }
    const typeMatch = line.match(/type\s*=\s*"([^"]+)"/)
    if (typeMatch) type = typeMatch[1]
    const textMatch = line.match(/^\s*"((?:\\.|[^"])*)"\s*,\s*$/)
    if (textMatch && !modText) modText = unescapeLua(textMatch[1])
  }
  flush()
  return entries
}

export function parseAffixCatalog(source: AffixCatalogSource, text: string): AffixCatalogEntry[] {
  return source === 'rune' ? parseRuneEntries(text) : parseStandardEntries(source, text)
}

export async function loadAffixCatalog(signal?: AbortSignal): Promise<AffixCatalogEntry[]> {
  const loaded = await Promise.all(CATALOG_FILES.map(async ({ source, path }) => {
    const response = await fetch(path, { signal })
    if (!response.ok) throw new Error(`Unable to load affix catalog: ${path}`)
    return parseAffixCatalog(source, await response.text())
  }))
  const seen = new Set<string>()
  return loaded.flat().map((entry) => {
    if (isCoveredByProbe(entry)) entry.support = 'probe'
    return entry
  }).filter((entry) => {
    const key = `${entry.source}:${entry.id}:${entry.text}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function catalogEntriesForDimension(entries: AffixCatalogEntry[], dimension: AnalysisDimension): AffixCatalogEntry[] {
  return entries.filter((entry) => entry.dimensions.includes(dimension))
}

export function catalogCoverageLabel(entry: AffixCatalogEntry): string {
  if (entry.support === 'probe') return 'calculated'
  if (entry.support === 'unsupported') return 'unsupported'
  return 'cataloged'
}
