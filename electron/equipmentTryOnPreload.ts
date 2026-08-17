import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('pob2TryOn', {
  close: () => ipcRenderer.invoke('equipment-try-on:close'),
  getPayload: () => ipcRenderer.invoke('equipment-try-on:get-payload'),
  onPayload: (callback: (payload: unknown) => void) => {
    const handler = (_event: unknown, payload: unknown) => callback(payload)
    ipcRenderer.on('equipment-try-on:payload', handler)
    return () => { ipcRenderer.removeListener('equipment-try-on:payload', handler) }
  },
})

// The try-on surface is sandboxed and has its own preload. Expose the small
// PoB bridge it needs so equipment comparison uses the shared LuaJIT sidecar
// instead of initializing a second Wasmoon runtime in this window.
contextBridge.exposeInMainWorld('pob2Desktop', {
  initPobLua: () => ipcRenderer.invoke('pob2:lua-init'),
  comparePobLuaEquipment: (payload: unknown) => ipcRenderer.invoke('pob2:lua-compare-equipment', payload),
})
