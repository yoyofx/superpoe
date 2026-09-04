import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, ExternalLink, Globe2, Headphones, House, LoaderCircle, RefreshCw } from 'lucide-react'

import { AccountStatus } from '@/components/AuthGate'
import { BuildCenterNav } from '@/components/BuildCenter'
import { uiText } from '@/i18n/uiLocale'
import { useTranslation } from '@/i18n/useTranslation'
import type { CommunityNavigationCommand, CommunityViewState } from '@/types/community'
import type { MarketBounds } from '@/types/market'

interface CommunityPageProps {
  onCenter: () => void
  onLibrary: () => void
  onTradeCenter: () => void
  onCommunity: () => void
  onUtilities: () => void
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

export function CommunityPage({ onCenter, onLibrary, onTradeCenter, onCommunity, onUtilities, onAbout, onBack }: CommunityPageProps) {
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

  return <div className="build-center community-page">
    <BuildCenterNav active="community" onCenter={() => leaveCommunity(onCenter)} onLibrary={() => leaveCommunity(onLibrary)} onTradeCenter={() => leaveCommunity(onTradeCenter)} onCommunity={onCommunity} onUtilities={() => leaveCommunity(onUtilities)} onAbout={() => leaveCommunity(onAbout)} />
    <header className="center-app-bar community-page-header">
      <div className="center-actions community-page-actions"><AccountStatus /></div>
      <div className="build-center-page-heading">
        <Headphones aria-hidden="true" />
        <div>
          <span>{l('COMMUNITY', '社区', '社群', '커뮤니티')}</span>
          <h1>{l('Voice community', '语音社区', '語音社群', '음성 커뮤니티')}</h1>
          <p className="community-page-hint">{l('Signing in again may redirect KOOK to another page. Press Voice Community to return here.', '重新登录可能会重定向 KOOK 页面地址，按下“语音社区”按钮可以进入语音社区。', '重新登入可能會重新導向 KOOK 頁面，按下「語音社群」按鈕即可返回這裡。', '다시 로그인하면 KOOK 페이지가 다른 주소로 이동할 수 있습니다. 음성 커뮤니티를 누르면 이곳으로 돌아옵니다.')}</p>
        </div>
      </div>
    </header>
    <main className="community-page-content">
      <section className="community-workspace" aria-label={l('KOOK voice community', 'KOOK 语音社区', 'KOOK 語音社群', 'KOOK 음성 커뮤니티')}>
        <header className="community-toolbar">
          <button className="secondary-command community-back-command" onClick={() => leaveCommunity(onBack)}><ArrowLeft />{l('Back', '返回', '返回', '뒤로')}</button>
          <span className="community-toolbar-divider" aria-hidden="true" />
          <button className="secondary-command community-home-command" disabled={!bridge} onClick={() => navigate('home')} title={l('Enter Voice Community', '进入语音社区', '進入語音社群', '음성 커뮤니티 들어가기')}><House />{l('Enter Voice Community', '进入语音社区', '進入語音社群', '음성 커뮤니티 들어가기')}</button>
          <div className="community-location" title={state.title || state.url || 'www.kookapp.cn'}>
            {state.loading ? <LoaderCircle className="community-loading-icon" /> : <Globe2 />}
            <span>{l('KOOK community', 'KOOK 社区', 'KOOK 社群', 'KOOK 커뮤니티')}</span>
            <small>{state.title || (state.url ? displayOrigin(state.url) : l('Persistent session', '会话会在切换页面后保留', '工作階段會在切換頁面後保留', '세션은 페이지를 전환해도 유지됩니다'))}</small>
          </div>
          <span className={`community-session ${state.connectionStatus}`}><i />{statusLabel}</span>
          <button className="icon-command compact" disabled={!bridge || !state.url} onClick={() => void bridge?.openExternal()} title={l('Open in browser', '在浏览器中打开', '在瀏覽器中開啟', '브라우저에서 열기')} aria-label={l('Open in browser', '在浏览器中打开', '在瀏覽器中開啟', '브라우저에서 열기')}><ExternalLink /></button>
        </header>
        <div className="community-browser-host" ref={hostRef}>
          {!bridge && <div className="community-browser-fallback"><Headphones /><strong>{l('Community view is available in the desktop app.', '语音社区仅在桌面版应用中可用。', '語音社群僅限桌面版應用程式使用。', '음성 커뮤니티는 데스크톱 앱에서 사용할 수 있습니다.')}</strong></div>}
          {bridgeError && <div className="community-browser-fallback community-browser-error"><strong>{l('Community view unavailable', '语音社区暂时不可用', '語音社群暫時無法使用', '커뮤니티를 사용할 수 없습니다')}</strong><span>{bridgeError}</span><button className="secondary-command" onClick={() => void applyBounds(true)}><RefreshCw />{l('Try again', '重试', '重試', '다시 시도')}</button></div>}
        </div>
      </section>
    </main>
  </div>
}
