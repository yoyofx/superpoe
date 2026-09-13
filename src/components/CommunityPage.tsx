import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, ExternalLink, Globe2, Headphones, House, LoaderCircle, RefreshCw } from 'lucide-react'

import { AccountStatus } from '@/components/AuthGate'
import { EmbeddedBrowserNavigation } from '@/components/EmbeddedBrowserNavigation'
import { uiText } from '@/i18n/uiLocale'
import { useTranslation } from '@/i18n/useTranslation'
import type { CommunityNavigationCommand, CommunityViewState } from '@/types/community'
import type { MarketBounds } from '@/types/market'

interface CommunityPageProps {
  onCenter: () => void
  onLibrary: () => void
  onTradeCenter: () => void
  onCommunity: () => void
  onReference: () => void
  onAbout: () => void
  onBack: () => void
}

const EMPTY_STATE: CommunityViewState = {
  url: '',
  title: '',
  loading: false,
  canGoBack: false,
  canGoForward: false,
  connectionStatus: 'idle',
}

function getBounds(element: HTMLElement): MarketBounds | null {
  const rect = element.getBoundingClientRect()
  if (rect.width < 1 || rect.height < 1) return null
  return {
    x: Math.round(rect.left),
    y: Math.round(rect.top),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  }
}

function displayOrigin(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return 'www.kookapp.cn'
  }
}

export function CommunityPage({ onCenter, onLibrary, onTradeCenter, onCommunity, onReference, onAbout, onBack }: CommunityPageProps) {
  const { lang } = useTranslation()
  const l = (en: string, zhCN: string, zhTW: string, koKR: string) => uiText(lang, en, zhCN, zhTW, koKR)
  const hostRef = useRef<HTMLDivElement>(null)
  const activatedRef = useRef(false)
  const [state, setState] = useState<CommunityViewState>(EMPTY_STATE)
  const [bridgeError, setBridgeError] = useState<string | null>(null)
  const bridge = window.pob2Community

  const applyBounds = useCallback(async (activate: boolean) => {
    if (!bridge || !hostRef.current) return
    const bounds = getBounds(hostRef.current)
    if (!bounds) return
    try {
      if (activate || !activatedRef.current) {
        setState(await bridge.activate(bounds))
        activatedRef.current = true
      } else {
        await bridge.setBounds(bounds)
      }
      setBridgeError(null)
    } catch (error: unknown) {
      setBridgeError(error instanceof Error ? error.message : String(error))
    }
  }, [bridge])

  useEffect(() => {
    if (!bridge) return
    const offState = bridge.onStateChanged((nextState) => setState(nextState))
    void applyBounds(true)
    return () => {
      offState()
      activatedRef.current = false
      void bridge.deactivate()
    }
  }, [applyBounds, bridge])

  useEffect(() => {
    if (!bridge || !hostRef.current) return
    const observer = new ResizeObserver(() => void applyBounds(false))
    observer.observe(hostRef.current)
    const update = () => void applyBounds(false)
    window.addEventListener('resize', update)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', update)
    }
  }, [applyBounds, bridge])

  const navigate = useCallback((command: CommunityNavigationCommand) => {
    void bridge?.navigate(command).catch((error: unknown) => {
      setBridgeError(error instanceof Error ? error.message : String(error))
    })
  }, [bridge])

  const leaveCommunity = useCallback((next: () => void) => {
    if (!bridge) {
      next()
      return
    }
    void bridge.deactivate().catch(() => {}).finally(next)
  }, [bridge])

  useEffect(() => {
    if (!bridge) return
    return bridge.onEscape(() => leaveCommunity(onBack))
  }, [bridge, leaveCommunity, onBack])

  const statusLabel = state.connectionStatus === 'connected'
    ? l('Connected', '已连接', '已連線', '연결됨')
    : state.connectionStatus === 'loading'
      ? l('Loading', '正在加载', '正在載入', '로드 중')
      : state.connectionStatus === 'error'
        ? l('Connection error', '连接失败', '連線失敗', '연결 오류')
        : l('Not connected', '未连接', '未連線', '연결 안 됨')

  return <div className="build-center embedded-browser-page community-page">
    <header className="embedded-browser-toolbar community-toolbar">
      <EmbeddedBrowserNavigation active="community" onBack={() => leaveCommunity(onBack)} onCenter={() => leaveCommunity(onCenter)} onLibrary={() => leaveCommunity(onLibrary)} onTradeCenter={() => leaveCommunity(onTradeCenter)} onCommunity={onCommunity} onReference={() => leaveCommunity(onReference)} onAbout={() => leaveCommunity(onAbout)} />
      <span className="community-toolbar-divider" aria-hidden="true" />
      <div className="community-navigation" aria-label={l('Web navigation', '网页导航', '網頁導覽', '웹 탐색')}>
        <button className="icon-command compact" disabled={!bridge || !state.canGoBack} onClick={() => navigate('back')} title={l('Back', '后退', '上一頁', '뒤로')} aria-label={l('Back', '后退', '上一頁', '뒤로')}><ChevronLeft /></button>
        <button className="icon-command compact" disabled={!bridge || !state.canGoForward} onClick={() => navigate('forward')} title={l('Forward', '前进', '下一頁', '앞으로')} aria-label={l('Forward', '前进', '下一頁', '앞으로')}><ChevronRight /></button>
        <button className="icon-command compact" disabled={!bridge} onClick={() => navigate('home')} title={l('Community home', '社区首页', '社群首頁', '커뮤니티 홈')} aria-label={l('Community home', '社区首页', '社群首頁', '커뮤니티 홈')}><House /></button>
        <button className="icon-command compact" disabled={!bridge} onClick={() => navigate('reload')} title={l('Reload', '刷新', '重新載入', '새로고침')} aria-label={l('Reload', '刷新', '重新載入', '새로고침')}><RefreshCw /></button>
      </div>
      <div className="community-location" title={state.title || state.url || 'www.kookapp.cn'}>
        {state.loading ? <LoaderCircle className="community-loading-icon" /> : <Globe2 />}
        <span>{l('KOOK community', 'KOOK 社区', 'KOOK 社群', 'KOOK 커뮤니티')}</span>
        <small>{state.title || (state.url ? displayOrigin(state.url) : l('Persistent session', '会话会在切换页面后保留', '工作階段會在切換頁面後保留', '세션은 페이지를 전환해도 유지됩니다'))}</small>
      </div>
      <span className={`community-session ${state.connectionStatus}`}><i />{statusLabel}</span>
      <button className="icon-command compact" disabled={!bridge || !state.url} onClick={() => void bridge?.openExternal()} title={l('Open in browser', '在浏览器中打开', '在瀏覽器中開啟', '브라우저에서 열기')} aria-label={l('Open in browser', '在浏览器中打开', '在瀏覽器中開啟', '브라우저에서 열기')}><ExternalLink /></button>
      <AccountStatus />
    </header>
    <main className="embedded-browser-content" aria-label={l('KOOK voice community', 'KOOK 语音社区', 'KOOK 語音社群', 'KOOK 음성 커뮤니티')}>
      <div className="community-browser-host" ref={hostRef}>
        {!bridge && <div className="community-browser-fallback"><Headphones /><strong>{l('Community view is available in the desktop app.', '语音社区仅在桌面版应用中可用。', '語音社群僅限桌面版應用程式使用。', '음성 커뮤니티는 데스크톱 앱에서 사용할 수 있습니다.')}</strong></div>}
        {bridgeError && <div className="community-browser-fallback community-browser-error"><strong>{l('Community view unavailable', '语音社区暂时不可用', '語音社群暫時無法使用', '커뮤니티를 사용할 수 없습니다')}</strong><span>{bridgeError}</span><button className="secondary-command" onClick={() => void applyBounds(true)}><RefreshCw />{l('Try again', '重试', '重試', '다시 시도')}</button></div>}
      </div>
    </main>
  </div>
}
