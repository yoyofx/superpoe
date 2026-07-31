import { ipcRenderer } from 'electron'
import { parseLiveResult } from './marketLive.js'

interface MonitorConfig {
  searchId: string
  realm: 'cn' | 'global'
  liveUrl: string
}

interface LiveConnection {
  config: MonitorConfig
  socket?: WebSocket
  retryAttempt: number
  retryTimer?: ReturnType<typeof setTimeout>
  stopped: boolean
}

const liveConnections = new Map<string, LiveConnection>()
const retryDelays = [1_000, 2_000, 5_000, 10_000, 30_000, 60_000]

function sendMonitorState(connection: LiveConnection, connectionStatus: string, extra: Record<string, unknown> = {}): void {
  ipcRenderer.send('market-monitor:state', {
    searchId: connection.config.searchId,
    connectionStatus,
    retryAttempt: connection.retryAttempt,
    ...extra,
  })
}

function validLiveUrl(config: MonitorConfig): boolean {
  try {
    const url = new URL(config.liveUrl)
    const host = config.realm === 'cn' ? 'poe.game.qq.com' : 'www.pathofexile.com'
    return url.protocol === 'wss:' && url.hostname === host
      && /^\/api\/trade2\/live\/poe2\/[^/]+\/[A-Za-z0-9_-]{1,128}$/.test(url.pathname)
  } catch {
    return false
  }
}

function stopLive(connection: LiveConnection): void {
  connection.stopped = true
  if (connection.retryTimer) clearTimeout(connection.retryTimer)
  connection.socket?.close(1000, 'monitor stopped')
  connection.socket = undefined
  sendMonitorState(connection, 'disabled')
}

function scheduleReconnect(connection: LiveConnection): void {
  if (connection.stopped || connection.retryTimer) return
  const delay = retryDelays[Math.min(connection.retryAttempt, retryDelays.length - 1)]
  connection.retryAttempt += 1
  const nextRetryAt = new Date(Date.now() + delay).toISOString()
  sendMonitorState(connection, 'reconnecting', { nextRetryAt })
  connection.retryTimer = setTimeout(() => {
    connection.retryTimer = undefined
    connectLive(connection)
  }, delay)
}

function connectLive(connection: LiveConnection): void {
  if (connection.stopped || connection.socket) return
  if (!validLiveUrl(connection.config)) {
    sendMonitorState(connection, 'invalid-search', { lastErrorCode: 'invalid-live-url' })
    return
  }
  sendMonitorState(connection, connection.retryAttempt ? 'reconnecting' : 'connecting')
  let socket: WebSocket
  try {
    socket = new WebSocket(connection.config.liveUrl)
  } catch {
    scheduleReconnect(connection)
    return
  }
  connection.socket = socket
  socket.addEventListener('open', () => {
    connection.retryAttempt = 0
    sendMonitorState(connection, 'connecting')
  })
  socket.addEventListener('message', (event) => {
    if (typeof event.data !== 'string' || event.data.length > 1_000_000) return
    try {
      const payload = JSON.parse(event.data) as unknown
      if (payload && typeof payload === 'object') {
        const message = payload as { auth?: unknown; count?: unknown; result?: unknown; new?: unknown }
        ipcRenderer.send('market-monitor:frame', {
          searchId: connection.config.searchId,
          keys: Object.keys(message).slice(0, 12),
          auth: message.auth === true,
          count: Number.isFinite(Number(message.count)) ? Number(message.count) : undefined,
          resultCount: Array.isArray(message.result) ? message.result.length : Array.isArray(message.new) ? message.new.length : undefined,
          resultType: Array.isArray(message.result) ? 'array' : typeof message.result,
          resultLength: typeof message.result === 'string' ? message.result.length : undefined,
          resultKeys: message.result && typeof message.result === 'object' && !Array.isArray(message.result) ? Object.keys(message.result).slice(0, 12) : undefined,
          invalidCharacters: typeof message.result === 'string' ? message.result.replace(/[A-Za-z0-9_-]/g, '').slice(0, 40) : undefined,
        })
        if (message.auth === true) sendMonitorState(connection, 'connected', { connectedAt: new Date().toISOString() })
      }
      const result = parseLiveResult(payload)
      if (result.listingIds.length || result.resultTokens.length) {
        ipcRenderer.send('market-monitor:result', { searchId: connection.config.searchId, ...result })
      }
    } catch { /* Ignore malformed official frames. */ }
  })
  socket.addEventListener('error', () => sendMonitorState(connection, 'error', { lastErrorCode: 'websocket-error' }))
  socket.addEventListener('close', (event) => {
    if (connection.socket === socket) connection.socket = undefined
    if (connection.stopped) return
    if (event.code === 1008 || event.code === 4004) {
      sendMonitorState(connection, 'invalid-search', { lastErrorCode: `close-${event.code}` })
      return
    }
    if (event.code === 1013) {
      sendMonitorState(connection, 'error', { lastErrorCode: 'rate-limited' })
      return
    }
    if (event.code === 4001 || event.code === 4401) {
      sendMonitorState(connection, 'auth-required', { lastErrorCode: `close-${event.code}` })
      return
    }
    scheduleReconnect(connection)
  })
}

ipcRenderer.on('market-monitor:sync', (_event, value: unknown) => {
  const configs = Array.isArray(value) ? value.filter((entry): entry is MonitorConfig => {
    if (!entry || typeof entry !== 'object') return false
    const config = entry as Partial<MonitorConfig>
    return typeof config.searchId === 'string' && (config.realm === 'cn' || config.realm === 'global') && typeof config.liveUrl === 'string'
  }).slice(0, 20) : []
  const wanted = new Set(configs.map((config) => config.searchId))
  for (const [searchId, connection] of liveConnections) {
    if (!wanted.has(searchId)) {
      stopLive(connection)
      liveConnections.delete(searchId)
    }
  }
  for (const config of configs) {
    const existing = liveConnections.get(config.searchId)
    if (existing && existing.config.liveUrl === config.liveUrl) continue
    if (existing) stopLive(existing)
    const connection: LiveConnection = { config, retryAttempt: 0, stopped: false }
    liveConnections.set(config.searchId, connection)
    connectLive(connection)
  }
})

ipcRenderer.send('market-monitor:ready')

type FavoriteVisualState = 'idle' | 'pending' | 'active' | 'error'

interface ListingRef {
  realm: 'cn' | 'global'
  listingId: string
  queryId?: string
  sourceUrl: string
}

const BUTTON_CLASS = 'superpoe-market-favorite'
const CARD_MARKER = 'data-superpoe-market-listing'
const buttonsByListing = new Map<string, Set<HTMLButtonElement>>()
const stateByListing = new Map<string, FavoriteVisualState>()
let scanTimer: ReturnType<typeof setTimeout> | undefined
let statusTimer: ReturnType<typeof setTimeout> | undefined

function migrateTencentTradeState(): void {
  if (window.location.hostname !== 'poe.game.qq.com') return
  try {
    const key = 'lscache-trade2state'
    const current = localStorage.getItem(key)
    const parsed = current ? JSON.parse(current) as unknown : {}
    const state = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {}
    if (state.status === 'securable') return
    localStorage.setItem(key, JSON.stringify({ ...state, realm: 'poe2', status: 'securable' }))
  } catch {
    // The official page remains usable if storage is unavailable or malformed.
  }
}

migrateTencentTradeState()

function safeId(value: string | null | undefined): string | undefined {
  const normalized = value?.trim()
  return normalized && /^[A-Za-z0-9_-]{4,160}$/.test(normalized) ? normalized : undefined
}

function queryIdFromUrl(value: string): string | undefined {
  try {
    const url = new URL(value, window.location.href)
    const query = safeId(url.searchParams.get('query'))
    if (query) return query
    const parts = url.pathname.split('/').filter(Boolean)
    const searchIndex = parts.indexOf('search')
    if (searchIndex >= 0) return safeId(parts[searchIndex + 3])
    return undefined
  } catch {
    return undefined
  }
}

function extractRef(card: Element): ListingRef | null {
  const element = card as HTMLElement
  const listingId = safeId(
    element.dataset.listingId
    || element.dataset.resultId
    || element.dataset.id
    || element.getAttribute('data-listing-id')
    || element.getAttribute('data-result-id')
    || element.getAttribute('data-id'),
  )
  if (!listingId) return null
  const queryId = safeId(element.dataset.queryId || element.dataset.query)
    || queryIdFromUrl(element.querySelector<HTMLAnchorElement>('a[href*="query="]')?.href || '')
    || queryIdFromUrl(window.location.href)
  const realm = window.location.hostname === 'poe.game.qq.com' ? 'cn' : 'global'
  return { realm, listingId, queryId, sourceUrl: window.location.href.slice(0, 2_048) }
}

function applyButtonState(button: HTMLButtonElement, state: FavoriteVisualState): void {
  button.dataset.state = state
  button.disabled = state === 'pending'
  button.textContent = state === 'active' ? '★' : state === 'pending' ? '…' : '☆'
  button.title = state === 'active'
    ? '从 SuperPoE2 装备仓库移除市场收藏来源'
    : state === 'error'
      ? '收藏失败，点击重试'
      : '收藏到 SuperPoE2 装备仓库'
  button.dataset.tooltip = button.title
  button.setAttribute('aria-label', button.title)
}

function setListingState(listingId: string, state: FavoriteVisualState): void {
  stateByListing.set(listingId, state)
  for (const button of buttonsByListing.get(listingId) || []) applyButtonState(button, state)
}

function scheduleStatusRequest(): void {
  if (statusTimer) clearTimeout(statusTimer)
  statusTimer = setTimeout(() => {
    const listingIds = [...buttonsByListing.keys()].slice(0, 250)
    if (listingIds.length) ipcRenderer.send('market-enhancement:status-request', { listingIds })
  }, 120)
}

function decorateCard(card: Element): void {
  if (card.hasAttribute(CARD_MARKER)) return
  const ref = extractRef(card)
  if (!ref) return
  card.setAttribute(CARD_MARKER, ref.listingId)
  const button = document.createElement('button')
  button.type = 'button'
  button.className = BUTTON_CLASS
  button.dataset.listingId = ref.listingId
  applyButtonState(button, stateByListing.get(ref.listingId) || 'idle')
  button.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopImmediatePropagation()
    setListingState(ref.listingId, 'pending')
    ipcRenderer.send('market-enhancement:favorite-toggle', {
      requestId: crypto.randomUUID(),
      ref: { ...ref, sourceUrl: window.location.href.slice(0, 2_048) },
    })
  }, true)
  const target = card.querySelector('.left, .item, .item-container, [class*="item"]') || card
  target.insertBefore(button, target.firstChild)
  const buttons = buttonsByListing.get(ref.listingId) || new Set<HTMLButtonElement>()
  buttons.add(button)
  buttonsByListing.set(ref.listingId, buttons)
}

function scan(root: ParentNode = document): void {
  for (const [listingId, buttons] of buttonsByListing) {
    for (const button of buttons) {
      if (!button.isConnected) buttons.delete(button)
    }
    if (!buttons.size) {
      buttonsByListing.delete(listingId)
      stateByListing.delete(listingId)
    }
  }
  const selectors = [
    '.resultset .row[data-id]',
    '.search-results .row[data-id]',
    '.row[data-listing-id]',
    '.row[data-result-id]',
    '[data-listing-id][class*="result"]',
    '[data-result-id][class*="result"]',
  ]
  if (root instanceof Element && selectors.some((selector) => root.matches(selector))) decorateCard(root)
  for (const card of root.querySelectorAll(selectors.join(','))) decorateCard(card)
  scheduleStatusRequest()
}

function scheduleScan(): void {
  if (scanTimer) clearTimeout(scanTimer)
  scanTimer = setTimeout(() => scan(document), 80)
}

function installStyle(): void {
  if (document.getElementById('superpoe-market-style')) return
  const style = document.createElement('style')
  style.id = 'superpoe-market-style'
  style.textContent = `
    :root {
      scrollbar-color: #62563f #111310 !important;
      scrollbar-width: thin !important;
    }
    *::-webkit-scrollbar { width: 9px !important; height: 9px !important; }
    *::-webkit-scrollbar-track { background: #111310 !important; }
    *::-webkit-scrollbar-corner { background: #111310 !important; }
    *::-webkit-scrollbar-thumb {
      border: 2px solid #111310 !important;
      border-radius: 2px !important;
      background: #62563f !important;
      background-clip: padding-box !important;
    }
    *::-webkit-scrollbar-thumb:hover { background-color: #8f7b58 !important; }
    .${BUTTON_CLASS} {
      box-sizing: border-box !important;
      width: 32px !important;
      height: 32px !important;
      min-width: 32px !important;
      margin: 4px 7px 4px 2px !important;
      padding: 0 !important;
      border: 1px solid #666 !important;
      border-radius: 4px !important;
      background: linear-gradient(135deg, #222, #111) !important;
      color: #888 !important;
      font: 20px/30px Arial, sans-serif !important;
      text-align: center !important;
      cursor: pointer !important;
      vertical-align: top !important;
      position: relative !important;
      z-index: 20 !important;
      transition: transform .2s ease, color .2s ease, border-color .2s ease, box-shadow .2s ease !important;
    }
    .${BUTTON_CLASS}:hover { border-color: #f0d0a0 !important; color: #d4b483 !important; transform: scale(1.1) rotate(15deg); box-shadow: 0 0 10px rgba(212,180,131,.4) !important; z-index: 2147483647 !important; }
    .${BUTTON_CLASS}[data-state="active"] { color: #d4b483 !important; border-color: #d4b483 !important; background: linear-gradient(135deg, #332a1b, #1a1a1a) !important; text-shadow: 0 0 8px rgba(255,215,0,.6) !important; }
    .${BUTTON_CLASS}[data-state="pending"] { cursor: wait !important; color: #aaa !important; }
    .${BUTTON_CLASS}[data-state="error"] { color: #d88678 !important; border-color: #9b5047 !important; }
    .${BUTTON_CLASS}::after { content: attr(data-tooltip); position: absolute; right: 0; bottom: 125%; width: max-content; max-width: 260px; padding: 7px 10px; border: 1px solid #a38d6d; border-left: 3px solid #d4b483; border-radius: 4px; background: #0f0f0f; color: #d4b483; font: 600 12px/1.35 Arial, sans-serif; white-space: normal; opacity: 0; visibility: hidden; pointer-events: none; transform: translateY(8px); transition: opacity .18s ease, transform .18s ease; box-shadow: 0 5px 20px rgba(0,0,0,.8); }
    .${BUTTON_CLASS}:hover::after { opacity: 1; visibility: visible; transform: translateY(0); }
  `
  document.head.appendChild(style)
}

ipcRenderer.on('market-enhancement:status-result', (_event, payload: unknown) => {
  if (!payload || typeof payload !== 'object' || !Array.isArray((payload as { states?: unknown }).states)) return
  for (const state of (payload as { states: Array<{ listingId?: unknown; active?: unknown }> }).states) {
    const listingId = typeof state.listingId === 'string' ? state.listingId : undefined
    const currentState = listingId ? stateByListing.get(listingId) : undefined
    if (listingId && typeof state.active === 'boolean' && currentState !== 'pending' && currentState !== 'error') {
      setListingState(listingId, state.active ? 'active' : 'idle')
    }
  }
})

ipcRenderer.on('market-enhancement:favorite-result', (_event, payload: unknown) => {
  if (!payload || typeof payload !== 'object') return
  const result = payload as { listingId?: unknown; active?: unknown; error?: unknown }
  if (typeof result.listingId !== 'string') return
  setListingState(result.listingId, result.error ? 'error' : result.active ? 'active' : 'idle')
  if (typeof result.error === 'string') {
    const message = result.error.slice(0, 240)
    for (const button of buttonsByListing.get(result.listingId) || []) {
      button.title = `收藏失败：${message}`
      button.setAttribute('aria-label', button.title)
    }
  }
})

window.addEventListener('DOMContentLoaded', () => {
  installStyle()
  scan(document)
  const observer = new MutationObserver(scheduleScan)
  observer.observe(document.documentElement, { childList: true, subtree: true })
  window.addEventListener('popstate', scheduleScan)
  window.addEventListener('hashchange', scheduleScan)
})
