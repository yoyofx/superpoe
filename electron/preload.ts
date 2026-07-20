import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('pob2Desktop', {
  importWeGame: (url: string) => ipcRenderer.invoke('pob2:import-wegame', url),
})
