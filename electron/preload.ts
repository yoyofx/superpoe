import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('pob2Desktop', {
  getSystemLocale: () => ipcRenderer.sendSync('pob2:get-system-locale') as string,
  importWeGame: (url: string) => ipcRenderer.invoke('pob2:import-wegame', url),
  importPoeNinja: (url: string) => ipcRenderer.invoke('pob2:import-poe-ninja', url),
  openBuildFile: () => ipcRenderer.invoke('pob2:open-build-file'),
  saveBuildFileCopy: (payload: { content: string; fileName: string }) => ipcRenderer.invoke('pob2:save-build-file-copy', payload),
  captureAnalysisImage: (payload: { x: number; y: number; width: number; height: number; scale?: number }) => ipcRenderer.invoke('pob2:capture-analysis-image', payload),
  saveAnalysisImage: (payload: { dataUrl: string; fileName: string }) => ipcRenderer.invoke('pob2:save-analysis-image', payload),
  copyAnalysisImage: (dataUrl: string) => ipcRenderer.invoke('pob2:copy-analysis-image', dataUrl),
  openBackupFile: () => ipcRenderer.invoke('pob2:open-backup-file'),
  saveBackupFile: (payload: { content: string; fileName: string }) => ipcRenderer.invoke('pob2:save-backup-file', payload),
  collectBackupData: () => ipcRenderer.invoke('pob2:collect-backup-data'),
  restoreBackupData: (main: import('../src/engine/superPoeBackup.js').SuperPoeBackupMainData) => ipcRenderer.invoke('pob2:restore-backup-data', main),
  registerBuildFileAssociation: () => ipcRenderer.invoke('pob2:register-build-file-association'),
  onOpenBuildFile: (callback: (result: { canceled: boolean; filePath?: string; content?: string; error?: string }) => void) => {
    const handler = (_event: unknown, result: { canceled: boolean; filePath?: string; content?: string; error?: string }) => callback(result)
    ipcRenderer.on('pob2:open-build-file', handler)
    return () => { ipcRenderer.removeListener('pob2:open-build-file', handler) }
  },
  saveGameBuild: (payload: { content: string; fileName: string }) => ipcRenderer.invoke('pob2:save-game-build', payload),
  installGameBuild: (payload: { content: string; fileName: string }) => ipcRenderer.invoke('pob2:install-game-build', payload),
  setUiScale: (factor: number) => ipcRenderer.invoke('pob2:set-ui-scale', factor),
  restartAsAdministrator: () => ipcRenderer.invoke('pob2:restart-as-admin') as Promise<{ status: 'started' | 'already-elevated' | 'cancelled' | 'unsupported' }>,
  setAppContext: (context: { defaultRealm: 'cn' | 'global'; language: 'en' | 'zh-rCN' | 'zh-rTW' | 'ko-KR'; priceCheckEnabled: boolean; priceCheckHotkey: string }) => ipcRenderer.invoke('pob2:set-app-context', context),
  initPobLua: () => ipcRenderer.invoke('pob2:lua-init'),
  calculatePobLua: (payload: import('../src/types/calc.js').SkillCalculationSelection & { xml: string }) => ipcRenderer.invoke('pob2:lua-calculate', payload),
  calculatePobLuaBatch: (payload: import('../src/types/calc.js').AttributeProbeBatchInput) => ipcRenderer.invoke('pob2:lua-calculate-batch', payload),
  rankPobLuaSkills: (payload: import('../src/types/calc.js').RankSkillsInput) => ipcRenderer.invoke('pob2:lua-rank-skills', payload),
  comparePobLuaEquipment: (payload: import('../src/equipmentDifference/types.js').EquipmentDifferenceRequest & { contextKey: string }) => ipcRenderer.invoke('pob2:lua-compare-equipment', payload),
  openEquipmentTryOn: (payload: import('../src/types/tryOn.js').EquipmentTryOnOpenRequest) => ipcRenderer.invoke('equipment-try-on:open', payload),
})

contextBridge.exposeInMainWorld('superpoePriceCheck', {
  open: (request: import('../src/types/market.js').PriceCheckOpenRequest) => ipcRenderer.invoke('price-check:open', request),
})

contextBridge.exposeInMainWorld('superpoeFindBetter', {
  open: (request: import('../src/types/market.js').PriceCheckOpenRequest) => ipcRenderer.invoke('find-better:open', request),
})

contextBridge.exposeInMainWorld('pob2TryOn', {
  close: () => ipcRenderer.invoke('equipment-try-on:close'),
  getPayload: () => ipcRenderer.invoke('equipment-try-on:get-payload') as Promise<import('../src/types/tryOn.js').EquipmentTryOnOpenRequest | null>,
  onPayload: (callback: (payload: import('../src/types/tryOn.js').EquipmentTryOnOpenRequest) => void) => {
    const handler = (_event: unknown, payload: import('../src/types/tryOn.js').EquipmentTryOnOpenRequest) => callback(payload)
    ipcRenderer.on('equipment-try-on:payload', handler)
    return () => { ipcRenderer.removeListener('equipment-try-on:payload', handler) }
  },
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
  replaceSearchFromCurrent: (id: string) => ipcRenderer.invoke('market:replace-search-current', id) as Promise<import('../src/types/market.js').SavedMarketSearch>,
  recoverSearch: (id: string) => ipcRenderer.invoke('market:recover-search', id) as Promise<import('../src/types/market.js').SavedMarketSearch>,
  deleteSearch: (id: string) => ipcRenderer.invoke('market:delete-search', id) as Promise<boolean>,
  openSearch: (id: string) => ipcRenderer.invoke('market:open-search', id) as Promise<void>,
  visitHideout: (entryId: string) => ipcRenderer.invoke('market:visit-hideout', entryId) as Promise<import('../src/types/market.js').MarketVisitHideoutResult>,
  updateLibrary: (patch: import('../src/types/market.js').EquipmentLibraryMetadataPatch) => ipcRenderer.invoke('market:update-library', patch) as Promise<import('../src/types/market.js').EquipmentLibraryEntry>,
  moveLibrary: (input: import('../src/types/market.js').EquipmentLibraryMoveInput) => ipcRenderer.invoke('market:move-library', input) as Promise<import('../src/types/market.js').EquipmentLibraryMoveResult>,
  deleteLibrary: (id: string) => ipcRenderer.invoke('market:delete-library', id) as Promise<boolean>,
  deleteLibraries: (ids: string[]) => ipcRenderer.invoke('market:delete-libraries', ids) as Promise<number>,
  removeLibrarySource: (sourceKey: string) => ipcRenderer.invoke('market:remove-library-source', sourceKey),
  openLibrarySource: (entryId: string, sourceKey: string) => ipcRenderer.invoke('market:open-library-source', { entryId, sourceKey }) as Promise<{ kind: import('../src/types/market.js').EquipmentLibrarySourceKind }>,
  saveEquipmentItem: (input: import('../src/types/market.js').EquipmentLibraryItemInput) => ipcRenderer.invoke('market:save-equipment-item', input) as Promise<import('../src/types/market.js').EquipmentLibraryEntry>,
  searchEquipmentItem: (input: import('../src/types/market.js').EquipmentTradeSearchRequest) => ipcRenderer.invoke('market:search-equipment', input) as Promise<import('../src/types/market.js').TradeSearchResult>,
  searchLibrary: (input: import('../src/types/market.js').TradeSearchRequest) => ipcRenderer.invoke('market:search-library', input) as Promise<import('../src/types/market.js').TradeSearchResult>,
  preparePriceCheck: (input: import('../src/types/market.js').TradePriceCheckPrepareRequest) => ipcRenderer.invoke('market:prepare-price-check', input) as Promise<import('../src/types/market.js').TradePriceCheckDraft>,
  runPriceCheck: (input: import('../src/types/market.js').TradePriceCheckSearchRequest) => ipcRenderer.invoke('market:run-price-check', input) as Promise<import('../src/types/market.js').TradeSearchResult>,
  listLeagues: (realm: import('../src/types/market.js').MarketRealm) => ipcRenderer.invoke('market:list-leagues', realm) as Promise<import('../src/types/market.js').TradeLeague[]>,
  getMonitoring: () => ipcRenderer.invoke('market:get-monitoring') as Promise<import('../src/types/market.js').MarketMonitoringSnapshot>,
  createMonitorTarget: (searchId: string, priority?: import('../src/types/market.js').MonitorTaskPriority) => ipcRenderer.invoke('market:create-monitor-target', { searchId, priority }) as Promise<import('../src/types/market.js').PurchaseTarget>,
  setMonitorTarget: (targetId: string, status: import('../src/types/market.js').MonitorTaskStatus, priority?: import('../src/types/market.js').MonitorTaskPriority) => ipcRenderer.invoke('market:set-monitor-target', { searchId: targetId, status, priority }) as Promise<import('../src/types/market.js').PurchaseTarget>,
  setMonitorPriority: (targetId: string, priority: import('../src/types/market.js').MonitorTaskPriority) => ipcRenderer.invoke('market:set-monitor-priority', { searchId: targetId, priority }) as Promise<import('../src/types/market.js').PurchaseTarget>,
  deleteMonitorTarget: (targetId: string) => ipcRenderer.invoke('market:delete-monitor-target', targetId) as Promise<boolean>,
  refreshMonitorTarget: (targetId: string) => ipcRenderer.invoke('market:refresh-monitor-target', targetId) as Promise<import('../src/types/market.js').PurchaseTarget>,
  setMonitoringPaused: (paused: boolean) => ipcRenderer.invoke('market:set-monitor-paused', paused) as Promise<import('../src/types/market.js').MarketMonitoringSnapshot>,
  updateMonitorSettings: (patch: Partial<import('../src/types/market.js').MarketMonitorSettings>) => ipcRenderer.invoke('market:update-monitor-settings', patch) as Promise<import('../src/types/market.js').MarketMonitoringSnapshot>,
  previewMonitorSound: () => ipcRenderer.invoke('market:preview-monitor-sound') as Promise<void>,
  previewOpportunityOverlay: () => ipcRenderer.invoke('market:preview-opportunity-overlay') as Promise<void>,
  attemptMonitorOpportunity: (id: string) => ipcRenderer.invoke('market:attempt-opportunity', id) as Promise<import('../src/types/market.js').MarketOpportunityAttemptResult>,
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
  onTryOnRequest: (callback: (entry: import('../src/types/market.js').EquipmentLibraryEntry) => void) => {
    const handler = (_event: unknown, payload: { entry?: import('../src/types/market.js').EquipmentLibraryEntry }) => {
      if (payload?.entry) callback(payload.entry)
    }
    ipcRenderer.on('market:try-on-request', handler)
    return () => { ipcRenderer.removeListener('market:try-on-request', handler) }
  },
  onMonitoringChanged: (callback: (snapshot: import('../src/types/market.js').MarketMonitoringSnapshot) => void) => {
    const handler = (_event: unknown, snapshot: import('../src/types/market.js').MarketMonitoringSnapshot) => callback(snapshot)
    ipcRenderer.on('market:monitoring-changed', handler)
    return () => { ipcRenderer.removeListener('market:monitoring-changed', handler) }
  },
  onOpenMonitoring: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on('market:open-monitoring', handler)
    return () => { ipcRenderer.removeListener('market:open-monitoring', handler) }
  },
  onOpenTradeCenter: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on('market:open-trade-center', handler)
    return () => { ipcRenderer.removeListener('market:open-trade-center', handler) }
  },
})

contextBridge.exposeInMainWorld('pob2CurrencyMarket', {
  get: (forceRefresh = false) => ipcRenderer.invoke('currency-market:get', forceRefresh) as Promise<import('../src/types/currencyMarket.js').CurrencyMarketState>,
  onChanged: (callback: (state: import('../src/types/currencyMarket.js').CurrencyMarketState) => void) => {
    const handler = (_event: unknown, state: import('../src/types/currencyMarket.js').CurrencyMarketState) => callback(state)
    ipcRenderer.on('currency-market:changed', handler)
    return () => { ipcRenderer.removeListener('currency-market:changed', handler) }
  },
})

contextBridge.exposeInMainWorld('pob2Updater', {
  check: (channel?: string) => ipcRenderer.invoke('updater:check', channel),
  download: (info: unknown, options?: { forceInstall?: boolean }) => ipcRenderer.invoke('updater:download', info, options),
  ready: () => ipcRenderer.send('updater:renderer-ready'),
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
