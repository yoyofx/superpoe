import { BrowserWindow, shell } from 'electron'
import type { PriceCheckContextState } from '../src/types/market.js'

function rendererSurfaceUrl(rendererUrl: string | undefined): string {
  if (rendererUrl) return `${rendererUrl}${rendererUrl.includes('?') ? '&' : '?'}surface=find-better`
  return 'app://localhost/index.html?surface=find-better'
}

/** Owns the build-aware search dialog independently from the ordinary checker. */
export class FindBetterWindowManager {
  private window?: BrowserWindow
  private state?: PriceCheckContextState
  private ready = false

  constructor(
    private readonly preload: string,
    private readonly rendererUrl: string | undefined,
    private readonly icon: string,
  ) {}

  owns(senderId: number): boolean { return this.window?.webContents.id === senderId }

  show(parent: BrowserWindow): void {
    const window = this.ensure(parent)
    if (this.ready) {
      this.sendState()
      if (window.isMinimized()) window.restore()
      window.show()
      window.focus()
    }
  }

  hide(senderId?: number): void {
    if (senderId != null && !this.owns(senderId)) throw new Error('Unauthorized find-better window request')
    if (this.window && !this.window.isDestroyed()) this.window.hide()
  }

  publish(state: PriceCheckContextState): void {
    this.state = state
    this.sendState()
  }

  getState(senderId: number): PriceCheckContextState {
    if (!this.owns(senderId)) throw new Error('Unauthorized find-better window request')
    return structuredClone(this.state || {
      generation: 0,
      realm: 'global',
      language: 'en',
      mode: 'find-better',
      phase: 'idle',
      leagues: [],
      listings: [],
    })
  }

  dispose(): void {
    if (this.window && !this.window.isDestroyed()) this.window.destroy()
    this.window = undefined
    this.state = undefined
    this.ready = false
  }

  private ensure(parent: BrowserWindow): BrowserWindow {
    if (this.window && !this.window.isDestroyed()) return this.window
    const window = new BrowserWindow({
      parent,
      modal: true,
      show: false,
      frame: false,
      width: 1180,
      height: 780,
      minWidth: 900,
      minHeight: 600,
      center: true,
      resizable: true,
      movable: true,
      fullscreenable: false,
      autoHideMenuBar: true,
      backgroundColor: '#10120f',
      icon: this.icon,
      webPreferences: {
        preload: this.preload,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    })
    window.webContents.setWindowOpenHandler(({ url }) => {
      void shell.openExternal(url)
      return { action: 'deny' }
    })
    window.webContents.once('did-finish-load', () => {
      this.ready = true
      this.sendState()
      if (!window.isDestroyed()) window.show()
    })
    window.on('closed', () => {
      if (this.window === window) {
        this.window = undefined
        this.state = undefined
        this.ready = false
      }
    })
    void window.loadURL(rendererSurfaceUrl(this.rendererUrl))
    this.window = window
    return window
  }

  private sendState(): void {
    if (!this.window || this.window.isDestroyed() || !this.ready || !this.state) return
    this.window.webContents.send('find-better:state', this.state)
  }
}
