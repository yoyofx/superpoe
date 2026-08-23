export {}

export interface UpdateInfo {
  version: string
  currentVersion: string
  channel: 'release' | 'dev'
  downloadUrl: string
  fileName: string
  size?: number
  releaseDate: string
}

export type UpdateCheckStatus = 'available' | 'up-to-date' | 'error'

export interface UpdateCheckResult {
  status: UpdateCheckStatus
  channel: 'release' | 'dev'
  currentVersion: string
  update?: UpdateInfo
  error?: string
}

export interface ProxyDomainsInfo {
  builtin: string[]
  user: string[]
}

declare global {
  interface Window {
    superpoePriceCheck?: {
      open(request: import('@/types/market').PriceCheckOpenRequest): Promise<import('@/types/market').PriceCheckContextState>
      getState?(): Promise<import('@/types/market').PriceCheckContextState>
      search?(leagueId: string, criteria: import('@/types/market').TradePriceCheckCriteria): Promise<import('@/types/market').PriceCheckContextState>
      fetchPage?(page: number): Promise<import('@/types/market').PriceCheckContextState>
      openTradePage?(url: string): Promise<void>
      openInTradeCenter?(url: string): Promise<void>
      visitHideout?(listingId: string): Promise<import('@/types/market').MarketVisitHideoutResult>
      favorite?(listingId: string): Promise<{ ok: true; entryId: string }>
      showDetail?(listingId: string): Promise<void>
      hideDetail?(): Promise<void>
      getDetailState?(): Promise<{ state?: import('@/types/market').PriceCheckContextState; listingId?: string }>
      hide?(): Promise<void>
      setUiScale?(factor: number): Promise<number>
      restartAsAdministrator?(): Promise<{ status: 'started' | 'already-elevated' | 'cancelled' | 'unsupported' }>
      onState?(callback: (state: import('@/types/market').PriceCheckContextState) => void): () => void
      onDetailState?(callback: (value: { state?: import('@/types/market').PriceCheckContextState; listingId?: string }) => void): () => void
    }
    superpoeFindBetter?: {
      open(request: import('@/types/market').PriceCheckOpenRequest): Promise<import('@/types/market').PriceCheckContextState>
      getState?(): Promise<import('@/types/market').PriceCheckContextState>
      search?(leagueId: string, criteria: import('@/types/market').TradePriceCheckCriteria): Promise<import('@/types/market').PriceCheckContextState>
      fetchPage?(page: number): Promise<import('@/types/market').PriceCheckContextState>
      openInTradeCenter?(url: string): Promise<void>
      visitHideout?(listingId: string): Promise<import('@/types/market').MarketVisitHideoutResult>
      favorite?(listingId: string): Promise<{ ok: true; entryId: string }>
      hide?(): Promise<void>
      setUiScale?(factor: number): Promise<number>
      onState?(callback: (state: import('@/types/market').PriceCheckContextState) => void): () => void
    }
    pob2Desktop?: {
      getSystemLocale(): string
      importWeGame(url: string): Promise<{ code: string; sourceUrl: string }>
      importPoeNinja(url: string): Promise<{ code: string; sourceUrl: string; suggestedName: string }>
      openBuildFile(): Promise<{ canceled: boolean; filePath?: string; content?: string }>
      saveBuildFileCopy(payload: { content: string; fileName: string }): Promise<{ canceled: boolean; filePath?: string }>
      captureAnalysisImage?(payload: { x: number; y: number; width: number; height: number; scale?: number }): Promise<{ dataUrl: string }>
      saveAnalysisImage?(payload: { dataUrl: string; fileName: string }): Promise<{ canceled: boolean; filePath?: string }>
      copyAnalysisImage?(dataUrl: string): Promise<{ copied: boolean }>
      openBackupFile(): Promise<{ canceled: boolean; filePath?: string; content?: string }>
      saveBackupFile(payload: { content: string; fileName: string }): Promise<{ canceled: boolean; filePath?: string }>
      collectBackupData(): Promise<import('@/engine/superPoeBackup').SuperPoeBackupMainData>
      restoreBackupData(main: import('@/engine/superPoeBackup').SuperPoeBackupMainData): Promise<void>
      registerBuildFileAssociation(): Promise<{ registered: boolean; isDefault: boolean; settingsOpened: boolean; reason?: 'unsupported-platform' }>
      onOpenBuildFile(callback: (result: { canceled: boolean; filePath?: string; content?: string; error?: string }) => void): () => void
      saveGameBuild(payload: { content: string; fileName: string }): Promise<{ canceled: boolean; filePath?: string }>
      installGameBuild(payload: { content: string; fileName: string }): Promise<{ canceled: false; filePath: string }>
      setUiScale(factor: number): Promise<number>
      restartAsAdministrator(): Promise<{ status: 'started' | 'already-elevated' | 'cancelled' | 'unsupported' }>
      setAppContext(context: { defaultRealm: import('@/types/tree').BuildRealm; language: import('@/i18n/translationLoader').Language; priceCheckEnabled: boolean; priceCheckHotkey: string }): Promise<void>
      initPobLua(): Promise<{
        available: boolean
        backend: 'luajit' | 'wasmoon'
        runtime?: string
        error?: string
      }>
      calculatePobLua(payload: import('@/types/calc').SkillCalculationSelection & { xml: string }): Promise<import('@/types/calc').CalcApiResponse>
      calculatePobLuaBatch(payload: import('@/types/calc').AttributeProbeBatchInput): Promise<import('@/types/calc').AttributeProbeBatchResponse>
      rankPobLuaSkills(payload: import('@/types/calc').RankSkillsInput): Promise<import('@/types/calc').SkillDpsRankResponse>
      comparePobLuaEquipment(payload: import('@/equipmentDifference/types').EquipmentDifferenceRequest & { contextKey: string }): Promise<import('@/equipmentDifference/types').EquipmentDifferenceResult>
      openEquipmentTryOn(payload: import('@/types/tryOn').EquipmentTryOnOpenRequest): Promise<void>
    }
    pob2TryOn?: {
      close(): Promise<void>
      getPayload(): Promise<import('@/types/tryOn').EquipmentTryOnOpenRequest | null>
      onPayload(callback: (payload: import('@/types/tryOn').EquipmentTryOnOpenRequest) => void): () => void
    }
    pob2Market?: {
      activate(bounds: import('@/types/market').MarketBounds): Promise<import('@/types/market').MarketViewState>
      deactivate(): Promise<void>
      setBounds(bounds: import('@/types/market').MarketBounds): Promise<void>
      navigate(command: import('@/types/market').MarketNavigationCommand): Promise<void>
      login(): Promise<void>
      openExternal(): Promise<void>
      getState(): Promise<import('@/types/market').MarketViewState>
      listLibrary(filter?: import('@/types/market').EquipmentLibraryFilter): Promise<import('@/types/market').EquipmentLibraryEntry[]>
      getSidebar(): Promise<import('@/types/market').EquipmentLibrarySidebarSnapshot>
      createFolder(input: import('@/types/market').EquipmentLibraryFolderInput): Promise<import('@/types/market').EquipmentLibraryFolder>
      updateFolder(patch: import('@/types/market').EquipmentLibraryFolderPatch): Promise<import('@/types/market').EquipmentLibraryFolder>
      deleteFolder(id: string): Promise<boolean>
      selectFolder(scope: import('@/types/market').LibraryTreeScope, folderId?: string): Promise<import('@/types/market').EquipmentLibrarySidebarSnapshot>
      saveSearch(input: import('@/types/market').SavedMarketSearchInput): Promise<import('@/types/market').SavedMarketSearch>
      updateSearch(patch: import('@/types/market').SavedMarketSearchPatch): Promise<import('@/types/market').SavedMarketSearch>
      replaceSearchFromCurrent(id: string): Promise<import('@/types/market').SavedMarketSearch>
      recoverSearch(id: string): Promise<import('@/types/market').SavedMarketSearch>
      deleteSearch(id: string): Promise<boolean>
      openSearch(id: string): Promise<void>
      visitHideout(entryId: string): Promise<import('@/types/market').MarketVisitHideoutResult>
      updateLibrary(patch: import('@/types/market').EquipmentLibraryMetadataPatch): Promise<import('@/types/market').EquipmentLibraryEntry>
      moveLibrary(input: import('@/types/market').EquipmentLibraryMoveInput): Promise<import('@/types/market').EquipmentLibraryMoveResult>
      deleteLibrary(id: string): Promise<boolean>
      deleteLibraries(ids: string[]): Promise<number>
      removeLibrarySource(sourceKey: string): Promise<{ removedEntryId?: string; entry?: import('@/types/market').EquipmentLibraryEntry }>
      openLibrarySource(entryId: string, sourceKey: string): Promise<{ kind: import('@/types/market').EquipmentLibrarySourceKind }>
      saveEquipmentItem(input: import('@/types/market').EquipmentLibraryItemInput): Promise<import('@/types/market').EquipmentLibraryEntry>
      searchEquipmentItem(input: import('@/types/market').EquipmentTradeSearchRequest): Promise<import('@/types/market').TradeSearchResult>
      searchLibrary(input: import('@/types/market').TradeSearchRequest): Promise<import('@/types/market').TradeSearchResult>
      preparePriceCheck(input: import('@/types/market').TradePriceCheckPrepareRequest): Promise<import('@/types/market').TradePriceCheckDraft>
      runPriceCheck(input: import('@/types/market').TradePriceCheckSearchRequest): Promise<import('@/types/market').TradeSearchResult>
      listLeagues(realm: import('@/types/market').MarketRealm): Promise<import('@/types/market').TradeLeague[]>
      getMonitoring(): Promise<import('@/types/market').MarketMonitoringSnapshot>
      createMonitorTarget(searchId: string, priority?: import('@/types/market').MonitorTaskPriority): Promise<import('@/types/market').PurchaseTarget>
      setMonitorTarget(targetId: string, status: import('@/types/market').MonitorTaskStatus, priority?: import('@/types/market').MonitorTaskPriority): Promise<import('@/types/market').PurchaseTarget>
      setMonitorPriority(targetId: string, priority: import('@/types/market').MonitorTaskPriority): Promise<import('@/types/market').PurchaseTarget>
      deleteMonitorTarget(targetId: string): Promise<boolean>
      refreshMonitorTarget(targetId: string): Promise<import('@/types/market').PurchaseTarget>
      setMonitoringPaused(paused: boolean): Promise<import('@/types/market').MarketMonitoringSnapshot>
      updateMonitorSettings(patch: Partial<import('@/types/market').MarketMonitorSettings>): Promise<import('@/types/market').MarketMonitoringSnapshot>
      previewMonitorSound(): Promise<void>
      previewOpportunityOverlay(): Promise<void>
      attemptMonitorOpportunity(id: string): Promise<import('@/types/market').MarketOpportunityAttemptResult>
      onStateChanged(callback: (state: import('@/types/market').MarketViewState) => void): () => void
      onLibraryChanged(callback: () => void): () => void
      onSidebarRequest(callback: (scope: import('@/types/market').LibraryTreeScope) => void): () => void
      onTryOnRequest(callback: (entry: import('@/types/market').EquipmentLibraryEntry) => void): () => void
      onMonitoringChanged(callback: (snapshot: import('@/types/market').MarketMonitoringSnapshot) => void): () => void
      onOpenMonitoring(callback: () => void): () => void
      onOpenTradeCenter(callback: () => void): () => void
    }
    pob2CurrencyMarket?: {
      get(forceRefresh?: boolean): Promise<import('@/types/currencyMarket').CurrencyMarketState>
      onChanged(callback: (state: import('@/types/currencyMarket').CurrencyMarketState) => void): () => void
    }
    pob2Updater?: {
      check(channel?: 'release' | 'dev'): Promise<UpdateCheckResult>
      download(info: UpdateInfo, options?: { forceInstall?: boolean }): Promise<void>
      ready(): void
      setConfig(config: { channel?: string; intervalMinutes?: number }): void
      setProxyDomains(domains: string[]): void
      getProxyDomains(): Promise<ProxyDomainsInfo>
      restartTimer(): void
      onUpdateAvailable(callback: (info: UpdateInfo) => void): () => void
      onDownloadProgress(callback: (percent: number) => void): () => void
      onDownloadComplete(callback: () => void): () => void
      onDownloadError(callback: (message: string) => void): () => void
    }
  }
}
