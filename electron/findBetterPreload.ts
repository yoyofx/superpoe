import { contextBridge, ipcRenderer } from 'electron'
import type { PriceCheckContextState, PriceCheckOpenRequest, TradePriceCheckCriteria } from '../src/types/market.js'

contextBridge.exposeInMainWorld('superpoeFindBetter', {
  open: (request: PriceCheckOpenRequest) => ipcRenderer.invoke('find-better:open', request) as Promise<PriceCheckContextState>,
  getState: () => ipcRenderer.invoke('find-better:get-state') as Promise<PriceCheckContextState>,
  search: (leagueId: string, criteria: TradePriceCheckCriteria) => ipcRenderer.invoke('find-better:search', { leagueId, criteria }) as Promise<PriceCheckContextState>,
  fetchPage: (page: number) => ipcRenderer.invoke('find-better:fetch-page', page) as Promise<PriceCheckContextState>,
  openInTradeCenter: (url: string) => ipcRenderer.invoke('find-better:open-in-trade-center', url) as Promise<void>,
  visitHideout: (listingId: string) => ipcRenderer.invoke('find-better:visit-hideout', listingId) as Promise<import('../src/types/market.js').MarketVisitHideoutResult>,
  favorite: (listingId: string) => ipcRenderer.invoke('find-better:favorite', listingId) as Promise<{ ok: true; entryId: string }>,
  hide: () => ipcRenderer.invoke('find-better:hide') as Promise<void>,
  setUiScale: (factor: number) => ipcRenderer.invoke('pob2:set-ui-scale', factor) as Promise<number>,
  onState: (callback: (state: PriceCheckContextState) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: PriceCheckContextState) => callback(state)
    ipcRenderer.on('find-better:state', listener)
    return () => ipcRenderer.removeListener('find-better:state', listener)
  },
})
