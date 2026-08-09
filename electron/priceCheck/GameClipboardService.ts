import { clipboard } from 'electron'
import { randomUUID } from 'node:crypto'
import koffi from 'koffi'
import type { GameWindowService } from '../gameWindowService.js'

function delay(ms: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, ms)) }

export function processIsElevated(pid: number): boolean | undefined {
  try {
    // TokenElevation is a small BOOL returned by advapi32. If the process is
    // protected or the token cannot be queried, return unknown rather than
    // blocking price checks for a permission state we cannot prove.
    const HANDLE = koffi.pointer('HANDLE', koffi.opaque())
    const kernel32 = koffi.load('kernel32.dll')
    const advapi32 = koffi.load('advapi32.dll')
    const processHandle = kernel32.func('HANDLE __stdcall OpenProcess(uint32_t, bool, uint32_t)')
    const closeHandle = kernel32.func('bool __stdcall CloseHandle(HANDLE)')
    const openProcessToken = advapi32.func('bool __stdcall OpenProcessToken(HANDLE, uint32_t, _Out_ HANDLE *)')
    const getTokenInformation = advapi32.func('bool __stdcall GetTokenInformation(HANDLE, int, _Out_ void *, uint32_t, _Out_ uint32_t *)')
    const process = processHandle(0x1000, false, pid)
    if (!process) return undefined
    try {
      const tokenOut: Array<unknown | null> = [null]
      if (!openProcessToken(process, 0x0008, tokenOut) || !tokenOut[0]) return undefined
      const token = tokenOut[0]
      try {
        const elevation = Buffer.alloc(4)
        const returnLength: Array<number> = [0]
        if (!getTokenInformation(token, 20, elevation, elevation.length, returnLength)) return undefined
        return elevation.readUInt32LE(0) !== 0
      } finally {
        closeHandle(token)
      }
    } finally {
      closeHandle(process)
    }
  } catch {
    return undefined
  }
}

export class GameClipboardService {
  constructor(private readonly game: () => GameWindowService | null) {}

  async copyItem(): Promise<string> {
    if (process.platform !== 'win32') throw new Error('Game clipboard capture is only supported on Windows')
    const state = this.game()?.getState()
    if (!state || state.status === 'stopped') throw new Error('Path of Exile 2 is not running')
    // Do not hard-fail on the cached foreground flag. The game-window poller
    // runs independently of this hotkey and can be one tick behind during a
    // price-check window hide/focus transition. The actual Ctrl+C result below
    // is the authoritative foreground check.
    if ('pid' in state && state.pid) {
      const gameElevated = processIsElevated(state.pid)
      const appElevated = processIsElevated(process.pid)
      if (gameElevated === true && appElevated === false) {
        throw new Error('Path of Exile 2 is running as administrator. Restart SuperPoE as administrator to use the price checker.')
      }
    }
    // Use a unique sentinel instead of relying on clipboard.clear(). Some game
    // clients publish the copied item asynchronously and Electron can otherwise
    // briefly return the previous clipboard owner while the copy is in flight.
    const sentinel = `__superpoe_price_check_${randomUUID()}__`
    clipboard.writeText(sentinel)
    const sendCopy = async (): Promise<void> => {
      const koffi = (await import('koffi')).default
      const user32 = koffi.load('user32.dll')
      const keybdEvent = user32.func('void __stdcall keybd_event(uint8_t, uint8_t, uint32_t, uintptr_t)')
      const KEYUP = 0x0002
      let controlDown = false
      let copyDown = false
      try {
        keybdEvent(0x11, 0, 0, 0)
        controlDown = true
        keybdEvent(0x43, 0, 0, 0)
        copyDown = true
        keybdEvent(0x43, 0, KEYUP, 0)
        copyDown = false
        keybdEvent(0x11, 0, KEYUP, 0)
        controlDown = false
      } finally {
        // Never leave Ctrl/C pressed if the native call fails halfway through.
        if (copyDown) keybdEvent(0x43, 0, KEYUP, 0)
        if (controlDown) keybdEvent(0x11, 0, KEYUP, 0)
      }
    }
    try {
      await sendCopy()
    } catch (error) {
      throw new Error(`Could not send Ctrl+C to the game: ${error instanceof Error ? error.message : String(error)}`)
    }
    // Busy maps and elevated clients can take more than half a second to answer
    // Ctrl+C. Keep polling for up to two seconds while rejecting our sentinel.
    for (let attempt = 0; attempt < 40; attempt += 1) {
      await delay(50)
      const value = clipboard.readText().trim()
      if (value && value !== sentinel) return value
      // A second native key sequence helps when the first one lands during a
      // render/input transition in borderless or elevated game clients.
      if (attempt === 12) await sendCopy()
    }
    throw new Error('The game did not copy an item. Keep Path of Exile 2 focused, hover an item, and press the price-check hotkey again. If the game is running as administrator, restart SuperPoE as administrator too.')
  }
}
