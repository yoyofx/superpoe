import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type {
  LibraryItemSnapshot, LibraryModifier, MarketRealm, TradeLeague, TradePriceCheckCriteria,
  PriceCheckMode, TradePriceCheckDraft, TradeSearchResult, TradeStatResolutionSnapshot,
} from '../src/types/market.js'
import type { MarketViewManager } from './marketView.js'
import { OfficialTradeRequestError } from './officialTradeRequestError.js'

export interface CatalogOption { id: string; text: string }
export interface CatalogEntry { id: string; text: string; type?: string; option?: { options?: CatalogOption[] } }
export interface CatalogSnapshot { realm: MarketRealm; fetchedAt: string; payloadHash: string; entries: CatalogEntry[] }

interface SearchResponse { id?: unknown; total?: unknown; result?: unknown }

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
  return item.rarity === 'UNIQUE' || item.rarity === 'RELIC'
}

function resolutionFor(modifier: LibraryModifier, realm: MarketRealm): TradeStatResolutionSnapshot | undefined {
  return modifier.tradeResolutions.find((candidate) => candidate.realm === realm
    && candidate.status === 'resolved' && (candidate.queryStatId || candidate.candidateStatIds.length))
}

function resolutionIds(resolution: TradeStatResolutionSnapshot | undefined): string[] {
  if (!resolution) return []
  return resolution.queryStatId ? [resolution.queryStatId] : []
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

export function createPriceCheckDraft(item: LibraryItemSnapshot, realm: MarketRealm): TradePriceCheckDraft {
  const localized = item.localized?.['zh-CN']
  return {
    realm,
    rarity: item.rarity,
    name: item.name,
    baseType: item.baseType,
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
  const statFilters = item.modifiers.flatMap((modifier) => {
    const selection = selected?.get(modifier.id)
    if (selected && !selection) return []
    const resolution = resolutionFor(modifier, realm)
    const statIds = resolutionIds(resolution)
    if (!resolution || !statIds.length) return []
    const value = resolution.valueMode === 'numeric'
      ? (criteria ? selectedRange(resolution, selection?.min, selection?.max) : { min: modifier.currentValues[0] })
      : undefined
    return statIds.map((id) => ({ id, ...(value ? { value } : {}) }))
  })
  const weighted = mode === 'find-better'
  const queryStats = weighted
    ? (statFilters.length ? [{
      type: 'weight',
      value: { min: 0 },
      filters: statFilters.map((filter) => ({ id: filter.id, value: { weight: 1 } })),
    }] : [])
    : (statFilters.length ? [{ type: 'and', filters: statFilters }] : [])
  const unique = isUniqueItem(item)
  const type = queryItemType(item, realm)
  const miscFilters = criteria && (criteria.itemLevelMin != null || criteria.itemLevelMax != null)
    ? { filters: { ilvl: { min: finiteValue(criteria.itemLevelMin), max: finiteValue(criteria.itemLevelMax) } } }
    : undefined
  const queryFilters = {
    ...(miscFilters ? { misc_filters: miscFilters } : {}),
    ...((weighted || !unique) && item.tradeCategory ? { type_filters: { filters: { category: { option: item.tradeCategory } } } } : {}),
  }
  const requestedCount = selected?.size ?? item.modifiers.length
  // PoB2 weighted searches use the slot category and nonunique rarity filter
  // as their default. A unique item in that slot is still a replacement
  // candidate, so its name/base type must not silently constrain the query.
  const includeType = weighted
    ? criteria?.useBaseType === true
    : (unique || criteria?.useBaseType !== false)
  return {
    query: {
      query: {
        status: { option: criteria?.listedStatus || (realm === 'cn' ? 'securable' : 'online') },
        ...(!weighted && unique && queryItemName(item, realm) ? { name: queryItemName(item, realm) } : {}),
        ...(includeType && type ? { type } : {}),
        stats: queryStats,
        ...(Object.keys(queryFilters).length ? { filters: queryFilters } : {}),
      },
      sort: weighted ? { 'statgroup.0': 'desc' } : { price: 'asc' },
    },
    resolved: statFilters.length,
    unresolved: requestedCount - statFilters.length,
  }
}

function buildTypeOnlyQuery(item: LibraryItemSnapshot, realm: MarketRealm): unknown {
  const type = queryItemType(item, realm)
  return {
    query: {
      status: { option: realm === 'cn' ? 'securable' : 'online' },
      ...(type ? { type } : {}),
      stats: [],
    },
    sort: { price: 'asc' },
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
  phase: 'detailed' | 'type-only' | 'identity-fallback',
  mode: PriceCheckMode,
  item: LibraryItemSnapshot,
  query: unknown,
  resolvedModifierCount: number,
  unresolvedModifierCount: number,
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
}

export class OfficialTradeProvider {
  private queue: Promise<void> = Promise.resolve()
  private lastRequestAt = 0

  constructor(
    private readonly manager: MarketViewManager,
    private readonly cache: TradeReferenceDataCache,
    private readonly embeddedCatalog?: (realm: MarketRealm) => Promise<CatalogSnapshot>,
    private readonly projectItem?: (realm: MarketRealm, item: LibraryItemSnapshot, catalog: CatalogSnapshot) => Promise<LibraryItemSnapshot> | LibraryItemSnapshot,
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
  ): Promise<{ query: unknown; response: SearchResponse; listingIds: string[] }> {
    let query = structuredClone(initialQuery)
    let previousResponse: SearchResponse | undefined
    for (let attempt = 0; attempt < WEIGHTED_SEARCH_MAX_RECURSION; attempt += 1) {
      const response = record(await this.limited(() => this.manager.search(realm, leagueId, query))) as SearchResponse
      const ids = searchResultIds(response)
      const total = typeof response.total === 'number' && Number.isFinite(response.total) ? response.total : ids.length
      const min = weightedMin(query)
       if (!isWeightedQuery(query) || min == null) return { query, response, listingIds: ids.slice(0, maxFetchPerSearch) }

       if (ids.length > 0 && total > maxFetchPerSearch && total < 10_000) {
         return { query, response, listingIds: ids.slice(0, maxFetchPerSearch) }
       }
       if (attempt === WEIGHTED_SEARCH_MAX_RECURSION - 1) {
         return { query, response, listingIds: ids.slice(0, maxFetchPerSearch) }
       }

       if (total < maxFetchPerSearch || ids.length === 0) {
        // PoB2 halves the lower bound when too few listings match.
        query = setWeightedMin(query, min / 2)
        previousResponse = response
        continue
      }

      // The API is clipped at 10,000 results. Fetch the highest-weight item
      // from the current search and bisect between its score and the bound.
      const searchId = clean(response.id)
      if (!searchId || !this.manager.fetchListings) {
        return { query, response, listingIds: ids.slice(0, maxFetchPerSearch) }
       }
       const firstBatch = ids.slice(0, WEIGHTED_SEARCH_PAGE_SIZE)
      const fetched = record(await this.limited(() => this.manager.fetchListings(realm, firstBatch, searchId)))
      const entries = Array.isArray(fetched.result) ? fetched.result : []
      const highestWeight = entries.map(listedWeight).find((value): value is number => value != null)
      if (highestWeight == null || !Number.isFinite(highestWeight)) {
        return { query, response, listingIds: ids.slice(0, maxFetchPerSearch) }
      }
      query = setWeightedMin(query, (highestWeight + min) / 2)
      previousResponse = response
    }
    // The loop always returns, but keep the fallback explicit for type safety.
    return { query, response: previousResponse || {}, listingIds: [] }
  }

  async search(
    realm: MarketRealm,
    leagueId: string,
    item: LibraryItemSnapshot,
    criteria?: TradePriceCheckCriteria,
    mode: PriceCheckMode = 'price-check',
    queryOverride?: { query: unknown; resolved?: number },
  ): Promise<TradeSearchResult & { resolvedItem: LibraryItemSnapshot; listingIds: string[] }> {
    const { resolvedItem } = await this.prepare(realm, item)
    const built = queryOverride
      ? { query: queryOverride.query, resolved: queryOverride.resolved ?? 0, unresolved: 0 }
      : buildTradeQuery(resolvedItem, realm, criteria, mode)
    let query = built.query
    if (queryOverride && query && typeof query === 'object') {
      const overrideQuery = structuredClone(query) as { query?: Record<string, unknown> }
      const root = overrideQuery.query
      if (root) {
        root.status = { option: criteria?.listedStatus || (realm === 'cn' ? 'securable' : 'online') }
        if (mode === 'find-better') {
          // PoB2's ordinary weighted replacement search is category based.
          // Item names are only used by its separate special-jewel paths;
          // this bridge does not expose those paths, so never let an item
          // identity from a future/older Lua payload narrow the search.
          delete root.name
          if (criteria?.useBaseType !== true) delete root.type
        }
        if (criteria?.useBaseType) {
          const type = queryItemType(resolvedItem, realm)
          if (type) root.type = type
        }
        const min = finiteValue(criteria?.itemLevelMin)
        const max = finiteValue(criteria?.itemLevelMax)
        if (min != null || max != null) {
          const filters = (root.filters && typeof root.filters === 'object' ? root.filters : {}) as Record<string, unknown>
          const misc = (filters.misc_filters && typeof filters.misc_filters === 'object' ? filters.misc_filters : {}) as Record<string, unknown>
          misc.filters = { ilvl: { ...(min == null ? {} : { min }), ...(max == null ? {} : { max }) } }
          filters.misc_filters = misc
          root.filters = filters
        }
      }
      query = overrideQuery
    }
    let resolvedModifierCount = built.resolved
    let unresolvedModifierCount = built.unresolved
    let response: SearchResponse
    let weightedListingIds: string[] | undefined
    try {
      if (mode === 'find-better' && isWeightedQuery(query)) {
        const adjusted = await this.searchWeighted(realm, leagueId, query, weightedFetchLimit(criteria?.findBetter?.fetchPages))
        query = adjusted.query
        response = adjusted.response
        weightedListingIds = adjusted.listingIds
      } else {
        response = record(await this.limited(() => this.manager.search(realm, leagueId, query))) as SearchResponse
      }
      // Log the final query that produced the visible result URL. For a
      // weighted search this includes PoB2's threshold adjustment.
      logTradeQuery(realm, leagueId, 'detailed', mode, resolvedItem, query, resolvedModifierCount, unresolvedModifierCount)
    } catch (error) {
      const unknownItemName = error instanceof OfficialTradeRequestError
        && error.status === 400
        && /unknown item name/i.test(error.detail || '')
      const identityFallback = unknownItemName && realm === 'global' ? withoutQueryItemName(query) : undefined
      if (identityFallback) {
        console.warn(`[Market search] global item name was rejected; retrying without query.name league=${leagueId}`)
        query = identityFallback
        logTradeQuery(realm, leagueId, 'identity-fallback', mode, resolvedItem, query, resolvedModifierCount, unresolvedModifierCount)
        response = record(await this.limited(() => this.manager.search(realm, leagueId, query))) as SearchResponse
      } else {
        if (criteria || mode !== 'price-check' || !(error instanceof OfficialTradeRequestError) || error.status !== 400 || built.resolved === 0 || !queryItemType(resolvedItem, realm)) throw error
        query = buildTypeOnlyQuery(resolvedItem, realm)
        resolvedModifierCount = 0
        unresolvedModifierCount = resolvedItem.modifiers.length
        logTradeQuery(realm, leagueId, 'type-only', mode, resolvedItem, query, resolvedModifierCount, unresolvedModifierCount)
        response = record(await this.limited(() => this.manager.search(realm, leagueId, query))) as SearchResponse
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
