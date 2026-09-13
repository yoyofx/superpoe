export type ReferenceSiteId = string

export interface ReferenceSiteConfig {
  id: ReferenceSiteId
  name: string
  url: string
  builtIn?: boolean
}

export type ReferenceNavigationCommand = 'home' | 'back' | 'forward' | 'reload' | 'stop'

export type ReferenceConnectionStatus = 'idle' | 'loading' | 'connected' | 'error'

export interface ReferenceViewState {
  site: ReferenceSiteId
  url: string
  title: string
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
  connectionStatus: ReferenceConnectionStatus
  error?: string
}

export interface ReferencePoeNinjaImportResult {
  code: string
  sourceUrl: string
  suggestedName: string
}

export type ReferencePoeNinjaImportEvent =
  | { status: 'loading'; sourceUrl: string }
  | { status: 'success'; result: ReferencePoeNinjaImportResult }
  | { status: 'error'; sourceUrl: string; error: string }
