import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events')
  class MockWindow extends EventEmitter {
    static instances: MockWindow[] = []
    webContents = Object.assign(new EventEmitter(), {
      id: MockWindow.instances.length + 1,
      send: vi.fn(),
      setWindowOpenHandler: vi.fn(),
    })
    visible = false
    minimized = false
    destroyed = false
    constructor(private bounds: { x: number; y: number; width: number; height: number }) {
      super()
      MockWindow.instances.push(this)
    }
    getBounds() { return this.bounds }
    setBounds(bounds: { x: number; y: number; width: number; height: number }) {
      const previous = this.bounds
      const moved = bounds.x !== previous.x || bounds.y !== previous.y
      // Fractional Windows scaling rounds the outer rectangle at odd positions.
      this.bounds = { ...bounds, height: bounds.height + (moved && bounds.y % 2 !== 0 ? 1 : 0) }
      if (previous.width !== this.bounds.width || previous.height !== this.bounds.height) this.emit('resize')
      if (moved) this.emit('move')
    }
    isVisible() { return this.visible }
    isMinimized() { return this.minimized }
    isMaximized() { return false }
    isDestroyed() { return this.destroyed }
    show() { this.visible = true; this.emit('show') }
    hide() { this.visible = false; this.emit('hide') }
    minimize() { this.minimized = true; this.emit('minimize') }
    restore() { this.minimized = false; this.emit('restore') }
    destroy() { this.destroyed = true; this.emit('closed') }
    setMinimumSize() {}
    setMaximumSize() {}
    setAspectRatio() {}
    setBackgroundColor() {}
    setOpacity() {}
    setAlwaysOnTop() {}
    focus() {}
    moveTop() {}
    loadURL = vi.fn(async (_url: string) => {})
  }
  return {
    BrowserWindow: MockWindow,
    screen: { getDisplayMatching: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }) },
    shell: { openExternal: vi.fn() },
  }
})

import { BrowserWindow } from 'electron'
import { TimerWindowManager } from '../../electron/timerWindow.js'

const directories: string[] = []
const managers: TimerWindowManager[] = []
const windows = () => (BrowserWindow as unknown as { instances: BrowserWindow[] }).instances

afterEach(() => {
  for (const manager of managers.splice(0)) manager.dispose()
  windows().length = 0
  vi.useRealTimers()
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function createManager() {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'superpoe-timer-visibility-'))
  directories.push(directory)
  const changed = vi.fn()
  const manager = new TimerWindowManager('', 'http://localhost:3000', '', path.join(directory, 'bounds.json'), path.join(directory, 'campaign.sqlite'), changed)
  managers.push(manager)
  return { manager, changed }
}

describe('timer visibility linkage', () => {
  it.each(['map', 'system'] as const)('keeps skins separate and switches both racing entries from %s to campaign without starting time', (mode) => {
    const { manager } = createManager()
    manager.show()
    const owner = windows()[0].webContents.id
    manager.setMode(owner, mode)
    manager.openSettings(owner)
    expect(manager.getState(owner)).toMatchObject({ mode, state: 'idle' })
    expect(windows()[1].loadURL).toHaveBeenCalledWith('http://localhost:3000?surface=timer-settings')

    manager.openCampaign(owner)
    const campaignWindow = windows()[2]
    expect(campaignWindow.loadURL).toHaveBeenCalledWith('http://localhost:3000?surface=timer-campaign')
    expect(manager.getState(owner)).toMatchObject({ mode: 'campaign', state: 'idle', elapsed: 0 })
    manager.setMode(owner, mode)
    manager.enterCampaign(owner)
    expect(manager.getState(owner)).toMatchObject({ mode: 'campaign', state: 'idle', elapsed: 0 })
    manager.openCampaign(owner)
    expect(windows()).toHaveLength(3)
    manager.close(campaignWindow.webContents.id)
    expect(campaignWindow.isVisible()).toBe(false)
    expect(windows()[1].isVisible()).toBe(true)
    expect(manager.isVisible()).toBe(true)
    expect(() => manager.enterCampaign(999)).toThrow()
  })

  it('preserves campaign time across both racing entries and controls the campaign from its dedicated window', () => {
    vi.useFakeTimers()
    const { manager } = createManager()
    manager.show()
    const owner = windows()[0].webContents.id
    manager.openCampaign(owner)
    const campaignOwner = windows()[1].webContents.id
    manager.start(campaignOwner)
    vi.advanceTimersByTime(2000)
    manager.enterCampaign(campaignOwner)
    manager.openCampaign(owner)
    manager.openSettings(owner)
    expect(manager.getState(campaignOwner)).toMatchObject({ mode: 'campaign', state: 'running', elapsed: 2000 })
    manager.setMode(owner, 'system')
    manager.start(campaignOwner)
    vi.advanceTimersByTime(1000)
    manager.pause(campaignOwner)
    expect(manager.getState(owner)).toMatchObject({ mode: 'campaign', state: 'paused', elapsed: 3000 })
    manager.setVisible(false)
    expect(windows().every(window => !window.isVisible())).toBe(true)
  })

  it.each(['obsidian', 'ember', 'frost', 'strip'] as const)('prevents %s growth from fractional display rounding during repeated moves', (skin) => {
    const { manager } = createManager()
    manager.show()
    const window = windows()[0]
    const owner = window.webContents.id
    manager.setSkin(owner, skin)
    const { width, height } = window.getBounds()
    for (let i = 0; i < 50; i++) {
      manager.moveBy(owner, { x: -2, y: 1 })
      expect(Math.abs(window.getBounds().width - width)).toBeLessThanOrEqual(1)
      expect(Math.abs(window.getBounds().height - height)).toBeLessThanOrEqual(1)
      // Windows may report a resize notification during a native move.
      window.emit('resize')
    }
    expect(window.getBounds()).toMatchObject({ width, height })
  })

  it('moves and resizes the timer within screen and size limits without changing the campaign session', () => {
    const { manager } = createManager()
    manager.setVisible(true, 'campaign')
    const window = windows()[0]
    const owner = window.webContents.id
    manager.moveBy(owner, { x: -100, y: 100 })
    expect(window.getBounds()).toMatchObject({ x: 1644, y: 128, width: 148, height: 148 })
    manager.moveBy(owner, { x: -10000, y: 10000 })
    expect(window.getBounds()).toMatchObject({ x: 0, y: 932 })
    manager.resize(owner, { width: 1000, height: 1000 })
    expect(window.getBounds()).toEqual({ x: 0, y: 760, width: 320, height: 320 })
    manager.resize(owner, { width: 1, height: 1 })
    expect(window.getBounds()).toMatchObject({ width: 128, height: 128 })
    expect(manager.getState(owner)).toMatchObject({ mode: 'campaign', state: 'idle', elapsed: 0 })
    manager.openSettings(owner)
    expect(() => manager.moveBy(windows()[1].webContents.id, { x: 10, y: 10 })).toThrow()
    expect(() => manager.resize(windows()[1].webContents.id, { width: 200, height: 200 })).toThrow()
  })

  it.each(['map', 'system'] as const)('opens in campaign mode from %s without starting a run', (mode) => {
    const { manager } = createManager()
    manager.show()
    const owner = windows()[0].webContents.id
    manager.setMode(owner, mode)
    manager.setVisible(false)

    manager.setVisible(true, 'campaign')

    expect(manager.isVisible()).toBe(true)
    expect(manager.getState(owner)).toMatchObject({ mode: 'campaign', state: 'idle', elapsed: 0 })
  })

  it('preserves running and paused campaign sessions when reopening from the story guide', () => {
    vi.useFakeTimers()
    const { manager } = createManager()
    manager.setVisible(true, 'campaign')
    const owner = windows()[0].webContents.id
    manager.setStoryArea('G1_town', 'act1')
    manager.start(owner)
    vi.advanceTimersByTime(1000)
    manager.setVisible(false, 'campaign')
    vi.advanceTimersByTime(2000)
    manager.setVisible(true, 'campaign')
    expect(manager.getState(owner)).toMatchObject({ mode: 'campaign', state: 'running', elapsed: 3000 })

    manager.setMode(owner, 'system')
    manager.setVisible(false, 'campaign')
    expect(manager.getState(owner).mode).toBe('system')
    vi.advanceTimersByTime(2000)
    manager.setVisible(true, 'campaign')
    expect(manager.getState(owner)).toMatchObject({ mode: 'campaign', state: 'paused', elapsed: 3000 })
  })

  it('allows repeated and reentrant shutdown with both timer windows open', () => {
    vi.useFakeTimers()
    const { manager, changed } = createManager()
    manager.show()
    const owner = windows()[0].webContents.id
    manager.setMode(owner, 'campaign')
    manager.start(owner)
    manager.openSettings(owner)
    manager.openCampaign(owner)
    vi.advanceTimersByTime(1_000)
    changed.mockImplementation(() => manager.dispose())

    expect(() => manager.dispose()).not.toThrow()
    expect(windows().every(window => window.isDestroyed())).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
    vi.advanceTimersByTime(2_000)
    expect(() => manager.dispose()).not.toThrow()
  })

  it('reports native show, minimize, restore and close without creating a window for the initial query', () => {
    const { manager, changed } = createManager()
    expect(manager.isVisible()).toBe(false)
    expect(windows()).toHaveLength(0)
    manager.setVisible(true)
    const window = windows()[0]
    expect(changed).toHaveBeenLastCalledWith(true)
    manager.minimize(window.webContents.id)
    expect(manager.isVisible()).toBe(false)
    expect(changed).toHaveBeenLastCalledWith(false)
    window.restore()
    expect(changed).toHaveBeenLastCalledWith(true)
    const preventDefault = vi.fn()
    window.emit('close', { preventDefault })
    expect(preventDefault).toHaveBeenCalled()
    expect(manager.isVisible()).toBe(false)
    expect(changed).toHaveBeenLastCalledWith(false)
    manager.setVisible(true)
    expect(windows()).toHaveLength(1)
  })

  it('keeps campaign time running while hidden and hides both timer surfaces', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-16T00:00:00Z'))
    const { manager } = createManager()
    manager.show()
    const owner = windows()[0].webContents.id
    manager.setMode(owner, 'campaign')
    manager.setStoryArea('G1_town', 'act1')
    manager.start(owner)
    manager.openSettings(owner)
    manager.close(windows()[1].webContents.id)
    expect(manager.isVisible()).toBe(true)
    manager.openSettings(owner)
    vi.advanceTimersByTime(1000)
    manager.setVisible(false)
    expect(windows().every((window) => !window.isVisible())).toBe(true)
    vi.advanceTimersByTime(2000)
    expect(manager.getState(owner)).toMatchObject({ mode: 'campaign', state: 'running', elapsed: 3000 })
    manager.setVisible(true)
    expect(manager.getState(owner)).toMatchObject({ mode: 'campaign', state: 'running', elapsed: 3000 })
    expect(windows()[1].isVisible()).toBe(false)
  })
})
