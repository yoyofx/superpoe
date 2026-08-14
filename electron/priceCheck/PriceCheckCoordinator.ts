import { randomUUID } from 'node:crypto'
import type {
  CanonicalItemDisplayStat, LibraryModifierGroup, LibraryModifierTag, MarketRealm, PriceCheckContextState, PriceCheckListingReference, PriceCheckListingView, PriceCheckOpenRequest,
  TradePriceCheckCriteria, TradePriceCheckDraft, TradeSearchResult, LibraryItemSnapshot,
} from '../../src/types/market.js'
import type { MarketStatTextResolution } from '../marketListing.js'

type SearchOutput = TradeSearchResult & { listingIds: string[] }

interface CoordinatorServices {
  context: () => { realm: MarketRealm; language: PriceCheckContextState['language'] }
  prepare: (realm: MarketRealm, source: PriceCheckOpenRequest['source']) => Promise<{ draft: TradePriceCheckDraft; item: LibraryItemSnapshot }>
  leagues: (realm: MarketRealm) => Promise<Array<{ id: string; text: string }>>
  search: (realm: MarketRealm, item: LibraryItemSnapshot, leagueId: string, criteria: TradePriceCheckCriteria) => Promise<SearchOutput>
  fetch: (realm: MarketRealm, ids: string[], searchId: string) => Promise<unknown>
  resolveListingStatText?: (realm: MarketRealm, queryStatId: string) => Promise<MarketStatTextResolution | undefined>
  resolveListingItemText?: (realm: MarketRealm, value: string) => { canonicalText?: string }
  visitHideout: (realm: MarketRealm, listingId: string, searchId: string, sourceUrl: string) => Promise<{ ok: true } | { ok: false; reason: 'game-offline' }>
  changed: (state: PriceCheckContextState) => void
}

interface SearchContext {
  id: string
  generation: number
  realm: MarketRealm
  search: TradeSearchResult
  ids: string[]
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function text(value: unknown): string | undefined {
  const result = typeof value === 'string' ? value.replace(/<<[^>]+>>/g, '').trim() : ''
  return result || undefined
}

function displayStats(value: unknown): CanonicalItemDisplayStat[] | undefined {
  if (!Array.isArray(value)) return undefined
  const stats = value.flatMap((raw) => {
    const entry = record(raw)
    const key = text(entry.name) || text(entry.key)
    if (!key) return []
    const values = Array.isArray(entry.values)
      ? entry.values.flatMap((candidate) => Array.isArray(candidate) ? [candidate[0]] : [candidate]).filter((candidate): candidate is string | number => typeof candidate === 'string' || typeof candidate === 'number').map(String)
      : []
    return values.length ? [{ key, values }] : []
  })
  return stats.length ? stats : undefined
}

function socketText(value: unknown): string | undefined {
  if (!Array.isArray(value) || !value.length) return undefined
  const sockets = value.map((raw) => {
    const socket = record(raw)
    return text(socket.sColour) || text(socket.colour) || text(socket.attr) || 'S'
  })
  return sockets.join(' ')
}

function hashesByIndex(hashes: unknown): Map<number, string[]> {
  const result = new Map<number, string[]>()
  if (!Array.isArray(hashes)) return result
  for (const tuple of hashes) {
    if (!Array.isArray(tuple) || typeof tuple[0] !== 'string' || !Array.isArray(tuple[1])) continue
    for (const index of tuple[1]) {
      if (typeof index !== 'number' || !Number.isInteger(index)) continue
      const current = result.get(index) || []
      current.push(tuple[0])
      result.set(index, current)
    }
  }
  return result
}

function hasPlaceholderText(value: string): boolean {
  return /(?:\?{2,}|\uFFFD)/u.test(value)
}

function directStatId(value: unknown): string | undefined {
  const hash = text(record(value).hash)
  return hash?.replace(/^stat\.(?=(?:explicit|implicit|enchant|rune|fractured|crafted|desecrated)\.)/, '')
}

function comparableStatTemplate(value: string, realm: MarketRealm): string {
  return value
    .replace(/\[([^|\]]+)\|([^\]]+)\]/g, (_match, global: string, cn: string) => realm === 'cn' ? cn : global)
    .replace(/[-+]?\d+(?:\.\d+)?/g, '#')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase()
}

function fillStatTemplate(template: string, source: string): string {
  const values = [...source.matchAll(/[-+]?\d+(?:\.\d+)?%?/g)].map((match) => match[0])
  let next = 0
  return template.replace(/#|\{(\d+)\}/g, (_match, index: string | undefined, offset: number) => {
    let value = values[index == null ? next++ : Number(index)]
    const preceding = template[offset - 1]
    const following = template[offset + 1]
    if (value && (preceding === '+' || preceding === '-') && value.startsWith(preceding)) value = value.slice(1)
    if (value && following === '%' && value.endsWith('%')) value = value.slice(0, -1)
    return value ?? _match
  })
}

async function listingView(
  value: unknown,
  realm: MarketRealm,
  resolveListingStatText?: CoordinatorServices['resolveListingStatText'],
  resolveListingItemText?: CoordinatorServices['resolveListingItemText'],
): Promise<PriceCheckListingView | null> {
  const root = record(value)
  const id = text(root.id)
  const item = record(root.item)
  const listing = record(root.listing)
  const extended = record(item.extended)
  const hashGroups = record(extended.hashes)
  const baseType = text(item.baseType) || text(item.typeLine)
  if (!id || !baseType) return null
  const price = record(listing.price)
  const amount = typeof price.amount === 'number' && Number.isFinite(price.amount) ? price.amount : undefined
  const currency = text(price.currency)
  const account = record(listing.account)
  const online = record(account.online)
  const statusText = text(online.status)?.toLowerCase()
  const groups = ['enchant', 'rune', 'implicit', 'explicit', 'fractured', 'crafted', 'desecrated']
  let displayOrder = 0
  const modifiers = groups.flatMap((group) => {
    const values = Array.isArray(item[`${group}Mods`]) ? item[`${group}Mods`] as unknown[] : []
    return values.flatMap((raw, index) => {
      const rawLine = typeof raw === 'string' ? text(raw) : text(record(raw).text) || text(record(raw).description)
      const canonicalGroup: LibraryModifierGroup = group === 'enchant' || group === 'rune' || group === 'implicit' ? group : 'explicit'
      const indexedStatIds = hashesByIndex(hashGroups[group]).get(index) || []
      const statIds = [...new Set([directStatId(raw), ...indexedStatIds].filter((id): id is string => Boolean(id)))]
      return rawLine ? [{
        id: `${group}-${index}`,
        displayOrder: displayOrder++,
        group: canonicalGroup,
        sourceTags: [group as LibraryModifierTag],
        text: rawLine,
        ...(realm === 'cn' && !hasPlaceholderText(rawLine) ? { localized: { 'zh-CN': rawLine } } : {}),
        tradeStatIds: statIds,
      }] : []
    })
  })
  // Official listing text is authoritative for display. Catalog text may
  // supply canonical English only when its localized template matches the
  // listing line; one stat ID can have multiple context-dependent templates.
  if (resolveListingStatText) {
    const resolvedModifiers = await Promise.all(modifiers.map(async (modifier) => {
      const [group, indexText] = modifier.id.split('-')
      const index = Number(indexText)
      const rawValues = Array.isArray(item[`${group}Mods`]) ? item[`${group}Mods`] as unknown[] : []
      const statIds = [...new Set([
        directStatId(rawValues[index]),
        ...(hashesByIndex(hashGroups[group]).get(index) || []),
      ].filter((id): id is string => Boolean(id)))]
      for (const queryStatId of statIds) {
        const resolved = await resolveListingStatText(realm, queryStatId)
        if (resolved) {
          const placeholder = hasPlaceholderText(modifier.text)
          const displayMatches = resolved.displayText
            ? comparableStatTemplate(resolved.displayText, realm) === comparableStatTemplate(modifier.text, realm)
            : false
          if (!placeholder && !displayMatches) continue
          const canonicalText = resolved.canonicalText && !hasPlaceholderText(resolved.canonicalText)
            ? fillStatTemplate(resolved.canonicalText, modifier.text)
            : modifier.text
          const displayText = resolved.displayText && !hasPlaceholderText(resolved.displayText)
            ? (placeholder ? fillStatTemplate(resolved.displayText, modifier.text) : modifier.text)
            : undefined
          return {
            ...modifier,
            text: canonicalText,
            tradeStatIds: statIds,
            ...(displayText
              ? { localized: { 'zh-CN': displayText } }
              : {}),
          }
        }
      }
      return modifier
    }))
    modifiers.splice(0, modifiers.length, ...resolvedModifiers)
  }
  const resolvedName = text(item.name) && resolveListingItemText ? resolveListingItemText(realm, text(item.name)!) : undefined
  const resolvedBaseType = resolveListingItemText ? resolveListingItemText(realm, baseType) : undefined
  const properties = displayStats(item.properties)?.map((stat) => ({
    ...stat,
    key: resolveListingItemText?.(realm, stat.key)?.canonicalText || stat.key,
  }))
  const requirements = displayStats(item.requirements)?.map((stat) => ({
    ...stat,
    key: resolveListingItemText?.(realm, stat.key)?.canonicalText || stat.key,
  }))
  return {
    id,
    ...(amount != null && currency ? { price: { amount, currency, display: `${amount} ${currency}` } } : {}),
    seller: {
      accountName: text(account.name) || text(account.lastCharacterName),
      status: statusText === 'afk' ? 'afk' : Object.keys(online).length ? 'online' : 'offline',
    },
    item: {
      rarity: text(item.rarity) || 'UNKNOWN',
      name: resolvedName?.canonicalText || text(item.name) || baseType,
      baseType: resolvedBaseType?.canonicalText || baseType,
      iconUrl: text(item.icon),
      itemLevel: typeof item.ilvl === 'number' ? item.ilvl : undefined,
      corrupted: item.corrupted === true,
      identified: item.identified !== false,
      sockets: socketText(item.sockets),
      modifiers,
      properties,
      requirements,
    },
    listedAt: text(listing.indexed),
    whisper: text(listing.whisper),
    hideoutAvailable: Boolean(text(listing.hideout_token)),
  }
}

export class PriceCheckCoordinator {
  private generation = 0
  private source?: PriceCheckOpenRequest['source']
  private preparedItem?: LibraryItemSnapshot
  private searchContext?: SearchContext
  private state: PriceCheckContextState

  constructor(private readonly services: CoordinatorServices) {
    const context = services.context()
    this.state = { generation: 0, ...context, phase: 'idle', leagues: [], listings: [] }
  }

  snapshot(): PriceCheckContextState { return structuredClone(this.state) }

  async open(request: PriceCheckOpenRequest): Promise<PriceCheckContextState> {
    const generation = ++this.generation
    this.source = structuredClone(request.source)
    this.preparedItem = undefined
    this.searchContext = undefined
    const context = this.services.context()
    this.set({
      generation,
      ...context,
      phase: 'parsing',
      leagues: [],
      listings: [],
      initialLeagueId: request.initialLeagueId,
      ...(request.captureWarnings?.length ? { captureWarnings: [...new Set(request.captureWarnings)].slice(0, 20) } : {}),
    })
    try {
      const [prepared, leagues] = await Promise.all([
        this.services.prepare(context.realm, request.source),
        this.services.leagues(context.realm),
      ])
      if (generation !== this.generation) return this.snapshot()
      this.preparedItem = prepared.item
      this.set({ ...this.state, phase: 'configuring', draft: prepared.draft, leagues })
    } catch (error) {
      if (generation === this.generation) this.fail(error)
    }
    return this.snapshot()
  }

  async search(leagueId: string, criteria: TradePriceCheckCriteria): Promise<PriceCheckContextState> {
    if (!this.source || !this.preparedItem) throw new Error('No price check item is active')
    const generation = this.generation
    const { realm } = this.state
    this.set({ ...this.state, phase: 'searching', listings: [], search: undefined, error: undefined })
    try {
      const result = await this.services.search(realm, this.preparedItem, leagueId, criteria)
      if (generation !== this.generation) return this.snapshot()
      const { listingIds, ...search } = result
      this.searchContext = { id: randomUUID(), generation, realm, search, ids: listingIds }
      return this.fetchPage(1)
    } catch (error) {
      if (generation === this.generation) this.fail(error)
      return this.snapshot()
    }
  }

  async fetchPage(page: number): Promise<PriceCheckContextState> {
    const context = this.searchContext
    if (!context || context.generation !== this.generation) throw new Error('Price check search has expired')
    const pageCount = Math.max(1, Math.ceil(context.ids.length / 10))
    const safePage = Math.max(1, Math.min(Math.trunc(page), pageCount))
    const ids = context.ids.slice((safePage - 1) * 10, safePage * 10)
    this.set({ ...this.state, phase: 'fetching-page', error: undefined })
    try {
      const payload = ids.length ? await this.services.fetch(context.realm, ids, context.search.searchId) : { result: [] }
      if (context.generation !== this.generation) return this.snapshot()
      const results = Array.isArray(record(payload).result) ? record(payload).result as unknown[] : []
      const listings = (await Promise.all(results.map((value) => listingView(value, context.realm, this.services.resolveListingStatText, this.services.resolveListingItemText))))
        .filter((value): value is PriceCheckListingView => Boolean(value))
      this.set({
        ...this.state,
        phase: 'results',
        listings,
        search: { ...context.search, contextId: context.id, page: safePage, pageCount },
      })
    } catch (error) { this.fail(error) }
    return this.snapshot()
  }

  async visitHideout(listingId: string): Promise<{ ok: true } | { ok: false; reason: 'game-offline' }> {
    const context = this.searchContext
    if (!context || context.generation !== this.generation || !context.ids.includes(listingId)) {
      throw new Error('Price check listing has expired')
    }
    return this.services.visitHideout(context.realm, listingId, context.search.searchId, context.search.url)
  }

  listingReference(listingId: string): PriceCheckListingReference {
    const context = this.searchContext
    if (!context || context.generation !== this.generation || !context.ids.includes(listingId)) {
      throw new Error('Price check listing has expired')
    }
    return {
      realm: context.realm,
      listingId,
      queryId: context.search.searchId,
      sourceUrl: context.search.url,
    }
  }

  updateApplicationContext(): void {
    const context = this.services.context()
    if (context.realm === this.state.realm && context.language === this.state.language) return
    this.generation += 1
    this.source = undefined
    this.searchContext = undefined
    this.set({ generation: this.generation, ...context, phase: 'idle', leagues: [], listings: [] })
  }

  reportError(error: unknown): PriceCheckContextState {
    this.generation += 1
    this.source = undefined
    this.searchContext = undefined
    const context = this.services.context()
    this.set({
      generation: this.generation,
      ...context,
      phase: 'error',
      leagues: [],
      listings: [],
      error: error instanceof Error ? error.message : String(error),
    })
    return this.snapshot()
  }

  private fail(error: unknown): void {
    this.set({ ...this.state, phase: 'error', error: error instanceof Error ? error.message : String(error) })
  }

  private set(state: PriceCheckContextState): void {
    this.state = state
    this.services.changed(this.snapshot())
  }
}
