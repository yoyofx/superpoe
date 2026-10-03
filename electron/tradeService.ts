import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type {
  LibraryItemSnapshot, LibraryModifier, MarketRealm, TradeLeague, TradePriceCheckCriteria,
  PriceCheckMode, TradePriceCheckDraft, TradeSearchResult, TradeStatResolutionSnapshot, TradeXiletradeFilters, TradeFilterRarity,
} from '../src/types/market.js'
import { XILETRADE_DEFAULT_LISTED_STATUS } from '../src/types/market.js'
import type { MarketViewManager } from './marketView.js'
import { OfficialTradeRequestError } from './officialTradeRequestError.js'
import type { ClientLogger } from './clientLogger.js'
import { resolveXiletradeItemQueryRouting, type XiletradeItemQueryRouting } from './xiletradeDataCatalog.js'

export interface CatalogOption { id: string; text: string }
export interface CatalogEntry { id: string; text: string; type?: string; option?: { options?: CatalogOption[] } }
export interface CatalogSnapshot { realm: MarketRealm; fetchedAt: string; payloadHash: string; entries: CatalogEntry[] }

interface SearchResponse { id?: unknown; total?: unknown; result?: unknown }

export interface TradeSearchListingReference {
  listingId: string
  queryId: string
}

const WEIGHTED_SEARCH_PAGE_SIZE = 10
const WEIGHTED_SEARCH_FETCH_PAGES_DEFAULT = 2
const WEIGHTED_SEARCH_FETCH_PAGES_MAX = 10
const WEIGHTED_SEARCH_MAX_RECURSION = 5

const CATALOG_TTL = 24 * 60 * 60 * 1_000

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function clean(value: unknown): string {
  return typeof value === 'string' ? value.replace(/<<[^>]+>>/g, '').trim() : ''
}

function usableGlobalItemText(value: unknown): string | undefined {
  const text = clean(value)
  if (!text || /(?:\?{2,}|\uFFFD|[\u3400-\u9fff\uac00-\ud7af])/u.test(text)) return undefined
  return text
}

function searchResultIds(response: SearchResponse): string[] {
  return Array.isArray(response.result)
    ? response.result.filter((value): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]+$/.test(value))
    : []
}

function listingReferences(ids: string[], queryId: string | undefined, limit = ids.length): TradeSearchListingReference[] {
  if (!queryId) return []
  return ids.slice(0, limit).map((listingId) => ({ listingId, queryId }))
}

function uniqueListingReferences(references: TradeSearchListingReference[], limit: number): TradeSearchListingReference[] {
  const seen = new Set<string>()
  return references.filter((reference) => {
    if (seen.has(reference.listingId) || seen.size >= limit) return false
    seen.add(reference.listingId)
    return true
  })
}

function weightedMin(query: unknown): number | undefined {
  const root = record(query)
  const body = record(root.query)
  const stats = Array.isArray(body.stats) ? body.stats : []
  const weight = record(stats[0])
  const value = record(weight.value)
  return finiteValue(typeof value.min === 'number' ? value.min : undefined)
}

function setWeightedMin(query: unknown, min: number): unknown {
  const next = structuredClone(query) as Record<string, unknown>
  const body = record(next.query)
  const stats = Array.isArray(body.stats) ? body.stats : []
  const weight = record(stats[0])
  const value = record(weight.value)
  value.min = min
  weight.value = value
  stats[0] = weight
  body.stats = stats
  next.query = body
  return next
}

function isWeightedQuery(query: unknown): boolean {
  const body = record(record(query).query)
  const stats = Array.isArray(body.stats) ? body.stats : []
  return record(stats[0]).type === 'weight' && weightedMin(query) != null
}

function weightedFetchLimit(fetchPages: number | undefined): number {
  const pages = Number.isInteger(fetchPages) && fetchPages != null
    ? Math.min(Math.max(fetchPages, 1), WEIGHTED_SEARCH_FETCH_PAGES_MAX)
    : WEIGHTED_SEARCH_FETCH_PAGES_DEFAULT
  return pages * WEIGHTED_SEARCH_PAGE_SIZE
}

function listedWeight(value: unknown): number | undefined {
  const item = record(record(value).item)
  const candidates = [item.weight, item.pseudoMods, item.pseudo_mods]
  for (const candidate of candidates) {
    const values = Array.isArray(candidate) ? candidate : [candidate]
    for (const entry of values) {
      const text = typeof entry === 'string' ? entry : clean(record(entry).text || record(entry).description)
      const match = text.match(/(?:^|\b)Sum:\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))/i)
      if (match) {
        const value = Number(match[1])
        if (Number.isFinite(value)) return value
      }
    }
  }
  return undefined
}

function parseEntries(payload: unknown): CatalogEntry[] {
  const groups = Array.isArray(record(payload).result) ? record(payload).result as unknown[] : []
  return groups.flatMap((group) => {
    const entries = Array.isArray(record(group).entries) ? record(group).entries as unknown[] : []
    return entries.flatMap((raw) => {
      const entry = record(raw)
      const id = clean(entry.id)
      const text = clean(entry.text)
      if (!id || !text) return []
      const optionValues = Array.isArray(record(entry.option).options) ? record(entry.option).options as unknown[] : []
      const options = optionValues.flatMap((rawOption) => {
        const option = record(rawOption)
        const optionId = clean(option.id)
        const optionText = clean(option.text)
        return optionId && optionText ? [{ id: optionId, text: optionText }] : []
      })
      return [{ id, text, type: clean(entry.type) || undefined, ...(options.length ? { option: { options } } : {}) }]
    })
  })
}

export class TradeReferenceDataCache {
  private readonly memory = new Map<MarketRealm, CatalogSnapshot>()

  constructor(private readonly directory: string) {}

  async get(realm: MarketRealm, fetcher: () => Promise<unknown>): Promise<CatalogSnapshot> {
    const current = this.memory.get(realm) || this.read(realm)
    if (current && Date.now() - Date.parse(current.fetchedAt) < CATALOG_TTL) {
      this.memory.set(realm, current)
      return current
    }
    try {
      const payload = await fetcher()
      const entries = parseEntries(payload)
      if (!entries.length) throw new Error('Official trade stat catalog is empty')
      const serialized = JSON.stringify(payload)
      const snapshot: CatalogSnapshot = {
        realm,
        fetchedAt: new Date().toISOString(),
        payloadHash: createHash('sha256').update(serialized).digest('hex'),
        entries,
      }
      this.memory.set(realm, snapshot)
      this.write(snapshot)
      return snapshot
    } catch (error) {
      if (current) return current
      throw error
    }
  }

  private filePath(realm: MarketRealm): string { return path.join(this.directory, `stats-${realm}.v1.json`) }

  private read(realm: MarketRealm): CatalogSnapshot | undefined {
    try {
      const file = this.filePath(realm)
      if (!existsSync(file)) return undefined
      const parsed = JSON.parse(readFileSync(file, 'utf8')) as CatalogSnapshot
      return parsed.realm === realm && Array.isArray(parsed.entries) ? parsed : undefined
    } catch { return undefined }
  }

  private write(snapshot: CatalogSnapshot): void {
    mkdirSync(this.directory, { recursive: true })
    writeFileSync(this.filePath(snapshot.realm), JSON.stringify(snapshot), { encoding: 'utf8', mode: 0o600 })
  }

}

function localizedTradeBaseType(item: LibraryItemSnapshot): string | undefined {
  const localized = clean(item.localized?.['zh-CN']?.baseType)
  if (!localized) return undefined
  if (!item.baseType || localized !== item.baseType || !/[A-Za-z]/.test(item.baseType)) return localized
  return undefined
}

function queryItemType(item: LibraryItemSnapshot, realm: MarketRealm): string | undefined {
  if (realm === 'cn') return localizedTradeBaseType(item) || (!/[A-Za-z]/.test(item.baseType) ? clean(item.baseType) : undefined)
  return usableGlobalItemText(item.baseType)
}

function queryItemName(item: LibraryItemSnapshot, realm: MarketRealm): string | undefined {
  if (realm === 'cn') return clean(item.localized?.['zh-CN']?.name) || (!/[A-Za-z]/.test(item.name) ? clean(item.name) : undefined)
  return usableGlobalItemText(item.name)
}

function isUniqueItem(item: LibraryItemSnapshot): boolean {
  const rarity = clean(item.rarity).toLocaleLowerCase()
  return rarity === 'unique' || rarity === 'uniquefoil'
}

function resolutionFor(modifier: LibraryModifier, realm: MarketRealm): TradeStatResolutionSnapshot | undefined {
  return modifier.tradeResolutions.find((candidate) => candidate.realm === realm
    && candidate.status === 'resolved'
    && candidate.queryStatId)
}

function resolutionIds(resolution: TradeStatResolutionSnapshot | undefined): string[] {
  return resolution?.queryStatId ? [resolution.queryStatId] : []
}

function finiteValue(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function selectedRange(
  resolution: TradeStatResolutionSnapshot,
  min: number | undefined,
  max: number | undefined,
): { min?: number; max?: number } | undefined {
  const range = { min: finiteValue(min), max: finiteValue(max) }
  if (range.min == null && range.max == null) return undefined
  if (resolution.valueTransform === 'negate') {
    return {
      min: range.max == null ? undefined : -range.max,
      max: range.min == null ? undefined : -range.min,
    }
  }
  return range.min == null && range.max == null ? undefined : range
}

function rangeObject(range: { min?: number; max?: number } | undefined): Record<string, number> | undefined {
  if (!range || (range.min == null && range.max == null)) return undefined
  return {
    ...(range.min == null ? {} : { min: range.min }),
    ...(range.max == null ? {} : { max: range.max }),
  }
}

function optionObject(value: string | undefined): { option: string } | undefined {
  return value ? { option: value } : undefined
}

type XiletradeItemLevelTarget = {
  section: 'type_filters' | 'misc_filters' | 'map_filters'
  key: 'ilvl' | 'gem_level' | 'area_level'
  also?: Array<Pick<XiletradeItemLevelTarget, 'section' | 'key'>>
}

function xiletradeItemRouting(item: LibraryItemSnapshot): XiletradeItemQueryRouting {
  const localized = item.localized?.['zh-CN']
  return resolveXiletradeItemQueryRouting({
    itemClass: item.itemClass,
    itemClassOrigin: item.itemClassOrigin,
    tradeCategory: item.tradeCategory,
    rarity: item.rarity,
    name: item.name || localized?.name,
    baseType: item.baseType || localized?.baseType,
    identified: item.identified,
  })
}

/** Mirrors ItemFlag's useIlvl/Area/Gem routing in JsonDataTwoFactory. */
function xiletradeItemLevelTarget(item: LibraryItemSnapshot): XiletradeItemLevelTarget | undefined {
  const routing = xiletradeItemRouting(item)
  if (routing.gems) {
    return { section: 'misc_filters', key: 'gem_level' }
  }
  // JsonDataTwoFactory writes the generic level control to type_filters for
  // every non-gem item, and adds the area-specific control for area items.
  return {
    section: 'type_filters',
    key: 'ilvl',
    ...(routing.area ? { also: [{ section: 'misc_filters', key: 'area_level' }] } : {}),
  }
}

/** Mirrors RarityViewModel(ItemData)'s automatic initial selection. */
function xiletradeDefaultRarity(item: LibraryItemSnapshot, routing: XiletradeItemQueryRouting): TradeFilterRarity | undefined {
  const rarity = clean(item.rarity).toLocaleLowerCase()
  if (routing.foilVariant) return 'uniquefoil'
  if (routing.unique) return 'unique'
  if (!routing.unique && (
    routing.map
    || routing.waystone
    || routing.invitation
    || routing.logbook
    || routing.voidstone
  )) return 'nonunique'
  if (!routing.unique && !routing.waystone && (
    routing.mapFragment
    || routing.miscMapItems
    || routing.exchangeCurrency
    || routing.currency
  )) return 'any'
  if (rarity === 'normal' || rarity === 'magic' || rarity === 'rare') return rarity
  return undefined
}

function intersectOrThrow(
  left: { min?: number; max?: number } | undefined,
  right: { min?: number; max?: number } | undefined,
  label: string,
): { min?: number; max?: number } | undefined {
  const result = intersectRanges(left, right)
  if (result?.min != null && result.max != null && result.min > result.max) {
    throw new Error(`Xiletrade ${label} range has no overlap`)
  }
  return result
}

function intersectRanges(
  left: { min?: number; max?: number } | undefined,
  right: { min?: number; max?: number } | undefined,
): { min?: number; max?: number } | undefined {
  if (!left) return right
  if (!right) return left
  const min = left.min == null ? right.min : right.min == null ? left.min : Math.max(left.min, right.min)
  const max = left.max == null ? right.max : right.max == null ? left.max : Math.min(left.max, right.max)
  return { ...(min == null ? {} : { min }), ...(max == null ? {} : { max }) }
}

function buildXiletradeFilterPayload(
  filters: TradeXiletradeFilters | undefined,
  itemLevelTarget: XiletradeItemLevelTarget | undefined,
  includeDefaultSaleType = false,
  mapFiltersEnabled = false,
  defaultRarity?: TradeFilterRarity,
): Record<string, unknown> {
  const type: Record<string, unknown> = {}
  const rarity = filters?.rarity || defaultRarity
  if (rarity && rarity !== 'any') type.rarity = optionObject(rarity)
  const itemLevel = rangeObject(filters?.itemLevel)
  if (itemLevel && itemLevelTarget?.section === 'type_filters') type.ilvl = itemLevel
  for (const target of itemLevelTarget?.also || []) {
    if (itemLevel && target.section === 'type_filters') type[target.key] = itemLevel
  }
  const quality = rangeObject(filters?.quality)
  if (quality) type.quality = quality

  const requirement: Record<string, unknown> = {}
  const requiredLevel = rangeObject(filters?.requiredLevel)
  if (requiredLevel) requirement.lvl = requiredLevel

  const equipment: Record<string, unknown> = {}
  const equipmentMap: Array<[keyof NonNullable<TradeXiletradeFilters['equipment']>, string]> = [
    ['armour', 'ar'], ['energyShield', 'es'], ['evasion', 'ev'], ['runicWard', 'ward'],
    ['damagePerSecond', 'dps'], ['elementalDps', 'edps'], ['physicalDps', 'pdps'],
    ['runeSockets', 'rune_sockets'],
  ]
  for (const [sourceKey, apiKey] of equipmentMap) {
    const value = rangeObject(filters?.equipment?.[sourceKey])
    if (value) equipment[apiKey] = value
  }

  const map: Record<string, unknown> = {}
  const mapMap: Array<[keyof NonNullable<TradeXiletradeFilters['map']>, string]> = [
    ['itemRarity', 'map_iir'],
    ['packSize', 'map_packsize'], ['rareMonsters', 'map_rare_monsters'],
    ['magicMonsters', 'map_magic_monsters'], ['bonus', 'map_bonus'],
    ['revives', 'map_revives'],
  ]
  if (mapFiltersEnabled) {
    for (const [sourceKey, apiKey] of mapMap) {
      const value = rangeObject(filters?.map?.[sourceKey])
      if (value) map[apiKey] = value
    }
  }

  const misc: Record<string, unknown> = {}
  const miscBooleanMap: Array<[keyof NonNullable<TradeXiletradeFilters['misc']>, string]> = [
    ['mirrored', 'mirrored'], ['corrupted', 'corrupted'], ['twiceCorrupted', 'twice_corrupted'],
    ['identified', 'identified'], ['fractured', 'fractured_item'],
    ['crafted', 'crafted'], ['mutated', 'mutated'], ['desecrated', 'desecrated'],
    ['veiled', 'veiled'], ['sanctified', 'sanctified'],
  ]
  for (const [sourceKey, apiKey] of miscBooleanMap) {
    const value = filters?.misc?.[sourceKey]
    if (typeof value === 'string') misc[apiKey] = optionObject(value)
  }
  const miscRangeMap: Array<[keyof NonNullable<TradeXiletradeFilters['misc']>, string]> = [
    ['gemLevel', 'gem_level'], ['gemSockets', 'gem_sockets'], ['areaLevel', 'area_level'],
  ]
  for (const [sourceKey, apiKey] of miscRangeMap) {
    const value = rangeObject(filters?.misc?.[sourceKey] as { min?: number; max?: number } | undefined)
    if (value) misc[apiKey] = value
  }
  if (itemLevel && itemLevelTarget?.section === 'misc_filters') {
    misc[itemLevelTarget.key] = itemLevel
  }
  for (const target of itemLevelTarget?.also || []) {
    if (itemLevel && target.section === 'misc_filters') misc[target.key] = itemLevel
  }

  const trade: Record<string, unknown> = {}
  const price = rangeObject(filters?.trade?.price)
  if (price || filters?.trade?.price?.currency) {
    trade.price = {
      ...(price || {}),
      ...(filters?.trade?.price?.currency ? { option: filters.trade.price.currency } : {}),
    }
  }
  if (filters?.trade?.indexed) trade.indexed = optionObject(filters.trade.indexed)
  // Xiletrade's price-check serialization opts into its fixed instant-buyout
  // filter. There is no user-selectable sale-type override in that flow.
  const saleType = includeDefaultSaleType ? { option: 'priced' } : undefined
  if (saleType) trade.sale_type = saleType
  return {
    ...(Object.keys(type).length ? { type_filters: { disabled: false, filters: type } } : {}),
    ...(Object.keys(requirement).length ? { req_filters: { disabled: false, filters: requirement } } : {}),
    ...(Object.keys(map).length ? { map_filters: { disabled: false, filters: map } } : {}),
    ...(Object.keys(equipment).length ? { equipment_filters: { disabled: false, filters: equipment } } : {}),
    ...(Object.keys(misc).length ? { misc_filters: { disabled: false, filters: misc } } : {}),
    ...(Object.keys(trade).length ? { trade_filters: { disabled: false, filters: trade } } : {}),
  }
}

function xiletradeQueryIdentity(
  item: LibraryItemSnapshot,
  realm: MarketRealm,
  criteria: TradePriceCheckCriteria | undefined,
): { name?: string; type?: string } {
  const routing = xiletradeItemRouting(item)
  const byBase = criteria?.useBaseType === true || routing.byBase
  const type = byBase ? queryItemType(item, realm) : undefined
  const name = byBase && (routing.unique || routing.foilVariant) ? queryItemName(item, realm) : undefined
  return {
    ...(name ? { name } : {}),
    ...(type ? { type } : {}),
  }
}

function applyXiletradeQueryIdentity(
  root: Record<string, unknown>,
  item: LibraryItemSnapshot,
  realm: MarketRealm,
  criteria: TradePriceCheckCriteria | undefined,
): void {
  delete root.name
  delete root.type
  Object.assign(root, xiletradeQueryIdentity(item, realm, criteria))
}

const FIND_BETTER_GENERATED_FILTER_KEYS: Record<string, readonly string[]> = {
  // These are the only non-identity filters currently added by the local
  // PoB2 weighted-query bridge: max level, empty socket count, and max price.
  // Xiletrade rebuilds all automatic type/category/rarity filters below.
  req_filters: ['lvl'],
  equipment_filters: ['rune_sockets'],
  trade_filters: ['price'],
}

function sanitizeFindBetterGeneratedFilters(root: Record<string, unknown>): void {
  const source = record(root.filters)
  const filters: Record<string, unknown> = {}
  for (const [sectionName, allowedKeys] of Object.entries(FIND_BETTER_GENERATED_FILTER_KEYS)) {
    const section = record(source[sectionName])
    const values = record(section.filters)
    const allowed = new Set(allowedKeys)
    const retained = Object.fromEntries(Object.entries(values).filter(([key]) => allowed.has(key)))
    if (Object.keys(retained).length) {
      // Generated filters are active by definition. Do not carry a disabled
      // flag from a PoB2 query into the final Xiletrade request.
      filters[sectionName] = { disabled: false, filters: retained }
    }
  }
  if (Object.keys(filters).length) root.filters = filters
  else delete root.filters
}

function applyItemLevelRange(
  root: Record<string, unknown>,
  item: LibraryItemSnapshot,
  range: { min?: number; max?: number } | undefined,
): void {
  if (!range) return
  const target = xiletradeItemLevelTarget(item)
  if (!target) return
  const filters = record(root.filters)
  for (const currentTarget of [target, ...(target.also || [])]) {
    const section = record(filters[currentTarget.section])
    const values = record(section.filters)
    values[currentTarget.key] = rangeObject(intersectOrThrow(
      range,
      values[currentTarget.key] as { min?: number; max?: number } | undefined,
      currentTarget.key,
    ))
    section.filters = values
    section.disabled = false
    filters[currentTarget.section] = section
  }
  root.filters = filters
}

export function createPriceCheckDraft(item: LibraryItemSnapshot, realm: MarketRealm): TradePriceCheckDraft {
  const localized = item.localized?.['zh-CN']
  const routing = xiletradeItemRouting(item)
  return {
    realm,
    rarity: item.rarity,
    name: item.name,
    baseType: item.baseType,
    xiletradeDefaultRarity: xiletradeDefaultRarity(item, routing),
    ...(item.tradeCategory ? { tradeCategory: item.tradeCategory } : {}),
    ...(item.itemClass ? { itemClass: item.itemClass } : {}),
    ...(item.rawText ? { rawText: item.rawText } : {}),
    localizedName: localized?.name,
    localizedBaseType: localized?.baseType,
    unique: isUniqueItem(item),
    itemLevel: item.itemLevel,
    modifiers: item.modifiers.map((modifier) => {
      const resolution = resolutionFor(modifier, realm)
      const rawValue = modifier.currentValues[0]
      const currentValue = resolution?.valueTransform === 'negate' && rawValue != null ? -rawValue : rawValue
      return {
        id: modifier.id,
        group: modifier.group,
        sourceTags: modifier.sourceTags,
        affixKind: modifier.affixKind,
        lines: modifier.original.lines,
        localizedLines: modifier.localized?.['zh-CN']?.lines,
        searchable: resolutionIds(resolution).length > 0,
        valueMode: resolution?.valueMode || modifier.valueMode,
        ...(currentValue == null ? {} : { currentValue }),
      }
    }),
  }
}

export function buildTradeQuery(item: LibraryItemSnapshot, realm: MarketRealm, criteria?: TradePriceCheckCriteria, mode: PriceCheckMode = 'price-check'): { query: unknown; resolved: number; unresolved: number } {
  const selected = criteria ? new Map(criteria.modifiers.map((modifier) => [modifier.id, modifier])) : undefined
  const statFilters: Array<{ id: string; value?: { min?: number; max?: number } }> = []
  let resolvedModifierCount = 0
  for (const modifier of item.modifiers) {
    const selection = selected?.get(modifier.id)
    if (selected && !selection) continue
    const resolution = resolutionFor(modifier, realm)
    const statIds = resolutionIds(resolution)
    if (!resolution || !statIds.length) continue
    const value = resolution.valueMode === 'numeric'
      ? (criteria ? selectedRange(resolution, selection?.min, selection?.max) : { min: modifier.currentValues[0] })
      : undefined
    const filter = { id: statIds[0], ...(value ? { value } : {}) }
    resolvedModifierCount += 1
    statFilters.push(filter)
  }
  const weighted = mode === 'find-better'
  const queryStats = weighted
    ? (statFilters.length ? [{
      type: 'weight',
      value: { min: 0 },
      filters: statFilters.map((filter) => ({ id: filter.id, value: { weight: 1 } })),
    }] : [])
    : (statFilters.length ? [{ type: 'and' as const, filters: statFilters }] : [])
  const type = queryItemType(item, realm)
  const itemLevelTarget = xiletradeItemLevelTarget(item)
  const legacyItemLevel = criteria && (criteria.itemLevelMin != null || criteria.itemLevelMax != null)
    ? rangeObject({ min: finiteValue(criteria.itemLevelMin), max: finiteValue(criteria.itemLevelMax) })
    : undefined
  const routing = xiletradeItemRouting(item)
  const xiletradeFilters = buildXiletradeFilterPayload(
    criteria?.xiletrade,
    itemLevelTarget,
    true,
    routing.waystone,
    xiletradeDefaultRarity(item, routing),
  )
  if (legacyItemLevel && itemLevelTarget) {
    const targets = [itemLevelTarget, ...(itemLevelTarget.also || [])]
    for (const target of targets) {
      const section = (xiletradeFilters[target.section] && typeof xiletradeFilters[target.section] === 'object'
        ? xiletradeFilters[target.section] : { disabled: false, filters: {} }) as Record<string, unknown>
      const values = (section.filters && typeof section.filters === 'object' ? section.filters : {}) as Record<string, unknown>
      values[target.key] = rangeObject(intersectOrThrow(
        legacyItemLevel,
        values[target.key] as { min?: number; max?: number } | undefined,
        target.key,
      ))
      section.disabled = false
      section.filters = values
      xiletradeFilters[target.section] = section
    }
  }
  const xiletradeTypeFilters = xiletradeFilters.type_filters as { filters?: Record<string, unknown> } | undefined
  const typeFilterValues = {
    ...(xiletradeTypeFilters?.filters || {}),
  }
  const routingCategory = xiletradeItemRouting(item).tradeCategory
  const queryFilters = {
    ...(Object.keys(typeFilterValues).length || routingCategory
      ? { type_filters: { disabled: false, ...(xiletradeTypeFilters || {}), filters: { ...typeFilterValues, ...(routingCategory ? { category: { option: routingCategory } } : {}) } } }
      : (xiletradeTypeFilters ? { type_filters: xiletradeTypeFilters } : {})),
    ...(xiletradeFilters.map_filters ? { map_filters: xiletradeFilters.map_filters } : {}),
    ...(xiletradeFilters.misc_filters ? { misc_filters: xiletradeFilters.misc_filters } : {}),
    ...(xiletradeFilters.req_filters ? { req_filters: xiletradeFilters.req_filters } : {}),
    ...(xiletradeFilters.equipment_filters ? { equipment_filters: xiletradeFilters.equipment_filters } : {}),
    ...(xiletradeFilters.trade_filters ? { trade_filters: xiletradeFilters.trade_filters } : {}),
  }
  const requestedCount = selected?.size ?? item.modifiers.length
  // FormViewModel automatically turns on base search for ItemFlag.ByBase
  // items (unique/normal/currency/maps/gems/flasks/etc.). The explicit user
  // checkbox can turn it on for every other item as well. ItemFlag.ByType is
  // a different classification and must not be used for this decision.
  const identity = xiletradeQueryIdentity(item, realm, criteria)
  return {
    query: {
      query: {
        status: { option: criteria?.listedStatus || XILETRADE_DEFAULT_LISTED_STATUS },
        ...identity,
        stats: queryStats,
        ...(Object.keys(queryFilters).length ? { filters: queryFilters } : {}),
      },
      sort: weighted ? { 'statgroup.0': 'desc' } : { price: 'asc' },
    },
    resolved: resolvedModifierCount,
    unresolved: requestedCount - resolvedModifierCount,
  }
}

function withoutQueryItemName(query: unknown): unknown | undefined {
  const next = structuredClone(query) as { query?: unknown }
  const root = record(next.query)
  if (!Object.prototype.hasOwnProperty.call(root, 'name')) return undefined
  delete root.name
  next.query = root
  return next
}

function logTradeQuery(
  realm: MarketRealm,
  leagueId: string,
  phase: 'detailed' | 'identity-fallback',
  mode: PriceCheckMode,
  item: LibraryItemSnapshot,
  query: unknown,
  resolvedModifierCount: number,
  unresolvedModifierCount: number,
  logger?: ClientLogger,
): void {
  const summary = {
    realm,
    leagueId,
    phase,
    mode,
    // Keep the source item metadata visibly separate from the API query.
    // This prevents the diagnostic name from being mistaken for query.name.
    sourceItem: {
      name: item.name,
      baseType: item.baseType,
      rarity: item.rarity,
      modifiers: item.modifiers.map((modifier) => ({
        group: modifier.group,
        text: modifier.original.displayText.slice(0, 240),
        values: modifier.currentValues,
        resolutions: modifier.tradeResolutions
          .filter((resolution) => resolution.realm === realm)
          .map((resolution) => ({
            status: resolution.status,
            queryStatId: resolution.queryStatId,
            candidateStatIds: resolution.candidateStatIds,
          })),
      })),
    },
    resolvedModifierCount,
    unresolvedModifierCount,
    query,
  }
  console.info(`[Market search] submit ${JSON.stringify(summary)}`)
  logger?.info('market-search', 'query-submitted', summary)
}

export class OfficialTradeProvider {
  private queue: Promise<void> = Promise.resolve()
  private lastRequestAt = 0

  constructor(
    private readonly manager: MarketViewManager,
    private readonly cache: TradeReferenceDataCache,
    private readonly embeddedCatalog?: (realm: MarketRealm) => Promise<CatalogSnapshot>,
    private readonly projectItem?: (realm: MarketRealm, item: LibraryItemSnapshot, catalog: CatalogSnapshot) => Promise<LibraryItemSnapshot> | LibraryItemSnapshot,
    private readonly logger?: ClientLogger,
  ) {}

  stats(realm: MarketRealm): Promise<CatalogSnapshot> {
    return this.cache.get(realm, () => this.limited(() => this.manager.fetchStats(realm)))
  }

  async leagues(realm: MarketRealm): Promise<TradeLeague[]> {
    const payload = record(await this.limited(() => this.manager.fetchLeagues(realm)))
    const result = Array.isArray(payload.result) ? payload.result : []
    return result.flatMap((raw) => {
      const league = record(raw)
      const id = clean(league.id)
      const text = clean(league.text) || id
      return id ? [{ id, text }] : []
    }).slice(0, 100)
  }

  async prepare(realm: MarketRealm, item: LibraryItemSnapshot): Promise<{ draft: TradePriceCheckDraft; resolvedItem: LibraryItemSnapshot }> {
    const catalog = this.embeddedCatalog ? await this.embeddedCatalog(realm) : await this.stats(realm)
    const resolvedItem = this.projectItem ? await this.projectItem(realm, item, catalog) : structuredClone(item)
    return { draft: createPriceCheckDraft(resolvedItem, realm), resolvedItem }
  }

  /**
   * Mirrors PoB2's SearchWithQueryWeightAdjusted loop. A weighted query is
   * repeatedly narrowed or widened until the API can provide a useful,
   * bounded candidate set. The final query remains the one used for the
   * generated trade URL.
   */
  private async searchWeighted(
    realm: MarketRealm,
    leagueId: string,
    initialQuery: unknown,
    maxFetchPerSearch: number,
  ): Promise<{ query: unknown; response: SearchResponse; listingIds: string[]; listingReferences: TradeSearchListingReference[] }> {
    let query = structuredClone(initialQuery)
    let previousSearch: { queryId: string; listingIds: string[] } | undefined
    for (let attempt = 0; attempt < WEIGHTED_SEARCH_MAX_RECURSION; attempt += 1) {
      const response = record(await this.limited(() => this.manager.search(realm, leagueId, query))) as SearchResponse
      const ids = searchResultIds(response)
      const total = typeof response.total === 'number' && Number.isFinite(response.total) ? response.total : ids.length
      const min = weightedMin(query)
      const searchId = clean(response.id)
      const currentReferences = listingReferences(ids, searchId, maxFetchPerSearch)
      if (!isWeightedQuery(query) || min == null) {
        return { query, response, listingIds: currentReferences.map((reference) => reference.listingId), listingReferences: currentReferences }
      }

      const finish = (): { query: unknown; response: SearchResponse; listingIds: string[]; listingReferences: TradeSearchListingReference[] } => {
        const references = previousSearch && total < maxFetchPerSearch
          ? uniqueListingReferences([
            ...currentReferences,
            ...listingReferences(previousSearch.listingIds, previousSearch.queryId, maxFetchPerSearch),
          ], maxFetchPerSearch)
          : currentReferences
        return { query, response, listingIds: references.map((reference) => reference.listingId), listingReferences: references }
      }

      if (ids.length > 0 && total > maxFetchPerSearch && total < 10_000) return finish()
      if (attempt === WEIGHTED_SEARCH_MAX_RECURSION - 1) return finish()

      if (total < maxFetchPerSearch || ids.length === 0) {
        // PoB2 halves the lower bound when too few listings match.
        query = setWeightedMin(query, min / 2)
        continue
      }

      // The API is clipped at 10,000 results. Fetch the highest-weight item
      // from the current search and bisect between its score and the bound.
      if (!searchId || !this.manager.fetchListings) return finish()
      const firstBatch = ids.slice(0, WEIGHTED_SEARCH_PAGE_SIZE)
      const fetched = record(await this.limited(() => this.manager.fetchListings(realm, firstBatch, searchId)))
      const entries = Array.isArray(fetched.result) ? fetched.result : []
      const highestWeight = entries.map(listedWeight).find((value): value is number => value != null)
      if (highestWeight == null || !Number.isFinite(highestWeight)) {
        return finish()
      }
      previousSearch = { queryId: searchId, listingIds: ids }
      query = setWeightedMin(query, (highestWeight + min) / 2)
    }
    // The loop always returns, but keep the fallback explicit for type safety.
    return { query, response: {}, listingIds: [], listingReferences: [] }
  }

  async search(
    realm: MarketRealm,
    leagueId: string,
    item: LibraryItemSnapshot,
    criteria?: TradePriceCheckCriteria,
    mode: PriceCheckMode = 'price-check',
    queryOverride?: { query: unknown; resolved?: number },
  ): Promise<TradeSearchResult & { resolvedItem: LibraryItemSnapshot; listingIds: string[]; listingReferences?: TradeSearchListingReference[] }> {
    const { resolvedItem } = await this.prepare(realm, item)
    const built = queryOverride
      ? { query: queryOverride.query, resolved: queryOverride.resolved ?? 0, unresolved: 0 }
      : buildTradeQuery(resolvedItem, realm, criteria, mode)
    // A direct item search may contain a modifier that Xiletrade cannot map;
    // omit that modifier and keep the searchable subset. An explicit price
    // check selection is different: silently dropping the user's condition
    // would produce a misleading result, so reject it instead.
    if (!queryOverride && criteria && built.unresolved > 0) {
      throw new Error(`Xiletrade could not resolve ${built.unresolved} selected modifier${built.unresolved === 1 ? '' : 's'}; query was not submitted`)
    }
    let query = built.query
    if (queryOverride && query && typeof query === 'object') {
      const overrideQuery = structuredClone(query) as { query?: Record<string, unknown> }
      const root = overrideQuery.query
      if (root) {
        root.status = { option: criteria?.listedStatus || XILETRADE_DEFAULT_LISTED_STATUS }
        if (mode === 'find-better') {
          // PoB2 supplies the weighted stats. Keep only the small set of
          // replacement options its bridge currently emits; Xiletrade
          // remains the authority for every automatic query filter.
          sanitizeFindBetterGeneratedFilters(root)
        }
        applyXiletradeQueryIdentity(root, resolvedItem, realm, criteria)
        const min = finiteValue(criteria?.itemLevelMin)
        const max = finiteValue(criteria?.itemLevelMax)
        // PoB2 supplies a complete weighted query for Find Better. Preserve
        // the user's Xiletrade filters when merging that query so the same
        // filter model is used by both ordinary and build-aware searches.
        const routing = xiletradeItemRouting(resolvedItem)
        const extraFilters = buildXiletradeFilterPayload(
          criteria?.xiletrade,
          xiletradeItemLevelTarget(resolvedItem),
          true,
          routing.waystone,
          xiletradeDefaultRarity(resolvedItem, routing),
        )
        if (routing.tradeCategory) {
          const type = (extraFilters.type_filters && typeof extraFilters.type_filters === 'object' ? extraFilters.type_filters : {}) as Record<string, unknown>
          const currentTypeFilters = (type.filters && typeof type.filters === 'object' ? type.filters : {}) as Record<string, unknown>
          extraFilters.type_filters = {
            ...type,
            disabled: false,
            filters: { ...currentTypeFilters, category: { option: routing.tradeCategory } },
          }
        }
        if (Object.keys(extraFilters).length) {
          const filters = (root.filters && typeof root.filters === 'object' ? root.filters : {}) as Record<string, unknown>
          for (const [section, value] of Object.entries(extraFilters)) {
            const current = filters[section]
            if (current && typeof current === 'object' && !Array.isArray(current) && value && typeof value === 'object' && !Array.isArray(value)) {
              const currentSection = current as Record<string, unknown>
              const nextSection = value as Record<string, unknown>
              const currentFilters = currentSection.filters
              const nextFilters = nextSection.filters
              filters[section] = {
                ...currentSection,
                ...nextSection,
                filters: {
                  ...(currentFilters && typeof currentFilters === 'object' ? currentFilters : {}),
                  ...(nextFilters && typeof nextFilters === 'object' ? nextFilters : {}),
                },
              }
            } else {
              filters[section] = value
            }
          }
          root.filters = filters
        }
        applyItemLevelRange(root, resolvedItem, (min == null && max == null) ? undefined : {
          ...(min == null ? {} : { min }),
          ...(max == null ? {} : { max }),
        })
      }
      query = overrideQuery
    }
    let resolvedModifierCount = built.resolved
    let unresolvedModifierCount = built.unresolved
    let response: SearchResponse
    let weightedListingIds: string[] | undefined
    let weightedListingReferences: TradeSearchListingReference[] | undefined
    try {
      if (mode === 'find-better' && isWeightedQuery(query)) {
        const adjusted = await this.searchWeighted(realm, leagueId, query, weightedFetchLimit(criteria?.findBetter?.fetchPages))
        query = adjusted.query
        response = adjusted.response
        weightedListingIds = adjusted.listingIds
        weightedListingReferences = adjusted.listingReferences
      } else {
        response = record(await this.limited(() => this.manager.search(realm, leagueId, query))) as SearchResponse
      }
      // Log the final query that produced the visible result URL. For a
      // weighted search this includes PoB2's threshold adjustment.
      logTradeQuery(realm, leagueId, 'detailed', mode, resolvedItem, query, resolvedModifierCount, unresolvedModifierCount, this.logger)
    } catch (error) {
      const unknownItemName = error instanceof OfficialTradeRequestError
        && error.status === 400
        && /unknown item name/i.test(error.detail || '')
      const identityFallback = unknownItemName && realm === 'global' ? withoutQueryItemName(query) : undefined
      if (identityFallback) {
        console.warn(`[Market search] global item name was rejected; retrying without query.name league=${leagueId}`)
        query = identityFallback
        logTradeQuery(realm, leagueId, 'identity-fallback', mode, resolvedItem, query, resolvedModifierCount, unresolvedModifierCount, this.logger)
        response = record(await this.limited(() => this.manager.search(realm, leagueId, query))) as SearchResponse
      } else {
        throw error
      }
    }
    const searchId = clean(response.id)
    if (!searchId) throw new Error('Official trade search did not return a search ID')
    this.manager.rememberGeneratedSearch(realm, leagueId, searchId, query)
    const origin = realm === 'cn' ? 'https://poe.game.qq.com' : 'https://www.pathofexile.com'
    return {
      searchId,
      url: `${origin}/trade2/search/poe2/${encodeURIComponent(leagueId)}/${encodeURIComponent(searchId)}`,
      total: typeof response.total === 'number' ? response.total : 0,
      resolvedModifierCount,
      unresolvedModifierCount,
      listingIds: weightedListingIds || searchResultIds(response).slice(0, 10_000),
      ...((weightedListingReferences?.length)
        ? { listingReferences: weightedListingReferences }
        : {}),
      resolvedItem,
    }
  }

  async recreateSearch(realm: MarketRealm, leagueId: string, query: unknown): Promise<{ searchId: string; url: string }> {
    const response = record(await this.limited(() => this.manager.search(realm, leagueId, query))) as SearchResponse
    const searchId = clean(response.id)
    if (!searchId) throw new Error('Official trade search did not return a search ID')
    this.manager.rememberGeneratedSearch(realm, leagueId, searchId, query)
    const origin = realm === 'cn' ? 'https://poe.game.qq.com' : 'https://www.pathofexile.com'
    return { searchId, url: `${origin}/trade2/search/poe2/${encodeURIComponent(leagueId)}/${encodeURIComponent(searchId)}` }
  }

  private limited<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.catch(() => {}).then(async () => {
      const delay = Math.max(0, 350 - (Date.now() - this.lastRequestAt))
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay))
      try { return await operation() } finally { this.lastRequestAt = Date.now() }
    })
    this.queue = result.then(() => {}, () => {})
    return result
  }
}
