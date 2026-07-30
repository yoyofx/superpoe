import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeft, ChevronRight, CircleHelp, Clock3, FileInput, ListFilter, MoreVertical, Plus, Search, Settings, Store, Trash2 } from 'lucide-react'
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

interface BuildCenterProps {
  onCreate: () => void
  onImport: () => void
  onOpen: (build: SavedBuild) => void
  onMarket: () => void
  onSettings: () => void
}

const BUILDS_PER_PAGE = 5
const ROW_MENU_WIDTH = 108
const ROW_MENU_HEIGHT = 64

interface RowMenuState {
  buildId: string
  left: number
  top: number
}

function formatUpdatedAt(value: string, lang: Language): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  const locale = lang === 'zh-rCN' ? 'zh-CN' : lang === 'zh-rTW' ? 'zh-TW' : lang
  return new Intl.DateTimeFormat(locale === 'en' ? 'en-US' : locale, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

export function BuildCenter({ onCreate, onImport, onOpen, onMarket, onSettings }: BuildCenterProps) {
  const { lang } = useTranslation()
  const treeData = useTreeStore((state) => state.treeData)
  const savedBuilds = useTreeStore((state) => state.savedBuilds)
  const deleteBuild = useTreeStore((state) => state.deleteBuild)
  const [query, setQuery] = useState('')
  const [rowMenu, setRowMenu] = useState<RowMenuState | null>(null)
  const [page, setPage] = useState(1)
  const [versionFilter, setVersionFilter] = useState('all')
  const [assetIndexes, setAssetIndexes] = useState<Record<string, SpriteIndex>>({})
  const zh = lang === 'zh-rCN'

  const sortedBuilds = useMemo(() => [...savedBuilds].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), [savedBuilds])
  const builds = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    if (!normalized) return sortedBuilds
    return sortedBuilds.filter((build) => {
      const cls = treeData?.constants.classes[build.selectedClassId]
      const asc = cls?.ascendancies.find((item) => (item.id || item.name) === build.selectedAscendancyId)
      return [build.name, cls?.name, cls?.displayName, asc?.name, asc?.displayName, buildRealmLabel(build.realm, zh)]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(normalized))
    })
  }, [query, sortedBuilds, treeData, zh])
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
    const rect = button.getBoundingClientRect()
    const left = Math.max(8, Math.min(window.innerWidth - ROW_MENU_WIDTH - 8, rect.right - ROW_MENU_WIDTH))
    const top = rect.bottom + ROW_MENU_HEIGHT + 8 <= window.innerHeight
      ? rect.bottom + 4
      : Math.max(8, rect.top - ROW_MENU_HEIGHT - 4)
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
    if (source === 'json') return 'JSON'
    if (source === 'pob') return 'PoB Code'
    return zh ? '本地' : 'Local'
  }

  return (
    <div className="build-center">
      <header className="center-app-bar">
        <div className="app-brand center-brand"><img className="app-brand-logo" src="/assets/ui/superpoe2-logo.png" alt="" /><span><strong>{SUPERPOE_NAME}</strong><small>{SUPERPOE_VERSION_LABEL}</small></span></div>
        <div className="center-actions">
          <button className="icon-command" onClick={onMarket} title={zh ? '打开集市' : 'Open market'} aria-label={zh ? '打开集市' : 'Open market'}><Store /></button>
          <button className="icon-command" onClick={onSettings} title={zh ? '全局设置' : 'Global settings'} aria-label={zh ? '全局设置' : 'Global settings'}><Settings /></button>
          <button className="icon-command" title={zh ? '帮助' : 'Help'} aria-label={zh ? '帮助' : 'Help'}><CircleHelp /></button>
        </div>
        <div className="center-command-row">
          <div><h1>{zh ? '构筑中心' : 'Build center'}</h1><p>{zh ? '管理本地构筑，或从 PoB、WeGame 和 JSON 导入。' : 'Manage local builds or import from PoB, WeGame, and JSON.'}</p></div>
          <div><button className="secondary-command" onClick={onImport}><FileInput />{zh ? '导入构筑' : 'Import build'}</button><button className="primary-command" onClick={onCreate}><Plus />{zh ? '新建构筑' : 'New build'}</button></div>
        </div>
      </header>

      <main className="build-center-content">
        {savedBuilds.length === 0 ? (
          <section className="center-empty-state">
            <span className="empty-build-mark">S</span>
            <h2>{zh ? '还没有本地构筑' : 'No local builds yet'}</h2>
            <div><button className="primary-command" onClick={onCreate}><Plus />{zh ? '新建构筑' : 'New build'}</button><button className="secondary-command" onClick={onImport}><FileInput />{zh ? '导入构筑' : 'Import build'}</button><button className="secondary-command" onClick={onMarket}><Store />{zh ? '打开集市' : 'Open market'}</button></div>
          </section>
        ) : <>
          <section className="recent-builds-section">
            <div className="center-section-title"><h2>{zh ? '最近打开' : 'Recently opened'}</h2><span>{recentBuilds.length}</span></div>
            <div className="recent-builds">
              {recentBuilds.map((build) => {
                const info = buildClass(build)
                return <button key={build.id} onClick={() => onOpen(build)}>
                  <span className="recent-class-mark">{info.name.slice(0, 1)}</span>
                  <span><strong>{build.name}<em className={`realm-tag ${build.realm}`}>{buildRealmLabel(build.realm, zh)}</em></strong><small>{info.name}{info.ascendancy ? ` · ${info.ascendancy}` : ''}</small></span>
                  <time><Clock3 />{formatUpdatedAt(build.updatedAt, lang)}</time>
                </button>
              })}
            </div>
          </section>

          <section className="build-table-section">
            <div className="center-section-title"><h2>{zh ? '我的构筑' : 'My builds'}</h2><span>{filteredBuilds.length}</span><label className="build-list-search"><Search /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={zh ? '搜索构筑、职业或升华' : 'Search builds, classes, or ascendancies'} /></label><label className="build-version-filter"><ListFilter /><select value={versionFilter} onChange={(event) => setVersionFilter(event.target.value)} aria-label={zh ? '按版本筛选构筑' : 'Filter builds by version'}><option value="all">{zh ? '全部版本' : 'All versions'}</option>{buildVersions.map((version) => <option key={version} value={version}>{version.replace('_', '.')}</option>)}</select></label></div>
            <div className="build-table-wrap">
              <div className="build-table-viewport">
                <table className="build-table">
                  <thead><tr><th>{zh ? '构筑名' : 'Build'}</th><th>{zh ? '职业 / 升华' : 'Class / Ascendancy'}</th><th>{zh ? '版本' : 'Version'}</th><th>{zh ? '天赋点数' : 'Passives'}</th><th>{zh ? '修改时间' : 'Modified'}</th><th>{zh ? '来源' : 'Source'}</th><th aria-label={zh ? '操作' : 'Actions'} /></tr></thead>
                  <tbody>{pagedBuilds.map((build) => {
                    const info = buildClass(build)
                    const characterLevel = build.characterLevel || getBuildCharacterLevel(build.importedBuildCode) || 1
                    return <tr key={build.id} onDoubleClick={() => onOpen(build)}>
                      <td><button className="build-name-cell" onClick={() => onOpen(build)}><span><FallbackImage src={info.imageUrl || undefined} alt="" decoding="async" fallback={info.name.slice(0, 1)} /></span><strong>{build.name}</strong><em className={`realm-tag ${build.realm}`}>{buildRealmLabel(build.realm, zh)}</em></button></td>
                      <td><strong>Lv.{characterLevel} · {info.name}</strong><small>{info.ascendancy || (zh ? '未选择升华' : 'No ascendancy')}</small></td>
                      <td>{build.treeVersion.replace('_', '.')}</td>
                      <td>{build.allocatedNodes.length}</td>
                      <td>{formatUpdatedAt(build.updatedAt, lang)}</td>
                      <td><span className={`source-tag ${(build.source && build.source !== 'local') || build.importedBuildCode ? 'imported' : ''}`}>{sourceLabel(build)}</span></td>
                      <td className="build-row-actions"><button className="icon-command compact" data-build-menu-trigger onClick={(event) => toggleRowMenu(build.id, event.currentTarget)} aria-expanded={rowMenu?.buildId === build.id} aria-label={zh ? '更多操作' : 'More actions'}><MoreVertical /></button></td>
                    </tr>
                  })}</tbody>
                </table>
                {filteredBuilds.length === 0 && <div className="table-empty">{zh ? '没有匹配的构筑' : 'No matching builds'}</div>}
              </div>
              <footer className="build-pagination">
                <span>{filteredBuilds.length === 0 ? '0' : `${pageStart + 1}-${Math.min(pageStart + BUILDS_PER_PAGE, filteredBuilds.length)}`} / {filteredBuilds.length}</span>
                <div>
                  <button className="icon-command compact" disabled={currentPage <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))} title={zh ? '上一页' : 'Previous page'} aria-label={zh ? '上一页' : 'Previous page'}><ChevronLeft /></button>
                  <span>{currentPage} / {pageCount}</span>
                  <button className="icon-command compact" disabled={currentPage >= pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))} title={zh ? '下一页' : 'Next page'} aria-label={zh ? '下一页' : 'Next page'}><ChevronRight /></button>
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
            <button role="menuitem" onClick={() => { setRowMenu(null); onOpen(build) }}>{zh ? '打开' : 'Open'}</button>
            <button role="menuitem" className="danger" onClick={() => { deleteBuild(build.id); setRowMenu(null) }}><Trash2 />{zh ? '删除' : 'Delete'}</button>
          </div>,
          document.body,
        )
      })()}
    </div>
  )
}
