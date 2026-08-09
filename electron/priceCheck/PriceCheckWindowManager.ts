import { BrowserWindow, screen, shell, type Rectangle } from 'electron'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import type { PriceCheckContextState } from '../../src/types/market.js'

function clampBounds(saved?: Partial<Rectangle>): Rectangle {
  const display = screen.getDisplayMatching({ x: saved?.x || 0, y: saved?.y || 0, width: saved?.width || 540, height: saved?.height || 820 })
  const area = display.workArea
  const preferredHeight = Math.max(520, Math.round(area.height * .7))
  // The previous overlay implementation persisted the full work area. Treat
  // those values as stale so the compact checker is restored at its normal
  // size instead of reopening as a full-screen panel.
  const staleBounds = Boolean(
    (saved?.width && saved.width > 720)
    || (saved?.height && saved.height > preferredHeight * 1.1)
    || (saved?.width && saved?.height && saved.width > area.width * .9 && saved.height > area.height * .9),
  )
  const savedWidth = staleBounds ? 540 : saved?.width
  const savedHeight = staleBounds ? preferredHeight : saved?.height
  const width = Math.min(area.width, 760, Math.max(460, savedWidth || 540))
  const height = Math.min(area.height, Math.max(520, savedHeight || preferredHeight))
  return {
    width, height,
    x: Math.min(area.x + area.width - width, Math.max(area.x, saved?.x ?? area.x + area.width - width - 24)),
    y: Math.min(area.y + area.height - height, Math.max(area.y, saved?.y ?? area.y + 24)),
  }
}

export class PriceCheckWindowManager {
  private window?: BrowserWindow
  private detailWindow?: BrowserWindow
  private maskWindow?: BrowserWindow
  private state?: PriceCheckContextState
  private selectedListingId?: string

  constructor(
    private readonly preload: string,
    private readonly rendererUrl: string | undefined,
    private readonly icon: string,
    private readonly boundsFile: string,
    private alwaysOnTop = true,
    private readonly restoreGameFocus?: () => void,
  ) {}

  owns(senderId: number): boolean { return this.window?.webContents.id === senderId }

  ownsDetail(senderId: number): boolean { return this.detailWindow?.webContents.id === senderId }

  show(): void {
    const window = this.ensure()
    this.hideDetail()
    this.positionMask(window)
    this.maskWindow?.showInactive()
    window.show()
    window.focus()
    window.setAlwaysOnTop(this.alwaysOnTop, 'screen-saver')
    window.moveTop()
  }

  hide(restoreFocus = true): void {
    this.hideDetail()
    this.maskWindow?.hide()
    this.window?.hide()
    if (restoreFocus && this.restoreGameFocus) setTimeout(() => this.restoreGameFocus?.(), 80)
  }

  showDetail(listingId: string): void {
    if (!this.state?.listings.some((listing) => listing.id === listingId)) return
    this.selectedListingId = listingId
    const detail = this.ensureDetail()
    this.positionDetail(detail)
    this.sendDetailState()
    detail.show()
    detail.focus()
    detail.setAlwaysOnTop(this.alwaysOnTop, 'screen-saver')
    detail.moveTop()
    this.window?.moveTop()
    detail.moveTop()
  }

  hideDetail(): void {
    this.selectedListingId = undefined
    if (this.detailWindow && !this.detailWindow.isDestroyed()) this.detailWindow.hide()
    this.sendDetailState()
  }

  publish(state: PriceCheckContextState): void {
    this.state = state
    if (this.selectedListingId && !state.listings.some((listing) => listing.id === this.selectedListingId)) {
      this.selectedListingId = undefined
      this.detailWindow?.hide()
    }
    if (this.window && !this.window.isDestroyed()) this.window.webContents.send('price-check:state', state)
    this.sendDetailState()
  }

  setAlwaysOnTop(value: boolean): void {
    this.alwaysOnTop = value
    this.window?.setAlwaysOnTop(value, 'screen-saver')
    this.detailWindow?.setAlwaysOnTop(value, 'screen-saver')
    this.maskWindow?.setAlwaysOnTop(value, 'screen-saver')
  }

  getDetailState(): { state?: PriceCheckContextState; listingId?: string } {
    return { state: this.state ? structuredClone(this.state) : undefined, listingId: this.selectedListingId }
  }

  dispose(): void {
    this.maskWindow?.destroy()
    this.maskWindow = undefined
    this.detailWindow?.destroy()
    this.detailWindow = undefined
    this.window?.destroy()
    this.window = undefined
  }

  private ensure(): BrowserWindow {
    if (this.window && !this.window.isDestroyed()) return this.window
    let saved: Partial<Rectangle> | undefined
    try { saved = JSON.parse(readFileSync(this.boundsFile, 'utf8')) as Partial<Rectangle> } catch { /* first launch */ }
    const window = new BrowserWindow({
      ...clampBounds(saved), minWidth: 460, minHeight: 520, frame: false, resizable: true, movable: true,
      fullscreenable: false, hasShadow: true, transparent: false,
      show: false, skipTaskbar: true, alwaysOnTop: this.alwaysOnTop, backgroundColor: '#0b0d0c', icon: this.icon,
      webPreferences: { preload: this.preload, contextIsolation: true, nodeIntegration: false, sandbox: true },
    })
    window.setAlwaysOnTop(this.alwaysOnTop, 'screen-saver')
    window.webContents.setWindowOpenHandler(({ url }) => { void shell.openExternal(url); return { action: 'deny' } })
    const save = () => {
      if (window.isDestroyed() || window.isMinimized() || window.isMaximized()) return
      mkdirSync(path.dirname(this.boundsFile), { recursive: true })
      writeFileSync(this.boundsFile, JSON.stringify(window.getBounds()), 'utf8')
    }
    window.on('resize', save)
    window.on('move', save)
    window.on('move', () => this.positionMask(window))
    window.on('close', (event) => {
      if (!BrowserWindow.getAllWindows().every((candidate) => candidate.isDestroyed())) {
        event.preventDefault()
        this.hide()
      }
    })
    window.on('closed', () => { this.window = undefined })
    window.webContents.on('did-finish-load', () => { if (this.state) window.webContents.send('price-check:state', this.state) })
    if (this.rendererUrl) void window.loadURL(`${this.rendererUrl}?surface=price-check`)
    else void window.loadURL('app://localhost/index.html?surface=price-check')
    this.window = window
    return window
  }

  private ensureMask(): BrowserWindow {
    if (this.maskWindow && !this.maskWindow.isDestroyed()) return this.maskWindow
    const window = new BrowserWindow({
      x: 0, y: 0, width: 800, height: 600,
      frame: false, resizable: false, movable: false, focusable: false,
      fullscreenable: false, hasShadow: false, transparent: false,
      show: false, skipTaskbar: true, alwaysOnTop: this.alwaysOnTop, backgroundColor: '#000000',
      webPreferences: { preload: this.preload, contextIsolation: true, nodeIntegration: false, sandbox: true },
    })
    window.setAlwaysOnTop(this.alwaysOnTop, 'screen-saver')
    window.setOpacity(.58)
    window.on('closed', () => { this.maskWindow = undefined })
    if (this.rendererUrl) void window.loadURL(`${this.rendererUrl}?surface=price-check-mask`)
    else void window.loadURL('app://localhost/index.html?surface=price-check-mask')
    this.maskWindow = window
    return window
  }

  private positionMask(main: BrowserWindow): void {
    if (main.isDestroyed()) return
    const display = screen.getDisplayMatching(main.getBounds())
    const mask = this.ensureMask()
    // Cover the complete monitor, including the taskbar area. The panels are
    // positioned independently above this full-screen mask.
    mask.setBounds(display.bounds, false)
    mask.setAlwaysOnTop(this.alwaysOnTop, 'screen-saver')
    mask.moveTop()
  }

  private ensureDetail(): BrowserWindow {
    if (this.detailWindow && !this.detailWindow.isDestroyed()) return this.detailWindow
    const detailBoundsFile = path.join(path.dirname(this.boundsFile), 'detail-window-bounds.json')
    let saved: Partial<Rectangle> | undefined
    try { saved = JSON.parse(readFileSync(detailBoundsFile, 'utf8')) as Partial<Rectangle> } catch { /* first launch */ }
    const window = new BrowserWindow({
      ...clampBounds(saved), minWidth: 460, minHeight: 520, frame: false, resizable: true, movable: true,
      fullscreenable: false, hasShadow: true, transparent: false,
      show: false, skipTaskbar: true, alwaysOnTop: this.alwaysOnTop, backgroundColor: '#0b0d0c', icon: this.icon,
      webPreferences: { preload: this.preload, contextIsolation: true, nodeIntegration: false, sandbox: true },
    })
    window.setAlwaysOnTop(this.alwaysOnTop, 'screen-saver')
    window.webContents.setWindowOpenHandler(({ url }) => { void shell.openExternal(url); return { action: 'deny' } })
    const save = () => {
      if (window.isDestroyed() || window.isMinimized() || window.isMaximized()) return
      mkdirSync(path.dirname(detailBoundsFile), { recursive: true })
      writeFileSync(detailBoundsFile, JSON.stringify(window.getBounds()), 'utf8')
    }
    window.on('resize', save)
    window.on('move', save)
    window.on('close', (event) => {
      event.preventDefault()
      this.hideDetail()
    })
    window.on('closed', () => { this.detailWindow = undefined })
    window.webContents.on('did-finish-load', () => this.sendDetailState())
    if (this.rendererUrl) void window.loadURL(`${this.rendererUrl}?surface=price-check-detail`)
    else void window.loadURL('app://localhost/index.html?surface=price-check-detail')
    this.detailWindow = window
    return window
  }

  private positionDetail(detail: BrowserWindow): void {
    const main = this.window
    if (!main || main.isDestroyed()) return
    const mainBounds = main.getBounds()
    const detailBounds = detail.getBounds()
    const display = screen.getDisplayMatching(mainBounds)
    const area = display.workArea
    const gap = 12
    const right = mainBounds.x + mainBounds.width + gap
    const left = mainBounds.x - detailBounds.width - gap
    const x = right + detailBounds.width <= area.x + area.width
      ? right
      : Math.max(area.x, left)
    const y = Math.min(area.y + area.height - detailBounds.height, Math.max(area.y, mainBounds.y))
    detail.setBounds({ x, y, width: detailBounds.width, height: detailBounds.height }, false)
  }

  private sendDetailState(): void {
    if (this.detailWindow && !this.detailWindow.isDestroyed()) {
      this.detailWindow.webContents.send('price-check:detail-state', this.getDetailState())
    }
  }
}
