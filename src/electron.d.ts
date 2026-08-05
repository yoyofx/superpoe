export {}

export interface UpdateInfo {
  version: string
  currentVersion: string
  channel: 'release' | 'dev'
  downloadUrl: string
  fileName: string
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
    pob2Desktop?: {
      importWeGame(url: string): Promise<{ code: string; sourceUrl: string }>
      importPoeNinja(url: string): Promise<{ code: string; sourceUrl: string; suggestedName: string }>
      openBuildFile(): Promise<{ canceled: boolean; filePath?: string; content?: string }>
      saveBuildFileCopy(payload: { content: string; fileName: string }): Promise<{ canceled: boolean; filePath?: string }>
      registerBuildFileAssociation(): Promise<{ registered: boolean; isDefault: boolean; settingsOpened: boolean; reason?: 'unsupported-platform' }>
      onOpenBuildFile(callback: (result: { canceled: boolean; filePath?: string; content?: string; error?: string }) => void): () => void
      saveGameBuild(payload: { content: string; fileName: string }): Promise<{ canceled: boolean; filePath?: string }>
      installGameBuild(payload: { content: string; fileName: string }): Promise<{ canceled: false; filePath: string }>
      setUiScale(factor: number): Promise<number>
      setAppContext(context: { defaultRealm: import('@/types/tree').BuildRealm }): Promise<void>
      initPobLua(): Promise<{
        available: boolean
        backend: 'luajit' | 'wasmoon'
        runtime?: string
        error?: string
      }>
      calculatePobLua(payload: import('@/types/calc').SkillCalculationSelection & { xml: string }): Promise<import('@/types/calc').CalcApiResponse>
      rankPobLuaSkills(payload: import('@/types/calc').RankSkillsInput): Promise<import('@/types/calc').SkillDpsRankResponse>
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
      deleteLibrary(id: string): Promise<boolean>
      deleteLibraries(ids: string[]): Promise<number>
      removeLibrarySource(sourceKey: string): Promise<{ removedEntryId?: string; entry?: import('@/types/market').EquipmentLibraryEntry }>
      openLibrarySource(entryId: string, sourceKey: string): Promise<{ kind: import('@/types/market').EquipmentLibrarySourceKind }>
      saveEquipmentItem(input: import('@/types/market').EquipmentLibraryItemInput): Promise<import('@/types/market').EquipmentLibraryEntry>
      searchEquipmentItem(input: import('@/types/market').EquipmentTradeSearchRequest): Promise<import('@/types/market').TradeSearchResult>
      searchLibrary(input: import('@/types/market').TradeSearchRequest): Promise<import('@/types/market').TradeSearchResult>
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
      onMonitoringChanged(callback: (snapshot: import('@/types/market').MarketMonitoringSnapshot) => void): () => void
      onOpenMonitoring(callback: () => void): () => void
    }
    pob2CurrencyMarket?: {
      get(forceRefresh?: boolean): Promise<import('@/types/currencyMarket').CurrencyMarketState>
      onChanged(callback: (state: import('@/types/currencyMarket').CurrencyMarketState) => void): () => void
    }
    pob2Updater?: {
      check(channel?: 'release' | 'dev'): Promise<UpdateCheckResult>
      download(info: UpdateInfo): Promise<void>
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
