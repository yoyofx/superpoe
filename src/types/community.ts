export type CommunityNavigationCommand = 'home' | 'back' | 'forward' | 'reload' | 'stop'

export type CommunityConnectionStatus = 'idle' | 'loading' | 'connected' | 'error'

export interface CommunityViewState {
  url: string
  title: string
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
  connectionStatus: CommunityConnectionStatus
  error?: string
}
