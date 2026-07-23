import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('pob2Desktop', {
  importWeGame: (url: string) => ipcRenderer.invoke('pob2:import-wegame', url),
  saveGameBuild: (payload: { content: string; fileName: string }) => ipcRenderer.invoke('pob2:save-game-build', payload),
  installGameBuild: (payload: { content: string; fileName: string }) => ipcRenderer.invoke('pob2:install-game-build', payload),
})

contextBridge.exposeInMainWorld('pob2Updater', {
  check: (channel?: string) => ipcRenderer.invoke('updater:check', channel),
  download: (info: unknown) => ipcRenderer.invoke('updater:download', info),
  setConfig: (config: { channel?: string; intervalMinutes?: number }) => ipcRenderer.send('updater:set-config', config),
  setProxyDomains: (domains: string[]) => ipcRenderer.send('updater:set-proxy-domains', domains),
  getProxyDomains: () => ipcRenderer.invoke('updater:get-proxy-domains') as Promise<{ builtin: string[]; user: string[] }>,
  restartTimer: () => ipcRenderer.send('updater:restart-timer'),
  onUpdateAvailable: (callback: (info: unknown) => void) => {
    const handler = (_event: unknown, info: unknown) => callback(info)
    ipcRenderer.on('updater:update-available', handler)
    return () => { ipcRenderer.removeListener('updater:update-available', handler) }
  },
  onDownloadProgress: (callback: (percent: number) => void) => {
    const handler = (_event: unknown, percent: number) => callback(percent)
    ipcRenderer.on('updater:download-progress', handler)
    return () => { ipcRenderer.removeListener('updater:download-progress', handler) }
  },
  onDownloadComplete: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on('updater:download-complete', handler)
    return () => { ipcRenderer.removeListener('updater:download-complete', handler) }
  },
  onDownloadError: (callback: (message: string) => void) => {
    const handler = (_event: unknown, message: string) => callback(message)
    ipcRenderer.on('updater:download-error', handler)
    return () => { ipcRenderer.removeListener('updater:download-error', handler) }
  },
})
