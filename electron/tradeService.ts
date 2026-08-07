import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type {
  LibraryItemSnapshot, LibraryModifier, MarketRealm, TradeLeague, TradePriceCheckCriteria,
  TradePriceCheckDraft, TradeSearchResult, TradeStatResolutionSnapshot,
} from '../src/types/market.js'
import type { MarketViewManager } from './marketView.js'
import { OfficialTradeRequestError } from './officialTradeRequestError.js'

interface CatalogOption { id: string; text: string }
interface CatalogEntry { id: string; text: string; type?: string; option?: { options?: CatalogOption[] } }
interface CatalogSnapshot { realm: MarketRealm; fetchedAt: string; payloadHash: string; entries: CatalogEntry[] }

interface SearchResponse { id?: unknown; total?: unknown; result?: unknown }

type TradeStatMatch = { entry: CatalogEntry; queryStatId: string; option?: CatalogOption }

const CATALOG_TTL = 24 * 60 * 60 * 1_000

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function clean(value: unknown): string {
  return typeof value === 'string' ? value.replace(/<<[^>]+>>/g, '').trim() : ''
}

function normalizeTemplate(value: string): string {
  return value
    .replace(/[-+]?\d+(?:\.\d+)?/g, (number) => number.startsWith('-') ? '-#' : '#')
    .replace(/\+(?=#)/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase()
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLocaleLowerCase()
}

function statScope(queryStatId: string): string {
  return queryStatId.split('.')[0] || ''
}

function preferredStatScopes(modifier: LibraryModifier): Set<string> {
  const known = new Set(['explicit', 'implicit', 'enchant', 'rune', 'fractured', 'crafted', 'desecrated'])
  const tagged = modifier.sourceTags.filter((tag) => known.has(tag))
  if (tagged.length) return new Set(tagged)
  if (modifier.group === 'implicit' || modifier.group === 'enchant' || modifier.group === 'rune') return new Set([modifier.group])
  return new Set(['explicit'])
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

export class TradeStatResolver {
  resolve(item: LibraryItemSnapshot, catalog: CatalogSnapshot): LibraryItemSnapshot {
    return {
      ...structuredClone(item),
      modifiers: item.modifiers.map((modifier) => this.resolveModifier(modifier, catalog)),
    }
  }

  private resolveModifier(modifier: LibraryModifier, catalog: CatalogSnapshot): LibraryModifier {
    const previous = modifier.tradeResolutions.find((resolution) => resolution.realm === catalog.realm)
    const existing = previous?.status === 'resolved' ? previous : undefined
    if (existing) {
      const [baseId] = existing.queryStatId?.split('|') || []
      if (baseId && catalog.entries.some((entry) => entry.id === baseId)) return structuredClone(modifier)
    }
    const sourceText = catalog.realm === 'cn'
      ? modifier.localized?.['zh-CN']?.displayText || modifier.original.displayText
      : modifier.original.displayText
    const template = normalizeTemplate(sourceText)
    const directMatches: TradeStatMatch[] = catalog.entries
      .filter((entry) => normalizeTemplate(entry.text) === template)
      .map((entry) => ({ entry, queryStatId: entry.id }))
    const optionMatches: TradeStatMatch[] = catalog.entries.flatMap((entry) => (entry.option?.options || []).flatMap((option) => (
      normalizeText(entry.text.replace('#', option.text)) === normalizeText(sourceText)
        ? [{ entry, option, queryStatId: `${entry.id}|${option.id}` }]
        : []
    )))
    const allMatches = [...new Map([...optionMatches, ...directMatches].map((match) => [match.queryStatId, match])).values()]
    const scopes = preferredStatScopes(modifier)
    const scopedMatches = allMatches.filter((match) => scopes.has(statScope(match.queryStatId)))
    const matches = scopedMatches.length ? scopedMatches : allMatches
    const candidates = matches.map((match) => match.queryStatId).slice(0, 20)
    const match = matches.length === 1 ? matches[0] : undefined
    const scopedResolution = scopedMatches.length > 0 && matches.length > 0
    const fixedOption = match ? (match as { option?: CatalogOption }).option : undefined
    const resolution: TradeStatResolutionSnapshot = {
      realm: catalog.realm,
      queryStatId: scopedResolution || match ? matches[0]?.queryStatId : undefined,
      baseStatId: match?.entry.id,
      optionId: fixedOption?.id,
      candidateStatIds: candidates,
      source: modifier.sourceTags.find((tag) => ['enchant', 'rune', 'implicit', 'explicit', 'fractured', 'crafted', 'desecrated'].includes(tag)) as TradeStatResolutionSnapshot['source'] || 'unknown',
      catalogTemplate: match?.entry.text,
      valueMode: fixedOption ? 'fixed-option' : modifier.valueMode,
      valueTransform: previous?.valueTransform || 'identity',
      resolvedBy: 'exact-text',
      catalogFetchedAt: catalog.fetchedAt,
      catalogPayloadHash: catalog.payloadHash,
      status: matches.length === 0 ? 'unresolved' : (matches.length === 1 || scopedResolution) ? 'resolved' : 'ambiguous',
    }
    return {
      ...structuredClone(modifier),
      tradeResolutions: [...modifier.tradeResolutions.filter((candidate) => candidate.realm !== catalog.realm), resolution],
    }
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
  return clean(item.baseType) || undefined
}

function queryItemName(item: LibraryItemSnapshot, realm: MarketRealm): string | undefined {
  if (realm === 'cn') return clean(item.localized?.['zh-CN']?.name) || (!/[A-Za-z]/.test(item.name) ? clean(item.name) : undefined)
  return clean(item.name) || undefined
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
  return [...new Set((resolution.candidateStatIds.length ? resolution.candidateStatIds : [resolution.queryStatId])
    .filter((id): id is string => Boolean(id)))]
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
        lines: modifier.original.lines,
        localizedLines: modifier.localized?.['zh-CN']?.lines,
        searchable: resolutionIds(resolution).length > 0,
        valueMode: resolution?.valueMode || modifier.valueMode,
        ...(currentValue == null ? {} : { currentValue }),
      }
    }),
  }
}

export function buildTradeQuery(item: LibraryItemSnapshot, realm: MarketRealm, criteria?: TradePriceCheckCriteria): { query: unknown; resolved: number; unresolved: number } {
  const selected = criteria ? new Map(criteria.modifiers.map((modifier) => [modifier.id, modifier])) : undefined
  const statGroups = item.modifiers.flatMap((modifier) => {
    const selection = selected?.get(modifier.id)
    if (selected && !selection) return []
    const resolution = resolutionFor(modifier, realm)
    const statIds = resolutionIds(resolution)
    if (!resolution || !statIds.length) return []
    const value = resolution.valueMode === 'numeric'
      ? (criteria ? selectedRange(resolution, selection?.min, selection?.max) : { min: modifier.currentValues[0] })
      : undefined
    const filters = statIds.map((id) => ({ id, ...(value ? { value } : {}) }))
    return [{
      type: statIds.length > 1 ? 'count' : 'and',
      ...(statIds.length > 1 ? { value: { min: 1 } } : {}),
      filters,
    }]
  })
  const unique = isUniqueItem(item)
  const type = queryItemType(item, realm)
  const miscFilters = criteria && (criteria.itemLevelMin != null || criteria.itemLevelMax != null)
    ? { filters: { ilvl: { min: finiteValue(criteria.itemLevelMin), max: finiteValue(criteria.itemLevelMax) } } }
    : undefined
  const queryFilters = {
    ...(miscFilters ? { misc_filters: miscFilters } : {}),
    ...(!unique && item.tradeCategory ? { type_filters: { filters: { category: { option: item.tradeCategory } } } } : {}),
  }
  const requestedCount = selected?.size ?? item.modifiers.length
  return {
    query: {
      query: {
        status: { option: criteria?.listedStatus || (realm === 'cn' ? 'securable' : 'online') },
        ...(unique && queryItemName(item, realm) ? { name: queryItemName(item, realm) } : {}),
        ...((unique || criteria?.useBaseType !== false) && type ? { type } : {}),
        stats: statGroups,
        ...(Object.keys(queryFilters).length ? { filters: queryFilters } : {}),
      },
      sort: { price: 'asc' },
    },
    resolved: statGroups.length,
    unresolved: requestedCount - statGroups.length,
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

function logTradeQuery(
  realm: MarketRealm,
  leagueId: string,
  phase: 'detailed' | 'type-only',
  item: LibraryItemSnapshot,
  query: unknown,
  resolvedModifierCount: number,
  unresolvedModifierCount: number,
): void {
  const summary = {
    realm,
    leagueId,
    phase,
    item: {
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

  constructor(private readonly manager: MarketViewManager, private readonly cache: TradeReferenceDataCache) {}

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
    const catalog = await this.stats(realm)
    const resolvedItem = new TradeStatResolver().resolve(item, catalog)
    return { draft: createPriceCheckDraft(resolvedItem, realm), resolvedItem }
  }

  async search(realm: MarketRealm, leagueId: string, item: LibraryItemSnapshot, criteria?: TradePriceCheckCriteria): Promise<TradeSearchResult & { resolvedItem: LibraryItemSnapshot; listingIds: string[] }> {
    const { resolvedItem } = await this.prepare(realm, item)
    const built = buildTradeQuery(resolvedItem, realm, criteria)
    let query = built.query
    let resolvedModifierCount = built.resolved
    let unresolvedModifierCount = built.unresolved
    let response: SearchResponse
    try {
      logTradeQuery(realm, leagueId, 'detailed', resolvedItem, query, resolvedModifierCount, unresolvedModifierCount)
      response = record(await this.limited(() => this.manager.search(realm, leagueId, query))) as SearchResponse
    } catch (error) {
      if (criteria || !(error instanceof OfficialTradeRequestError) || error.status !== 400 || built.resolved === 0 || !queryItemType(resolvedItem, realm)) throw error
      query = buildTypeOnlyQuery(resolvedItem, realm)
      resolvedModifierCount = 0
      unresolvedModifierCount = resolvedItem.modifiers.length
      logTradeQuery(realm, leagueId, 'type-only', resolvedItem, query, resolvedModifierCount, unresolvedModifierCount)
      response = record(await this.limited(() => this.manager.search(realm, leagueId, query))) as SearchResponse
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
      listingIds: Array.isArray(response.result)
        ? response.result.filter((value): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]+$/.test(value)).slice(0, 10_000)
        : [],
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
