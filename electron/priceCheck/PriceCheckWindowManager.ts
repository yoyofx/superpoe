import { BrowserWindow, screen, shell, type Rectangle } from 'electron'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import type { PriceCheckContextState } from '../../src/types/market.js'

function clampBounds(saved?: Partial<Rectangle>): Rectangle {
  const display = screen.getDisplayMatching({ x: saved?.x || 0, y: saved?.y || 0, width: saved?.width || 540, height: saved?.height || 680 })
  const area = display.workArea
  const width = Math.min(area.width, Math.max(460, saved?.width || 540))
  const height = Math.min(area.height, Math.max(520, saved?.height || 680))
  return {
    width, height,
    x: Math.min(area.x + area.width - width, Math.max(area.x, saved?.x ?? area.x + area.width - width - 24)),
    y: Math.min(area.y + area.height - height, Math.max(area.y, saved?.y ?? area.y + 24)),
  }
}

export class PriceCheckWindowManager {
  private window?: BrowserWindow
  private state?: PriceCheckContextState

  constructor(
    private readonly preload: string,
    private readonly rendererUrl: string | undefined,
    private readonly icon: string,
    private readonly boundsFile: string,
    private alwaysOnTop = true,
  ) {}

  owns(senderId: number): boolean { return this.window?.webContents.id === senderId }

  show(): void {
    const window = this.ensure()
    window.show()
    window.focus()
    window.moveTop()
  }

  hide(): void { this.window?.hide() }

  publish(state: PriceCheckContextState): void {
    this.state = state
    if (this.window && !this.window.isDestroyed()) this.window.webContents.send('price-check:state', state)
  }

  setAlwaysOnTop(value: boolean): void {
    this.alwaysOnTop = value
    this.window?.setAlwaysOnTop(value, 'floating')
  }

  dispose(): void { this.window?.destroy(); this.window = undefined }

  private ensure(): BrowserWindow {
    if (this.window && !this.window.isDestroyed()) return this.window
    let saved: Partial<Rectangle> | undefined
    try { saved = JSON.parse(readFileSync(this.boundsFile, 'utf8')) as Partial<Rectangle> } catch { /* first launch */ }
    const window = new BrowserWindow({
      ...clampBounds(saved), minWidth: 460, minHeight: 520, frame: false, resizable: true,
      show: false, skipTaskbar: true, alwaysOnTop: this.alwaysOnTop, backgroundColor: '#0b0d0c', icon: this.icon,
      webPreferences: { preload: this.preload, contextIsolation: true, nodeIntegration: false, sandbox: true },
    })
    window.webContents.setWindowOpenHandler(({ url }) => { void shell.openExternal(url); return { action: 'deny' } })
    const save = () => {
      if (window.isDestroyed() || window.isMinimized() || window.isMaximized()) return
      mkdirSync(path.dirname(this.boundsFile), { recursive: true })
      writeFileSync(this.boundsFile, JSON.stringify(window.getBounds()), 'utf8')
    }
    window.on('resize', save)
    window.on('move', save)
    window.on('close', (event) => { if (!BrowserWindow.getAllWindows().every((candidate) => candidate.isDestroyed())) { event.preventDefault(); window.hide() } })
    window.on('closed', () => { this.window = undefined })
    window.webContents.on('did-finish-load', () => { if (this.state) window.webContents.send('price-check:state', this.state) })
    if (this.rendererUrl) void window.loadURL(`${this.rendererUrl}?surface=price-check`)
    else void window.loadURL('app://localhost/index.html?surface=price-check')
    this.window = window
    return window
  }
}
