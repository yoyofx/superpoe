import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { LibraryItemSnapshot, LibraryModifier, MarketRealm, TradeLeague, TradeSearchResult, TradeStatResolutionSnapshot } from '../src/types/market.js'
import type { MarketViewManager } from './marketView.js'

interface CatalogOption { id: string; text: string }
interface CatalogEntry { id: string; text: string; type?: string; option?: { options?: CatalogOption[] } }
interface CatalogSnapshot { realm: MarketRealm; fetchedAt: string; payloadHash: string; entries: CatalogEntry[] }

interface SearchResponse { id?: unknown; total?: unknown }

const CATALOG_TTL = 24 * 60 * 60 * 1_000

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function clean(value: unknown): string {
  return typeof value === 'string' ? value.replace(/<<[^>]+>>/g, '').trim() : ''
}

function normalizeTemplate(value: string): string {
  return value
    .replace(/[-+]?\d+(?:\.\d+)?/g, '#')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase()
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLocaleLowerCase()
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
    const existing = modifier.tradeResolutions.find((resolution) => resolution.realm === catalog.realm && resolution.status === 'resolved')
    if (existing) {
      const [baseId] = existing.queryStatId?.split('|') || []
      if (baseId && catalog.entries.some((entry) => entry.id === baseId)) return structuredClone(modifier)
    }
    const sourceText = catalog.realm === 'cn'
      ? modifier.localized?.['zh-CN']?.displayText || modifier.original.displayText
      : modifier.original.displayText
    const template = normalizeTemplate(sourceText)
    const directMatches = catalog.entries
      .filter((entry) => normalizeTemplate(entry.text) === template)
      .map((entry) => ({ entry, queryStatId: entry.id }))
    const optionMatches = catalog.entries.flatMap((entry) => (entry.option?.options || []).flatMap((option) => (
      normalizeText(entry.text.replace('#', option.text)) === normalizeText(sourceText)
        ? [{ entry, option, queryStatId: `${entry.id}|${option.id}` }]
        : []
    )))
    const matches = [...new Map([...optionMatches, ...directMatches].map((match) => [match.queryStatId, match])).values()]
    const candidates = matches.map((match) => match.queryStatId).slice(0, 20)
    const match = matches.length === 1 ? matches[0] : undefined
    const fixedOption = match ? (match as { option?: CatalogOption }).option : undefined
    const resolution: TradeStatResolutionSnapshot = {
      realm: catalog.realm,
      queryStatId: match?.queryStatId,
      baseStatId: match?.entry.id,
      optionId: fixedOption?.id,
      candidateStatIds: candidates,
      source: modifier.sourceTags.find((tag) => ['enchant', 'rune', 'implicit', 'explicit', 'fractured', 'crafted', 'desecrated'].includes(tag)) as TradeStatResolutionSnapshot['source'] || 'unknown',
      catalogTemplate: match?.entry.text,
      valueMode: fixedOption ? 'fixed-option' : modifier.valueMode,
      valueTransform: 'identity',
      resolvedBy: 'exact-text',
      catalogFetchedAt: catalog.fetchedAt,
      catalogPayloadHash: catalog.payloadHash,
      status: matches.length === 1 ? 'resolved' : matches.length > 1 ? 'ambiguous' : 'unresolved',
    }
    return {
      ...structuredClone(modifier),
      tradeResolutions: [...modifier.tradeResolutions.filter((candidate) => candidate.realm !== catalog.realm), resolution],
    }
  }
}

export function buildTradeQuery(item: LibraryItemSnapshot, realm: MarketRealm): { query: unknown; resolved: number; unresolved: number } {
  const filters = item.modifiers.flatMap((modifier) => {
    const resolution = modifier.tradeResolutions.find((candidate) => candidate.realm === realm && candidate.status === 'resolved' && candidate.queryStatId)
    if (!resolution?.queryStatId) return []
    const value = resolution.valueMode === 'numeric' && modifier.currentValues.length
      ? { min: modifier.currentValues[0] }
      : undefined
    return [{ id: resolution.queryStatId, ...(value ? { value } : {}) }]
  })
  return {
    query: {
      query: {
        status: { option: realm === 'cn' ? 'securable' : 'online' },
        type: (realm === 'cn' ? item.localized?.['zh-CN']?.baseType : undefined) || item.baseType || undefined,
        stats: filters.length ? [{ type: 'and', filters }] : [],
      },
      sort: { price: 'asc' },
    },
    resolved: filters.length,
    unresolved: item.modifiers.length - filters.length,
  }
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

  async search(realm: MarketRealm, leagueId: string, item: LibraryItemSnapshot): Promise<TradeSearchResult & { resolvedItem: LibraryItemSnapshot }> {
    const catalog = await this.stats(realm)
    const resolvedItem = new TradeStatResolver().resolve(item, catalog)
    const built = buildTradeQuery(resolvedItem, realm)
    const response = record(await this.limited(() => this.manager.search(realm, leagueId, built.query))) as SearchResponse
    const searchId = clean(response.id)
    if (!searchId) throw new Error('Official trade search did not return a search ID')
    const origin = realm === 'cn' ? 'https://poe.game.qq.com' : 'https://www.pathofexile.com'
    return {
      searchId,
      url: `${origin}/trade2/search/poe2/${encodeURIComponent(leagueId)}/${encodeURIComponent(searchId)}`,
      total: typeof response.total === 'number' ? response.total : 0,
      resolvedModifierCount: built.resolved,
      unresolvedModifierCount: built.unresolved,
      resolvedItem,
    }
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
