import { ipcRenderer } from 'electron'

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
    .${BUTTON_CLASS} {
      box-sizing: border-box !important;
      width: 30px !important;
      height: 30px !important;
      min-width: 30px !important;
      margin: 4px 7px 4px 2px !important;
      padding: 0 !important;
      border: 1px solid #81704b !important;
      border-radius: 3px !important;
      background: #171814 !important;
      color: #a99a75 !important;
      font: 20px/28px Arial, sans-serif !important;
      text-align: center !important;
      cursor: pointer !important;
      vertical-align: top !important;
      position: relative !important;
      z-index: 20 !important;
    }
    .${BUTTON_CLASS}:hover { border-color: #c4aa67 !important; color: #dfc273 !important; background: #222017 !important; }
    .${BUTTON_CLASS}[data-state="active"] { color: #edc75f !important; border-color: #c29b3e !important; background: #292315 !important; }
    .${BUTTON_CLASS}[data-state="pending"] { cursor: wait !important; color: #aaa !important; }
    .${BUTTON_CLASS}[data-state="error"] { color: #d88678 !important; border-color: #9b5047 !important; }
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
