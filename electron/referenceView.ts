import { BrowserWindow, WebContentsView, shell, type Rectangle, type WebContents } from 'electron'

import type { ReferenceNavigationCommand, ReferencePoeNinjaImportEvent, ReferenceSiteConfig, ReferenceViewState } from '../src/types/reference.js'

export type { ReferenceNavigationCommand, ReferenceSiteConfig, ReferenceSiteId } from '../src/types/reference.js'

const DEFAULT_REFERENCE_SITE: ReferenceSiteConfig = {
  id: 'ninja',
  name: 'Ninja builds',
  url: 'https://ninja.710421059.xyz/poe2/builds',
  builtIn: true,
}

const REFERENCE_PARTITION = 'persist:superpoe-reference'
const MAX_REFERENCE_SITE_NAME_LENGTH = 80
const MAX_REFERENCE_SITE_URL_LENGTH = 2_048
const POE_NINJA_IMPORT_SCHEME = 'superpoe:'
const POE_NINJA_IMPORT_HOST = 'import-poe-ninja'
const POE_NINJA_IMPORT_RESET_SCRIPT = "document.getElementById('superpoe-poe-ninja-import')?.remove()"

const POE_NINJA_IMPORT_SCRIPT = String.raw`(() => {
  const hostId = 'superpoe-poe-ninja-import'
  const segments = location.pathname.split('/').filter(Boolean)
  const hasPassiveTreeSuffix = segments.length === 7 && segments[6] === 'passive-tree'
  const isProfileCharacter = (segments.length === 6 || hasPassiveTreeSuffix) && segments[0] === 'poe2' && segments[1] === 'profile' && segments[4] === 'character'
  const isBuildCharacter = (segments.length === 6 || hasPassiveTreeSuffix) && segments[0] === 'poe2' && segments[1] === 'builds' && segments[3] === 'character'
  const existing = document.getElementById(hostId)
  if (!isProfileCharacter && !isBuildCharacter) {
    existing?.remove()
    return
  }
  if (existing) return

  const host = document.createElement('div')
  host.id = hostId
  host.style.position = 'fixed'
  host.style.top = '18px'
  host.style.right = '18px'
  host.style.zIndex = '2147483647'
  host.style.fontFamily = 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
  const shadow = host.attachShadow({ mode: 'closed' })
  const style = document.createElement('style')
  style.textContent = '.import-button { align-items: center; background: linear-gradient(135deg, #0a0d0c, #171711 58%, #0b0d0c); border: 1px solid #9b7b3d; border-radius: 5px; box-shadow: 0 0 0 1px rgba(210, 174, 94, .12), 0 0 14px rgba(194, 156, 82, .26), 0 5px 20px rgba(0, 0, 0, .48); color: #ead59d; cursor: pointer; display: inline-flex; font: 600 14px/1 system-ui, sans-serif; gap: 8px; letter-spacing: .02em; padding: 11px 15px; text-shadow: 0 1px 2px #000; transition: background .15s ease, border-color .15s ease, box-shadow .15s ease, color .15s ease, transform .15s ease; animation: superpoe-gold-glow 2.8s ease-in-out infinite; } .import-button::before { background: #d8b66a; box-shadow: 0 0 8px rgba(216, 182, 106, .85); content: ""; display: block; height: 5px; transform: rotate(45deg); width: 5px; } .import-button:hover { background: linear-gradient(135deg, #111510, #282218 58%, #111510); border-color: #e1bd69; box-shadow: 0 0 0 1px rgba(225, 189, 105, .2), 0 0 22px rgba(218, 178, 86, .48), 0 7px 24px rgba(0, 0, 0, .55); color: #fff0bd; transform: translateY(-1px); } .import-button:active { transform: translateY(0); } .import-button.is-loading { cursor: wait; animation: none; border-color: #d7b66c; box-shadow: 0 0 0 1px rgba(225, 189, 105, .2), 0 0 20px rgba(218, 178, 86, .4); color: #f3dfaa; } .import-button.is-loading::before { animation: superpoe-gold-spin .9s linear infinite; } @keyframes superpoe-gold-glow { 0%, 100% { box-shadow: 0 0 0 1px rgba(210, 174, 94, .12), 0 0 12px rgba(194, 156, 82, .2), 0 5px 20px rgba(0, 0, 0, .48); } 50% { box-shadow: 0 0 0 1px rgba(225, 189, 105, .2), 0 0 23px rgba(218, 178, 86, .48), 0 5px 20px rgba(0, 0, 0, .48); } } @keyframes superpoe-gold-spin { to { transform: rotate(405deg); } } @media (prefers-reduced-motion: reduce) { .import-button, .import-button.is-loading::before { animation: none; } }'
  const button = document.createElement('button')
  button.className = 'import-button'
  button.type = 'button'
  button.textContent = '导入到 SuperPoE'
  button.addEventListener('click', () => {
    button.disabled = true
    button.classList.add('is-loading')
    button.textContent = '正在导入...'
    button.setAttribute('aria-busy', 'true')
    const url = 'superpoe://import-poe-ninja?url=' + encodeURIComponent(location.href)
    window.open(url, '_blank')
  })
  shadow.append(style, button)
  document.documentElement.append(host)
})()`

export function validateReferenceSite(value: unknown): ReferenceSiteConfig {
  if (!value || typeof value !== 'object') throw new Error('Invalid reference site')
  const candidate = value as Partial<ReferenceSiteConfig>
  const id = typeof candidate.id === 'string' ? candidate.id.trim().slice(0, 64) : ''
  const name = typeof candidate.name === 'string' ? candidate.name.trim().slice(0, MAX_REFERENCE_SITE_NAME_LENGTH) : ''
  const rawUrl = typeof candidate.url === 'string' ? candidate.url.trim() : ''
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(id) || !name || !rawUrl || rawUrl.length > MAX_REFERENCE_SITE_URL_LENGTH) {
    throw new Error('Invalid reference site')
  }
  try {
    const url = new URL(rawUrl)
    if (url.protocol !== 'https:' || !url.hostname) throw new Error('Invalid reference site URL')
    return { id, name, url: url.toString(), ...(candidate.builtIn === true ? { builtIn: true } : {}) }
  } catch {
    throw new Error('Reference sites must use HTTPS URLs')
  }
}

function isAllowedUrl(value: string, site: ReferenceSiteConfig): URL | null {
  try {
    const url = new URL(value)
    const base = new URL(site.url)
    if (url.protocol !== 'https:' || url.port !== base.port) return null
    if (url.hostname !== base.hostname && !url.hostname.endsWith(`.${base.hostname}`)) return null
    return url
  } catch {
    return null
  }
}

function errorMessage(code: number, description: string): string | undefined {
  if (code === -3) return undefined
  if (code === -106) return 'The reference site is unavailable while offline.'
  if (code === -105) return 'The reference site could not be resolved.'
  if (code === -102) return 'The reference site refused the connection.'
  if (code === -200 || code === -202) return 'The reference site certificate could not be verified.'
  return description || `The reference site failed to load (${code}).`
}

export class ReferenceViewManager {
  private view: WebContentsView | null = null
  private attached = false
  private visible = false
  private viewVisible = true
  private disposed = false
  private site: ReferenceSiteConfig = DEFAULT_REFERENCE_SITE
  private bounds: Rectangle = { x: 0, y: 0, width: 1, height: 1 }
  private lastError: string | undefined

  constructor(
    private readonly window: BrowserWindow,
    private readonly emitState: (state: ReferenceViewState) => void,
    private readonly emitEscape: () => void = () => {},
    private readonly emitPoeNinjaImport: (sourceUrl: string) => void = () => {},
  ) {
    window.on('minimize', () => this.detach())
    window.on('restore', () => {
      if (this.visible && this.view) this.attach(this.view)
    })
  }

  async activate(bounds: Rectangle, site: ReferenceSiteConfig): Promise<ReferenceViewState> {
    this.bounds = bounds
    this.site = site
    this.visible = true
    this.viewVisible = true
    const view = this.getOrCreateView()
    this.attach(view)
    view.setBounds(bounds)
    const current = isAllowedUrl(view.webContents.getURL(), site)
    if (!current) {
      this.lastError = undefined
      await view.webContents.loadURL(site.url).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error)
        this.lastError = message
        this.publish(view.webContents, message)
      })
    }
    const state = this.buildState(view)
    this.emitState(state)
    return state
  }

  deactivate(): void {
    this.visible = false
    this.hideView()
    this.detach()
  }

  handleEscape(): boolean {
    if (!this.visible) return false
    this.deactivate()
    this.emitEscape()
    return true
  }

  setBounds(bounds: Rectangle): void {
    this.bounds = bounds
    if (this.view && this.attached) this.view.setBounds(bounds)
  }

  setVisible(visible: boolean): void {
    this.viewVisible = visible
    if (this.view && this.attached) this.setViewVisible(this.view, visible)
  }

  setSite(site: ReferenceSiteConfig): void {
    this.site = site
    const view = this.getOrCreateView()
    this.lastError = undefined
    void view.webContents.loadURL(site.url).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error)
      this.lastError = message
      this.publish(view.webContents, message)
    })
  }

  navigate(command: ReferenceNavigationCommand): void {
    const view = this.getOrCreateView()
    const history = view.webContents.navigationHistory
    if (command === 'home') void view.webContents.loadURL(this.site.url)
    else if (command === 'back' && history.canGoBack()) history.goBack()
    else if (command === 'forward' && history.canGoForward()) history.goForward()
    else if (command === 'reload') view.webContents.reload()
    else if (command === 'stop') view.webContents.stop()
  }

  openExternal(): void {
    const url = this.view?.webContents.getURL()
    if (url && isAllowedUrl(url, this.site)) void shell.openExternal(url)
  }

  getState(): ReferenceViewState {
    return this.view ? this.buildState(this.view) : {
      site: this.site.id,
      url: '',
      title: '',
      loading: false,
      canGoBack: false,
      canGoForward: false,
      connectionStatus: 'idle',
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.visible = false
    this.viewVisible = false
    this.hideView()
    this.detach()
    if (this.view && !this.view.webContents.isDestroyed()) this.view.webContents.close()
    this.view = null
  }

  private getOrCreateView(): WebContentsView {
    if (this.view && !this.view.webContents.isDestroyed()) return this.view
    const view = new WebContentsView({
      webPreferences: {
        partition: REFERENCE_PARTITION,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
      },
    })
    view.setBackgroundColor('#090b0c')
    this.configureWebContents(view.webContents)
    this.view = view
    return view
  }

  private configureWebContents(contents: WebContents): void {
    const publish = () => this.publish(contents)
    this.bindEscape(contents)
    contents.on('did-start-loading', () => {
      this.lastError = undefined
      publish()
    })
    contents.on('did-stop-loading', publish)
    contents.on('did-stop-loading', () => void this.injectPoeNinjaImportButton(contents))
    contents.on('did-navigate', () => {
      publish()
      void this.injectPoeNinjaImportButton(contents)
    })
    contents.on('did-navigate-in-page', () => {
      publish()
      void this.injectPoeNinjaImportButton(contents)
    })
    contents.on('page-title-updated', publish)
    contents.on('did-fail-load', (_event, code, description, _url, isMainFrame) => {
      if (isMainFrame) {
        this.lastError = errorMessage(code, description)
        this.publish(contents, this.lastError)
      }
    })

    const guardNavigation = (event: Electron.Event, url: string) => {
      if (this.handlePoeNinjaImportUrl(url)) {
        event.preventDefault()
        return
      }
      if (isAllowedUrl(url, this.site)) return
      event.preventDefault()
      if (/^https:/i.test(url)) void shell.openExternal(url)
    }
    contents.on('will-navigate', (event, url) => guardNavigation(event, url))
    contents.on('will-redirect', (event, url) => guardNavigation(event, url))
    contents.setWindowOpenHandler(({ url }) => {
      if (this.handlePoeNinjaImportUrl(url)) return { action: 'deny' }
      if (isAllowedUrl(url, this.site)) {
        void contents.loadURL(url)
        return { action: 'deny' }
      }
      if (/^https:/i.test(url)) void shell.openExternal(url)
      return { action: 'deny' }
    })
  }

  private handlePoeNinjaImportUrl(value: string): boolean {
    if (this.site.id !== 'ninja') return false
    try {
      const url = new URL(value)
      if (url.protocol !== POE_NINJA_IMPORT_SCHEME || url.hostname !== POE_NINJA_IMPORT_HOST) return false
      const sourceUrl = url.searchParams.get('url')?.trim() || ''
      if (!sourceUrl || sourceUrl.length > MAX_REFERENCE_SITE_URL_LENGTH) return true
      this.emitPoeNinjaImport(sourceUrl)
      return true
    } catch {
      return false
    }
  }

  private async injectPoeNinjaImportButton(contents: WebContents): Promise<void> {
    if (this.site.id !== 'ninja' || contents.isDestroyed() || contents.getURL() === '') return
    try {
      await contents.executeJavaScript(POE_NINJA_IMPORT_SCRIPT, true)
    } catch {
      // Pages can be destroyed between navigation events and script execution.
    }
  }

  resetPoeNinjaImportButton(): void {
    const contents = this.view?.webContents
    if (this.site.id !== 'ninja' || !contents || contents.isDestroyed()) return
    void contents.executeJavaScript(POE_NINJA_IMPORT_RESET_SCRIPT, true)
      .then(() => this.injectPoeNinjaImportButton(contents))
      .catch(() => {
        // The embedded page may have been closed while the import completed.
      })
  }

  private bindEscape(contents: WebContents): void {
    contents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown' || input.isAutoRepeat || (input.key !== 'Escape' && input.code !== 'Escape')) return
      if (input.alt || input.control || input.meta || input.shift) return
      if (this.handleEscape()) event.preventDefault()
    })
  }

  private attach(view: WebContentsView): void {
    if (this.disposed || !this.visible || this.window.isDestroyed() || view.webContents.isDestroyed()) return
    if (!this.attached) {
      this.window.contentView.addChildView(view)
      this.attached = true
    }
    this.setViewVisible(view, this.viewVisible)
    view.setBounds(this.bounds)
  }

  private hideView(): void {
    if (!this.view || this.view.webContents.isDestroyed()) return
    this.setViewVisible(this.view, false)
    this.view.setBounds({ x: 0, y: 0, width: 1, height: 1 })
  }

  private setViewVisible(view: WebContentsView, visible: boolean): void {
    const setVisible = (view as WebContentsView & { setVisible?: (value: boolean) => void }).setVisible
    setVisible?.call(view, visible)
  }

  private detach(): void {
    if (!this.view || !this.attached) return
    this.attached = false
    if (this.window.isDestroyed() || this.view.webContents.isDestroyed()) return
    this.window.contentView.removeChildView(this.view)
  }

  private publish(contents: WebContents, error?: string): void {
    if (!this.view || this.view.webContents !== contents || contents.isDestroyed()) return
    this.emitState(this.buildState(this.view, error || this.lastError))
  }

  private buildState(view: WebContentsView, error?: string): ReferenceViewState {
    const contents = view.webContents
    const loading = contents.isLoading()
    return {
      site: this.site.id,
      url: contents.getURL(),
      title: contents.getTitle(),
      loading,
      canGoBack: contents.navigationHistory.canGoBack(),
      canGoForward: contents.navigationHistory.canGoForward(),
      connectionStatus: error ? 'error' : loading ? 'loading' : contents.getURL() ? 'connected' : 'idle',
      ...(error ? { error } : {}),
    }
  }
}
