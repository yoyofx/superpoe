import { BrowserWindow, WebContentsView, shell, type Rectangle, type WebContents } from 'electron'

import type { CommunityNavigationCommand, CommunityViewState } from '../src/types/community.js'

export type { CommunityNavigationCommand } from '../src/types/community.js'

export const COMMUNITY_URL = 'https://kook.vip/CU9Bfx'

const COMMUNITY_PARTITION = 'persist:superpoe-kook'
const COMMUNITY_HOSTS = ['kook.vip', 'kookapp.cn'] as const

function isCommunityHost(hostname: string): boolean {
  return COMMUNITY_HOSTS.some((host) => hostname === host || hostname.endsWith(`.${host}`))
}

function isAllowedUrl(value: string): URL | null {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:') return null
    if (!isCommunityHost(url.hostname)) return null
    return url
  } catch {
    return null
  }
}

function errorMessage(code: number, description: string): string | undefined {
  if (code === -3) return undefined
  if (code === -106) return 'The KOOK community is unavailable while offline.'
  if (code === -105) return 'The KOOK community could not be resolved.'
  if (code === -102) return 'The KOOK community refused the connection.'
  if (code === -200 || code === -202) return 'The KOOK community certificate could not be verified.'
  return description || `The KOOK community failed to load (${code}).`
}

export class CommunityViewManager {
  private view: WebContentsView | null = null
  private attached = false
  private visible = false
  private disposed = false
  private bounds: Rectangle = { x: 0, y: 0, width: 1, height: 1 }
  private lastError: string | undefined

  constructor(
    private readonly window: BrowserWindow,
    private readonly emitState: (state: CommunityViewState) => void,
    private readonly emitEscape: () => void = () => {},
  ) {
    window.on('minimize', () => this.detach())
    window.on('restore', () => {
      if (this.visible && this.view) this.attach(this.view)
    })
  }

  async activate(bounds: Rectangle): Promise<CommunityViewState> {
    this.bounds = bounds
    this.visible = true
    const view = this.getOrCreateView()
    this.attach(view)
    view.setBounds(bounds)
    if (!view.webContents.getURL() && !view.webContents.isLoading()) {
      void view.webContents.loadURL(COMMUNITY_URL).catch((error: unknown) => {
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

  /** Hide the community immediately when the user needs an emergency escape. */
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

  navigate(command: CommunityNavigationCommand): void {
    const view = this.getOrCreateView()
    const history = view.webContents.navigationHistory
    if (command === 'home') {
      const currentUrl = view.webContents.getURL()
      if (currentUrl !== COMMUNITY_URL) void view.webContents.loadURL(COMMUNITY_URL)
    } else if (command === 'back' && history.canGoBack()) history.goBack()
    else if (command === 'forward' && history.canGoForward()) history.goForward()
    else if (command === 'reload') view.webContents.reload()
    else if (command === 'stop') view.webContents.stop()
  }

  openExternal(): void {
    const url = this.view?.webContents.getURL()
    if (url && isAllowedUrl(url)) void shell.openExternal(url)
  }

  reload(): void {
    this.view?.webContents.reload()
  }

  getState(): CommunityViewState {
    return this.view ? this.buildState(this.view) : {
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
    this.hideView()
    this.detach()
    if (this.view && !this.view.webContents.isDestroyed()) this.view.webContents.close()
    this.view = null
  }

  private getOrCreateView(): WebContentsView {
    if (this.view && !this.view.webContents.isDestroyed()) return this.view
    const view = new WebContentsView({
      webPreferences: {
        partition: COMMUNITY_PARTITION,
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
    contents.on('did-navigate', publish)
    contents.on('did-navigate-in-page', publish)
    contents.on('page-title-updated', publish)
    contents.on('did-fail-load', (_event, code, description, _url, isMainFrame) => {
      if (isMainFrame) {
        this.lastError = errorMessage(code, description)
        this.publish(contents, this.lastError)
      }
    })

    const guardNavigation = (event: Electron.Event, url: string) => {
      if (isAllowedUrl(url)) return
      event.preventDefault()
      if (/^https:/i.test(url)) void shell.openExternal(url)
    }
    contents.on('will-navigate', (event, url) => guardNavigation(event, url))
    contents.on('will-redirect', (event, url) => guardNavigation(event, url))
    contents.setWindowOpenHandler(({ url }) => {
      if (!isAllowedUrl(url)) {
        if (/^https:/i.test(url)) void shell.openExternal(url)
        return { action: 'deny' }
      }
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          parent: this.window,
          autoHideMenuBar: true,
          width: 900,
          height: 760,
          webPreferences: {
            partition: COMMUNITY_PARTITION,
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
            webSecurity: true,
          },
        },
      }
    })
    contents.on('did-create-window', (childWindow) => {
      this.bindEscape(childWindow.webContents)
      childWindow.webContents.on('will-navigate', (event, url) => guardNavigation(event, url))
      childWindow.webContents.on('will-redirect', (event, url) => guardNavigation(event, url))
      childWindow.webContents.setWindowOpenHandler(({ url }) => {
        if (isAllowedUrl(url)) return { action: 'allow' }
        if (/^https:/i.test(url)) void shell.openExternal(url)
        return { action: 'deny' }
      })
      childWindow.on('closed', publish)
    })

    // KOOK needs microphone access for voice rooms. Keep it isolated to this
    // partition and reject camera requests explicitly.
    contents.session.setPermissionRequestHandler((_webContents, permission, callback, details) => {
      const requestingUrl = typeof details?.requestingUrl === 'string' ? details.requestingUrl : contents.getURL()
      const mediaTypesValue = (details as { mediaTypes?: unknown } | undefined)?.mediaTypes
      const mediaTypes = Array.isArray(mediaTypesValue) ? mediaTypesValue.map(String) : []
      const audioOnly = mediaTypes.includes('audio') && !mediaTypes.includes('video')
      callback(permission === 'media' && Boolean(isAllowedUrl(requestingUrl)) && audioOnly)
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
    this.setViewVisible(view, true)
    view.setBounds(this.bounds)
  }

  // Removing a child view is normally enough, but explicitly hiding and
  // shrinking it closes the input-capture window if navigation and renderer
  // unmounting happen in the same frame.
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

  private buildState(view: WebContentsView, error?: string): CommunityViewState {
    const contents = view.webContents
    const loading = contents.isLoading()
    return {
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
