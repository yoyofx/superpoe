import { BrowserWindow, WebContentsView, shell, type Rectangle, type WebContents } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { MarketDomListingRef, MarketSearchReference, MarketVisitHideoutResult, SavedSearchQuerySnapshot } from '../src/types/market.js'
import { TradeCredentialStore } from './tradeCredentialStore.js'
import { isGameOfflineVisitError, OfficialTradeRequestError } from './officialTradeRequestError.js'
import { createSearchQuerySnapshot, parseOfficialSearchUrl, withSearchSnapshot } from './marketSearch.js'

export type MarketRealm = 'cn' | 'global'
export type MarketNavigationCommand = 'back' | 'forward' | 'reload' | 'stop' | 'home'

export interface MarketViewState {
  realm: MarketRealm
  url: string
  title: string
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
  sessionStatus: 'anonymous' | 'valid' | 'unknown'
  currentSearch?: MarketSearchReference
  error?: string
}

interface MarketRealmProfile {
  realm: MarketRealm
  partition: string
  homeUrl: string
  loginUrl: string
  profileUrl: string
  isAllowedUrl: (url: URL) => boolean
}

const isHttpsHost = (url: URL, hostname: string): boolean => url.protocol === 'https:'
  && (url.hostname === hostname || url.hostname.endsWith(`.${hostname}`))

const MARKET_PROFILES: Record<MarketRealm, MarketRealmProfile> = {
  cn: {
    realm: 'cn',
    partition: 'persist:superpoe-trade-cn',
    homeUrl: 'https://poe.game.qq.com/trade2',
    loginUrl: 'https://poe.game.qq.com/login?redir=%2Ftrade2',
    profileUrl: 'https://poe.game.qq.com/api/profile',
    isAllowedUrl: (url) => isHttpsHost(url, 'game.qq.com')
      || isHttpsHost(url, 'qq.com')
      || isHttpsHost(url, 'wegame.com.cn'),
  },
  global: {
    realm: 'global',
    partition: 'persist:superpoe-trade-global',
    homeUrl: 'https://www.pathofexile.com/trade2',
    loginUrl: 'https://www.pathofexile.com/login?redirect=%2Ftrade2',
    profileUrl: 'https://www.pathofexile.com/api/profile',
    isAllowedUrl: (url) => isHttpsHost(url, 'pathofexile.com')
      || isHttpsHost(url, 'steamcommunity.com'),
  },
}

const currentDir = path.dirname(fileURLToPath(import.meta.url))
const marketPreloadPath = path.join(currentDir, 'marketPreload.cjs')
const MARKET_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/

function parseAllowedUrl(value: string, profile: MarketRealmProfile): URL | null {
  try {
    const url = new URL(value)
    return profile.isAllowedUrl(url) ? url : null
  } catch {
    return null
  }
}

function errorMessage(code: number, description: string): string | undefined {
  if (code === -3) return undefined
  if (code === -106) return 'The internet connection is unavailable.'
  if (code === -105) return 'The official trade site could not be resolved.'
  if (code === -102) return 'The official trade site refused the connection.'
  if (code === -200 || code === -202) return 'The official trade site certificate could not be verified.'
  return description || `The official trade site failed to load (${code}).`
}

export class MarketViewManager {
  private readonly views = new Map<MarketRealm, WebContentsView>()
  private activeView: WebContentsView | null = null
  private activeRealm: MarketRealm = 'global'
  private attached = false
  private bounds: Rectangle = { x: 0, y: 0, width: 1, height: 1 }
  private readonly sessionStates = new Map<MarketRealm, { status: MarketViewState['sessionStatus']; checkedAt: number }>()
  private readonly sessionChecks = new Map<MarketRealm, Promise<MarketViewState['sessionStatus']>>()
  private readonly sessionRestores = new Map<MarketRealm, Promise<void>>()
  private readonly generatedSearches = new Map<string, SavedSearchQuerySnapshot>()
  private readonly recentOfficialQueries = new Map<MarketRealm, { webContentsId: number; leagueId: string; snapshot: SavedSearchQuerySnapshot; capturedAt: number }>()

  constructor(
    private readonly window: BrowserWindow,
    private readonly emitState: (state: MarketViewState) => void,
    private readonly credentialStore: TradeCredentialStore,
  ) {
    window.on('minimize', () => this.detach())
    window.on('restore', () => {
      if (this.activeView) this.attach(this.activeView)
    })
  }

  setRealm(realm: MarketRealm): void {
    if (realm === this.activeRealm) return
    this.activeRealm = realm
    if (!this.activeView) return
    this.detach()
    const view = this.getOrCreateView(realm)
    this.activeView = view
    this.attach(view)
    void this.loadHomeIfNeeded(view, MARKET_PROFILES[realm])
    void this.publishState(view, realm)
  }

  activate(bounds: Rectangle): void {
    this.bounds = bounds
    const view = this.getOrCreateView(this.activeRealm)
    if (this.activeView !== view) this.detach()
    this.activeView = view
    this.attach(view)
    view.setBounds(bounds)
    void this.loadHomeIfNeeded(view, MARKET_PROFILES[this.activeRealm])
    void this.publishState(view, this.activeRealm)
  }

  deactivate(): void {
    this.detach()
  }

  setBounds(bounds: Rectangle): void {
    this.bounds = bounds
    if (this.activeView && this.attached) this.activeView.setBounds(bounds)
  }

  navigate(command: MarketNavigationCommand): void {
    const view = this.activeView || this.getOrCreateView(this.activeRealm)
    const history = view.webContents.navigationHistory
    if (command === 'back' && history.canGoBack()) history.goBack()
    else if (command === 'forward' && history.canGoForward()) history.goForward()
    else if (command === 'reload') view.webContents.reload()
    else if (command === 'stop') view.webContents.stop()
    else if (command === 'home') void view.webContents.loadURL(MARKET_PROFILES[this.activeRealm].homeUrl)
  }

  login(): void {
    const view = this.activeView || this.getOrCreateView(this.activeRealm)
    void view.webContents.loadURL(MARKET_PROFILES[this.activeRealm].loginUrl)
  }

  openCurrentExternal(): void {
    const url = this.activeView?.webContents.getURL()
    if (url && parseAllowedUrl(url, MARKET_PROFILES[this.activeRealm])) void shell.openExternal(url)
  }

  openSource(realm: MarketRealm, value: string): void {
    const profile = MARKET_PROFILES[realm]
    const url = parseAllowedUrl(value, profile)
    if (!url) throw new Error('Invalid market source URL')
    this.setRealm(realm)
    const view = this.getOrCreateView(realm)
    void view.webContents.loadURL(url.toString())
  }

  async getState(): Promise<MarketViewState> {
    const view = this.activeView || this.getOrCreateView(this.activeRealm)
    return this.buildState(view, this.activeRealm)
  }

  getCurrentSearch(): MarketSearchReference | null {
    const contents = this.activeView?.webContents
    if (!contents || contents.isDestroyed()) return null
    return this.resolveSearchReference(contents, this.activeRealm)
  }

  rememberGeneratedSearch(realm: MarketRealm, leagueId: string, searchCode: string, body: unknown): void {
    const reference = parseOfficialSearchUrl(
      `https://${realm === 'cn' ? 'poe.game.qq.com' : 'www.pathofexile.com'}/trade2/search/poe2/${encodeURIComponent(leagueId)}/${encodeURIComponent(searchCode)}`,
      realm,
    )
    if (!reference) throw new Error('Official trade search returned an invalid reference')
    this.generatedSearches.set(`${realm}:${leagueId}:${searchCode}`, createSearchQuerySnapshot(body, 'superpoe-query'))
    while (this.generatedSearches.size > 100) this.generatedSearches.delete(this.generatedSearches.keys().next().value as string)
  }

  getRealmForSender(contents: WebContents): MarketRealm | null {
    for (const [realm, view] of this.views) {
      if (!view.webContents.isDestroyed() && view.webContents === contents) return realm
    }
    return null
  }

  ensureMonitoringView(realm: MarketRealm): void {
    const view = this.getOrCreateView(realm)
    void this.loadHomeIfNeeded(view, MARKET_PROFILES[realm])
  }

  sendMonitorSync(realm: MarketRealm, configs: Array<{ searchId: string; realm: MarketRealm; liveUrl: string }>): void {
    const view = this.getOrCreateView(realm)
    if (!view.webContents.isDestroyed()) view.webContents.send('market-monitor:sync', configs)
  }

  async fetchListing(ref: MarketDomListingRef): Promise<unknown> {
    if (!MARKET_ID_PATTERN.test(ref.listingId)
      || (ref.queryId != null && !MARKET_ID_PATTERN.test(ref.queryId))) {
      throw new Error('Invalid official trade listing reference')
    }
    const origin = ref.realm === 'cn' ? 'https://poe.game.qq.com' : 'https://www.pathofexile.com'
    const query = ref.queryId ? `?query=${encodeURIComponent(ref.queryId)}&realm=poe2` : '?realm=poe2'
    return this.requestJson(ref.realm,
      `${origin}/api/trade2/fetch/${encodeURIComponent(ref.listingId)}${query}`,
      { credentials: 'include', headers: { Accept: 'application/json' } },
    )
  }

  async fetchListings(realm: MarketRealm, listingIds: string[], searchCode: string): Promise<unknown> {
    const ids = [...new Set(listingIds)].filter((id) => MARKET_ID_PATTERN.test(id)).slice(0, 10)
    if (!ids.length || !MARKET_ID_PATTERN.test(searchCode)) throw new Error('Invalid official trade fetch request')
    const origin = realm === 'cn' ? 'https://poe.game.qq.com' : 'https://www.pathofexile.com'
    return this.requestJson(realm,
      `${origin}/api/trade2/fetch/${ids.map(encodeURIComponent).join(',')}?query=${encodeURIComponent(searchCode)}&realm=poe2`,
      { credentials: 'include', headers: { Accept: 'application/json' } },
    )
  }

  async fetchLiveResult(realm: MarketRealm, resultToken: string, searchCode: string): Promise<unknown> {
    if (resultToken.length > 4_096 || !/^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+){2}$/.test(resultToken)
      || !MARKET_ID_PATTERN.test(searchCode)) throw new Error('Invalid official live result token')
    const origin = realm === 'cn' ? 'https://poe.game.qq.com' : 'https://www.pathofexile.com'
    return this.requestJson(realm,
      `${origin}/api/trade2/fetch/${encodeURIComponent(resultToken)}?query=${encodeURIComponent(searchCode)}&realm=poe2`,
      { credentials: 'include', headers: { Accept: 'application/json' } },
    )
  }

  async visitHideout(ref: MarketDomListingRef): Promise<MarketVisitHideoutResult> {
    const payload = await this.fetchListing(ref)
    const result = payload && typeof payload === 'object' && Array.isArray((payload as { result?: unknown }).result)
      ? (payload as { result: unknown[] }).result[0]
      : undefined
    const listing = result && typeof result === 'object' && (result as { listing?: unknown }).listing
    const token = listing && typeof listing === 'object' && typeof (listing as { hideout_token?: unknown }).hideout_token === 'string'
      ? (listing as { hideout_token: string }).hideout_token
      : undefined
    if (!token) throw new Error('This listing does not provide a hideout token')
    const origin = ref.realm === 'cn' ? 'https://poe.game.qq.com' : 'https://www.pathofexile.com'
    try {
      await this.requestJson(ref.realm, `${origin}/api/trade2/whisper`, {
        method: 'POST', credentials: 'include',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
        body: JSON.stringify({ token }),
      })
      return { ok: true }
    } catch (error) {
      if (isGameOfflineVisitError(error)) return { ok: false, reason: 'game-offline' }
      throw error
    }
  }

  fetchStats(realm: MarketRealm): Promise<unknown> {
    const origin = realm === 'cn' ? 'https://poe.game.qq.com' : 'https://www.pathofexile.com'
    return this.requestJson(realm, `${origin}/api/trade2/data/stats`, {
      credentials: 'include', headers: { Accept: 'application/json' },
    })
  }

  fetchLeagues(realm: MarketRealm): Promise<unknown> {
    const origin = realm === 'cn' ? 'https://poe.game.qq.com' : 'https://www.pathofexile.com'
    return this.requestJson(realm, `${origin}/api/trade2/data/leagues`, {
      credentials: 'include', headers: { Accept: 'application/json' },
    })
  }

  search(realm: MarketRealm, leagueId: string, query: unknown): Promise<unknown> {
    if (!leagueId || leagueId.length > 128 || /[/?#\\]/.test(leagueId)) throw new Error('Invalid trade league')
    const body = JSON.stringify(query)
    if (body.length > 500_000) throw new Error('Trade query is too large')
    const origin = realm === 'cn' ? 'https://poe.game.qq.com' : 'https://www.pathofexile.com'
    return this.requestJson(realm, `${origin}/api/trade2/search/poe2/${encodeURIComponent(leagueId)}`, {
      method: 'POST', credentials: 'include', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body,
    })
  }

  dispose(): void {
    this.detach()
    for (const view of this.views.values()) {
      if (!view.webContents.isDestroyed()) view.webContents.close()
    }
    this.views.clear()
    this.activeView = null
  }

  private getOrCreateView(realm: MarketRealm): WebContentsView {
    const existing = this.views.get(realm)
    if (existing && !existing.webContents.isDestroyed()) return existing

    const profile = MARKET_PROFILES[realm]
    const view = new WebContentsView({
      webPreferences: {
        preload: marketPreloadPath,
        partition: profile.partition,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
      },
    })
    view.setBackgroundColor('#090b0c')
    this.configureWebContents(view.webContents, profile)
    this.views.set(realm, view)
    return view
  }

  private configureWebContents(contents: WebContents, profile: MarketRealmProfile): void {
    const publish = () => void this.publishStateFor(contents, profile.realm)

    contents.on('did-start-loading', publish)
    contents.on('did-stop-loading', publish)
    contents.on('did-navigate', publish)
    contents.on('did-navigate-in-page', publish)
    contents.on('page-title-updated', publish)
    contents.on('did-fail-load', (_event, code, description, _url, isMainFrame) => {
      if (!isMainFrame) return
      const message = errorMessage(code, description)
      if (message) void this.publishStateFor(contents, profile.realm, message)
    })

    const guardNavigation = (event: Electron.Event, url: string) => {
      if (parseAllowedUrl(url, profile)) return
      event.preventDefault()
      if (/^https:/i.test(url)) void shell.openExternal(url)
    }
    contents.on('will-navigate', (event, url) => guardNavigation(event, url))
    contents.on('will-redirect', (event, url) => guardNavigation(event, url))

    contents.setWindowOpenHandler(({ url }) => {
      if (!parseAllowedUrl(url, profile)) {
        if (/^https:/i.test(url)) void shell.openExternal(url)
        return { action: 'deny' }
      }
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          parent: this.window,
          autoHideMenuBar: true,
          width: 860,
          height: 760,
          webPreferences: {
            partition: profile.partition,
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
            webSecurity: true,
          },
        },
      }
    })

    contents.on('did-create-window', (childWindow) => {
      childWindow.webContents.on('will-navigate', (event, url) => guardNavigation(event, url))
      childWindow.webContents.on('will-redirect', (event, url) => guardNavigation(event, url))
      childWindow.webContents.setWindowOpenHandler(({ url }) => {
        if (parseAllowedUrl(url, profile)) return { action: 'allow' }
        if (/^https:/i.test(url)) void shell.openExternal(url)
        return { action: 'deny' }
      })
      childWindow.on('closed', () => publish())
    })

    contents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
    const apiOrigin = profile.realm === 'cn' ? 'https://poe.game.qq.com' : 'https://www.pathofexile.com'
    contents.session.webRequest.onBeforeRequest({ urls: [`${apiOrigin}/api/trade2/search/poe2/*`] }, (details, callback) => {
      try {
        if (details.method !== 'POST' || details.webContentsId !== contents.id) return callback({})
        const apiUrl = new URL(details.url)
        const encodedLeague = apiUrl.pathname.match(/^\/api\/trade2\/search\/poe2\/([^/]+)$/)?.[1]
        const bytes = details.uploadData?.length === 1 ? details.uploadData[0].bytes : undefined
        if (!encodedLeague || !bytes || bytes.byteLength > 500_000) return callback({})
        const leagueId = decodeURIComponent(encodedLeague)
        const snapshot = createSearchQuerySnapshot(JSON.parse(Buffer.from(bytes).toString('utf8')) as unknown, 'official-page')
        this.recentOfficialQueries.set(profile.realm, { webContentsId: contents.id, leagueId, snapshot, capturedAt: Date.now() })
      } catch { /* An ambiguous or malformed body remains code-only. */ }
      callback({})
    })
    contents.session.cookies.on('changed', (_event, cookie, _cause, removed) => {
      if (!this.credentialStore.matches(profile.realm, cookie)) return
      if (removed) this.credentialStore.remove(profile.realm)
      else this.credentialStore.save(profile.realm, cookie)
      this.sessionStates.delete(profile.realm)
      publish()
    })
  }

  private async loadHomeIfNeeded(view: WebContentsView, profile: MarketRealmProfile): Promise<void> {
    await this.ensureSessionRestored(view.webContents, profile)
    if (!view.webContents.getURL() && !view.webContents.isLoading()) {
      await view.webContents.loadURL(profile.homeUrl).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error)
        void this.publishState(view, profile.realm, message)
      })
    }
  }

  private attach(view: WebContentsView): void {
    if (!this.attached) {
      this.window.contentView.addChildView(view)
      this.attached = true
    }
    view.setBounds(this.bounds)
  }

  private detach(): void {
    if (this.activeView && this.attached) {
      this.window.contentView.removeChildView(this.activeView)
      this.attached = false
    }
  }

  private async publishStateFor(contents: WebContents, realm: MarketRealm, error?: string): Promise<void> {
    const view = this.views.get(realm)
    if (!view || view.webContents !== contents || contents.isDestroyed()) return
    await this.publishState(view, realm, error)
  }

  private async publishState(view: WebContentsView, realm: MarketRealm, error?: string): Promise<void> {
    if (realm !== this.activeRealm || view.webContents.isDestroyed()) return
    this.emitState(await this.buildState(view, realm, error))
  }

  private async buildState(view: WebContentsView, realm: MarketRealm, error?: string): Promise<MarketViewState> {
    const contents = view.webContents
    const currentSearch = this.resolveSearchReference(contents, realm)
    return {
      realm,
      url: contents.getURL(),
      title: contents.getTitle(),
      loading: contents.isLoading(),
      canGoBack: contents.navigationHistory.canGoBack(),
      canGoForward: contents.navigationHistory.canGoForward(),
      sessionStatus: await this.resolveSessionStatus(contents, MARKET_PROFILES[realm]),
      ...(currentSearch ? { currentSearch } : {}),
      ...(error ? { error } : {}),
    }
  }

  private resolveSearchReference(contents: WebContents, realm: MarketRealm): MarketSearchReference | null {
    const reference = parseOfficialSearchUrl(contents.getURL(), realm)
    if (!reference) return null
    const generated = this.generatedSearches.get(`${realm}:${reference.leagueId}:${reference.searchCode}`)
    if (generated) return withSearchSnapshot(reference, generated)
    const recent = this.recentOfficialQueries.get(realm)
    if (recent && recent.webContentsId === contents.id && recent.leagueId === reference.leagueId && Date.now() - recent.capturedAt <= 120_000) {
      return withSearchSnapshot(reference, recent.snapshot)
    }
    return reference
  }

  private async resolveSessionStatus(contents: WebContents, profile: MarketRealmProfile): Promise<MarketViewState['sessionStatus']> {
    await this.ensureSessionRestored(contents, profile)
    const cached = this.sessionStates.get(profile.realm)
    if (cached && Date.now() - cached.checkedAt < 30_000) return cached.status
    const pending = this.sessionChecks.get(profile.realm)
    if (pending) return pending

    const check = (async (): Promise<MarketViewState['sessionStatus']> => {
      const cookies = await contents.session.cookies.get({ name: 'POESESSID' }).catch(() => [])
      if (!cookies.length) return 'anonymous'
      try {
        const response = await contents.session.fetch(profile.profileUrl, {
          credentials: 'include',
          redirect: 'manual',
        })
        if (response.ok) return 'valid'
        if (response.status === 401 || response.status === 403 || (response.status >= 300 && response.status < 400)) {
          this.credentialStore.remove(profile.realm)
          return 'anonymous'
        }
        return 'unknown'
      } catch {
        return 'unknown'
      }
    })()
    this.sessionChecks.set(profile.realm, check)
    try {
      const status = await check
      this.sessionStates.set(profile.realm, { status, checkedAt: Date.now() })
      return status
    } finally {
      this.sessionChecks.delete(profile.realm)
    }
  }

  private ensureSessionRestored(contents: WebContents, profile: MarketRealmProfile): Promise<void> {
    const existing = this.sessionRestores.get(profile.realm)
    if (existing) return existing
    const restore = (async () => {
      const restored = await this.credentialStore.restore(profile.realm, contents.session.cookies)
      if (restored) return
      const existingCookies = await contents.session.cookies.get({ name: 'POESESSID' }).catch(() => [])
      for (const cookie of existingCookies) this.credentialStore.save(profile.realm, cookie)
    })()
    this.sessionRestores.set(profile.realm, restore)
    return restore
  }

  private async requestJson(realm: MarketRealm, url: string, init: RequestInit): Promise<unknown> {
    const view = this.views.get(realm) || this.getOrCreateView(realm)
    if (view.webContents.isDestroyed()) throw new Error('Market session is unavailable')
    await this.ensureSessionRestored(view.webContents, MARKET_PROFILES[realm])
    const response = await view.webContents.session.fetch(url, init)
    if (!response.ok) throw new OfficialTradeRequestError(response.status)
    const text = await response.text()
    if (text.length > 5_000_000) throw new Error('Official trade response is too large')
    return JSON.parse(text) as unknown
  }
}
