import { BrowserWindow, screen, shell, type Rectangle } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

type TimerSkinId = 'obsidian' | 'ember' | 'frost' | 'strip'
type TimerState = 'idle' | 'running' | 'paused' | 'finished'

export interface TimerStateSnapshot {
  state: TimerState
  elapsed: number
  gameRunning: boolean
}

const COLLAPSED_SIZES: Record<TimerSkinId, { width: number; height: number }> = {
  obsidian: { width: 148, height: 148 },
  ember: { width: 148, height: 148 },
  frost: { width: 148, height: 148 },
  strip: { width: 276, height: 84 },
}
const TIMER_MIN_SIZES: Record<TimerSkinId, { width: number; height: number }> = {
  obsidian: { width: 116, height: 116 },
  ember: { width: 116, height: 116 },
  frost: { width: 116, height: 116 },
  strip: { width: 196, height: 60 },
}
const TIMER_MAX_SIZES: Record<TimerSkinId, { width: number; height: number }> = {
  obsidian: { width: 420, height: 420 },
  ember: { width: 420, height: 420 },
  frost: { width: 420, height: 420 },
  strip: { width: 720, height: 220 },
}
const LEGACY_SETTINGS_SIZE = { width: 640, height: 280 }
const SETTINGS_SIZE = { width: 760, height: 360 }
const SETTINGS_MIN_SIZE = { width: 640, height: 320 }
const SETTINGS_MAX_SIZE = { width: 1_200, height: 800 }

type TimerBounds = Partial<Rectangle>
type TimerBoundsStore = {
  activeSkin?: TimerSkinId
  skins?: Partial<Record<TimerSkinId, TimerBounds>>
  settings?: TimerBounds
}

function isTimerSkinId(value: unknown): value is TimerSkinId {
  return value === 'obsidian' || value === 'ember' || value === 'frost' || value === 'strip'
}

function applyTimerSurface(window: BrowserWindow): void {
  // Keep native bounds rectangular so Windows can resize the transparent window normally.
  window.setBackgroundColor('#00000000')
}

function collapsedSize(skin: TimerSkinId): { width: number; height: number } {
  return COLLAPSED_SIZES[skin]
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value))
}

function timerSize(saved: Partial<Rectangle> | undefined, skin: TimerSkinId, preferredDimension?: 'width' | 'height'): { width: number; height: number } {
  const defaults = collapsedSize(skin)
  const minimum = TIMER_MIN_SIZES[skin]
  const maximum = TIMER_MAX_SIZES[skin]
  const width = clamp(saved?.width ?? defaults.width, minimum.width, maximum.width)
  const height = clamp(saved?.height ?? defaults.height, minimum.height, maximum.height)
  const aspectRatio = defaults.width / defaults.height
  if (preferredDimension === 'height') {
    const normalizedHeight = clamp(Math.round(height), minimum.height, maximum.height)
    const normalizedWidth = clamp(Math.round(normalizedHeight * aspectRatio), minimum.width, maximum.width)
    return {
      width: normalizedWidth,
      height: clamp(Math.round(normalizedWidth / aspectRatio), minimum.height, maximum.height),
    }
  }
  if (preferredDimension === 'width') {
    const normalizedWidth = clamp(Math.round(width), minimum.width, maximum.width)
    return {
      width: normalizedWidth,
      height: clamp(Math.round(normalizedWidth / aspectRatio), minimum.height, maximum.height),
    }
  }
  const normalizedWidth = clamp(Math.round(Math.max(width, height * aspectRatio)), minimum.width, maximum.width)
  const normalizedHeight = clamp(Math.round(normalizedWidth / aspectRatio), minimum.height, maximum.height)
  return { width: normalizedWidth, height: normalizedHeight }
}

function settingsSize(saved: TimerBounds | undefined): { width: number; height: number } {
  const isLegacyDefault = saved?.width === LEGACY_SETTINGS_SIZE.width && saved?.height === LEGACY_SETTINGS_SIZE.height
  const source = isLegacyDefault ? undefined : saved
  return {
    width: clamp(source?.width ?? SETTINGS_SIZE.width, SETTINGS_MIN_SIZE.width, SETTINGS_MAX_SIZE.width),
    height: clamp(source?.height ?? SETTINGS_SIZE.height, SETTINGS_MIN_SIZE.height, SETTINGS_MAX_SIZE.height),
  }
}

function surfaceUrl(rendererUrl: string | undefined, surface: 'timer' | 'timer-settings'): string {
  if (rendererUrl) return `${rendererUrl}${rendererUrl.includes('?') ? '&' : '?'}surface=${surface}`
  return `app://localhost/index.html?surface=${surface}`
}

function clampBounds(saved: Partial<Rectangle> | undefined, size: { width: number; height: number }): Rectangle {
  const display = screen.getDisplayMatching({
    x: saved?.x || 0,
    y: saved?.y || 0,
    width: saved?.width || size.width,
    height: saved?.height || size.height,
  })
  const area = display.workArea
  const x = saved?.x ?? area.x + area.width - size.width - 28
  const y = saved?.y ?? area.y + 28
  return {
    x: Math.max(area.x, Math.min(area.x + area.width - size.width, x)),
    y: Math.max(area.y, Math.min(area.y + area.height - size.height, y)),
    width: size.width,
    height: size.height,
  }
}

export class TimerWindowManager {
  private window?: BrowserWindow
  private settingsWindow?: BrowserWindow
  private skin: TimerSkinId = 'obsidian'
  private state: TimerState = 'idle'
  private accumulatedElapsed = 0
  private startedAt: number | null = null
  private automaticAreaId: string | null = null
  private gameRunning = false
  private stateTicker?: NodeJS.Timeout
  private boundsTicker?: NodeJS.Timeout
  private boundsLoaded = false
  private timerBounds: Partial<Record<TimerSkinId, TimerBounds>> = {}
  private settingsBounds?: TimerBounds

  constructor(
    private readonly preload: string,
    private readonly rendererUrl: string | undefined,
    private readonly icon: string,
    private readonly boundsFile: string,
  ) {
    this.stateTicker = setInterval(() => {
      if (this.state === 'running') this.broadcastState()
    }, 250)
    // Frameless native drag regions do not emit a move event consistently on
    // every Windows/Electron combination. Keep the persisted bounds in sync
    // without rewriting the file when the window has not changed.
    this.boundsTicker = setInterval(() => this.persistTimerBoundsIfChanged(), 250)
  }

  owns(senderId: number): boolean {
    return Boolean(this.window && !this.window.isDestroyed() && this.window.webContents.id === senderId)
  }

  ownsSettings(senderId: number): boolean {
    return Boolean(this.settingsWindow && !this.settingsWindow.isDestroyed() && this.settingsWindow.webContents.id === senderId)
  }

  getState(senderId: number): TimerStateSnapshot {
    this.requireAnyOwner(senderId)
    return this.snapshot()
  }

  setGameRunning(running: boolean): void {
    if (this.gameRunning === running) return
    this.gameRunning = running
    this.broadcastState()
  }

  start(senderId: number): void {
    this.requireAnyOwner(senderId)
    this.automaticAreaId = null
    this.startedAt = Date.now() - this.accumulatedElapsed
    this.state = 'running'
    this.broadcastState()
  }

  pause(senderId: number): void {
    this.requireAnyOwner(senderId)
    if (this.state !== 'running') return
    this.accumulatedElapsed = this.currentElapsed()
    this.startedAt = null
    this.state = 'paused'
    this.broadcastState()
  }

  finish(senderId: number): void {
    this.requireAnyOwner(senderId)
    const elapsed = this.currentElapsed()
    if (elapsed <= 0) return
    this.accumulatedElapsed = elapsed
    this.startedAt = null
    this.automaticAreaId = null
    this.state = 'finished'
    this.broadcastState()
  }

  reset(senderId: number): void {
    this.requireAnyOwner(senderId)
    this.resetState()
  }

  beginAutomaticMap(areaId: string): void {
    if (!areaId) return
    if (this.automaticAreaId === areaId && this.state === 'running') return
    this.finishAutomaticMap()
    this.automaticAreaId = areaId
    this.accumulatedElapsed = 0
    this.startedAt = Date.now()
    this.state = 'running'
    this.broadcastState()
  }

  finishAutomaticMap(areaId?: string): void {
    if (!this.automaticAreaId || (areaId && this.automaticAreaId !== areaId)) return
    this.accumulatedElapsed = this.currentElapsed()
    this.startedAt = null
    this.state = this.accumulatedElapsed > 0 ? 'finished' : 'idle'
    this.automaticAreaId = null
    this.broadcastState()
  }

  resize(senderId: number, size: { width: number; height: number }): void {
    this.requireOwner(senderId)
    const window = this.window
    if (!window || window.isDestroyed()) return
    const current = window.getBounds()
    const nextSize = timerSize(size, this.skin)
    this.applyWindowConstraints(window, this.skin)
    const next = clampBounds({ x: current.x, y: current.y }, nextSize)
    window.setBounds(next, true)
    const applied = window.getBounds()
    applyTimerSurface(window)
    this.saveTimerBounds(this.skin, applied)
  }

  show(): void {
    const window = this.ensure()
    if (window.isMinimized()) window.restore()
    window.show()
    window.focus()
    window.setAlwaysOnTop(true, 'screen-saver')
    window.moveTop()
    this.saveTimerWindowBounds()
  }

  close(senderId: number): void {
    if (this.ownsSettings(senderId)) {
      this.saveSettingsWindowBounds()
      this.settingsWindow?.hide()
    }
    else {
      this.requireOwner(senderId)
      this.saveTimerWindowBounds()
      this.saveSettingsWindowBounds()
      this.window?.hide()
      this.settingsWindow?.hide()
    }
  }

  minimize(senderId: number): void {
    if (this.ownsSettings(senderId)) this.settingsWindow?.minimize()
    else {
      this.requireOwner(senderId)
      this.window?.minimize()
    }
  }

  openSettings(senderId: number): void {
    this.requireOwner(senderId)
    const settings = this.ensureSettings()
    if (settings.isMinimized()) settings.restore()
    settings.show()
    settings.focus()
    settings.setAlwaysOnTop(true, 'screen-saver')
    settings.moveTop()
    this.saveSettingsWindowBounds()
  }

  setSkin(senderId: number, skin: TimerSkinId): void {
    if (!this.owns(senderId) && !this.ownsSettings(senderId)) throw new Error('Unauthorized timer skin request')
    const window = this.window
    if (skin === this.skin) {
      // Renderer hot reloads and React StrictMode can repeat this request.
      // Do not normalize or resize an already active skin in that case.
      if (window && !window.isDestroyed()) this.saveTimerWindowBounds(window)
      return
    }
    if (window && !window.isDestroyed()) {
      const current = window.getBounds()
      this.saveTimerBounds(this.skin, current)
      this.skin = skin
      this.applyWindowConstraints(window, skin)
      const saved = this.timerBounds[skin]
      const next = clampBounds(saved || { x: current.x, y: current.y }, timerSize(saved, skin))
      window.setBounds(next, true)
      const applied = window.getBounds()
      applyTimerSurface(window)
      this.saveTimerBounds(skin, applied)
      window.webContents.send('timer:skin-changed', skin)
    } else {
      this.skin = skin
    }
    if (this.settingsWindow && !this.settingsWindow.isDestroyed()) this.settingsWindow.webContents.send('timer:skin-changed', skin)
  }

  dispose(): void {
    this.saveTimerWindowBounds()
    this.saveSettingsWindowBounds()
    if (this.stateTicker) clearInterval(this.stateTicker)
    this.stateTicker = undefined
    if (this.boundsTicker) clearInterval(this.boundsTicker)
    this.boundsTicker = undefined
    if (this.window && !this.window.isDestroyed()) this.window.destroy()
    if (this.settingsWindow && !this.settingsWindow.isDestroyed()) this.settingsWindow.destroy()
    this.window = undefined
    this.settingsWindow = undefined
  }

  private requireOwner(senderId: number): BrowserWindow {
    if (!this.owns(senderId)) throw new Error('Unauthorized timer window request')
    return this.window!
  }

  private requireAnyOwner(senderId: number): void {
    if (!this.owns(senderId) && !this.ownsSettings(senderId)) throw new Error('Unauthorized timer request')
  }

  private currentElapsed(): number {
    return this.state === 'running' && this.startedAt !== null
      ? Math.max(0, Date.now() - this.startedAt)
      : this.accumulatedElapsed
  }

  private resetState(): void {
    this.startedAt = null
    this.accumulatedElapsed = 0
    this.automaticAreaId = null
    this.state = 'idle'
    this.broadcastState()
  }

  private snapshot(): TimerStateSnapshot {
    return { state: this.state, elapsed: this.currentElapsed(), gameRunning: this.gameRunning }
  }

  private broadcastState(): void {
    const snapshot = this.snapshot()
    for (const window of [this.window, this.settingsWindow]) {
      if (window && !window.isDestroyed()) window.webContents.send('timer:state-changed', snapshot)
    }
  }

  private applyWindowConstraints(window: BrowserWindow, skin: TimerSkinId): void {
    const minimum = TIMER_MIN_SIZES[skin]
    const maximum = TIMER_MAX_SIZES[skin]
    window.setMinimumSize(minimum.width, minimum.height)
    window.setMaximumSize(maximum.width, maximum.height)
    window.setAspectRatio(COLLAPSED_SIZES[skin].width / COLLAPSED_SIZES[skin].height)
  }

  private ensure(): BrowserWindow {
    if (this.window && !this.window.isDestroyed()) return this.window
    this.loadBounds()
    const saved = this.timerBounds[this.skin]
    const size = timerSize(saved, this.skin)
    const bounds = clampBounds(saved, size)
    const window = new BrowserWindow({
      ...bounds,
      frame: false,
      resizable: true,
      movable: true,
      minWidth: TIMER_MIN_SIZES[this.skin].width,
      minHeight: TIMER_MIN_SIZES[this.skin].height,
      maxWidth: TIMER_MAX_SIZES[this.skin].width,
      maxHeight: TIMER_MAX_SIZES[this.skin].height,
      fullscreenable: false,
      autoHideMenuBar: true,
      transparent: true,
      hasShadow: false,
      show: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      backgroundColor: '#00000000',
      icon: this.icon,
      webPreferences: {
        preload: this.preload,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    })
    this.applyWindowConstraints(window, this.skin)
    applyTimerSurface(window)
    window.setAlwaysOnTop(true, 'screen-saver')
    const reapplySurface = () => {
      if (window.isDestroyed()) return
      applyTimerSurface(window)
    }
    window.once('ready-to-show', reapplySurface)
    window.webContents.once('did-finish-load', reapplySurface)
    window.webContents.setWindowOpenHandler(({ url }) => { void shell.openExternal(url); return { action: 'deny' } })
    let lastBounds = bounds
    let normalizingResize = false
    const save = () => {
      this.saveTimerWindowBounds(window)
    }
    window.on('move', save)
    window.on('resize', () => {
      const current = window.getBounds()
      if (!normalizingResize) {
        const widthChanged = Math.abs(current.width - lastBounds.width)
        const heightChanged = Math.abs(current.height - lastBounds.height)
        const preferredDimension = widthChanged >= heightChanged ? 'width' : 'height'
        const normalizedSize = timerSize(current, this.skin, preferredDimension)
        if (normalizedSize.width !== current.width || normalizedSize.height !== current.height) {
          normalizingResize = true
          window.setBounds(clampBounds({ x: current.x, y: current.y }, normalizedSize), true)
          normalizingResize = false
        }
      }
      lastBounds = window.getBounds()
      reapplySurface()
      save()
    })
    window.on('close', (event) => {
      save()
      event.preventDefault()
      window.hide()
    })
    window.on('hide', save)
    window.on('closed', () => { if (this.window === window) this.window = undefined })
    void window.loadURL(surfaceUrl(this.rendererUrl, 'timer'))
    this.window = window
    return window
  }

  private ensureSettings(): BrowserWindow {
    if (this.settingsWindow && !this.settingsWindow.isDestroyed()) return this.settingsWindow
    this.loadBounds()
    const timer = this.window
    const timerBounds = timer && !timer.isDestroyed() ? timer.getBounds() : undefined
    const size = settingsSize(this.settingsBounds)
    const saved = this.settingsBounds || {
      x: (timerBounds?.x ?? 0) + ((timerBounds?.width ?? 148) - size.width) / 2,
      y: (timerBounds?.y ?? 0) + (timerBounds?.height ?? 148) + 12,
    }
    const bounds = clampBounds(saved, size)
    const window = new BrowserWindow({
      ...bounds,
      frame: false,
      resizable: true,
      movable: true,
      minWidth: SETTINGS_MIN_SIZE.width,
      minHeight: SETTINGS_MIN_SIZE.height,
      maxWidth: SETTINGS_MAX_SIZE.width,
      maxHeight: SETTINGS_MAX_SIZE.height,
      fullscreenable: false,
      autoHideMenuBar: true,
      transparent: true,
      hasShadow: false,
      show: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      backgroundColor: '#00000000',
      icon: this.icon,
      webPreferences: {
        preload: this.preload,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    })
    applyTimerSurface(window)
    window.setAlwaysOnTop(true, 'screen-saver')
    window.webContents.setWindowOpenHandler(({ url }) => { void shell.openExternal(url); return { action: 'deny' } })
    const save = () => {
      this.saveSettingsWindowBounds(window)
    }
    window.on('move', save)
    window.on('resize', save)
    window.on('close', (event) => {
      save()
      event.preventDefault()
      window.hide()
    })
    window.on('hide', save)
    window.on('closed', () => { if (this.settingsWindow === window) this.settingsWindow = undefined })
    void window.loadURL(surfaceUrl(this.rendererUrl, 'timer-settings'))
    this.settingsWindow = window
    return window
  }

  private loadBounds(): void {
    if (this.boundsLoaded) return
    this.boundsLoaded = true
    try {
      const parsed = JSON.parse(readFileSync(this.boundsFile, 'utf8')) as TimerBoundsStore & TimerBounds
      if (isTimerSkinId(parsed.activeSkin)) this.skin = parsed.activeSkin
      if (parsed.skins && typeof parsed.skins === 'object') this.timerBounds = parsed.skins
      if (parsed.settings && typeof parsed.settings === 'object') this.settingsBounds = parsed.settings
      if (!parsed.skins && !parsed.settings && (parsed.x !== undefined || parsed.y !== undefined || parsed.width !== undefined || parsed.height !== undefined)) {
        this.timerBounds.obsidian = parsed
      }
    } catch {
      // First launch or an older invalid position file.
    }
  }

  private saveTimerBounds(skin: TimerSkinId, bounds: Rectangle): void {
    this.loadBounds()
    this.timerBounds[skin] = bounds
    this.writeBoundsStore()
  }

  private saveSettingsBounds(bounds: Rectangle): void {
    this.loadBounds()
    this.settingsBounds = bounds
    this.writeBoundsStore()
  }

  private saveTimerWindowBounds(window = this.window): void {
    if (!window || window.isDestroyed() || window.isMinimized() || window.isMaximized()) return
    this.saveTimerBounds(this.skin, window.getBounds())
  }

  private persistTimerBoundsIfChanged(): void {
    const window = this.window
    if (!window || window.isDestroyed() || window.isMinimized() || window.isMaximized()) return
    const bounds = window.getBounds()
    const saved = this.timerBounds[this.skin]
    if (saved?.x === bounds.x && saved?.y === bounds.y && saved?.width === bounds.width && saved?.height === bounds.height) return
    this.saveTimerBounds(this.skin, bounds)
  }

  private saveSettingsWindowBounds(window = this.settingsWindow): void {
    if (!window || window.isDestroyed() || window.isMinimized() || window.isMaximized()) return
    this.saveSettingsBounds(window.getBounds())
  }

  private writeBoundsStore(): void {
    try {
      mkdirSync(path.dirname(this.boundsFile), { recursive: true })
      const store: TimerBoundsStore = {
        activeSkin: this.skin,
        skins: this.timerBounds,
        ...(this.settingsBounds ? { settings: this.settingsBounds } : {}),
      }
      writeFileSync(this.boundsFile, JSON.stringify(store), 'utf8')
    } catch {
      // Position persistence is best effort.
    }
  }
}
