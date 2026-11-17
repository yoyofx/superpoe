import { normalizeMarketText, scoreLocalizedMatch, type MarketTranslationPair } from './marketPageTranslation.js'

/** Selection identity is independent of the translated label, including null (Any). */
export interface OfficialMarketCandidate {
  key: string
  field: string
  value: string | number | null
  source: string
  text: string
  group: string
  aliases?: string[]
  affixes?: Array<'prefix' | 'suffix'>
  disabled?: boolean
  item?: { type: string; name?: string; unique?: boolean; category?: string; categoryLabel?: string; equipment?: boolean }
}

export interface OfficialItemScope { category: string; rarity: string; categoryLabel?: string; rarityLabel?: string }

const BASE_CATEGORIES: Record<string, string> = {
  Amulet: 'accessory.amulet', Belt: 'accessory.belt', Ring: 'accessory.ring',
  'Body Armour': 'armour.chest', Boots: 'armour.boots', Gloves: 'armour.gloves', Helmet: 'armour.helmet',
  Quiver: 'armour.quiver', Shield: 'armour.shield', Focus: 'armour.focus', Buckler: 'armour.buckler',
  'One Hand Axe': 'weapon.oneaxe', 'Two Hand Axe': 'weapon.twoaxe', 'One Hand Mace': 'weapon.onemace',
  'Two Hand Mace': 'weapon.twomace', 'One Hand Sword': 'weapon.onesword', 'Two Hand Sword': 'weapon.twosword',
  Bow: 'weapon.bow', Crossbow: 'weapon.crossbow', Claw: 'weapon.claw', Dagger: 'weapon.dagger',
  Flail: 'weapon.flail', Spear: 'weapon.spear', Sceptre: 'weapon.sceptre', Staff: 'weapon.staff',
  Wand: 'weapon.wand', 'Fishing Rod': 'weapon.rod', Talisman: 'weapon.talisman',
  Charm: 'flask.charm', Jewel: 'jewel', Flask: 'flask',
}

export function buildOfficialItemCategoryPairs(bases: Record<string, { type?: string; subType?: string }>,
  localizers: Array<(text: string) => string> = []): Array<[string, string]> {
  return Object.entries(bases).flatMap(([name, base]) => {
    const category = base.type === 'Staff' && base.subType === 'Warstaff' ? 'weapon.warstaff'
      : base.type === 'Flask' && ['Life', 'Mana'].includes(base.subType || '') ? `flask.${base.subType!.toLowerCase()}`
      : BASE_CATEGORIES[base.type || '']
    return category ? [name, ...localizers.map((localize) => localize(name))]
      .filter(Boolean).map((label): [string, string] => [label, category]) : []
  })
}

/** Enrich actual selectable rows; catalog entries never create extra options. */
export function enrichOfficialItemCandidates(candidates: readonly OfficialMarketCandidate[], data: unknown,
  categoryPairs: Array<[string, string]>): OfficialMarketCandidate[] {
  const categories = new Map(categoryPairs)
  const entries = new Map<string, { category: string; label: string; unique: boolean }>()
  for (const group of resultGroups(data)) {
    for (const raw of Array.isArray(group.entries) ? group.entries : []) {
      const entry = asRecord(raw)
      if (!entry) continue
      const metadata = { category: String(group.id || ''), label: String(group.label || group.id || ''),
        unique: asRecord(entry.flags)?.unique === true }
      const key = JSON.stringify([entry.type || '', entry.name || ''])
      entries.set(key, metadata)
    }
  }
  return candidates.map((candidate) => {
    if (candidate.field !== 'items' || !candidate.item) return candidate
    const item = candidate.item
    const metadata = entries.get(JSON.stringify([item.type, item.name || '']))
    const category = categories.get(item.type) || metadata?.category || item.category || ''
    return { ...candidate, item: { ...item, category, categoryLabel: metadata?.label,
      unique: item.unique ?? metadata?.unique ?? false,
      equipment: /^(weapon|armour|accessory|jewel|flask)(\.|$)/.test(category) } }
  })
}

export function officialItemCandidateRarity(candidate: OfficialMarketCandidate, scope?: OfficialItemScope): string {
  if (candidate.item?.unique) return 'unique'
  return candidate.item?.equipment && ['normal', 'magic', 'rare'].includes(scope?.rarity || '') ? scope!.rarity : 'base'
}

function itemMatchesScope(candidate: OfficialMarketCandidate, scope?: OfficialItemScope): boolean {
  if (!scope || candidate.field !== 'items') return true
  const item = candidate.item
  if (scope.category) {
    const category = item?.category || ''
    const families: Record<string, string[]> = {
      'weapon.onemelee': ['claw', 'dagger', 'onesword', 'oneaxe', 'onemace', 'spear', 'flail'],
      'weapon.twomelee': ['twosword', 'twoaxe', 'twomace', 'warstaff', 'talisman'],
      'weapon.ranged': ['bow', 'crossbow'], 'weapon.caster': ['wand', 'sceptre', 'staff'],
    }
    if (!(category === scope.category || category.startsWith(scope.category + '.')
      || families[scope.category]?.some((suffix) => category === `weapon.${suffix}`))) return false
  }
  if (['unique', 'uniquefoil'].includes(scope.rarity)) return item?.unique === true
  if (scope.rarity === 'nonunique') return item?.unique !== true
  if (['normal', 'magic', 'rare'].includes(scope.rarity)) {
    if (item?.unique) return false
    if (scope.rarity !== 'normal' && !item?.equipment) return false
    if (scope.rarity === 'rare' && item?.category?.startsWith('flask')) return false
  }
  return true
}

export const MARKET_CANDIDATE_BATCH_SIZE = 100

export function filterOfficialMarketCandidates(
  candidates: readonly OfficialMarketCandidate[], query: string, group = '', scope?: OfficialItemScope,
): OfficialMarketCandidate[] {
  const scoped = candidates.filter((candidate) => (!group || candidate.group === group) && itemMatchesScope(candidate, scope))
  if (!query.trim()) return [...scoped]
  return scoped.flatMap((candidate, index) => {
    const scores = [candidate.text, candidate.source, ...(candidate.aliases || [])].map((text) => scoreLocalizedMatch(query, text))
      .filter((score): score is NonNullable<typeof score> => Boolean(score))
      .sort((a, b) => a.kind - b.kind || b.span - a.span || a.gap - b.gap)
    return scores[0] ? [{ candidate, score: scores[0], index }] : []
  }).sort((a, b) => a.score.kind - b.score.kind || b.score.span - a.score.span
    || a.score.gap - b.score.gap || a.index - b.index).map(({ candidate }) => candidate)
}

export function officialMarketCandidatePage(candidates: readonly OfficialMarketCandidate[], batches = 1): OfficialMarketCandidate[] {
  return candidates.slice(0, MARKET_CANDIDATE_BATCH_SIZE * Math.max(1, Math.floor(batches) || 1))
}

/** Keeps the official field IDs/values, rather than deduplicating by display text. */
export function buildOfficialMarketFilterCandidates(
  data: unknown, localize: (value: string) => string,
): Map<string, OfficialMarketCandidate[]> {
  const result = new Map<string, OfficialMarketCandidate[]>()
  for (const group of resultGroups(data)) {
    for (const raw of Array.isArray(group.filters) ? group.filters : []) {
      const filter = asRecord(raw)
      const field = stringValue(filter?.id)
      if (!field) continue
      const options = asRecord(filter?.option)?.options
      if (!Array.isArray(options)) continue
      const candidates = options.flatMap((rawOption) => {
        const option = asRecord(rawOption)
        const source = stringValue(option?.text)
        const value = option?.id
        if (!source || (value !== null && typeof value !== 'string' && typeof value !== 'number')) return []
        return [{ key: JSON.stringify([field, value]), field, value, source, text: localize(source) || source, group: '' }]
      })
      if (candidates.length) result.set(field, candidates)
    }
  }
  return result
}

export interface OfficialMarketSuggestionCatalog {
  itemPairs: MarketTranslationPair[]
  filterPairsById: Map<string, MarketTranslationPair[]>
  filterLabelsById: Map<string, string>
  statPairs: MarketTranslationPair[]
}

type LocalizeOfficialText = (source: string) => string
type ResolveOfficialSource = (localized: string) => string | undefined

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function resultGroups(value: unknown): Record<string, unknown>[] {
  const root = asRecord(value)
  const result = Array.isArray(root?.result) ? root.result : []
  return result.map(asRecord).filter((group): group is Record<string, unknown> => Boolean(group))
}

function addPair(
  target: MarketTranslationPair[],
  source: unknown,
  localize: LocalizeOfficialText,
  seen: Set<string>,
  resolveSource?: ResolveOfficialSource,
): void {
  const displayedText = stringValue(source)
  if (!displayedText) return
  const sourceText = /[A-Za-z]/u.test(displayedText)
    ? displayedText
    : resolveSource?.(displayedText)
  if (!sourceText) return
  const sourceKey = normalizeMarketText(sourceText).toLocaleLowerCase()
  if (seen.has(sourceKey)) return
  seen.add(sourceKey)
  const targetText = /[A-Za-z]/u.test(displayedText) ? localize(sourceText) || sourceText : displayedText
  if (!targetText) return
  target.push([sourceText, targetText])
}

function optionPairs(
  option: unknown,
  localize: LocalizeOfficialText,
  resolveSource?: ResolveOfficialSource,
): MarketTranslationPair[] {
  const optionRecord = asRecord(option)
  const options = Array.isArray(optionRecord?.options) ? optionRecord.options : []
  const pairs: MarketTranslationPair[] = []
  const seen = new Set<string>()
  for (const entry of options) addPair(pairs, asRecord(entry)?.text, localize, seen, resolveSource)
  return pairs
}

export function buildOfficialMarketSuggestionCatalog(
  itemsData: unknown,
  filtersData: unknown,
  statsData: unknown,
  localize: LocalizeOfficialText,
  resolveSource?: ResolveOfficialSource,
): OfficialMarketSuggestionCatalog {
  const itemPairs: MarketTranslationPair[] = []
  const seenItems = new Set<string>()
  for (const group of resultGroups(itemsData)) {
    const entries = Array.isArray(group.entries) ? group.entries : []
    for (const entry of entries) {
      const item = asRecord(entry)
      addPair(itemPairs, item?.type, localize, seenItems, resolveSource)
      addPair(itemPairs, item?.text, localize, seenItems, resolveSource)
      addPair(itemPairs, item?.name, localize, seenItems, resolveSource)
    }
  }

  const filterPairsById = new Map<string, MarketTranslationPair[]>()
  const filterLabelsById = new Map<string, string>()
  for (const group of resultGroups(filtersData)) {
    const filters = Array.isArray(group.filters) ? group.filters : []
    for (const filter of filters) {
      const filterRecord = asRecord(filter)
      const id = stringValue(filterRecord?.id)
      if (!id) continue
      const label = stringValue(filterRecord?.text || filterRecord?.label)
      if (label) filterLabelsById.set(id, label)
      const pairs = optionPairs(filterRecord?.option, localize, resolveSource)
      if (!pairs.length) continue
      filterPairsById.set(id, pairs)
    }
  }

  const statPairs: MarketTranslationPair[] = []
  const seenStats = new Set<string>()
  for (const group of resultGroups(statsData)) {
    const entries = Array.isArray(group.entries) ? group.entries : []
    for (const entry of entries) addPair(statPairs, asRecord(entry)?.text, localize, seenStats, resolveSource)
  }

  return { itemPairs, filterPairsById, filterLabelsById, statPairs }
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

/**
 * Builds the same official-only catalog as the synchronous helper, but yields
 * between batches so a large item/stat catalog cannot block the market page.
 */
export async function buildOfficialMarketSuggestionCatalogAsync(
  itemsData: unknown,
  filtersData: unknown,
  statsData: unknown,
  localize: LocalizeOfficialText,
  batchSize = 200,
  resolveSource?: ResolveOfficialSource,
): Promise<OfficialMarketSuggestionCatalog> {
  const itemPairs: MarketTranslationPair[] = []
  const seenItems = new Set<string>()
  let work = 0
  const checkpoint = async (): Promise<void> => {
    work += 1
    if (work % batchSize === 0) await yieldToEventLoop()
  }

  for (const group of resultGroups(itemsData)) {
    const entries = Array.isArray(group.entries) ? group.entries : []
    for (const entry of entries) {
      const item = asRecord(entry)
      addPair(itemPairs, item?.type, localize, seenItems, resolveSource)
      addPair(itemPairs, item?.text, localize, seenItems, resolveSource)
      addPair(itemPairs, item?.name, localize, seenItems, resolveSource)
      await checkpoint()
    }
  }

  const filterPairsById = new Map<string, MarketTranslationPair[]>()
  const filterLabelsById = new Map<string, string>()
  for (const group of resultGroups(filtersData)) {
    const filters = Array.isArray(group.filters) ? group.filters : []
    for (const filter of filters) {
      const filterRecord = asRecord(filter)
      const id = stringValue(filterRecord?.id)
      if (!id) continue
      const label = stringValue(filterRecord?.text || filterRecord?.label)
      if (label) filterLabelsById.set(id, label)
      const pairs = optionPairs(filterRecord?.option, localize, resolveSource)
      if (pairs.length) filterPairsById.set(id, pairs)
      await checkpoint()
    }
  }

  const statPairs: MarketTranslationPair[] = []
  const seenStats = new Set<string>()
  for (const group of resultGroups(statsData)) {
    const entries = Array.isArray(group.entries) ? group.entries : []
    for (const entry of entries) {
      addPair(statPairs, asRecord(entry)?.text, localize, seenStats, resolveSource)
      await checkpoint()
    }
  }

  return { itemPairs, filterPairsById, filterLabelsById, statPairs }
}
