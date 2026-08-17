import { BrowserWindow, shell } from 'electron'
import type { EquipmentTryOnOpenRequest } from '../src/types/tryOn.js'

function rendererSurfaceUrl(rendererUrl: string | undefined): string {
  if (rendererUrl) return `${rendererUrl}${rendererUrl.includes('?') ? '&' : '?'}surface=equipment-try-on`
  return 'app://localhost/index.html?surface=equipment-try-on'
}

export class EquipmentTryOnWindowManager {
  private window?: BrowserWindow
  private payload?: EquipmentTryOnOpenRequest
  private ready = false

  constructor(
    private readonly preload: string,
    private readonly rendererUrl: string | undefined,
    private readonly icon: string,
  ) {}

  open(parent: BrowserWindow, payload: EquipmentTryOnOpenRequest): void {
    this.payload = payload
    const window = this.ensure(parent)
    if (!this.ready) return
    this.sendPayload()
    if (window.isMinimized()) window.restore()
    window.show()
    window.focus()
  }

  close(senderId: number): void {
    if (!this.window || this.window.isDestroyed() || this.window.webContents.id !== senderId) {
      throw new Error('Unauthorized equipment try-on window request')
    }
    this.window.close()
  }

  getPayload(senderId: number): EquipmentTryOnOpenRequest | null {
    if (!this.window || this.window.isDestroyed() || this.window.webContents.id !== senderId) {
      throw new Error('Unauthorized equipment try-on window request')
    }
    return this.payload ? structuredClone(this.payload) : null
  }

  dispose(): void {
    if (this.window && !this.window.isDestroyed()) this.window.destroy()
    this.window = undefined
    this.payload = undefined
    this.ready = false
  }

  private ensure(parent: BrowserWindow): BrowserWindow {
    if (this.window && !this.window.isDestroyed()) return this.window
    const window = new BrowserWindow({
      parent,
      modal: true,
      show: false,
      frame: false,
      width: 680,
      height: 820,
      minWidth: 560,
      minHeight: 620,
      center: true,
      resizable: true,
      movable: true,
      fullscreenable: false,
      autoHideMenuBar: true,
      backgroundColor: '#111310',
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
      this.sendPayload()
      if (!window.isDestroyed()) window.show()
    })
    window.on('closed', () => {
      if (this.window === window) {
        this.window = undefined
        this.payload = undefined
        this.ready = false
      }
    })
    void window.loadURL(rendererSurfaceUrl(this.rendererUrl))
    this.window = window
    return window
  }

  private sendPayload(): void {
    if (!this.window || this.window.isDestroyed() || !this.ready || !this.payload) return
    this.window.webContents.send('equipment-try-on:payload', this.payload)
  }
}
