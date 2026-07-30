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
      updateLibrary(patch: import('@/types/market').EquipmentLibraryMetadataPatch): Promise<import('@/types/market').EquipmentLibraryEntry>
      deleteLibrary(id: string): Promise<boolean>
      removeLibrarySource(sourceKey: string): Promise<{ removedEntryId?: string; entry?: import('@/types/market').EquipmentLibraryEntry }>
      openLibrarySource(entryId: string, sourceKey: string): Promise<{ kind: import('@/types/market').EquipmentLibrarySourceKind }>
      saveEquipmentItem(input: import('@/types/market').EquipmentLibraryItemInput): Promise<import('@/types/market').EquipmentLibraryEntry>
      searchLibrary(input: import('@/types/market').TradeSearchRequest): Promise<import('@/types/market').TradeSearchResult>
      listLeagues(realm: import('@/types/market').MarketRealm): Promise<import('@/types/market').TradeLeague[]>
      onStateChanged(callback: (state: import('@/types/market').MarketViewState) => void): () => void
      onLibraryChanged(callback: () => void): () => void
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
