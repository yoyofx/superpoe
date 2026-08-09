import { contextBridge, ipcRenderer } from 'electron'
import type { PriceCheckContextState, PriceCheckOpenRequest, TradePriceCheckCriteria } from '../../src/types/market.js'

contextBridge.exposeInMainWorld('superpoePriceCheck', {
  open: (request: PriceCheckOpenRequest) => ipcRenderer.invoke('price-check:open', request),
  getState: () => ipcRenderer.invoke('price-check:get-state') as Promise<PriceCheckContextState>,
  search: (leagueId: string, criteria: TradePriceCheckCriteria) => ipcRenderer.invoke('price-check:search', { leagueId, criteria }) as Promise<PriceCheckContextState>,
  fetchPage: (page: number) => ipcRenderer.invoke('price-check:fetch-page', page) as Promise<PriceCheckContextState>,
  openTradePage: (url: string) => ipcRenderer.invoke('price-check:open-trade-page', url),
  visitHideout: (listingId: string) => ipcRenderer.invoke('price-check:visit-hideout', listingId) as Promise<import('../../src/types/market.js').MarketVisitHideoutResult>,
  favorite: (listingId: string) => ipcRenderer.invoke('price-check:favorite', listingId) as Promise<{ ok: true; entryId: string }>,
  openInTradeCenter: (url: string) => ipcRenderer.invoke('price-check:open-in-trade-center', url) as Promise<void>,
  showDetail: (listingId: string) => ipcRenderer.invoke('price-check:show-detail', listingId),
  hideDetail: () => ipcRenderer.invoke('price-check:hide-detail'),
  getDetailState: () => ipcRenderer.invoke('price-check:get-detail-state') as Promise<{ state?: PriceCheckContextState; listingId?: string }>,
  hide: () => ipcRenderer.invoke('price-check:hide'),
  setUiScale: (factor: number) => ipcRenderer.invoke('pob2:set-ui-scale', factor) as Promise<number>,
  restartAsAdministrator: () => ipcRenderer.invoke('pob2:restart-as-admin') as Promise<{ status: 'started' | 'already-elevated' | 'cancelled' | 'unsupported' }>,
  onState: (callback: (state: PriceCheckContextState) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: PriceCheckContextState) => callback(state)
    ipcRenderer.on('price-check:state', listener)
    return () => ipcRenderer.removeListener('price-check:state', listener)
  },
  onDetailState: (callback: (value: { state?: PriceCheckContextState; listingId?: string }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, value: { state?: PriceCheckContextState; listingId?: string }) => callback(value)
    ipcRenderer.on('price-check:detail-state', listener)
    return () => ipcRenderer.removeListener('price-check:detail-state', listener)
  },
})
