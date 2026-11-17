import type { MarketStatContext, MarketStatScopeData, PobScopeMod, ResolvedMarketStatScope } from './marketStatScope.js'

export interface MarketStatTier {
  id: string
  statId: string
  series: string
  tier: number
  level: number
  affix: 'prefix' | 'suffix'
  name: string
  text: string
  statIds: string[]
  min: number
  max: number
  /** Query-safe bounds used when the official stat's projected tier ranges overlap. */
  searchMin: number
  searchMax: number
  average: boolean
  /** Raw roll ranges from the PoB mod line, before trade-query projection. */
  rolls?: Array<{ min: number; max: number }>
}

const normalize = (text: string) => text.replace(/\{[^}]*\}/g, '').replace(/\s*\(local\)\s*$/i, '').trim().toLowerCase().replace(/\s+/g, ' ')
const number = '-?\\d+(?:\\.\\d+)?'
const capture = `([+-]?(?:\\(${number}-${number}\\)|\\d+(?:\\.\\d+)?))`
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Match only official numeric placeholders; fixed numbers in the text stay fixed.
 * PoB TradeQueryGenerator averages the bounds when a trade stat has two values. */
export function marketStatRollRange(text: string, descriptor: string): Pick<MarketStatTier, 'min' | 'max' | 'average' | 'rolls'> | undefined {
  const parts = normalize(descriptor).split(/[+-]?#/)
  if (parts.length < 2 || parts.length > 3) return undefined
  const expression = new RegExp(`^${parts.map(escape).join(capture)}$`)
  const source = normalize(text)
  const variants: Array<[string, number]> = [[source, 1]]
  for (const [from, to] of [['reduced', 'increased'], ['increased', 'reduced'], ['less', 'more'], ['more', 'less']]) {
    if (new RegExp(`\\b${from}\\b`).test(source)) variants.push([source.replace(new RegExp(`\\b${from}\\b`), to), -1])
  }
  for (const [variant, invert] of variants) {
    const match = variant.match(expression)
    if (!match) continue
    const ranges = match.slice(1).map((token) => {
      const range = token.match(/^([+-]?)\((-?\d+(?:\.\d+)?)-(-?\d+(?:\.\d+)?)\)$/)
      const values = range ? [Number(range[2]), Number(range[3])].map((value) => value * (range[1] === '-' ? -1 : 1) * invert)
        : [Number(token) * invert, Number(token) * invert]
      return { min: Math.min(...values), max: Math.max(...values) }
    })
    if (!ranges.every(({ min, max }) => Number.isFinite(min) && Number.isFinite(max))) continue
    return { min: ranges.reduce((sum, range) => sum + range.min, 0) / ranges.length,
      max: ranges.reduce((sum, range) => sum + range.max, 0) / ranges.length,
      average: ranges.length === 2, rolls: ranges }
  }
  return undefined
}

/** Rank the entire spawnable sequence before considering item-level filters. */
export function buildMarketStatTiers(mods: PobScopeMod[], descriptors: Map<string, string>): MarketStatTier[] {
  const series = new Map<string, PobScopeMod[]>()
  for (const mod of mods) {
    if (!['Prefix', 'Suffix'].includes(mod.type || '') || !mod.id || !Number.isFinite(mod.level)) continue
    const key = JSON.stringify([mod.type, mod.statOrder?.length ? mod.statOrder : mod.group])
    if (!mod.statOrder?.length && !mod.group) continue
    const rows = series.get(key) || []; rows.push(mod); series.set(key, rows)
  }
  const result: MarketStatTier[] = []
  for (const [key, rows] of series) {
    const ranked = rows.sort((a, b) => b.level! - a.level! || a.id!.localeCompare(b.id!))
    // Equal-level competing records cannot be assigned a reliable T number.
    if (ranked.some((mod, index) => index > 0 && mod.level === ranked[index - 1].level)) continue
    ranked.forEach((mod, index) => {
      for (const [hash, lines] of mod.descriptions || mod.hashes.map((hash): [string, string[]] => [hash, mod.lines])) {
        const statId = `explicit.stat_${hash}`, descriptor = descriptors.get(statId)
        if (!descriptor) continue
        const range = [lines.join('\n'), ...lines].map((line) => marketStatRollRange(line, descriptor)).find(Boolean)
        if (!range) continue
        result.push({ id: mod.id!, statId, series: key, tier: index + 1, level: mod.level!,
          affix: mod.type === 'Prefix' ? 'prefix' : 'suffix', name: mod.affix || '', text: mod.lines.join('\n'),
          statIds: mod.hashes.map((hash) => `explicit.stat_${hash}`), searchMin: range.min, searchMax: range.max, ...range })
      }
    })
  }
  // The official trade stat exposes two numeric placeholders through one
  // scalar input. PoB projects those placeholders to their average, which
  // can make adjacent tiers overlap. Move the lower bound above the highest
  // lower-tier projection so a selected tier does not intentionally include
  // a lower tier in the official search.
  const groups = new Map<string, MarketStatTier[]>()
  for (const tier of result) {
    const groupKey = JSON.stringify([tier.series, tier.statId])
    const group = groups.get(groupKey) || []
    group.push(tier); groups.set(groupKey, group)
  }
  for (const tiers of groups.values()) {
    for (const tier of tiers) {
      const lowerMax = Math.max(...tiers.filter((candidate) => candidate.tier > tier.tier).map((candidate) => candidate.max), -Infinity)
      const safeMin = Number.isFinite(lowerMax) ? Number((lowerMax + 0.01).toFixed(2)) : tier.min
      tier.searchMin = safeMin <= tier.max ? Math.max(tier.min, safeMin) : tier.min
      tier.searchMax = tier.max
    }
  }
  return result.sort((a, b) => Number(a.text.includes('\n')) - Number(b.text.includes('\n'))
    || a.series.localeCompare(b.series) || a.tier - b.tier || a.id.localeCompare(b.id))
}

export function resolveMarketStatTiers(context: MarketStatContext | undefined, scope: ResolvedMarketStatScope,
  data: MarketStatScopeData | undefined, statId: string): MarketStatTier[] {
  if (!statId.startsWith('explicit.') || context?.item?.name || context?.item?.unique
    || ['unique', 'uniquefoil'].includes(context?.rarity || '') || !scope.tierPoolKeys?.length) return []
  const pools = scope.tierPoolKeys.map((key) => (data?.tierPools?.[key] || []).filter((entry) => entry.statId === statId)).filter((rows) => rows.length)
  if (!pools.length) return []
  // A broad category is usable only when its bases agree on the entire series.
  const signature = (rows: MarketStatTier[]) => JSON.stringify(rows.map(({ id, tier, min, max, searchMin, searchMax }) => [id, tier, min, max, searchMin, searchMax]).sort())
  if (pools.some((rows) => signature(rows) !== signature(pools[0]))) return []
  return pools[0]
}
