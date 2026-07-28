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
      initPobLua(): Promise<{
        available: boolean
        backend: 'luajit' | 'wasmoon'
        runtime?: string
        error?: string
      }>
      calculatePobLua(payload: import('@/types/calc').SkillCalculationSelection & { xml: string }): Promise<import('@/types/calc').CalcApiResponse>
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
