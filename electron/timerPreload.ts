import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('pob2Timer', {
  getState: () => ipcRenderer.invoke('timer:get-state') as Promise<{ state: string; elapsed: number; gameRunning: boolean }>,
  start: () => ipcRenderer.invoke('timer:start') as Promise<void>,
  pause: () => ipcRenderer.invoke('timer:pause') as Promise<void>,
  finish: () => ipcRenderer.invoke('timer:finish') as Promise<void>,
  reset: () => ipcRenderer.invoke('timer:reset') as Promise<void>,
  resize: (size: { width: number; height: number }) => ipcRenderer.invoke('timer:resize', size) as Promise<void>,
  close: () => ipcRenderer.invoke('timer:close') as Promise<void>,
  minimize: () => ipcRenderer.invoke('timer:minimize') as Promise<void>,
  openSettings: () => ipcRenderer.invoke('timer:open-settings') as Promise<void>,
  closeSettings: () => ipcRenderer.invoke('timer:close-settings') as Promise<void>,
  setSkin: (skin: string) => ipcRenderer.invoke('timer:set-skin', skin) as Promise<void>,
  onSkinChanged: (callback: (skin: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, skin: unknown) => { if (typeof skin === 'string') callback(skin) }
    ipcRenderer.on('timer:skin-changed', listener)
    return () => ipcRenderer.removeListener('timer:skin-changed', listener)
  },
  onStateChanged: (callback: (state: { state: string; elapsed: number; gameRunning: boolean }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: unknown) => {
      if (!state || typeof state !== 'object') return
      const value = state as { state?: unknown; elapsed?: unknown; gameRunning?: unknown }
      if (typeof value.state !== 'string' || typeof value.elapsed !== 'number' || typeof value.gameRunning !== 'boolean') return
      callback({ state: value.state, elapsed: value.elapsed, gameRunning: value.gameRunning })
    }
    ipcRenderer.on('timer:state-changed', listener)
    return () => ipcRenderer.removeListener('timer:state-changed', listener)
  },
})
