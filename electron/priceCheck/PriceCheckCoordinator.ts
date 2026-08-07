import { randomUUID } from 'node:crypto'
import type {
  LibraryModifierGroup, LibraryModifierTag, MarketRealm, PriceCheckContextState, PriceCheckListingView, PriceCheckOpenRequest,
  TradePriceCheckCriteria, TradePriceCheckDraft, TradeSearchResult,
} from '../../src/types/market.js'

type SearchOutput = TradeSearchResult & { listingIds: string[] }

interface CoordinatorServices {
  context: () => { realm: MarketRealm; language: PriceCheckContextState['language'] }
  prepare: (realm: MarketRealm, source: PriceCheckOpenRequest['source']) => Promise<TradePriceCheckDraft>
  leagues: (realm: MarketRealm) => Promise<Array<{ id: string; text: string }>>
  search: (realm: MarketRealm, source: PriceCheckOpenRequest['source'], leagueId: string, criteria: TradePriceCheckCriteria) => Promise<SearchOutput>
  fetch: (realm: MarketRealm, ids: string[], searchId: string) => Promise<unknown>
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

function listingView(value: unknown): PriceCheckListingView | null {
  const root = record(value)
  const id = text(root.id)
  const item = record(root.item)
  const listing = record(root.listing)
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
    return values.flatMap((raw) => {
      const line = typeof raw === 'string' ? text(raw) : text(record(raw).text) || text(record(raw).description)
      const canonicalGroup: LibraryModifierGroup = group === 'enchant' || group === 'rune' || group === 'implicit' ? group : 'explicit'
      return line ? [{
        id: `${group}-${displayOrder}`,
        displayOrder: displayOrder++,
        group: canonicalGroup,
        sourceTags: [group as LibraryModifierTag],
        text: line,
        tradeStatIds: [],
      }] : []
    })
  })
  return {
    id,
    ...(amount != null && currency ? { price: { amount, currency, display: `${amount} ${currency}` } } : {}),
    seller: {
      accountName: text(account.name) || text(account.lastCharacterName),
      status: statusText === 'afk' ? 'afk' : Object.keys(online).length ? 'online' : 'offline',
    },
    item: {
      rarity: text(item.rarity) || 'UNKNOWN',
      name: text(item.name) || baseType,
      baseType,
      iconUrl: text(item.icon),
      itemLevel: typeof item.ilvl === 'number' ? item.ilvl : undefined,
      corrupted: item.corrupted === true,
      identified: item.identified !== false,
      modifiers,
    },
    listedAt: text(listing.indexed),
    whisper: text(listing.whisper),
    hideoutAvailable: Boolean(text(listing.hideout_token)),
  }
}

export class PriceCheckCoordinator {
  private generation = 0
  private source?: PriceCheckOpenRequest['source']
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
    this.searchContext = undefined
    const context = this.services.context()
    this.set({ generation, ...context, phase: 'parsing', leagues: [], listings: [], initialLeagueId: request.initialLeagueId })
    try {
      const [draft, leagues] = await Promise.all([
        this.services.prepare(context.realm, request.source),
        this.services.leagues(context.realm),
      ])
      if (generation !== this.generation) return this.snapshot()
      this.set({ ...this.state, phase: 'configuring', draft, leagues })
    } catch (error) {
      if (generation === this.generation) this.fail(error)
    }
    return this.snapshot()
  }

  async search(leagueId: string, criteria: TradePriceCheckCriteria): Promise<PriceCheckContextState> {
    if (!this.source) throw new Error('No price check item is active')
    const generation = this.generation
    const { realm } = this.state
    this.set({ ...this.state, phase: 'searching', listings: [], search: undefined, error: undefined })
    try {
      const result = await this.services.search(realm, this.source, leagueId, criteria)
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
      const listings = results.map(listingView).filter((value): value is PriceCheckListingView => Boolean(value))
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
