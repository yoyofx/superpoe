import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('pob2Desktop', {
  importWeGame: (url: string) => ipcRenderer.invoke('pob2:import-wegame', url),
  saveGameBuild: (payload: { content: string; fileName: string }) => ipcRenderer.invoke('pob2:save-game-build', payload),
  installGameBuild: (payload: { content: string; fileName: string }) => ipcRenderer.invoke('pob2:install-game-build', payload),
  setUiScale: (factor: number) => ipcRenderer.invoke('pob2:set-ui-scale', factor),
  setAppContext: (context: { defaultRealm: 'cn' | 'global' }) => ipcRenderer.invoke('pob2:set-app-context', context),
  initPobLua: () => ipcRenderer.invoke('pob2:lua-init'),
  calculatePobLua: (payload: import('../src/types/calc.js').SkillCalculationSelection & { xml: string }) => ipcRenderer.invoke('pob2:lua-calculate', payload),
  rankPobLuaSkills: (payload: import('../src/types/calc.js').RankSkillsInput) => ipcRenderer.invoke('pob2:lua-rank-skills', payload),
})

contextBridge.exposeInMainWorld('pob2Market', {
  activate: (bounds: import('../src/types/market.js').MarketBounds) => ipcRenderer.invoke('market:activate', bounds),
  deactivate: () => ipcRenderer.invoke('market:deactivate'),
  setBounds: (bounds: import('../src/types/market.js').MarketBounds) => ipcRenderer.invoke('market:set-bounds', bounds),
  navigate: (command: import('../src/types/market.js').MarketNavigationCommand) => ipcRenderer.invoke('market:navigate', command),
  login: () => ipcRenderer.invoke('market:login'),
  openExternal: () => ipcRenderer.invoke('market:open-external'),
  getState: () => ipcRenderer.invoke('market:get-state') as Promise<import('../src/types/market.js').MarketViewState>,
  listLibrary: (filter: import('../src/types/market.js').EquipmentLibraryFilter) => ipcRenderer.invoke('market:list-library', filter) as Promise<import('../src/types/market.js').EquipmentLibraryEntry[]>,
  getSidebar: () => ipcRenderer.invoke('market:get-sidebar') as Promise<import('../src/types/market.js').EquipmentLibrarySidebarSnapshot>,
  createFolder: (input: import('../src/types/market.js').EquipmentLibraryFolderInput) => ipcRenderer.invoke('market:create-folder', input) as Promise<import('../src/types/market.js').EquipmentLibraryFolder>,
  updateFolder: (patch: import('../src/types/market.js').EquipmentLibraryFolderPatch) => ipcRenderer.invoke('market:update-folder', patch) as Promise<import('../src/types/market.js').EquipmentLibraryFolder>,
  deleteFolder: (id: string) => ipcRenderer.invoke('market:delete-folder', id) as Promise<boolean>,
  selectFolder: (scope: import('../src/types/market.js').LibraryTreeScope, folderId?: string) => ipcRenderer.invoke('market:select-folder', { scope, folderId }) as Promise<import('../src/types/market.js').EquipmentLibrarySidebarSnapshot>,
  saveSearch: (input: import('../src/types/market.js').SavedMarketSearchInput) => ipcRenderer.invoke('market:save-search', input) as Promise<import('../src/types/market.js').SavedMarketSearch>,
  updateSearch: (patch: import('../src/types/market.js').SavedMarketSearchPatch) => ipcRenderer.invoke('market:update-search', patch) as Promise<import('../src/types/market.js').SavedMarketSearch>,
  deleteSearch: (id: string) => ipcRenderer.invoke('market:delete-search', id) as Promise<boolean>,
  openSearch: (id: string) => ipcRenderer.invoke('market:open-search', id) as Promise<void>,
  visitHideout: (entryId: string) => ipcRenderer.invoke('market:visit-hideout', entryId) as Promise<import('../src/types/market.js').MarketVisitHideoutResult>,
  updateLibrary: (patch: import('../src/types/market.js').EquipmentLibraryMetadataPatch) => ipcRenderer.invoke('market:update-library', patch) as Promise<import('../src/types/market.js').EquipmentLibraryEntry>,
  deleteLibrary: (id: string) => ipcRenderer.invoke('market:delete-library', id) as Promise<boolean>,
  removeLibrarySource: (sourceKey: string) => ipcRenderer.invoke('market:remove-library-source', sourceKey),
  openLibrarySource: (entryId: string, sourceKey: string) => ipcRenderer.invoke('market:open-library-source', { entryId, sourceKey }) as Promise<{ kind: import('../src/types/market.js').EquipmentLibrarySourceKind }>,
  saveEquipmentItem: (input: import('../src/types/market.js').EquipmentLibraryItemInput) => ipcRenderer.invoke('market:save-equipment-item', input) as Promise<import('../src/types/market.js').EquipmentLibraryEntry>,
  searchLibrary: (input: import('../src/types/market.js').TradeSearchRequest) => ipcRenderer.invoke('market:search-library', input) as Promise<import('../src/types/market.js').TradeSearchResult>,
  listLeagues: (realm: import('../src/types/market.js').MarketRealm) => ipcRenderer.invoke('market:list-leagues', realm) as Promise<import('../src/types/market.js').TradeLeague[]>,
  onStateChanged: (callback: (state: import('../src/types/market.js').MarketViewState) => void) => {
    const handler = (_event: unknown, state: import('../src/types/market.js').MarketViewState) => callback(state)
    ipcRenderer.on('market:state-changed', handler)
    return () => { ipcRenderer.removeListener('market:state-changed', handler) }
  },
  onLibraryChanged: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on('market:library-changed', handler)
    return () => { ipcRenderer.removeListener('market:library-changed', handler) }
  },
  onSidebarRequest: (callback: (scope: import('../src/types/market.js').LibraryTreeScope) => void) => {
    const handler = (_event: unknown, scope: import('../src/types/market.js').LibraryTreeScope) => callback(scope)
    ipcRenderer.on('market:sidebar-request', handler)
    return () => { ipcRenderer.removeListener('market:sidebar-request', handler) }
  },
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
