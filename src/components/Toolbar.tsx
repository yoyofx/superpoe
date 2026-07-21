import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Calculator,
  ChevronDown,
  CircleHelp,
  Download,
  ArrowLeft,
  Languages,
  LockKeyhole,
  MoreVertical,
  Redo2,
  Save,
  Search,
  Settings,
  Sparkles,
  Swords,
  Undo2,
  Upload,
  Workflow,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import { ExportPanel } from '@/components/ExportPanel'
import { LANGUAGE_OPTIONS, translateGameText, type Language } from '@/i18n/translationLoader'
import { useTranslation } from '@/i18n/useTranslation'
import { buildRealmLabel } from '@/engine/buildRealm'
import { SUPERPOE_VERSION_LABEL } from '@/engine/appVersion'
import {
  DEFAULT_ZOOM,
  MAX_ZOOM,
  MIN_ZOOM,
  useTreeStore,
} from '@/store/treeStore'

export type WorkspaceView = 'passive' | 'equipment' | 'skills' | 'calculation'
type ToolbarMenu = 'export' | null

interface ToolbarProps {
  activeView: WorkspaceView
  onViewChange: (view: WorkspaceView) => void
  buildName: string
  onBuildNameChange: (name: string) => void
  saveStatus: 'saved' | 'dirty' | 'saving' | 'error'
  onHome: () => void
  onImport: () => void
  onSave: () => void
}

const VIEW_ICONS = {
  equipment: Swords,
  passive: Workflow,
  skills: Sparkles,
  calculation: Calculator,
}

const VIEW_ORDER: WorkspaceView[] = ['equipment', 'passive', 'skills', 'calculation']

export function Toolbar({ activeView, onViewChange, buildName, onBuildNameChange, saveStatus, onHome, onImport, onSave }: ToolbarProps) {
  const { t, lang, setLanguage } = useTranslation()
  const zoom = useTreeStore((state) => state.zoom)
  const treeVersion = useTreeStore((state) => state.treeVersion)
  const selectedClassId = useTreeStore((state) => state.selectedClassId)
  const selectedAscendancyId = useTreeStore((state) => state.selectedAscendancyId)
  const searchQuery = useTreeStore((state) => state.searchQuery)
  const searchMatchCount = useTreeStore((state) => state.searchMatchCount)
  const allocatedNodes = useTreeStore((state) => state.allocatedNodes)
  const calcLoading = useTreeStore((state) => state.calcLoading)
  const treeEditMode = useTreeStore((state) => state.treeEditMode)
  const weaponSetMode = useTreeStore((state) => state.weaponSetMode)
  const undoStack = useTreeStore((state) => state.undoStack)
  const redoStack = useTreeStore((state) => state.redoStack)
  const treeData = useTreeStore((state) => state.treeData)
  const buildRealm = useTreeStore((state) => state.buildRealm)
  const setZoom = useTreeStore((state) => state.setZoom)
  const selectClass = useTreeStore((state) => state.selectClass)
  const selectAscendancy = useTreeStore((state) => state.selectAscendancy)
  const setTreeEditMode = useTreeStore((state) => state.setTreeEditMode)
  const setWeaponSetMode = useTreeStore((state) => state.setWeaponSetMode)
  const setSearchQuery = useTreeStore((state) => state.setSearchQuery)
  const performSearch = useTreeStore((state) => state.performSearch)
  const runCalculation = useTreeStore((state) => state.runCalculation)
  const undo = useTreeStore((state) => state.undo)
  const redo = useTreeStore((state) => state.redo)

  const [activeMenu, setActiveMenu] = useState<ToolbarMenu>(null)

  useEffect(() => {
    const timer = window.setTimeout(() => performSearch(searchQuery), 180)
    return () => window.clearTimeout(timer)
  }, [performSearch, searchQuery])

  const classEntries = Object.entries(treeData?.constants?.classes || {})
  const currentClass = treeData?.constants?.classes?.[selectedClassId]
  const ascendancies = currentClass?.ascendancies || []
  const currentAscendancy = ascendancies.find((asc) => (asc.id || asc.name) === selectedAscendancyId)
  const className = currentClass ? translateGameText(currentClass.displayName || currentClass.name, lang) : 'Character'
  const ascendancyName = currentAscendancy
    ? translateGameText(currentAscendancy.displayName || currentAscendancy.name, lang)
    : ''
  const viewLabels = useMemo(() => lang === 'zh-rCN'
    ? { passive: '天赋', equipment: '装备', skills: '技能', calculation: '计算' }
    : { passive: 'Passive', equipment: 'Equipment', skills: 'Skills', calculation: 'Calculate' }, [lang])
  const saveLabels = lang === 'zh-rCN'
    ? { saved: '已保存', dirty: '有未保存修改', saving: '正在保存', error: '保存失败' }
    : { saved: 'Saved', dirty: 'Unsaved changes', saving: 'Saving', error: 'Save failed' }

  const handleZoomFit = useCallback(() => {
    if (!treeData) return
    const constants = treeData.constants
    const treeWidth = constants.max_x - constants.min_x
    const treeHeight = constants.max_y - constants.min_y
    const viewportWidth = Math.max(1, window.innerWidth - 520)
    const viewportHeight = Math.max(1, window.innerHeight - 94)
    const fitZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.min(viewportWidth / treeWidth, viewportHeight / treeHeight) * 0.94))
    useTreeStore.setState({
      zoom: fitZoom,
      offsetX: -(constants.min_x + constants.max_x) / 2,
      offsetY: -(constants.min_y + constants.max_y) / 2,
    })
  }, [treeData])

  const resetZoom = useCallback(() => {
    if (!treeData) return
    const constants = treeData.constants
    useTreeStore.setState({
      zoom: DEFAULT_ZOOM,
      offsetX: -(constants.min_x + constants.max_x) / 2,
      offsetY: -(constants.min_y + constants.max_y) / 2,
    })
  }, [treeData])

  const toggleMenu = (menu: Exclude<ToolbarMenu, null>) => {
    setActiveMenu((current) => current === menu ? null : menu)
  }

  const openCalculate = () => {
    onViewChange('calculation')
    void runCalculation()
  }

  return (
    <header className="workbench-header">
      <div className="app-command-bar">
        <div className="app-brand" aria-label="SuperPoE2">
          <span className="app-brand-mark"><i>S</i></span>
          <span><strong>SuperPoE2</strong><small>{SUPERPOE_VERSION_LABEL}</small></span>
        </div>

        <div className="current-build">
          <button className="icon-command compact back-command" onClick={onHome} title={lang === 'zh-rCN' ? '返回构筑中心' : 'Back to build center'} aria-label={lang === 'zh-rCN' ? '返回构筑中心' : 'Back to build center'}><ArrowLeft /></button>
          <span className="class-emblem">{className.slice(0, 1)}</span>
          <span className="current-build-copy">
            <input
              className="current-build-name"
              value={buildName}
              maxLength={80}
              onChange={(event) => onBuildNameChange(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }}
              aria-label={lang === 'zh-rCN' ? '构筑名称' : 'Build name'}
              title={lang === 'zh-rCN' ? '修改构筑名称' : 'Rename build'}
            />
            <small>{className}{ascendancyName ? ` · ${ascendancyName}` : ''}</small>
          </span>
          <span className={`realm-tag ${buildRealm}`}>{buildRealmLabel(buildRealm, lang === 'zh-rCN')}</span>
          <span className={`save-state ${saveStatus}`}><i />{saveLabels[saveStatus]}</span>
        </div>

        <div className="command-actions">
          <span className="version-indicator" title={lang === 'zh-rCN' ? '构筑版本已确定' : 'Build version is fixed'} aria-label={`${t('toolbar.version')} ${treeVersion.replace('_', '.')}`}>
            <LockKeyhole />
            <span>{treeVersion.replace('_', '.')}</span>
          </span>
          <button className="icon-command" onClick={onImport} title={t('toolbar.importTitle')} aria-label={t('toolbar.importTitle')}><Upload /></button>
          <button className="icon-command" onClick={() => toggleMenu('export')} title={t('toolbar.exportTitle')} aria-label={t('toolbar.exportTitle')}><Download /></button>
          <button className="primary-command" onClick={onSave}><Save />{lang === 'zh-rCN' ? '保存' : 'Save'}</button>
          <button className="icon-command" title={lang === 'zh-rCN' ? '更多操作' : 'More'} aria-label={lang === 'zh-rCN' ? '更多操作' : 'More'}><MoreVertical /></button>
        </div>
      </div>

      <div className="workspace-tabs-bar">
        <nav className="workspace-tabs" aria-label={lang === 'zh-rCN' ? '构筑编辑页面' : 'Build workspace'}>
          {VIEW_ORDER.map((view) => {
            const Icon = VIEW_ICONS[view]
            const count = view === 'passive' ? allocatedNodes.size : null
            return (
              <button key={view} className={activeView === view ? 'active' : ''} onClick={() => onViewChange(view)} aria-label={viewLabels[view]} title={viewLabels[view]}>
                <Icon /> <span>{viewLabels[view]}</span>{count != null && <small>{count}</small>}
              </button>
            )
          })}
        </nav>

        <div className="context-tools">
          {activeView === 'passive' && <>
            <label className="node-search">
              <Search />
              <input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && performSearch(searchQuery)} placeholder={t('toolbar.search')} />
              {searchQuery && <span>{searchMatchCount}</span>}
            </label>
            <select className="context-select" value={selectedClassId} onChange={(event) => selectClass(event.target.value)} aria-label={t('toolbar.class')}>
              {classEntries.map(([id, cls]) => <option key={id} value={id}>{translateGameText(cls.displayName || cls.name, lang)}</option>)}
            </select>
            {ascendancies.length > 0 && <select className="context-select" value={selectedAscendancyId} onChange={(event) => selectAscendancy(event.target.value)} aria-label={t('toolbar.ascendancy')}>
              {ascendancies.map((asc) => <option key={asc.id || asc.name} value={asc.id || asc.name}>{translateGameText(asc.displayName || asc.name, lang)}</option>)}
            </select>}
            <div className="mode-control" aria-label={t('toolbar.weaponSet')}>
              <button className={treeEditMode ? 'active edit' : ''} onClick={() => setTreeEditMode(!treeEditMode)}>{t('toolbar.edit')}</button>
              <button disabled={!treeEditMode} className={treeEditMode && weaponSetMode === 0 ? 'active' : ''} onClick={() => setWeaponSetMode(0)}>{t('toolbar.both')}</button>
              <button disabled={!treeEditMode} className={treeEditMode && weaponSetMode === 1 ? 'active weapon-one' : ''} onClick={() => setWeaponSetMode(1)}>I</button>
              <button disabled={!treeEditMode} className={treeEditMode && weaponSetMode === 2 ? 'active weapon-two' : ''} onClick={() => setWeaponSetMode(2)}>II</button>
            </div>
            <button className="icon-command compact" disabled={!undoStack.length} onClick={undo} title="Undo" aria-label="Undo"><Undo2 /></button>
            <button className="icon-command compact" disabled={!redoStack.length} onClick={redo} title="Redo" aria-label="Redo"><Redo2 /></button>
            <div className="zoom-control">
              <button onClick={() => setZoom(Math.max(MIN_ZOOM, zoom / 1.3))} title={t('toolbar.zoomOut')} aria-label={t('toolbar.zoomOut')}><ZoomOut /></button>
              <button onClick={resetZoom} title={t('toolbar.zoomReset')}>{Math.round(zoom * 100)}%</button>
              <button onClick={handleZoomFit} title={t('toolbar.zoomFit')}>{t('toolbar.fit')}</button>
              <button onClick={() => setZoom(Math.min(MAX_ZOOM, zoom * 1.3))} title={t('toolbar.zoomIn')} aria-label={t('toolbar.zoomIn')}><ZoomIn /></button>
            </div>
          </>}

          {activeView === 'calculation' && <button className="primary-command" onClick={openCalculate} disabled={!allocatedNodes.size || calcLoading}><Calculator />{calcLoading ? t('stats.calculating') : t('toolbar.calc')}</button>}

          <span className="toolbar-spacer" />
          <label className="language-select" title={t('toolbar.language')}>
            <Languages />
            <select value={lang} onChange={(event) => setLanguage(event.target.value as Language)} aria-label={t('toolbar.language')}>
              {LANGUAGE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
            <ChevronDown />
          </label>
          <button className="icon-command compact" title={lang === 'zh-rCN' ? '设置' : 'Settings'} aria-label={lang === 'zh-rCN' ? '设置' : 'Settings'}><Settings /></button>
          <button className="icon-command compact" title={lang === 'zh-rCN' ? '帮助' : 'Help'} aria-label={lang === 'zh-rCN' ? '帮助' : 'Help'}><CircleHelp /></button>
        </div>
      </div>

      {activeMenu && <div className="command-popover">
        {activeMenu === 'export' && <ExportPanel embedded />}
      </div>}
    </header>
  )
}
