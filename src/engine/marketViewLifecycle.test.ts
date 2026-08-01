import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  BrowserWindow: class {},
  WebContentsView: class {},
  shell: { openExternal: vi.fn() },
}))

import { MarketViewManager } from '../../electron/marketView'
import type { TradeCredentialStore } from '../../electron/tradeCredentialStore'

describe('MarketViewManager lifecycle', () => {
  it('can dispose after its owner window has already been destroyed', () => {
    const close = vi.fn()
    const owner = {
      isDestroyed: () => true,
      on: vi.fn(),
      get contentView(): never {
        throw new TypeError('Object has been destroyed')
      },
    }
    const manager = new MarketViewManager(
      owner as never,
      vi.fn(),
      {} as TradeCredentialStore,
    )
    const view = { webContents: { isDestroyed: () => false, close } }
    Object.assign(manager, {
      activeView: view,
      attached: true,
    })
    ;(manager as unknown as { views: Map<string, typeof view> }).views.set('cn', view)

    expect(() => manager.dispose()).not.toThrow()
    expect(() => manager.dispose()).not.toThrow()
    expect(close).toHaveBeenCalledOnce()
  })

  it('does not reattach a deactivated market view when the window is restored', () => {
    const listeners = new Map<string, () => void>()
    const addChildView = vi.fn()
    const removeChildView = vi.fn()
    const owner = {
      isDestroyed: () => false,
      contentView: { addChildView, removeChildView },
      on: vi.fn((event: string, listener: () => void) => listeners.set(event, listener)),
    }
    const manager = new MarketViewManager(
      owner as never,
      vi.fn(),
      {} as TradeCredentialStore,
    )
    const view = {
      setBounds: vi.fn(),
      webContents: { isDestroyed: () => false, close: vi.fn() },
    }
    Object.assign(manager, { activeView: view, attached: true, visible: true })

    manager.deactivate()
    listeners.get('restore')?.()

    expect(removeChildView).toHaveBeenCalledWith(view)
    expect(addChildView).not.toHaveBeenCalled()
  })
})
