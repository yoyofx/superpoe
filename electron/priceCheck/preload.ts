import { contextBridge, ipcRenderer } from 'electron'
import type { PriceCheckContextState, PriceCheckOpenRequest, TradePriceCheckCriteria } from '../../src/types/market.js'

contextBridge.exposeInMainWorld('superpoePriceCheck', {
  open: (request: PriceCheckOpenRequest) => ipcRenderer.invoke('price-check:open', request),
  getState: () => ipcRenderer.invoke('price-check:get-state') as Promise<PriceCheckContextState>,
  search: (leagueId: string, criteria: TradePriceCheckCriteria) => ipcRenderer.invoke('price-check:search', { leagueId, criteria }) as Promise<PriceCheckContextState>,
  fetchPage: (page: number) => ipcRenderer.invoke('price-check:fetch-page', page) as Promise<PriceCheckContextState>,
  openTradePage: (url: string) => ipcRenderer.invoke('price-check:open-trade-page', url),
  visitHideout: (listingId: string) => ipcRenderer.invoke('price-check:visit-hideout', listingId) as Promise<import('../../src/types/market.js').MarketVisitHideoutResult>,
  hide: () => ipcRenderer.invoke('price-check:hide'),
  onState: (callback: (state: PriceCheckContextState) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: PriceCheckContextState) => callback(state)
    ipcRenderer.on('price-check:state', listener)
    return () => ipcRenderer.removeListener('price-check:state', listener)
  },
})
