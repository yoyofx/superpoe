import { useMemo, useState } from 'react'
import { CircleHelp, Clock3, FileInput, Languages, MoreVertical, Plus, Search, Settings, Trash2 } from 'lucide-react'
import { LANGUAGE_OPTIONS, translateGameText, type Language } from '@/i18n/translationLoader'
import { useTranslation } from '@/i18n/useTranslation'
import { useTreeStore } from '@/store/treeStore'
import type { SavedBuild } from '@/types/tree'

interface BuildCenterProps {
  onCreate: () => void
  onImport: () => void
  onOpen: (build: SavedBuild) => void
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

export function BuildCenter({ onCreate, onImport, onOpen }: BuildCenterProps) {
  const { lang, setLanguage } = useTranslation()
  const treeData = useTreeStore((state) => state.treeData)
  const treeVersion = useTreeStore((state) => state.treeVersion)
  const savedBuilds = useTreeStore((state) => state.savedBuilds)
  const deleteBuild = useTreeStore((state) => state.deleteBuild)
  const [query, setQuery] = useState('')
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  const zh = lang === 'zh-rCN'

  const builds = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    const sorted = [...savedBuilds].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    if (!normalized) return sorted
    return sorted.filter((build) => {
      const cls = treeData?.constants.classes[build.selectedClassId]
      const asc = cls?.ascendancies.find((item) => (item.id || item.name) === build.selectedAscendancyId)
      return [build.name, cls?.name, cls?.displayName, asc?.name, asc?.displayName]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(normalized))
    })
  }, [query, savedBuilds, treeData])
  const recentBuilds = builds.slice(0, 4)

  const buildClass = (build: SavedBuild) => {
    const cls = treeData?.constants.classes[build.selectedClassId]
    const asc = cls?.ascendancies.find((item) => (item.id || item.name) === build.selectedAscendancyId)
    return {
      name: cls ? translateGameText(cls.displayName || cls.name, lang) : build.selectedClassId,
      ascendancy: asc ? translateGameText(asc.displayName || asc.name, lang) : '',
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
        <div className="app-brand center-brand"><span className="app-brand-mark"><i>S</i></span><span><strong>SuperPoE</strong><small>PoB2 {treeVersion.replace('_', '.')} · Offline</small></span></div>
        <label className="build-search"><Search /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={zh ? '搜索构筑名称、职业或升华' : 'Search builds, classes, or ascendancies'} /></label>
        <div className="center-actions">
          <label className="language-select"><Languages /><select value={lang} onChange={(event) => setLanguage(event.target.value as Language)}>{LANGUAGE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
          <button className="icon-command" title={zh ? '设置' : 'Settings'} aria-label={zh ? '设置' : 'Settings'}><Settings /></button>
          <button className="icon-command" title={zh ? '帮助' : 'Help'} aria-label={zh ? '帮助' : 'Help'}><CircleHelp /></button>
        </div>
      </header>

      <main className="build-center-content">
        <div className="center-command-row">
          <div><h1>{zh ? '构筑中心' : 'Build center'}</h1><p>{zh ? '管理本地构筑，或从 PoB、WeGame 和 JSON 导入。' : 'Manage local builds or import from PoB, WeGame, and JSON.'}</p></div>
          <div><button className="secondary-command" onClick={onImport}><FileInput />{zh ? '导入构筑' : 'Import build'}</button><button className="primary-command" onClick={onCreate}><Plus />{zh ? '新建构筑' : 'New build'}</button></div>
        </div>

        {savedBuilds.length === 0 ? (
          <section className="center-empty-state">
            <span className="empty-build-mark">S</span>
            <h2>{zh ? '还没有本地构筑' : 'No local builds yet'}</h2>
            <div><button className="primary-command" onClick={onCreate}><Plus />{zh ? '新建构筑' : 'New build'}</button><button className="secondary-command" onClick={onImport}><FileInput />{zh ? '导入构筑' : 'Import build'}</button></div>
          </section>
        ) : <>
          <section className="recent-builds-section">
            <div className="center-section-title"><h2>{zh ? '最近打开' : 'Recently opened'}</h2><span>{recentBuilds.length}</span></div>
            <div className="recent-builds">
              {recentBuilds.map((build) => {
                const info = buildClass(build)
                return <button key={build.id} onClick={() => onOpen(build)}>
                  <span className="recent-class-mark">{info.name.slice(0, 1)}</span>
                  <span><strong>{build.name}</strong><small>{info.name}{info.ascendancy ? ` · ${info.ascendancy}` : ''}</small></span>
                  <time><Clock3 />{formatUpdatedAt(build.updatedAt, lang)}</time>
                </button>
              })}
            </div>
          </section>

          <section className="build-table-section">
            <div className="center-section-title"><h2>{zh ? '我的构筑' : 'My builds'}</h2><span>{builds.length}</span></div>
            <div className="build-table-wrap">
              <table className="build-table">
                <thead><tr><th>{zh ? '构筑名' : 'Build'}</th><th>{zh ? '职业 / 升华' : 'Class / Ascendancy'}</th><th>{zh ? '版本' : 'Version'}</th><th>{zh ? '天赋点数' : 'Passives'}</th><th>{zh ? '修改时间' : 'Modified'}</th><th>{zh ? '来源' : 'Source'}</th><th aria-label={zh ? '操作' : 'Actions'} /></tr></thead>
                <tbody>{builds.map((build) => {
                  const info = buildClass(build)
                  return <tr key={build.id} onDoubleClick={() => onOpen(build)}>
                    <td><button className="build-name-cell" onClick={() => onOpen(build)}><span>{info.name.slice(0, 1)}</span><strong>{build.name}</strong></button></td>
                    <td><strong>{info.name}</strong><small>{info.ascendancy || (zh ? '未选择升华' : 'No ascendancy')}</small></td>
                    <td>{build.treeVersion.replace('_', '.')}</td>
                    <td>{build.allocatedNodes.length}</td>
                    <td>{formatUpdatedAt(build.updatedAt, lang)}</td>
                    <td><span className={`source-tag ${(build.source && build.source !== 'local') || build.importedBuildCode ? 'imported' : ''}`}>{sourceLabel(build)}</span></td>
                    <td className="build-row-actions"><button className="icon-command compact" onClick={() => setOpenMenuId((id) => id === build.id ? null : build.id)} aria-label={zh ? '更多操作' : 'More actions'}><MoreVertical /></button>{openMenuId === build.id && <div className="row-menu"><button onClick={() => onOpen(build)}>{zh ? '打开' : 'Open'}</button><button className="danger" onClick={() => { deleteBuild(build.id); setOpenMenuId(null) }}><Trash2 />{zh ? '删除' : 'Delete'}</button></div>}</td>
                  </tr>
                })}</tbody>
              </table>
              {builds.length === 0 && <div className="table-empty">{zh ? '没有匹配的构筑' : 'No matching builds'}</div>}
            </div>
          </section>
        </>}
      </main>
    </div>
  )
}
