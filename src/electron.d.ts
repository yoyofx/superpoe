export {}

export interface UpdateInfo {
  version: string
  currentVersion: string
  channel: 'release' | 'dev'
  downloadUrl: string
  fileName: string
  releaseDate: string
}

export interface ProxyDomainsInfo {
  builtin: string[]
  user: string[]
}

declare global {
  interface Window {
    pob2Desktop?: {
      importWeGame(url: string): Promise<{ code: string; sourceUrl: string }>
    }
    pob2Updater?: {
      check(): Promise<UpdateInfo | null>
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
