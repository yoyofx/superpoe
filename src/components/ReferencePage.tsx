import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { AlertTriangle, BookOpen, Check, ChevronLeft, ChevronRight, ExternalLink, Globe2, House, LoaderCircle, Pencil, Plus, RefreshCw, RotateCcw, Settings2, Trash2, X } from 'lucide-react'

import { AccountStatus } from '@/components/AuthGate'
import { EmbeddedBrowserNavigation } from '@/components/EmbeddedBrowserNavigation'
import { createReferenceSiteId, DEFAULT_REFERENCE_SITES, isValidReferenceSiteUrl, loadReferenceSites, normalizeReferenceSite, REFERENCE_SITE_LIMITS, saveReferenceSites } from '@/engine/referenceSites'
import { uiText } from '@/i18n/uiLocale'
import { useTranslation } from '@/i18n/useTranslation'
import type { MarketBounds } from '@/types/market'
import type { ReferenceNavigationCommand, ReferencePoeNinjaImportResult, ReferenceSiteConfig, ReferenceSiteId, ReferenceViewState } from '@/types/reference'

interface ReferencePageProps {
  initialSite: ReferenceSiteId
  onCenter: () => void
  onLibrary: () => void
  onTradeCenter: () => void
  onCommunity: () => void
  onReference: () => void
  onAbout: () => void
  onBack: () => void
  onPoeNinjaImport: (result: ReferencePoeNinjaImportResult) => Promise<void>
}

const EMPTY_STATE: ReferenceViewState = {
  site: '',
  url: '',
  title: '',
  loading: false,
  canGoBack: false,
  canGoForward: false,
  connectionStatus: 'idle',
}

const BUILT_IN_SITE_META: Record<string, { icon: typeof BookOpen; en: string; zhCN: string; zhTW: string; koKR: string }> = {
  ninja: {
    icon: BookOpen,
    en: 'Ninja builds',
    zhCN: '忍者网',
    zhTW: '忍者網',
    koKR: '닌자 빌드',
  },
  poe2db: {
    icon: Globe2,
    en: 'PoE2DB',
    zhCN: '编年史',
    zhTW: '編年史',
    koKR: 'PoE2DB',
  },
}

function siteLabel(site: ReferenceSiteConfig, l: (en: string, zhCN: string, zhTW: string, koKR: string) => string): string {
  const meta = BUILT_IN_SITE_META[site.id]
  const defaultSite = DEFAULT_REFERENCE_SITES.find((entry) => entry.id === site.id)
  return meta && site.builtIn && site.name === defaultSite?.name ? l(meta.en, meta.zhCN, meta.zhTW, meta.koKR) : site.name
}

function siteIcon(site: ReferenceSiteConfig): typeof BookOpen {
  return BUILT_IN_SITE_META[site.id]?.icon || Globe2
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
    return 'reference site'
  }
}

export function ReferencePage({ initialSite, onCenter, onLibrary, onTradeCenter, onCommunity, onReference, onAbout, onBack, onPoeNinjaImport }: ReferencePageProps) {
  const { lang } = useTranslation()
  const l = (en: string, zhCN: string, zhTW: string, koKR: string) => uiText(lang, en, zhCN, zhTW, koKR)
  const hostRef = useRef<HTMLDivElement>(null)
  const activatedRef = useRef(false)
  const [sites, setSites] = useState<ReferenceSiteConfig[]>(() => loadReferenceSites())
  const [site, setSite] = useState<ReferenceSiteId>(initialSite)
  const [state, setState] = useState<ReferenceViewState>(EMPTY_STATE)
  const [bridgeError, setBridgeError] = useState<string | null>(null)
  const [managerOpen, setManagerOpen] = useState(false)
  const [editorOpen, setEditorOpen] = useState(false)
  const [editingId, setEditingId] = useState<ReferenceSiteId | null>(null)
  const [draftName, setDraftName] = useState('')
  const [draftUrl, setDraftUrl] = useState('https://')
  const [formError, setFormError] = useState<string | null>(null)
  const [poeNinjaImportLoading, setPoeNinjaImportLoading] = useState(false)
  const [poeNinjaImportPhase, setPoeNinjaImportPhase] = useState<'requesting' | 'importing' | null>(null)
  const [poeNinjaImportProgress, setPoeNinjaImportProgress] = useState(0)
  const [poeNinjaImportError, setPoeNinjaImportError] = useState<string | null>(null)
  const bridge = window.pob2Reference
  const selectedSite = sites.find((entry) => entry.id === site) || sites[0] || null
  const fallbackSite = DEFAULT_REFERENCE_SITES[0]!
  const siteRef = useRef<ReferenceSiteConfig>(selectedSite || fallbackSite)
  siteRef.current = selectedSite || fallbackSite

  useEffect(() => {
    if (selectedSite && selectedSite.id !== site) setSite(selectedSite.id)
  }, [selectedSite, site])

  const persistSites = (nextSites: ReferenceSiteConfig[]) => {
    setSites(nextSites)
    saveReferenceSites(nextSites)
  }

  const startCreate = () => {
    setEditingId(null)
    setDraftName('')
    setDraftUrl('https://')
    setFormError(null)
    setEditorOpen(true)
  }

  const startEdit = (entry: ReferenceSiteConfig) => {
    setEditingId(entry.id)
    setDraftName(entry.name)
    setDraftUrl(entry.url)
    setFormError(null)
    setEditorOpen(true)
  }

  const cancelEditor = () => {
    setEditingId(null)
    setEditorOpen(false)
    setFormError(null)
  }

  const handleSaveSite = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const name = draftName.trim()
    const url = draftUrl.trim()
    if (!name) {
      setFormError(l('Enter a site name.', '请输入资料站名称。', '請輸入資料站名稱。', '사이트 이름을 입력하세요.'))
      return
    }
    if (!isValidReferenceSiteUrl(url)) {
      setFormError(l('Use a valid HTTPS URL.', '请输入有效的 HTTPS 地址。', '請輸入有效的 HTTPS 網址。', '유효한 HTTPS URL을 입력하세요.'))
      return
    }
    if (!editingId && sites.length >= REFERENCE_SITE_LIMITS.maxSites) {
      setFormError(l('The reference site list is full.', '资料站列表已达到上限。', '資料站列表已達到上限。', '참고 사이트 목록이 가득 찼습니다.'))
      return
    }
    if (sites.some((entry) => entry.id !== editingId && entry.url.toLowerCase() === url.toLowerCase())) {
      setFormError(l('This URL is already in the list.', '这个地址已经在列表中。', '這個網址已經在列表中。', '이 URL은 이미 목록에 있습니다.'))
      return
    }
    const existing = editingId ? sites.find((entry) => entry.id === editingId) : undefined
    const nextEntry = normalizeReferenceSite({ id: editingId || createReferenceSiteId(sites), name, url, builtIn: existing?.builtIn })
    if (!nextEntry) {
      setFormError(l('The reference site details are invalid.', '资料站信息无效。', '資料站資訊無效。', '참고 사이트 정보가 올바르지 않습니다.'))
      return
    }
    const nextSites = editingId
      ? sites.map((entry) => entry.id === editingId ? nextEntry : entry)
      : [...sites, nextEntry]
    persistSites(nextSites)
    setSite(nextEntry.id)
    cancelEditor()
  }

  const handleDeleteSite = (entry: ReferenceSiteConfig) => {
    if (sites.length <= 1) {
      setFormError(l('Keep at least one reference site.', '至少保留一个资料站。', '至少保留一個資料站。', '참고 사이트를 하나 이상 남겨 두세요.'))
      return
    }
    const nextSites = sites.filter((candidate) => candidate.id !== entry.id)
    persistSites(nextSites)
    if (site === entry.id) setSite(nextSites[0]?.id || '')
    if (editingId === entry.id) cancelEditor()
  }

  const restoreDefaults = () => {
    const nextSites = DEFAULT_REFERENCE_SITES.map((entry) => ({ ...entry }))
    persistSites(nextSites)
    setSite(nextSites[0]?.id || '')
    cancelEditor()
  }

  const applyBounds = useCallback(async (activate: boolean) => {
    if (!bridge || !hostRef.current) return
    const bounds = getBounds(hostRef.current)
    if (!bounds) return
    try {
      if (activate || !activatedRef.current) {
        setState(await bridge.activate(bounds, siteRef.current))
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
    const offState = bridge.onStateChanged((nextState) => {
      setState(nextState)
      setSite(nextState.site)
    })
    void applyBounds(true)
    return () => {
      offState()
      activatedRef.current = false
      void bridge.deactivate()
    }
  }, [applyBounds, bridge])

  useEffect(() => {
    if (!bridge || !activatedRef.current || !selectedSite) return
    void bridge.setSite(selectedSite).catch((error: unknown) => {
      setBridgeError(error instanceof Error ? error.message : String(error))
    })
  }, [bridge, selectedSite])

  useEffect(() => {
    if (!bridge) return
    return bridge.onPoeNinjaImport((event) => {
      if (event.status === 'loading') {
        setPoeNinjaImportLoading(true)
        setPoeNinjaImportPhase('requesting')
        setPoeNinjaImportProgress(14)
        setPoeNinjaImportError(null)
        return
      }
      if (event.status === 'error') {
        setPoeNinjaImportLoading(false)
        setPoeNinjaImportPhase(null)
        setPoeNinjaImportProgress(0)
        setPoeNinjaImportError(event.error)
        return
      }
      setPoeNinjaImportLoading(true)
      setPoeNinjaImportPhase('importing')
      setPoeNinjaImportProgress(72)
      setPoeNinjaImportError(null)
      void onPoeNinjaImport(event.result).then(() => {
        setPoeNinjaImportProgress(100)
        setPoeNinjaImportLoading(false)
        setPoeNinjaImportPhase(null)
      }).catch((error: unknown) => {
        setPoeNinjaImportLoading(false)
        setPoeNinjaImportPhase(null)
        setPoeNinjaImportProgress(0)
        setPoeNinjaImportError(error instanceof Error ? error.message : String(error))
      })
    })
  }, [bridge, onPoeNinjaImport])

  useEffect(() => {
    if (!poeNinjaImportLoading) return
    const timer = window.setInterval(() => {
      setPoeNinjaImportProgress((value) => Math.min(86, value + 3))
    }, 420)
    return () => window.clearInterval(timer)
  }, [poeNinjaImportLoading])

  useEffect(() => {
    if (!bridge) return
    void bridge.setVisible(!managerOpen).catch((error: unknown) => {
      setBridgeError(error instanceof Error ? error.message : String(error))
    })
  }, [bridge, managerOpen])

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

  const navigate = useCallback((command: ReferenceNavigationCommand) => {
    void bridge?.navigate(command).catch((error: unknown) => {
      setBridgeError(error instanceof Error ? error.message : String(error))
    })
  }, [bridge])

  const leaveReference = useCallback((next: () => void) => {
    if (!bridge) {
      next()
      return
    }
    void bridge.deactivate().catch(() => {}).finally(next)
  }, [bridge])

  useEffect(() => {
    if (!bridge) return
    return bridge.onEscape(() => leaveReference(onBack))
  }, [bridge, leaveReference, onBack])

  const statusLabel = state.connectionStatus === 'connected'
    ? l('Connected', '已连接', '已連線', '연결됨')
    : state.connectionStatus === 'loading'
      ? l('Loading', '正在加载', '正在載入', '로드 중')
      : state.connectionStatus === 'error'
        ? l('Connection error', '连接失败', '連線失敗', '연결 오류')
        : l('Not connected', '未连接', '未連線', '연결 안 됨')
  const currentSite = selectedSite || fallbackSite
  const CurrentIcon = siteIcon(currentSite)
  const currentLabel = siteLabel(currentSite, l)

  return <div className="build-center embedded-browser-page reference-page">
    <header className="embedded-browser-toolbar reference-toolbar">
      <EmbeddedBrowserNavigation active="reference" showModuleLinks={false} onBack={() => leaveReference(onBack)} onCenter={() => leaveReference(onCenter)} onLibrary={() => leaveReference(onLibrary)} onTradeCenter={() => leaveReference(onTradeCenter)} onCommunity={() => leaveReference(onCommunity)} onReference={onReference} onAbout={() => leaveReference(onAbout)} />
      <span className="reference-toolbar-divider" aria-hidden="true" />
      <div className="reference-navigation" aria-label={l('Web navigation', '网页导航', '網頁導覽', '웹 탐색')}>
        <button className="icon-command compact" disabled={!bridge || !state.canGoBack} onClick={() => navigate('back')} title={l('Back', '后退', '上一頁', '뒤로')} aria-label={l('Back', '后退', '上一頁', '뒤로')}><ChevronLeft /></button>
        <button className="icon-command compact" disabled={!bridge || !state.canGoForward} onClick={() => navigate('forward')} title={l('Forward', '前进', '下一頁', '앞으로')} aria-label={l('Forward', '前进', '下一頁', '앞으로')}><ChevronRight /></button>
        <button className="icon-command compact" disabled={!bridge} onClick={() => navigate('home')} title={l('Home page', '首页', '首頁', '홈')} aria-label={l('Home page', '首页', '首頁', '홈')}><House /></button>
        <button className="icon-command compact" disabled={!bridge} onClick={() => navigate('reload')} title={l('Reload', '刷新', '重新載入', '새로고침')} aria-label={l('Reload', '刷新', '重新載入', '새로고침')}><RefreshCw /></button>
      </div>
      <nav className="reference-site-tabs" aria-label={l('Reference sites', '资料网站', '資料網站', '참고 사이트')}>
        {sites.map((entry) => {
          const Icon = siteIcon(entry)
          const label = siteLabel(entry, l)
          return <button key={entry.id} type="button" className={`reference-site-tab${site === entry.id ? ' active' : ''}`} onClick={() => setSite(entry.id)} aria-pressed={site === entry.id} title={entry.url}>
            <Icon aria-hidden="true" />
            <span>{label}</span>
          </button>
        })}
      </nav>
      <button type="button" className="icon-command compact reference-manage-command" onClick={() => { setManagerOpen((open) => !open); setFormError(null) }} title={l('Manage reference sites', '管理资料站', '管理資料站', '참고 사이트 관리')} aria-label={l('Manage reference sites', '管理资料站', '管理資料站', '참고 사이트 관리')} aria-expanded={managerOpen} aria-controls="reference-site-manager"><Settings2 /></button>
      {managerOpen && <section id="reference-site-manager" className="reference-site-manager" role="dialog" aria-labelledby="reference-site-manager-title">
        <header>
          <div><span>{l('Reference collection', '资料站集合', '資料站集合', '참고 사이트 모음')}</span><strong id="reference-site-manager-title">{l('Manage reference sites', '管理资料站', '管理資料站', '참고 사이트 관리')}</strong></div>
          <button type="button" className="icon-command compact" onClick={() => { setManagerOpen(false); cancelEditor() }} title={l('Close', '关闭', '關閉', '닫기')} aria-label={l('Close', '关闭', '關閉', '닫기')}><X /></button>
        </header>
        <div className="reference-site-manager-list">
          {sites.map((entry) => {
            const Icon = siteIcon(entry)
            return <div key={entry.id} className="reference-site-manager-row">
              <button type="button" className={`reference-site-manager-entry${site === entry.id ? ' active' : ''}`} onClick={() => setSite(entry.id)} title={entry.url}>
                <Icon aria-hidden="true" />
                <span><strong>{siteLabel(entry, l)}</strong><small>{entry.url}</small></span>
              </button>
              <div className="reference-site-manager-actions">
                <button type="button" className="icon-command compact" onClick={() => startEdit(entry)} title={l('Edit site', '编辑资料站', '編輯資料站', '사이트 편집')} aria-label={l('Edit site', '编辑资料站', '編輯資料站', '사이트 편집')}><Pencil /></button>
                <button type="button" className="icon-command compact" disabled={sites.length <= 1} onClick={() => handleDeleteSite(entry)} title={l('Delete site', '删除资料站', '刪除資料站', '사이트 삭제')} aria-label={l('Delete site', '删除资料站', '刪除資料站', '사이트 삭제')}><Trash2 /></button>
              </div>
            </div>
          })}
        </div>
        {formError && !editorOpen && <small className="reference-site-manager-error" role="alert">{formError}</small>}
        {editorOpen ? <form className="reference-site-manager-form" onSubmit={handleSaveSite}>
          <div className="reference-site-manager-form-heading"><strong>{editingId ? l('Edit site', '编辑资料站', '編輯資料站', '사이트 편집') : l('Add site', '新增资料站', '新增資料站', '사이트 추가')}</strong><small>{l('Use an HTTPS address.', '请使用 HTTPS 地址。', '請使用 HTTPS 網址。', 'HTTPS 주소를 사용하세요.')}</small></div>
          <label><span>{l('Name', '名称', '名稱', '이름')}</span><input value={draftName} maxLength={REFERENCE_SITE_LIMITS.maxNameLength} onChange={(event) => setDraftName(event.target.value)} placeholder={l('My reference site', '我的资料站', '我的資料站', '내 참고 사이트')} autoFocus /></label>
          <label><span>{l('URL', '地址', '網址', 'URL')}</span><input type="url" value={draftUrl} maxLength={REFERENCE_SITE_LIMITS.maxUrlLength} onChange={(event) => setDraftUrl(event.target.value)} placeholder="https://example.com" /></label>
          {formError && <small className="reference-site-manager-error" role="alert">{formError}</small>}
          <footer><button type="button" className="secondary-command" onClick={cancelEditor}><X />{l('Cancel', '取消', '取消', '취소')}</button><button type="submit" className="primary-command"><Check />{editingId ? l('Save changes', '保存修改', '儲存修改', '변경 저장') : l('Add site', '添加资料站', '新增資料站', '사이트 추가')}</button></footer>
        </form> : <button type="button" className="secondary-command reference-site-manager-add" onClick={startCreate}><Plus />{l('Add reference site', '新增资料站', '新增資料站', '참고 사이트 추가')}</button>}
        <button type="button" className="reference-site-manager-restore" onClick={restoreDefaults}><RotateCcw />{l('Restore default sites', '恢复默认资料站', '恢復預設資料站', '기본 사이트 복원')}</button>
      </section>}
      <span className="reference-location" title={state.title || state.url}>
        {state.loading ? <LoaderCircle className="reference-loading-icon" /> : <CurrentIcon />}
        <span>{currentLabel}</span>
        <small>{state.title || (state.url ? displayOrigin(state.url) : l('Persistent session', '会话会在切换页面后保留', '工作階段會在切換頁面後保留', '페이지를 전환해도 세션이 유지됩니다'))}</small>
      </span>
      <span className={`reference-session ${state.connectionStatus}`}><i />{statusLabel}</span>
      {poeNinjaImportLoading && <span className="reference-import-status loading"><LoaderCircle /><span>{poeNinjaImportPhase === 'requesting' ? l('Reading Ninja build', '正在读取忍者网构筑', '正在讀取忍者網構築', '닌자 빌드 읽는 중') : l('Parsing build', '正在解析构筑', '正在解析構築', '빌드 분석 중')}</span></span>}
      {poeNinjaImportError && <span className="reference-import-status error" role="status"><AlertTriangle /><span title={poeNinjaImportError}>{poeNinjaImportError}</span><button type="button" className="icon-command compact" onClick={() => setPoeNinjaImportError(null)} title={l('Dismiss', '关闭提示', '關閉提示', '닫기')} aria-label={l('Dismiss', '关闭提示', '關閉提示', '닫기')}><X /></button></span>}
      <button className="icon-command compact" disabled={!bridge || !state.url} onClick={() => void bridge?.openExternal()} title={l('Open in browser', '在浏览器中打开', '在瀏覽器中開啟', '브라우저에서 열기')} aria-label={l('Open in browser', '在浏览器中打开', '在瀏覽器中開啟', '브라우저에서 열기')}><ExternalLink /></button>
      <AccountStatus />
      {poeNinjaImportLoading && <div className="reference-import-progress" role="progressbar" aria-label={l('Ninja build import progress', '忍者网构筑导入进度', '忍者網構築匯入進度', '닌자 빌드 가져오기 진행률')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={poeNinjaImportProgress}><span style={{ width: `${poeNinjaImportProgress}%` }} /></div>}
    </header>
    <main className="embedded-browser-content" aria-label={l('Reference websites', '资料参考网站', '資料參考網站', '참고 웹사이트')}>
      <div className="reference-browser-host" ref={hostRef}>
        {!bridge && <div className="reference-browser-fallback"><BookOpen /><strong>{l('Reference pages are available in the desktop app.', '资料参考页面仅在桌面版应用中可用。', '資料參考頁面僅限桌面版應用程式使用。', '참고 페이지는 데스크톱 앱에서 사용할 수 있습니다.')}</strong></div>}
        {bridgeError && <div className="reference-browser-fallback reference-browser-error"><strong>{l('Reference page unavailable', '资料页面暂时不可用', '資料頁面暫時無法使用', '참고 페이지를 사용할 수 없습니다')}</strong><span>{bridgeError}</span><button className="secondary-command" onClick={() => void applyBounds(true)}><RefreshCw />{l('Try again', '重试', '重試', '다시 시도')}</button></div>}
      </div>
    </main>
  </div>
}
