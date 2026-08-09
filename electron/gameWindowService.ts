import { EventEmitter } from 'node:events'
import path from 'node:path'
import koffi from 'koffi'
import type { GameRuntimeState, MarketBounds, MarketRealm } from '../src/types/market.js'

interface NativeWindowInfo {
  hwnd: unknown
  pid: number
  title: string
  processPath?: string
  bounds?: MarketBounds
  foreground: boolean
}

export function classifyGameClient(processPath: string | undefined, title: string): MarketRealm | 'unknown' {
  const evidence = `${processPath || ''}\n${title}`.toLocaleLowerCase()
  if (/wegame|rail_apps|2002052|腾讯|流放之路/.test(evidence)) return 'cn'
  if (/pathofexile|path of exile|steamapps|grinding gear/.test(evidence)) return 'global'
  return 'unknown'
}

function sameState(left: GameRuntimeState, right: GameRuntimeState): boolean {
  return JSON.stringify({ ...left, checkedAt: undefined }) === JSON.stringify({ ...right, checkedAt: undefined })
}

class Win32GameWindowAdapter {
  private readonly user32 = koffi.load('user32.dll')
  private readonly kernel32 = koffi.load('kernel32.dll')
  private readonly dwmapi = koffi.load('dwmapi.dll')
  private readonly HANDLE = koffi.pointer('HANDLE', koffi.opaque())
  private readonly HWND = koffi.alias('HWND', this.HANDLE)
  private readonly RECT = koffi.struct('RECT', { left: 'long', top: 'long', right: 'long', bottom: 'long' })
  private readonly FindWindowExW = this.user32.func('HWND __stdcall FindWindowExW(HWND, HWND, const char16_t *, const char16_t *)')
  private readonly GetForegroundWindow = this.user32.func('HWND __stdcall GetForegroundWindow()')
  private readonly GetWindowThreadProcessId = this.user32.func('uint32_t __stdcall GetWindowThreadProcessId(HWND, _Out_ uint32_t *)')
  private readonly ShowWindow = this.user32.func('bool __stdcall ShowWindow(HWND, int)')
  private readonly SetForegroundWindow = this.user32.func('bool __stdcall SetForegroundWindow(HWND)')
  private readonly GetWindowTextW = this.user32.func('int __stdcall GetWindowTextW(HWND, _Out_ char16_t *, int)')
  private readonly GetWindowRect = this.user32.func('bool __stdcall GetWindowRect(HWND, _Out_ RECT *)')
  private readonly OpenProcess = this.kernel32.func('HANDLE __stdcall OpenProcess(uint32_t, bool, uint32_t)')
  private readonly CloseHandle = this.kernel32.func('bool __stdcall CloseHandle(HANDLE)')
  private readonly QueryFullProcessImageNameW = this.kernel32.func('bool __stdcall QueryFullProcessImageNameW(HANDLE, uint32_t, _Out_ char16_t *, _Inout_ uint32_t *)')
  private readonly DwmGetWindowAttribute = this.dwmapi.func('long __stdcall DwmGetWindowAttribute(HWND, uint32_t, _Out_ RECT *, uint32_t)')

  find(): NativeWindowInfo | null {
    let cursor: unknown = null
    const foreground = this.GetForegroundWindow()
    const foregroundPidOut: Array<number | null> = [null]
    if (foreground) this.GetWindowThreadProcessId(foreground, foregroundPidOut)
    let firstMatch: NativeWindowInfo | null = null
    for (let count = 0; count < 8; count += 1) {
      cursor = this.FindWindowExW(null, cursor, 'POEWindowClass', null)
      if (!cursor) break
      const pidOut: Array<number | null> = [null]
      if (!this.GetWindowThreadProcessId(cursor, pidOut) || !pidOut[0]) continue
      const pid = pidOut[0]
      const titleBuffer = Buffer.alloc(1_024)
      const titleLength = this.GetWindowTextW(cursor, titleBuffer, 512)
      const title = titleLength > 0 ? titleBuffer.subarray(0, titleLength * 2).toString('utf16le') : ''
      const info: NativeWindowInfo = {
        hwnd: cursor,
        pid,
        title,
        processPath: this.processPath(pid),
        bounds: this.windowBounds(cursor),
        // Compare process IDs instead of HWND pointer addresses. Koffi may
        // materialize equivalent HWND values as different JS objects.
        foreground: foregroundPidOut[0] === pid,
      }
      if (!firstMatch) firstMatch = info
      if (info.foreground) return info
    }
    return firstMatch
  }

  focus(): boolean {
    const window = this.find()
    if (!window) return false
    // SW_RESTORE also brings a minimized client back before assigning focus.
    this.ShowWindow(window.hwnd, 9)
    return Boolean(this.SetForegroundWindow(window.hwnd))
  }

  private processPath(pid: number): string | undefined {
    const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
    const process = this.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid)
    if (!process) return undefined
    try {
      const buffer = Buffer.alloc(65_536)
      const size: Array<number> = [32_768]
      if (!this.QueryFullProcessImageNameW(process, 0, buffer, size)) return undefined
      return buffer.subarray(0, size[0] * 2).toString('utf16le')
    } finally {
      this.CloseHandle(process)
    }
  }

  private windowBounds(hwnd: unknown): MarketBounds | undefined {
    const rect: { left?: number; top?: number; right?: number; bottom?: number } = {}
    const DWMWA_EXTENDED_FRAME_BOUNDS = 9
    const result = this.DwmGetWindowAttribute(hwnd, DWMWA_EXTENDED_FRAME_BOUNDS, rect, koffi.sizeof(this.RECT))
    if (result !== 0 && !this.GetWindowRect(hwnd, rect)) return undefined
    if (![rect.left, rect.top, rect.right, rect.bottom].every(Number.isFinite)) return undefined
    return { x: rect.left!, y: rect.top!, width: Math.max(1, rect.right! - rect.left!), height: Math.max(1, rect.bottom! - rect.top!) }
  }
}

export class GameWindowService extends EventEmitter {
  private state: GameRuntimeState = { status: 'unknown' }
  private timer?: NodeJS.Timeout
  private adapter?: Win32GameWindowAdapter

  constructor(private readonly intervalMs = 1_000) {
    super()
    if (process.platform === 'win32') {
      try { this.adapter = new Win32GameWindowAdapter() } catch { /* Native detection remains unknown. */ }
    }
  }

  start(): void {
    if (this.timer) return
    this.check()
    this.timer = setInterval(() => this.check(), this.intervalMs)
    this.timer.unref()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
  }

  getState(): GameRuntimeState {
    return structuredClone(this.state)
  }

  focusGame(): boolean {
    return this.adapter?.focus() === true
  }

  private check(): void {
    const checkedAt = new Date().toISOString()
    let next: GameRuntimeState
    if (process.platform !== 'win32') next = { status: 'stopped', checkedAt }
    else if (!this.adapter) next = { status: 'unknown', checkedAt }
    else {
      try {
        const found = this.adapter.find()
        next = found ? {
          status: found.foreground ? 'foreground' : 'background',
          checkedAt,
          clientRealm: classifyGameClient(found.processPath, found.title),
          processName: found.processPath ? path.basename(found.processPath) : found.title || 'Path of Exile 2',
          pid: found.pid,
          ...(found.bounds ? { bounds: found.bounds } : {}),
        } : { status: 'stopped', checkedAt }
      } catch {
        next = { status: 'unknown', checkedAt }
      }
    }
    if (!sameState(this.state, next)) {
      this.state = next
      this.emit('changed', this.getState())
    } else this.state = next
  }
}
