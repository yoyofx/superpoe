import { buildOfficialItemCategoryPairs, type OfficialMarketCandidate, type OfficialItemScope } from './marketOfficialSuggestions.js'
import { buildMarketStatTiers, type MarketStatTier } from './marketStatTiers.js'

export interface MarketStatContext extends OfficialItemScope {
  item?: { type: string; name?: string; unique?: boolean }
  selectionLabel?: string
}
export interface MarketStatScopeEntry {
  name: string
  base?: string
  category: string
  ids: string[]
  complete: boolean
  fixedIds?: string[]
  fixedComplete?: boolean
  tierPool?: string
}
export interface MarketStatScopeData {
  bases: MarketStatScopeEntry[]
  uniques: MarketStatScopeEntry[]
  aliases: Array<[string, string]>
  tierPools?: Record<string, MarketStatTier[]>
}
export interface ResolvedMarketStatScope {
  key: string
  kind: 'all' | 'category' | 'base' | 'unique' | 'unknown'
  ids?: string[]
  complete: boolean
  tierPoolKeys?: string[]
}
export interface PobScopeMod {
  id?: string; group?: string; level?: number; statOrder?: number[]; affix?: string
  type?: string; weightKey?: string[]; weightVal?: number[]
  weightMultiplierKey?: string[]; weightMultiplierVal?: number[]
  hashes: string[]; lines: string[]; descriptions?: Array<[string, string[]]>
}
export interface PobScopeSource {
  bases: Record<string, { type?: string; subType?: string; tags: Record<string, boolean>; implicit?: string }>
  baseVariants?: Record<string, PobScopeSource['bases'][string][]>
  mods: Record<string, PobScopeMod[]>
  exclusive: PobScopeMod[]
  uniques: string[]
}

/** The first matching weight wins, including zero-weight exclusions. */
export function marketModSpawnWeight(base: PobScopeSource['bases'][string], mod: PobScopeMod): number {
  let weight = 0
  for (const [index, key] of (mod.weightKey || []).entries()) {
    if (base.tags[key]) { weight = mod.weightVal?.[index] || 0; break }
  }
  for (const [index, key] of (mod.weightMultiplierKey || []).entries()) {
    if (base.tags[key]) { weight *= (mod.weightMultiplierVal?.[index] || 0) / 100; break }
  }
  return weight
}

const normalize = (text: string) => text.trim().toLocaleLowerCase().replace(/\s+/g, ' ')
const stripTags = (text: string) => text.replace(/\{[^}]*\}/g, '').trim()
// Only used as a fallback when exactly one official descriptor matches.
const template = (text: string) => normalize(text).replace(/\s*\(local\)$/, '')
  .replace(/\(-?\d+(?:\.\d+)?--?\d+(?:\.\d+)?\)/g, '#')
  .replace(/[+-]?\d+(?:\.\d+)?|[+]?#/g, '#')

export function buildMarketStatScopeData(source: PobScopeSource, descriptors: Array<[string, string]>,
  localizers: Array<(name: string) => string> = []): MarketStatScopeData {
  const categories = new Map(buildOfficialItemCategoryPairs(source.bases))
  const exact = new Map<string, Set<string>>()
  for (const mod of [...Object.values(source.mods).flat(), ...source.exclusive]) {
    const descriptions = mod.descriptions || mod.hashes.map((hash): [string, string[]] => [hash, mod.lines])
    for (const [hash, lines] of descriptions) {
      for (const line of [...lines, lines.join('\n')]) {
        const key = normalize(line)
        const values = exact.get(key) || new Set<string>()
        values.add(hash); exact.set(key, values)
      }
    }
  }
  const fallback = new Map<string, Set<string>>()
  for (const [id, text] of descriptors) {
    if (!/^(?:(explicit|implicit)\.stat_\d+|skill\.[\w]+)$/.test(id)) continue
    const key = `${id.split('.')[0]}:${template(text)}`
    const values = fallback.get(key) || new Set<string>()
    values.add(id); fallback.set(key, values)
  }
  const lineIds = (line: string, kind: string): string[] => {
    if (line.startsWith('Grants Skill:')) {
      const matches = fallback.get(`skill:${template(line)}`)
      return matches?.size === 1 ? [...matches] : []
    }
    const hashes = exact.get(normalize(line))
    if (hashes?.size === 1) return [...hashes].map((hash) => `${kind}.stat_${hash}`)
    const matches = fallback.get(`${kind}:${template(line)}`)
    return matches?.size === 1 ? [...matches] : []
  }
  const bases: MarketStatScopeEntry[] = []
  const tierPools: Record<string, MarketStatTier[]> = {}
  const descriptorMap = new Map(descriptors)
  const poolCache = new Map<string, { ids: string[]; complete: boolean; tierPool: string }>()
  for (const [name, base] of Object.entries(source.bases)) {
    const category = categories.get(name)
    if (!category) continue
    const file = base.type === 'Jewel' ? 'ModJewel' : base.type === 'Charm' ? 'ModCharm'
      : base.type === 'Flask' ? 'ModFlask' : 'ModItem'
    const cacheKey = `${file}:${Object.keys(base.tags).filter((key) => base.tags[key]).sort().join(',')}`
    let pool = poolCache.get(cacheKey)
    if (!pool) {
      const mods = (source.mods[file] || []).filter((mod) => marketModSpawnWeight(base, mod) > 0)
      pool = { ids: [...new Set(mods.flatMap((mod) => mod.hashes.map((hash) => `explicit.stat_${hash}`)))],
        tierPool: String(poolCache.size),
        complete: mods.length > 0 && mods.every((mod) => mod.hashes.length > 0) }
      tierPools[pool.tierPool] = file === 'ModJewel' && base.subType !== 'Abyss' ? [] : buildMarketStatTiers(mods, descriptorMap)
      poolCache.set(cacheKey, pool)
    }
    // Runic bases can be assigned several times under the same name in PoB.
    // The market identifies only the name, so retain all possible fixed stats.
    const implicit = (source.baseVariants?.[name] || [base]).flatMap((variant) =>
      (variant.implicit || '').split('\n').filter(Boolean).map((line) => lineIds(line, 'implicit')))
    const fixedIds = [...new Set(implicit.flat())]
    const fixedComplete = implicit.every((ids) => ids.length > 0)
    bases.push({ name, category, ids: [...new Set([...pool.ids, ...fixedIds])], fixedIds, fixedComplete,
      tierPool: pool.tierPool,
      complete: pool.complete && fixedComplete })
  }
  const uniques: MarketStatScopeEntry[] = []
  for (const raw of source.uniques) {
    const lines = raw.trim().split(/\r?\n/)
    const name = lines[0]
    if (!name) continue
    // PoB also allows base lines after Variant/Source metadata.
    const baseLines = lines.slice(1).filter((line) => categories.has(stripTags(line)))
    if (!baseLines.length) continue
    const variantNames = lines.filter((line) => line.startsWith('Variant:')).map((line) => line.slice(8).trim())
    const current = variantNames.findIndex((name) => name.toLowerCase() === 'current') + 1
    // Historical rolls remain accessible through "View all". Mutually
    // exclusive current variants (for example elemental variants) are unioned.
    const variants = current ? [current] : Array.from({ length: Math.max(1, variantNames.length) }, (_, index) => index + 1)
    const implicit = Number(raw.match(/(?:^|\n)Implicits: (\d+)/)?.[1] || 0)
    const entries = new Map<string, { ids: Set<string>; complete: boolean }>()
    for (const variant of variants) {
      const matchesVariant = (line: string) => {
        const tag = line.match(/\{variant:([^}]+)\}/)?.[1]
        return !tag || tag.split(',').includes(String(variant))
      }
      const variantBases = baseLines.filter(matchesVariant).map(stripTags)
      const base = variantBases[variantBases.length - 1]
      if (!base) continue
      const entry = entries.get(base) || { ids: new Set<string>(), complete: true }
      entries.set(base, entry)
      let index = 0
      const properties = lines.slice(1).flatMap((rawLine) => {
        if (!matchesVariant(rawLine)) return []
        const line = stripTags(rawLine)
        if (categories.has(line)) return []
        if (!line || /^(?:Variant|Selected Variant|Has Alt Variant\d*|Source|League|Requires Level|LevelReq|Sockets|Quality|Radius|Limited to|Implicits|Corrupted|Unreleased|Crafted|Item Level|Armour|Evasion|Energy Shield|Ward|Unique ID|Catalyst|CatalystQuality)(?::|$)/i.test(line)) return []
        return [line]
      })
      for (let position = 0; position < properties.length; position++) {
        const kind = index++ < implicit ? 'implicit' : 'explicit'
        let matches: string[] = []
        for (let length = Math.min(4, properties.length - position); length > 0; length--) {
          matches = lineIds(properties.slice(position, position + length).join('\n'), kind)
          if (matches.length) { position += length - 1; break }
        }
        matches.forEach((id) => entry.ids.add(id))
        if (!matches.length) entry.complete = false
      }
    }
    for (const [base, { ids, complete }] of entries) {
      uniques.push({ name, base, category: categories.get(base)!, ids: [...ids], complete: complete && ids.size > 0 })
    }
  }
  const names = new Set([...bases.map((base) => base.name), ...uniques.map((unique) => unique.name),
    // Translate identities for legacy rune versions even when their base data
    // is no longer bundled. These aliases never create base/unique records.
    ...uniques.flatMap((unique) => [`Runeforged ${unique.base}`, `Runemastered ${unique.base}`])])
  const aliases: Array<[string, string]> = [...names].flatMap((name) => [name, ...localizers.map((localize) => localize(name))]
    .filter(Boolean).map((label): [string, string] => [label, name]))
  return { bases, uniques, aliases, tierPools }
}

export function marketCategoryIncludes(category: string, actual: string): boolean {
  const families: Record<string, string[]> = {
    'weapon.onemelee': ['claw', 'dagger', 'onesword', 'oneaxe', 'onemace', 'spear', 'flail'],
    'weapon.twomelee': ['twosword', 'twoaxe', 'twomace', 'warstaff', 'talisman'],
    'weapon.ranged': ['bow', 'crossbow'], 'weapon.caster': ['wand', 'sceptre', 'staff'],
  }
  return actual === category || actual.startsWith(category + '.') || Boolean(families[category]?.includes(actual.replace(/^weapon\./, '')))
}

export function resolveMarketStatScope(context: MarketStatContext | undefined, data?: MarketStatScopeData): ResolvedMarketStatScope {
  const key = JSON.stringify([context?.item || null, context?.category || '', context?.rarity || ''])
  if (!context?.item?.type && !context?.category) return { key, kind: 'all', complete: true }
  if (!data) return { key, kind: 'unknown', complete: false }
  const aliases = new Map<string, string>()
  const ambiguous = new Set<string>()
  for (const [label, name] of data.aliases) {
    const key = normalize(label)
    if (aliases.has(key) && aliases.get(key) !== name) ambiguous.add(key)
    aliases.set(key, name)
  }
  ambiguous.forEach((key) => aliases.delete(key))
  const canonical = (text: string) => aliases.get(normalize(text)) || text
  const uniqueEntries = (baseName: string, title?: string): MarketStatScopeEntry[] => {
    const matching = (base: string) => data.uniques.filter((entry) => entry.base === base && (!title || entry.name === title))
    const exact = matching(baseName)
    if (exact.length) return exact
    // Same fallback as PoB ItemClass:GetUniqueDBItem. Never match by title alone.
    const originalName = baseName.replace(/^(?:Runeforged|Runemastered) /, '')
    if (originalName === baseName) return []
    const actual = data.bases.find((entry) => entry.name === baseName)
    const original = data.bases.find((entry) => entry.name === originalName)
    if (!original || (actual && actual.category !== original.category)) return []
    // Legacy official rune versions may be absent from the current PoB bases.
    // Their title + original base still identify the unique, but fixed rune
    // properties cannot be inferred without that version's base data.
    if (!actual) return matching(originalName).map((entry) => ({ ...entry, base: baseName, complete: false }))
    const replaced = new Set(original.fixedIds || [])
    return matching(originalName).map((entry) => ({ ...entry, base: baseName,
      ids: [...new Set([...entry.ids.filter((id) => !replaced.has(id)), ...(actual.fixedIds || [])])],
      complete: entry.complete && actual.fixedComplete === true,
    }))
  }
  const item = context.item
  if (item?.type) {
    const name = canonical(item.type)
    if (item.unique || item.name) {
      const entries = uniqueEntries(name, canonical(item.name || ''))
      return entries.length ? { key, kind: 'unique', ids: [...new Set(entries.flatMap((entry) => entry.ids))], complete: entries.every((entry) => entry.complete) }
        : { key, kind: 'unknown', complete: false }
    }
    if (['unique', 'uniquefoil'].includes(context.rarity)) {
      const entries = uniqueEntries(name)
      if (!entries.length) return { key, kind: 'unknown', complete: false }
      return { key, kind: 'unique', ids: [...new Set(entries.flatMap((entry) => entry.ids))], complete: entries.length > 0 && entries.every((entry) => entry.complete) }
    }
    const base = data.bases.find((entry) => entry.name === name)
    if (!base) return { key, kind: 'unknown', complete: false }
    return { key, kind: 'base', ids: context.rarity === 'normal' ? base.ids.filter((id) => /^(implicit|skill)\./.test(id)) : base.ids,
      tierPoolKeys: base.tierPool ? [base.tierPool] : [], complete: base.complete }
  }
  const entries = (['unique', 'uniquefoil'].includes(context.rarity) ? data.uniques : data.bases)
    .filter((entry) => marketCategoryIncludes(context.category, entry.category))
  return entries.length ? { key, kind: 'category', ids: [...new Set(entries.flatMap((entry) => entry.ids))].filter((id) => context.rarity !== 'normal' || /^(implicit|skill)\./.test(id)),
    tierPoolKeys: [...new Set(entries.flatMap((entry) => entry.tierPool ? [entry.tierPool] : []))], complete: entries.every((entry) => entry.complete) }
    : { key, kind: 'unknown', complete: false }
}

export function scopeMarketStatCandidates(candidates: readonly OfficialMarketCandidate[], scope: ResolvedMarketStatScope,
  all = false): OfficialMarketCandidate[] {
  if (all || !scope.ids) return [...candidates]
  const ids = new Set(scope.ids)
  return candidates.filter((candidate) => ids.has(String(candidate.value)))
}
