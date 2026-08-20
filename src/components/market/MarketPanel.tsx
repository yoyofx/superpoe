import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import { Archive, ArrowLeft, ArrowRight, ChevronLeft, ExternalLink, Globe2, Home, Library, LoaderCircle, LogIn, RefreshCw, Square, Store } from 'lucide-react'
import type { BuildRealm } from '@/types/tree'
import type { LibraryTreeScope, MarketBounds, MarketMonitoringSnapshot, MarketNavigationCommand, MarketViewState } from '@/types/market'
import { useTranslation } from '@/i18n/useTranslation'
import { EquipmentLibraryPanel } from '@/components/market/EquipmentLibraryPanel'
import { uiText } from '@/i18n/uiLocale'
import { loadAppSettings } from '@/engine/appSettings'
import { parseEquipmentXml } from '@/engine/equipment'
import { useTreeStore } from '@/store/treeStore'
import type { BuildContextSnapshot } from '@/equipmentDifference'

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
  const l = (en: string, zhCN: string, zhTW: string, koKR: string) => uiText(lang, en, zhCN, zhTW, koKR)
  const hostRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const activatedRef = useRef(false)
  const resizingRef = useRef(false)
  const [state, setState] = useState<MarketViewState>({ ...EMPTY_STATE, realm })
  const [bridgeError, setBridgeError] = useState<string | null>(null)
  const [libraryOpen, setLibraryOpen] = useState(true)
  const [libraryWidthPercent, setLibraryWidthPercent] = useState(30)
  const [libraryTab, setLibraryTab] = useState<LibraryTreeScope>('items')
  const [monitoring, setMonitoring] = useState<MarketMonitoringSnapshot | null>(null)
  const importedBuildCode = useTreeStore((store) => store.importedBuildCode)
  const pobBuildRevision = useTreeStore((store) => store.pobBuildRevision)
  const activeWeaponSet = useTreeStore((store) => store.activeWeaponSet)
  const activeCalculationProfileId = useTreeStore((store) => store.activeCalculationProfileId)
  const calculationProfiles = useTreeStore((store) => store.calculationProfiles)
  const getActivePobXml = useTreeStore((store) => store.getActivePobXml)
  const activePobXml = useMemo(() => getActivePobXml() || '', [getActivePobXml, importedBuildCode, pobBuildRevision])
  const activeEquipment = useMemo(() => activePobXml ? parseEquipmentXml(activePobXml) : null, [activePobXml])
  const activeCalculationOverrides = useMemo(() => {
    const profile = calculationProfiles.find((candidate) => candidate.id === activeCalculationProfileId)
    return profile?.values && Object.keys(profile.values).length ? { ...profile.values } : undefined
  }, [activeCalculationProfileId, calculationProfiles])
  const equipmentDifferenceContext = useMemo<BuildContextSnapshot | null>(() => {
    if (!activePobXml || !activeEquipment?.activeItemSetId) return null
    return {
      xml: activePobXml,
      buildRevision: pobBuildRevision,
      activeItemSetId: activeEquipment.activeItemSetId,
      activeWeaponSet,
      ...(activeCalculationOverrides ? { configOverrides: activeCalculationOverrides } : {}),
    }
  }, [activeCalculationOverrides, activeEquipment?.activeItemSetId, activePobXml, activeWeaponSet, pobBuildRevision])
  const viewSuspended = suspended
  const bridge = window.pob2Market
  const realmLabel = realm === 'cn' ? l('Tencent CN', '腾讯服', '騰訊服', 'Tencent 중국') : l('Global', '国际服', '國際服', '글로벌')
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

  useEffect(() => bridge?.onTryOnRequest((entry) => {
    setLibraryOpen(true)
    if (!window.pob2Desktop?.openEquipmentTryOn) {
      setBridgeError(l('The try-on window is unavailable in this environment.', '当前环境无法打开试穿窗口。', '目前環境無法開啟試穿視窗。', '이 환경에서는 시험 착용 창을 열 수 없습니다.'))
      return
    }
    void window.pob2Desktop.openEquipmentTryOn({
      entry,
      context: equipmentDifferenceContext,
      language: lang,
    }).catch((error: unknown) => setBridgeError(error instanceof Error ? error.message : String(error)))
  }), [bridge, equipmentDifferenceContext, lang])

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
        const saved = loadAppSettings()
        await window.pob2Desktop?.setAppContext({ defaultRealm: realm, language: lang, priceCheckEnabled: saved.priceCheckEnabled, priceCheckHotkey: saved.priceCheckHotkey })
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
  }, [applyBounds, bridge, lang, realm, viewSuspended])

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
    if (state.sessionStatus === 'valid') return l('Signed in', '已登录', '已登入', '로그인됨')
    if (state.sessionStatus === 'anonymous') return l('Signed out', '未登录', '未登入', '로그아웃됨')
    return l('Checking session', '检查登录状态', '檢查登入狀態', '세션 확인 중')
  }, [lang, state.sessionStatus])

  return <section className="market-workspace">
    <header className="market-toolbar">
      <div className="market-navigation">
        <button className="icon-command compact" disabled={!bridge || !state.canGoBack} onClick={() => navigate('back')} title={l('Back', '后退', '上一頁', '뒤로')} aria-label={l('Back', '后退', '上一頁', '뒤로')}><ArrowLeft /></button>
        <button className="icon-command compact" disabled={!bridge || !state.canGoForward} onClick={() => navigate('forward')} title={l('Forward', '前进', '下一頁', '앞으로')} aria-label={l('Forward', '前进', '下一頁', '앞으로')}><ArrowRight /></button>
        <button className="icon-command compact" disabled={!bridge} onClick={() => navigate(state.loading ? 'stop' : 'reload')} title={state.loading ? l('Stop', '停止加载', '停止載入', '중지') : l('Reload', '刷新', '重新載入', '새로 고침')} aria-label={state.loading ? l('Stop', '停止加载', '停止載入', '중지') : l('Reload', '刷新', '重新載入', '새로 고침')}>{state.loading ? <Square /> : <RefreshCw />}</button>
        <button className="icon-command compact" disabled={!bridge} onClick={() => navigate('home')} title={l('Market home', '集市首页', '市集首頁', '거래소 홈')} aria-label={l('Market home', '集市首页', '市集首頁', '거래소 홈')}><Home /></button>
      </div>


      <div className="market-location" title={state.title || state.url || officialHost}>
        {state.loading ? <LoaderCircle className="market-loading-icon" /> : <Globe2 />}
        <span>{displayOrigin(state.url, officialHost)}</span>
        {state.title && <small>{state.title}</small>}
      </div>

      <span className={`market-realm ${realm}`}>{realmLabel}</span>
      <span className={`market-session ${state.sessionStatus}`}><i />{statusLabel}</span>
      {state.sessionStatus !== 'valid' && <button className="secondary-command market-login" disabled={!bridge} onClick={() => void bridge?.login()}><LogIn />{l('Sign in', '登录', '登入', '로그인')}</button>}
      <button className={`icon-command compact${libraryOpen ? ' active' : ''}`} disabled={!bridge} onClick={() => setLibraryOpen((open) => !open)} title={l('Favorites sidebar', '收藏侧栏', '收藏側欄', '즐겨찾기 사이드바')} aria-label={l('Favorites sidebar', '收藏侧栏', '收藏側欄', '즐겨찾기 사이드바')} aria-pressed={libraryOpen}><Library /></button>
      <button className="icon-command compact" disabled={!bridge || !state.url} onClick={() => void bridge?.openExternal()} title={l('Open in browser', '在系统浏览器打开', '在系統瀏覽器開啟', '브라우저에서 열기')} aria-label={l('Open in browser', '在系统浏览器打开', '在系統瀏覽器開啟', '브라우저에서 열기')}><ExternalLink /></button>
    </header>

    <div
      className={`market-content${libraryOpen ? ' library-open' : ' library-collapsed'}`}
      ref={contentRef}
      style={{ '--market-library-width': `${libraryWidthPercent}%` } as CSSProperties}
    >
    <div className="market-browser-host" ref={hostRef}>
      {!bridge && <div className="market-browser-fallback">
        <Store />
        <h2>{l('The market browser is available in the desktop app', '集市浏览器仅在桌面版可用', '市集瀏覽器僅限桌面版使用', '거래소 브라우저는 데스크톱 앱에서 사용할 수 있습니다')}</h2>
        <p>{l('The Electron desktop app loads the official trade site here.', 'Electron 桌面版会在这里加载当前服务器的官方交易网站。', 'Electron 桌面版會在此載入目前伺服器的官方交易網站。', 'Electron 데스크톱 앱은 여기에 현재 리전의 공식 거래 사이트를 불러옵니다.')}</p>
      </div>}
      {(bridgeError || state.error) && <div className="market-browser-error" role="alert">
        <strong>{l('Official market failed to load', '官方集市加载失败', '官方市集載入失敗', '공식 거래소를 불러오지 못했습니다')}</strong>
        <span>{bridgeError || state.error}</span>
        <button className="secondary-command" onClick={() => navigate('reload')}><RefreshCw />{l('Retry', '重试', '重試', '다시 시도')}</button>
      </div>}
    </div>
    {libraryOpen
      ? <>
        <div
          className="market-splitter"
          role="separator"
          aria-label={l('Resize market and library', '调整集市与仓库宽度', '調整市集與倉庫寬度', '거래소 및 라이브러리 크기 조절')}
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
        <EquipmentLibraryPanel realm={realm} language={lang} currentSearch={state.currentSearch} monitoring={monitoring} activeTab={libraryTab} onTabChange={setLibraryTab} onClose={() => setLibraryOpen(false)} headerTitle={l('Trade center shortcuts', '交易中心快捷栏', '交易中心快捷欄', '거래 센터 바로 가기')} />
      </>
      : <button className="trade-helper-rail" onClick={() => setLibraryOpen(true)} title={l('Open trade center shortcuts', '打开交易中心快捷栏', '開啟交易中心快捷欄', '거래 센터 바로 가기 열기')} aria-label={l('Open trade center shortcuts', '打开交易中心快捷栏', '開啟交易中心快捷欄', '거래 센터 바로 가기 열기')}><Archive /><strong>{l('Trade shortcuts', '交易中心快捷栏', '交易中心快捷欄', '거래 바로 가기')}</strong><ChevronLeft /></button>}
    </div>
  </section>
}
