import { clipboard } from 'electron'
import type { GameWindowService } from '../gameWindowService.js'

function delay(ms: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, ms)) }

export class GameClipboardService {
  constructor(private readonly game: () => GameWindowService | null) {}

  async copyItem(): Promise<string> {
    if (process.platform !== 'win32') throw new Error('Game clipboard capture is only supported on Windows')
    const state = this.game()?.getState()
    if (!state || state.status === 'stopped') throw new Error('Path of Exile 2 is not running')
    if (state.status !== 'foreground') throw new Error('Path of Exile 2 must be in the foreground')
    clipboard.clear()
    try {
      const koffi = (await import('koffi')).default
      const user32 = koffi.load('user32.dll')
      const keybdEvent = user32.func('void __stdcall keybd_event(uint8_t, uint8_t, uint32_t, uintptr_t)')
      const KEYUP = 0x0002
      keybdEvent(0x11, 0, 0, 0)
      keybdEvent(0x43, 0, 0, 0)
      keybdEvent(0x43, 0, KEYUP, 0)
      keybdEvent(0x11, 0, KEYUP, 0)
    } catch (error) {
      throw new Error(`Could not send Ctrl+C to the game: ${error instanceof Error ? error.message : String(error)}`)
    }
    for (let attempt = 0; attempt < 12; attempt += 1) {
      await delay(40)
      const value = clipboard.readText().trim()
      if (value) return value
    }
    throw new Error('The game did not place a new item on the clipboard; check elevation permissions')
  }
}
