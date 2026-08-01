import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import { Archive, ArrowLeft, ArrowRight, ChevronLeft, ExternalLink, Globe2, Home, Library, LoaderCircle, LogIn, RefreshCw, Square, Store } from 'lucide-react'
import type { BuildRealm } from '@/types/tree'
import type { LibraryTreeScope, MarketBounds, MarketMonitoringSnapshot, MarketNavigationCommand, MarketViewState } from '@/types/market'
import { useTranslation } from '@/i18n/useTranslation'
import { EquipmentLibraryPanel } from '@/components/market/EquipmentLibraryPanel'

interface MarketPanelProps {
  realm: BuildRealm
  suspended?: boolean
}

const EMPTY_STATE: MarketViewState = {
  realm: 'global',
  url: '',
  title: '',
  loading: false,
  canGoBack: false,
  canGoForward: false,
  sessionStatus: 'unknown',
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

function displayOrigin(url: string, fallback: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return fallback
  }
}

export function MarketPanel({ realm, suspended = false }: MarketPanelProps) {
  const { lang } = useTranslation()
  const zh = lang === 'zh-rCN'
  const hostRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const activatedRef = useRef(false)
  const resizingRef = useRef(false)
  const [state, setState] = useState<MarketViewState>({ ...EMPTY_STATE, realm })
  const [bridgeError, setBridgeError] = useState<string | null>(null)
  const [libraryOpen, setLibraryOpen] = useState(true)
  const [libraryWidthPercent, setLibraryWidthPercent] = useState(44)
  const [libraryTab, setLibraryTab] = useState<LibraryTreeScope>('items')
  const [monitoring, setMonitoring] = useState<MarketMonitoringSnapshot | null>(null)
  const viewSuspended = suspended
  const bridge = window.pob2Market
  const realmLabel = realm === 'cn' ? (zh ? '腾讯服' : 'Tencent CN') : (zh ? '国际服' : 'Global')
  const officialHost = realm === 'cn' ? 'poe.game.qq.com' : 'www.pathofexile.com'

  const applyBounds = useCallback(async (activate: boolean) => {
    if (!bridge || viewSuspended || !hostRef.current) return
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
  }, [bridge, viewSuspended])

  useEffect(() => {
    if (!bridge) return
    const unsubscribe = bridge.onStateChanged((nextState) => setState(nextState))
    return unsubscribe
  }, [bridge])

  useEffect(() => bridge?.onSidebarRequest((scope) => {
    setLibraryTab(scope)
    setLibraryOpen(true)
  }), [bridge])

  useEffect(() => {
    if (!bridge) return
    let active = true
    void bridge.getMonitoring().then((snapshot) => { if (active) setMonitoring(snapshot) }).catch(() => {})
    const unsubscribe = bridge.onMonitoringChanged((snapshot) => { if (active) setMonitoring(snapshot) })
    return () => { active = false; unsubscribe() }
  }, [bridge])

  useEffect(() => {
    if (!bridge) return
    let active = true
    const sync = async () => {
      try {
        await window.pob2Desktop?.setAppContext({ defaultRealm: realm })
        if (active && !viewSuspended) await applyBounds(true)
      } catch (error: unknown) {
        if (active) setBridgeError(error instanceof Error ? error.message : String(error))
      }
    }
    if (viewSuspended) {
      activatedRef.current = false
      void bridge.deactivate()
    } else {
      void sync()
    }
    return () => { active = false }
  }, [applyBounds, bridge, realm, viewSuspended])

  useEffect(() => {
    if (!bridge || viewSuspended || !hostRef.current) return
    const observer = new ResizeObserver(() => void applyBounds(false))
    observer.observe(hostRef.current)
    const update = () => void applyBounds(false)
    window.addEventListener('resize', update)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', update)
    }
  }, [applyBounds, bridge, viewSuspended])

  useEffect(() => () => {
    activatedRef.current = false
    void bridge?.deactivate()
  }, [bridge])

  const navigate = useCallback((command: MarketNavigationCommand) => {
    void bridge?.navigate(command).catch((error: unknown) => {
      setBridgeError(error instanceof Error ? error.message : String(error))
    })
  }, [bridge])

  const resizeLibrary = useCallback((clientX: number) => {
    const rect = contentRef.current?.getBoundingClientRect()
    if (!rect?.width) return
    const nextWidth = ((rect.right - clientX) / rect.width) * 100
    setLibraryWidthPercent(Math.min(75, Math.max(30, nextWidth)))
  }, [])

  const startLibraryResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    resizingRef.current = true
    event.currentTarget.setPointerCapture(event.pointerId)
    resizeLibrary(event.clientX)
  }

  const moveLibraryResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (resizingRef.current) resizeLibrary(event.clientX)
  }

  const stopLibraryResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    resizingRef.current = false
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }

  const statusLabel = useMemo(() => {
    if (state.sessionStatus === 'valid') return zh ? '已登录' : 'Signed in'
    if (state.sessionStatus === 'anonymous') return zh ? '未登录' : 'Signed out'
    return zh ? '检查登录状态' : 'Checking session'
  }, [state.sessionStatus, zh])

  return <section className="market-workspace">
    <header className="market-toolbar">
      <div className="market-navigation">
        <button className="icon-command compact" disabled={!bridge || !state.canGoBack} onClick={() => navigate('back')} title={zh ? '后退' : 'Back'} aria-label={zh ? '后退' : 'Back'}><ArrowLeft /></button>
        <button className="icon-command compact" disabled={!bridge || !state.canGoForward} onClick={() => navigate('forward')} title={zh ? '前进' : 'Forward'} aria-label={zh ? '前进' : 'Forward'}><ArrowRight /></button>
        <button className="icon-command compact" disabled={!bridge} onClick={() => navigate(state.loading ? 'stop' : 'reload')} title={state.loading ? (zh ? '停止加载' : 'Stop') : (zh ? '刷新' : 'Reload')} aria-label={state.loading ? (zh ? '停止加载' : 'Stop') : (zh ? '刷新' : 'Reload')}>{state.loading ? <Square /> : <RefreshCw />}</button>
        <button className="icon-command compact" disabled={!bridge} onClick={() => navigate('home')} title={zh ? '集市首页' : 'Market home'} aria-label={zh ? '集市首页' : 'Market home'}><Home /></button>
      </div>


      <div className="market-location" title={state.title || state.url || officialHost}>
        {state.loading ? <LoaderCircle className="market-loading-icon" /> : <Globe2 />}
        <span>{displayOrigin(state.url, officialHost)}</span>
        {state.title && <small>{state.title}</small>}
      </div>

      <span className={`market-realm ${realm}`}>{realmLabel}</span>
      <span className={`market-session ${state.sessionStatus}`}><i />{statusLabel}</span>
      {state.sessionStatus !== 'valid' && <button className="secondary-command market-login" disabled={!bridge} onClick={() => void bridge?.login()}><LogIn />{zh ? '登录' : 'Sign in'}</button>}
      <button className={`icon-command compact${libraryOpen ? ' active' : ''}`} disabled={!bridge} onClick={() => setLibraryOpen((open) => !open)} title={zh ? '收藏侧栏' : 'Favorites sidebar'} aria-label={zh ? '收藏侧栏' : 'Favorites sidebar'} aria-pressed={libraryOpen}><Library /></button>
      <button className="icon-command compact" disabled={!bridge || !state.url} onClick={() => void bridge?.openExternal()} title={zh ? '在系统浏览器打开' : 'Open in browser'} aria-label={zh ? '在系统浏览器打开' : 'Open in browser'}><ExternalLink /></button>
    </header>

    <div
      className={`market-content${libraryOpen ? ' library-open' : ' library-collapsed'}`}
      ref={contentRef}
      style={{ '--market-library-width': `${libraryWidthPercent}%` } as CSSProperties}
    >
    <div className="market-browser-host" ref={hostRef}>
      {!bridge && <div className="market-browser-fallback">
        <Store />
        <h2>{zh ? '集市浏览器仅在桌面版可用' : 'The market browser is available in the desktop app'}</h2>
        <p>{zh ? 'Electron 桌面版会在这里加载当前服务器的官方交易网站。' : 'The Electron desktop app loads the official trade site here.'}</p>
      </div>}
      {(bridgeError || state.error) && <div className="market-browser-error" role="alert">
        <strong>{zh ? '官方集市加载失败' : 'Official market failed to load'}</strong>
        <span>{bridgeError || state.error}</span>
        <button className="secondary-command" onClick={() => navigate('reload')}><RefreshCw />{zh ? '重试' : 'Retry'}</button>
      </div>}
    </div>
    {libraryOpen
      ? <>
        <div
          className="market-splitter"
          role="separator"
          aria-label={zh ? '调整集市与仓库宽度' : 'Resize market and library'}
          aria-orientation="vertical"
          aria-valuemin={30}
          aria-valuemax={75}
          aria-valuenow={Math.round(libraryWidthPercent)}
          tabIndex={0}
          onPointerDown={startLibraryResize}
          onPointerMove={moveLibraryResize}
          onPointerUp={stopLibraryResize}
          onPointerCancel={stopLibraryResize}
          onKeyDown={(event) => {
            if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
            event.preventDefault()
            setLibraryWidthPercent((current) => Math.min(75, Math.max(30, current + (event.key === 'ArrowLeft' ? 2 : -2))))
          }}
        />
        <EquipmentLibraryPanel realm={realm} zh={zh} currentSearch={state.currentSearch} monitoring={monitoring} activeTab={libraryTab} onTabChange={setLibraryTab} onClose={() => setLibraryOpen(false)} />
      </>
      : <button className="trade-helper-rail" onClick={() => setLibraryOpen(true)} title={zh ? '打开装备仓库' : 'Open equipment library'} aria-label={zh ? '打开装备仓库' : 'Open equipment library'}><Archive /><strong>{zh ? '装备仓库' : 'Equipment Library'}</strong><ChevronLeft /></button>}
    </div>
  </section>
}
