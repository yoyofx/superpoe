import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle, Archive, BellRing, ChevronLeft, ChevronRight, CircleHelp, Clock3, FileInput, FolderOpen, Info, LayoutDashboard, ListFilter, MoreVertical, Plus, RefreshCw, Search, Settings, Store, Trash2, Wrench } from 'lucide-react'
import { FallbackImage } from '@/components/FallbackImage'
import { translateGameText, type Language } from '@/i18n/translationLoader'
import { useTranslation } from '@/i18n/useTranslation'
import { useTreeStore } from '@/store/treeStore'
import type { SavedBuild } from '@/types/tree'
import { buildRealmLabel } from '@/engine/buildRealm'
import { getBuildCharacterLevel } from '@/engine/buildCode'
import { getTreeAssetUrl, loadTreeAssetIndex } from '@/engine/treeAssetIndex'
import type { SpriteIndex } from '@/engine/spriteLoader'
import { SUPERPOE_NAME, SUPERPOE_VERSION_LABEL } from '@/engine/appVersion'
import { GameRuntimeIndicator } from '@/components/GameRuntimeIndicator'
import { MAX_ACTIVE_PURCHASE_TARGETS, type MarketMonitoringSnapshot } from '@/types/market'
import { formatUiDate, uiText } from '@/i18n/uiLocale'

interface BuildCenterProps {
  onCreate: () => void
  onOpenFile: () => void
  onImport: () => void
  onOpen: (build: SavedBuild) => void
  onCheckForUpdate: (build: SavedBuild) => void
  onTradeCenter: () => void
  onLibrary: () => void
  onUtilities: () => void
  onAbout: () => void
  monitoring?: MarketMonitoringSnapshot | null
  onSettings: () => void
}

export type BuildCenterNavPage = 'center' | 'library' | 'utilities' | 'about'

interface BuildCenterNavProps {
  active: BuildCenterNavPage
  onCenter: () => void
  onLibrary: () => void
  onTradeCenter: () => void
  onUtilities: () => void
  onAbout: () => void
}

const BUILDS_PER_PAGE = 5
const ROW_MENU_WIDTH = 150
const ROW_MENU_HEIGHT = 64
const ROW_MENU_UPDATE_HEIGHT = 92

interface RowMenuState {
  buildId: string
  left: number
  top: number
}

export function BuildCenterNav({ active, onCenter, onLibrary, onTradeCenter, onUtilities, onAbout }: BuildCenterNavProps) {
  const { lang } = useTranslation()
  const l = (en: string, zhCN: string, zhTW: string, koKR: string) => uiText(lang, en, zhCN, zhTW, koKR)
  return (
    <aside className="build-center-nav" aria-label={l('Build center navigation', '构筑中心导航', '構築中心導覽', '빌드 센터 탐색')}>
      <div className="build-center-nav-brand">
        <img src="/assets/ui/superpoe2-logo.png" alt="" />
        <span><strong>{SUPERPOE_NAME}</strong><small>{SUPERPOE_VERSION_LABEL}</small></span>
      </div>
      <nav className="build-center-nav-list">
        <button className={active === 'center' ? 'active' : ''} aria-current={active === 'center' ? 'page' : undefined} onClick={onCenter}>
          <span className="build-center-nav-main"><LayoutDashboard aria-hidden="true" /><span>{l('Build center', '构筑中心', '構築中心', '빌드 센터')}</span><span className="build-center-nav-tooltip" role="tooltip">{l('Manage builds, open recent builds, and enter the build workspace.', '管理构筑、打开最近构筑并进入构筑编辑工作区', '管理構築、開啟最近構築並進入構築編輯工作區', '빌드를 관리하고 최근 빌드를 열어 빌드 작업 공간으로 이동합니다.')}</span></span>
        </button>
        <button className={active === 'library' ? 'active' : ''} aria-current={active === 'library' ? 'page' : undefined} onClick={onLibrary}>
          <span className="build-center-nav-main"><Archive aria-hidden="true" /><span>{l('Equipment library', '装备仓库', '裝備倉庫', '장비 라이브러리')}</span><span className="build-center-nav-tooltip" role="tooltip">{l('Organize market favorites, PoB imports, and custom items.', '集中管理市场收藏、PoB 导入和自定义装备', '集中管理市集收藏、PoB 匯入與自訂裝備', '거래소 즐겨찾기, PoB 가져오기 및 사용자 지정 장비를 관리합니다.')}</span></span>
        </button>
        <button onClick={onTradeCenter}>
          <span className="build-center-nav-main"><Store aria-hidden="true" /><span>{l('Trade center', '交易中心', '交易中心', '거래 센터')}</span><span className="build-center-nav-tooltip" role="tooltip">{l('Search equipment, save market results, and view live prices.', '搜索装备、收藏市场结果并查看实时行情', '搜尋裝備、收藏市集結果並查看即時行情', '장비를 검색하고 거래소 결과를 저장하며 실시간 시세를 확인합니다.')}</span></span>
        </button>
        <button className={active === 'utilities' ? 'active' : ''} aria-current={active === 'utilities' ? 'page' : undefined} onClick={onUtilities}>
          <span className="build-center-nav-main"><Wrench aria-hidden="true" /><span>{l('Utilities', '实用工具', '實用工具', '유틸리티')}</span><span className="build-center-nav-tooltip" role="tooltip">{l('Access currency prices, monitoring, and utility tools.', '访问通货行情、监控和其它辅助工具', '查看通貨行情、監控與其他輔助工具', '화폐 시세, 모니터링 및 기타 보조 도구를 엽니다.')}</span></span>
        </button>
        <button className={active === 'about' ? 'active' : ''} aria-current={active === 'about' ? 'page' : undefined} onClick={onAbout}>
          <span className="build-center-nav-main"><Info aria-hidden="true" /><span>{l('About', '关于', '關於', '정보')}</span><span className="build-center-nav-tooltip" role="tooltip">{l('View app version, data sources, and project information.', '查看应用版本、数据来源和项目信息', '查看應用程式版本、資料來源與專案資訊', '앱 버전, 데이터 출처 및 프로젝트 정보를 확인합니다.')}</span></span>
        </button>
      </nav>
    </aside>
  )
}

function formatUpdatedAt(value: string, lang: Language): string {
  if (Number.isNaN(new Date(value).getTime())) return '-'
  return formatUiDate(value, lang, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function canRefreshBuild(build: SavedBuild): boolean {
  return Boolean(build.sourceUrl && (build.source === 'wegame' || build.source === 'poe-ninja'))
}

export function BuildCenter({ onCreate, onOpenFile, onImport, onOpen, onCheckForUpdate, onTradeCenter, onLibrary, onUtilities, onAbout, monitoring, onSettings }: BuildCenterProps) {
  const { lang } = useTranslation()
  const treeData = useTreeStore((state) => state.treeData)
  const savedBuilds = useTreeStore((state) => state.savedBuilds)
  const deleteBuild = useTreeStore((state) => state.deleteBuild)
  const [query, setQuery] = useState('')
  const [rowMenu, setRowMenu] = useState<RowMenuState | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<SavedBuild | null>(null)
  const [page, setPage] = useState(1)
  const [versionFilter, setVersionFilter] = useState('all')
  const [assetIndexes, setAssetIndexes] = useState<Record<string, SpriteIndex>>({})
  const l = (en: string, zhCN: string, zhTW: string, koKR: string) => uiText(lang, en, zhCN, zhTW, koKR)

  const sortedBuilds = useMemo(() => [...savedBuilds].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), [savedBuilds])
  const builds = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    if (!normalized) return sortedBuilds
    return sortedBuilds.filter((build) => {
      const cls = treeData?.constants.classes[build.selectedClassId]
      const asc = cls?.ascendancies.find((item) => (item.id || item.name) === build.selectedAscendancyId)
      return [build.name, cls?.name, cls?.displayName, asc?.name, asc?.displayName, buildRealmLabel(build.realm, lang)]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(normalized))
    })
  }, [query, sortedBuilds, treeData, lang])
  const buildVersions = useMemo(() => [...new Set(savedBuilds.map((build) => build.treeVersion).filter(Boolean))]
    .sort((a, b) => b.localeCompare(a, undefined, { numeric: true })), [savedBuilds])
  const filteredBuilds = useMemo(() => versionFilter === 'all'
    ? builds
    : builds.filter((build) => build.treeVersion === versionFilter), [builds, versionFilter])
  const recentBuilds = sortedBuilds.slice(0, 4)
  const pageCount = Math.max(1, Math.ceil(filteredBuilds.length / BUILDS_PER_PAGE))
  const currentPage = Math.min(page, pageCount)
  const pageStart = (currentPage - 1) * BUILDS_PER_PAGE
  const pagedBuilds = filteredBuilds.slice(pageStart, pageStart + BUILDS_PER_PAGE)

  useEffect(() => {
    setPage(1)
  }, [query, versionFilter])

  useEffect(() => {
    if (versionFilter !== 'all' && !buildVersions.includes(versionFilter)) setVersionFilter('all')
  }, [buildVersions, versionFilter])

  useEffect(() => {
    const versions = [...new Set(savedBuilds.map((build) => build.treeVersion).filter(Boolean))]
    let active = true
    void Promise.all(versions.map(async (version) => [version, await loadTreeAssetIndex(version)] as const))
      .then((entries) => {
        if (active) setAssetIndexes(Object.fromEntries(entries))
      })
    return () => { active = false }
  }, [savedBuilds])

  useEffect(() => {
    if (page > pageCount) setPage(pageCount)
  }, [page, pageCount])

  useEffect(() => {
    if (!rowMenu) return
    const closeMenu = (event?: Event) => {
      if (event?.target instanceof Element && event.target.closest('.row-menu, [data-build-menu-trigger]')) return
      setRowMenu(null)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setRowMenu(null)
    }
    document.addEventListener('pointerdown', closeMenu)
    window.addEventListener('resize', closeMenu)
    window.addEventListener('scroll', closeMenu, true)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeMenu)
      window.removeEventListener('resize', closeMenu)
      window.removeEventListener('scroll', closeMenu, true)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [rowMenu])

  useEffect(() => {
    setRowMenu(null)
  }, [currentPage, query, versionFilter])

  const toggleRowMenu = (buildId: string, button: HTMLButtonElement) => {
    if (rowMenu?.buildId === buildId) {
      setRowMenu(null)
      return
    }
    const build = savedBuilds.find((item) => item.id === buildId)
    const rect = button.getBoundingClientRect()
    const left = Math.max(8, Math.min(window.innerWidth - ROW_MENU_WIDTH - 8, rect.right - ROW_MENU_WIDTH))
    const menuHeight = build && canRefreshBuild(build) ? ROW_MENU_UPDATE_HEIGHT : ROW_MENU_HEIGHT
    const top = rect.bottom + menuHeight + 8 <= window.innerHeight
      ? rect.bottom + 4
      : Math.max(8, rect.top - menuHeight - 4)
    setRowMenu({ buildId, left, top })
  }

  const buildClass = (build: SavedBuild) => {
    const cls = treeData?.constants.classes[build.selectedClassId]
    const asc = cls?.ascendancies.find((item) => (item.id || item.name) === build.selectedAscendancyId)
    return {
      name: cls ? translateGameText(cls.displayName || cls.name, lang) : build.selectedClassId,
      ascendancy: asc ? translateGameText(asc.displayName || asc.name, lang) : '',
      imageUrl: getTreeAssetUrl(assetIndexes[build.treeVersion] || {}, asc?.background?.image || cls?.background?.image),
    }
  }
  const sourceLabel = (build: SavedBuild) => {
    const source = build.source || (build.importedBuildCode ? 'pob' : 'local')
    if (source === 'wegame') return 'WeGame'
    if (source === 'poe-ninja') return 'poe.ninja'
    if (source === 'json') return 'JSON'
    if (source === 'pob') return 'PoB Code'
    return l('Local', '本地', '本機', '로컬')
  }

  const armedCount = monitoring?.purchaseTargets.filter((target) => target.status === 'armed').length || 0
  const pendingCount = monitoring?.targets.reduce((total, target) => total + target.pendingOpportunityCount, 0) || 0
  const isActivelyMonitoring = armedCount > 0 && !monitoring?.globalPaused

  return (
    <div className="build-center">
      <BuildCenterNav active="center" onCenter={() => {}} onLibrary={onLibrary} onTradeCenter={onTradeCenter} onUtilities={onUtilities} onAbout={onAbout} />
      <header className="center-app-bar">
        <div className="center-actions">
          <GameRuntimeIndicator />
          <button className="icon-command" onClick={onSettings} title={l('Global settings', '全局设置', '全域設定', '전역 설정')} aria-label={l('Global settings', '全局设置', '全域設定', '전역 설정')}><Settings /></button>
          <button className="icon-command" title={l('Help', '帮助', '說明', '도움말')} aria-label={l('Help', '帮助', '說明', '도움말')}><CircleHelp /></button>
        </div>
        <div className="center-command-row">
          <div><button className="secondary-command" onClick={onOpenFile}><FolderOpen />{l('Open build', '打开构筑', '開啟構築', '빌드 열기')}</button><button className="secondary-command" onClick={onImport}><FileInput />{l('Import build', '导入构筑', '匯入構築', '빌드 가져오기')}</button><button className="primary-command" onClick={onCreate}><Plus />{l('New build', '新建构筑', '新增構築', '새 빌드')}</button></div>
        </div>
      </header>

      <main className="build-center-content">
        {savedBuilds.length === 0 ? (
          <section className="center-empty-state">
            <span className="empty-build-mark">S</span>
            <h2>{l('No local builds yet', '还没有本地构筑', '尚無本機構築', '로컬 빌드가 없습니다')}</h2>
            <div><button className="primary-command" onClick={onCreate}><Plus />{l('New build', '新建构筑', '新增構築', '새 빌드')}</button><button className="secondary-command" onClick={onOpenFile}><FolderOpen />{l('Open build', '打开构筑', '開啟構築', '빌드 열기')}</button><button className="secondary-command" onClick={onImport}><FileInput />{l('Import build', '导入构筑', '匯入構築', '빌드 가져오기')}</button><button className="secondary-command" onClick={onTradeCenter}><Store />{l('Trade Center', '交易中心', '交易中心', '거래 센터')}</button></div>
          </section>
        ) : <>
          <section className="recent-builds-section" id="recent-builds-section">
            <div className="center-section-title"><h2>{l('Recently opened', '最近打开', '最近開啟', '최근 열어본 빌드')}</h2><span>{recentBuilds.length}</span></div>
            <div className="recent-builds">
              {recentBuilds.map((build) => {
                const info = buildClass(build)
                return <button key={build.id} onClick={() => onOpen(build)}>
                  <span className="recent-class-mark">{info.name.slice(0, 1)}</span>
                  <span><strong>{build.name}<em className={`realm-tag ${build.realm}`}>{buildRealmLabel(build.realm, lang)}</em></strong><small>{info.name}{info.ascendancy ? ` · ${info.ascendancy}` : ''}</small></span>
                  <time><Clock3 />{formatUpdatedAt(build.updatedAt, lang)}</time>
                </button>
              })}
            </div>
          </section>

          <section className="build-table-section" id="build-table-section">
            <div className="center-section-title"><h2>{l('My builds', '我的构筑', '我的構築', '내 빌드')}</h2><span>{filteredBuilds.length}</span><label className="build-list-search"><Search /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={l('Search builds, classes, or ascendancies', '搜索构筑、职业或升华', '搜尋構築、職業或昇華', '빌드, 클래스 또는 전직 검색')} /></label><label className="build-version-filter"><ListFilter /><select value={versionFilter} onChange={(event) => setVersionFilter(event.target.value)} aria-label={l('Filter builds by version', '按版本筛选构筑', '依版本篩選構築', '버전별 빌드 필터')}><option value="all">{l('All versions', '全部版本', '所有版本', '모든 버전')}</option>{buildVersions.map((version) => <option key={version} value={version}>{version.replace('_', '.')}</option>)}</select></label></div>
            <div className="build-table-wrap">
              <div className="build-table-viewport">
                <table className="build-table">
                  <thead><tr><th>{l('Build', '构筑名', '構築名稱', '빌드')}</th><th>{l('Class / Ascendancy', '职业 / 升华', '職業 / 昇華', '클래스 / 전직')}</th><th>{l('Version', '版本', '版本', '버전')}</th><th>{l('Passives', '天赋点数', '天賦點數', '패시브')}</th><th>{l('Modified', '修改时间', '修改時間', '수정일')}</th><th>{l('Source', '来源', '來源', '출처')}</th><th aria-label={l('Actions', '操作', '操作', '작업')} /></tr></thead>
                  <tbody>{pagedBuilds.map((build) => {
                    const info = buildClass(build)
                    const characterLevel = build.characterLevel || getBuildCharacterLevel(build.importedBuildCode) || 1
                    return <tr key={build.id} onDoubleClick={() => onOpen(build)}>
                      <td><button className="build-name-cell" onClick={() => onOpen(build)}><span><FallbackImage src={info.imageUrl || undefined} alt="" decoding="async" fallback={info.name.slice(0, 1)} /></span><strong>{build.name}</strong><em className={`realm-tag ${build.realm}`}>{buildRealmLabel(build.realm, lang)}</em></button></td>
                      <td><strong>Lv.{characterLevel} · {info.name}</strong><small>{info.ascendancy || l('No ascendancy', '未选择升华', '未選擇昇華', '전직 선택 안 함')}</small></td>
                      <td>{build.treeVersion.replace('_', '.')}</td>
                      <td>{build.allocatedNodes.length}</td>
                      <td>{formatUpdatedAt(build.updatedAt, lang)}</td>
                      <td><span className={`source-tag ${(build.source && build.source !== 'local') || build.importedBuildCode ? 'imported' : ''}`}>{sourceLabel(build)}</span></td>
                      <td className="build-row-actions"><button className="icon-command compact" data-build-menu-trigger onClick={(event) => toggleRowMenu(build.id, event.currentTarget)} aria-expanded={rowMenu?.buildId === build.id} aria-label={l('More actions', '更多操作', '更多操作', '추가 작업')}><MoreVertical /></button></td>
                    </tr>
                  })}</tbody>
                </table>
                {filteredBuilds.length === 0 && <div className="table-empty">{l('No matching builds', '没有匹配的构筑', '沒有符合的構築', '일치하는 빌드가 없습니다')}</div>}
              </div>
              <footer className="build-pagination">
                <span>{filteredBuilds.length === 0 ? '0' : `${pageStart + 1}-${Math.min(pageStart + BUILDS_PER_PAGE, filteredBuilds.length)}`} / {filteredBuilds.length}</span>
                <div>
                  <button className="icon-command compact" disabled={currentPage <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))} title={l('Previous page', '上一页', '上一頁', '이전 페이지')} aria-label={l('Previous page', '上一页', '上一頁', '이전 페이지')}><ChevronLeft /></button>
                  <span>{currentPage} / {pageCount}</span>
                  <button className="icon-command compact" disabled={currentPage >= pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))} title={l('Next page', '下一页', '下一頁', '다음 페이지')} aria-label={l('Next page', '下一页', '下一頁', '다음 페이지')}><ChevronRight /></button>
                </div>
              </footer>
            </div>
          </section>
        </>}
      </main>
      {rowMenu && (() => {
        const build = savedBuilds.find((item) => item.id === rowMenu.buildId)
        if (!build) return null
        return createPortal(
          <div className="row-menu" style={{ left: rowMenu.left, top: rowMenu.top }} role="menu">
            <button role="menuitem" onClick={() => { setRowMenu(null); onOpen(build) }}>{l('Open', '打开', '開啟', '열기')}</button>
            {canRefreshBuild(build) && <button role="menuitem" onClick={() => { setRowMenu(null); onCheckForUpdate(build) }}><RefreshCw />{l('Check for updates', '检查更新', '檢查更新', '업데이트 확인')}</button>}
            <button role="menuitem" className="danger" onClick={() => { setRowMenu(null); setDeleteTarget(build) }}><Trash2 />{l('Delete', '删除', '刪除', '삭제')}</button>
          </div>,
          document.body,
        )
      })()}
      {deleteTarget && createPortal(
        <div className="modal-backdrop" role="presentation">
          <section className="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="delete-build-title">
            <AlertTriangle />
            <h2 id="delete-build-title">{l('Delete build?', '删除构筑？', '刪除構築？', '빌드를 삭제할까요?')}</h2>
            <p>{l(`Delete "${deleteTarget.name}"? This action cannot be undone.`, `确定要删除“${deleteTarget.name}”吗？此操作不能撤销。`, `確定要刪除「${deleteTarget.name}」嗎？此操作無法復原。`, `“${deleteTarget.name}” 빌드를 삭제할까요? 이 작업은 취소할 수 없습니다.`)}</p>
            <footer>
              <button className="secondary-command" onClick={() => setDeleteTarget(null)}>{l('Cancel', '取消', '取消', '취소')}</button>
              <button className="primary-command danger-command" onClick={() => { deleteBuild(deleteTarget.id); setDeleteTarget(null) }}><Trash2 />{l('Delete', '确认删除', '確認刪除', '삭제')}</button>
            </footer>
          </section>
        </div>,
        document.body,
      )}
    </div>
  )
}
