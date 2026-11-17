import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('pob2Timer', {
  getState: () => ipcRenderer.invoke('timer:get-state') as Promise<{
    mode: 'map' | 'campaign' | 'system'
    state: string
    elapsed: number
    gameRunning: boolean
    opacity: number
    mapAreaId: string | null
    campaign: {
      runId: number | null
      status: string
      elapsed: number
      currentSegment: string | null
      currentAreaId: string | null
      segments: Array<{ key: string; elapsed: number; status: string }>
    }
  }>,
  setMode: (mode: 'map' | 'campaign' | 'system') => ipcRenderer.invoke('timer:set-mode', mode) as Promise<void>,
  setOpacity: (opacity: number) => ipcRenderer.invoke('timer:set-opacity', opacity) as Promise<void>,
  start: () => ipcRenderer.invoke('timer:start') as Promise<void>,
  pause: () => ipcRenderer.invoke('timer:pause') as Promise<void>,
  finish: () => ipcRenderer.invoke('timer:finish') as Promise<void>,
  reset: () => ipcRenderer.invoke('timer:reset') as Promise<void>,
  resize: (size: { width: number; height: number }) => ipcRenderer.invoke('timer:resize', size) as Promise<void>,
  moveBy: (delta: { x: number; y: number }) => ipcRenderer.invoke('timer:move-by', delta) as Promise<void>,
  close: () => ipcRenderer.invoke('timer:close') as Promise<void>,
  minimize: () => ipcRenderer.invoke('timer:minimize') as Promise<void>,
  openSettings: () => ipcRenderer.invoke('timer:open-settings') as Promise<void>,
  openCampaign: () => ipcRenderer.invoke('timer:open-campaign') as Promise<void>,
  openStoryGuide: () => ipcRenderer.invoke('timer:open-story-guide') as Promise<void>,
  closeSettings: () => ipcRenderer.invoke('timer:close-settings') as Promise<void>,
  setSkin: (skin: string) => ipcRenderer.invoke('timer:set-skin', skin) as Promise<void>,
  onSkinChanged: (callback: (skin: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, skin: unknown) => { if (typeof skin === 'string') callback(skin) }
    ipcRenderer.on('timer:skin-changed', listener)
    return () => ipcRenderer.removeListener('timer:skin-changed', listener)
  },
  onStateChanged: (callback: (state: {
    mode: 'map' | 'campaign' | 'system'
    state: string
    elapsed: number
    gameRunning: boolean
    opacity: number
    mapAreaId: string | null
    campaign: {
      runId: number | null
      status: string
      elapsed: number
      currentSegment: string | null
      currentAreaId: string | null
      segments: Array<{ key: string; elapsed: number; status: string }>
    }
  }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: unknown) => {
      if (!state || typeof state !== 'object') return
      const value = state as { state?: unknown; elapsed?: unknown; gameRunning?: unknown; opacity?: unknown; mode?: unknown; campaign?: unknown }
      if (typeof value.state !== 'string' || typeof value.elapsed !== 'number' || typeof value.gameRunning !== 'boolean' || typeof value.opacity !== 'number') return
      if (typeof value.mode !== 'string' || !value.campaign || typeof value.campaign !== 'object') return
      callback(value as Parameters<typeof callback>[0])
    }
    ipcRenderer.on('timer:state-changed', listener)
    return () => ipcRenderer.removeListener('timer:state-changed', listener)
  },
})
