import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  CircleHelp,
  BellRing,
  ArrowLeft,
  FileInput,
  FileOutput,
  Files,
  LockKeyhole,
  MoreVertical,
  Redo2,
  Save,
  Search,
  Settings,
  Sparkles,
  Store,
  Swords,
  Undo2,
  Workflow,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import { ExportPanel } from '@/components/ExportPanel'
import { FallbackImage } from '@/components/FallbackImage'
import { getBuildCharacterLevel } from '@/engine/buildCode'
import { getTreeAssetUrl, loadTreeAssetIndex } from '@/engine/treeAssetIndex'
import type { SpriteIndex } from '@/engine/spriteLoader'
import { translateGameText } from '@/i18n/translationLoader'
import { useTranslation } from '@/i18n/useTranslation'
import { buildRealmLabel } from '@/engine/buildRealm'
import { SUPERPOE_NAME, SUPERPOE_VERSION_LABEL } from '@/engine/appVersion'
import { GameRuntimeIndicator } from '@/components/GameRuntimeIndicator'
import { MAX_ACTIVE_PURCHASE_TARGETS, type MarketMonitoringSnapshot } from '@/types/market'
import { uiText } from '@/i18n/uiLocale'
import {
  DEFAULT_ZOOM,
  MAX_ZOOM,
  MIN_ZOOM,
  useTreeStore,
} from '@/store/treeStore'

export type WorkspaceView = 'passive' | 'equipment' | 'skills'
type ToolbarMenu = 'export' | 'more' | null

interface ToolbarProps {
  activeView: WorkspaceView
  onViewChange: (view: WorkspaceView) => void
  onTradeCenter: () => void
  monitoring?: MarketMonitoringSnapshot | null
  buildName: string
  buildSourceUrl?: string | null
  onBuildNameChange: (name: string) => void
  saveStatus: 'saved' | 'dirty' | 'saving' | 'error'
  onHome: () => void
  onImport: () => void
  onSave: () => void
  onSaveCopy: () => void
  onSettings: () => void
}

const VIEW_ICONS = {
  equipment: Swords,
  passive: Workflow,
  skills: Sparkles,
}

const VIEW_ORDER: WorkspaceView[] = ['equipment', 'skills', 'passive']

export function Toolbar({ activeView, onViewChange, onTradeCenter, monitoring, buildName, buildSourceUrl, onBuildNameChange, saveStatus, onHome, onImport, onSave, onSaveCopy, onSettings }: ToolbarProps) {
  const { t, lang } = useTranslation()
  const l = (en: string, zhCN: string, zhTW: string, koKR: string) => uiText(lang, en, zhCN, zhTW, koKR)
  const zoom = useTreeStore((state) => state.zoom)
  const treeVersion = useTreeStore((state) => state.treeVersion)
  const selectedClassId = useTreeStore((state) => state.selectedClassId)
  const selectedAscendancyId = useTreeStore((state) => state.selectedAscendancyId)
  const searchQuery = useTreeStore((state) => state.searchQuery)
  const searchMatchCount = useTreeStore((state) => state.searchMatchCount)
  const allocatedNodes = useTreeStore((state) => state.allocatedNodes)
  const treeEditMode = useTreeStore((state) => state.treeEditMode)
  const weaponSetMode = useTreeStore((state) => state.weaponSetMode)
  const undoStack = useTreeStore((state) => state.undoStack)
  const redoStack = useTreeStore((state) => state.redoStack)
  const treeData = useTreeStore((state) => state.treeData)
  const buildRealm = useTreeStore((state) => state.buildRealm)
  const pobBuildRevision = useTreeStore((state) => state.pobBuildRevision)
  const getActivePobCode = useTreeStore((state) => state.getActivePobCode)
  const setZoom = useTreeStore((state) => state.setZoom)
  const setBuildRealm = useTreeStore((state) => state.setBuildRealm)
  const selectClass = useTreeStore((state) => state.selectClass)
  const selectAscendancy = useTreeStore((state) => state.selectAscendancy)
  const setTreeEditMode = useTreeStore((state) => state.setTreeEditMode)
  const setWeaponSetMode = useTreeStore((state) => state.setWeaponSetMode)
  const setSearchQuery = useTreeStore((state) => state.setSearchQuery)
  const performSearch = useTreeStore((state) => state.performSearch)
  const undo = useTreeStore((state) => state.undo)
  const redo = useTreeStore((state) => state.redo)

  const [activeMenu, setActiveMenu] = useState<ToolbarMenu>(null)

  const [assetIndex, setAssetIndex] = useState<SpriteIndex>({})

  useEffect(() => {
    let active = true
    setAssetIndex({})
    void loadTreeAssetIndex(treeVersion).then((index) => {
      if (active) setAssetIndex(index)
    })
    return () => { active = false }
  }, [treeVersion])

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
  const characterImageUrl = getTreeAssetUrl(
    assetIndex,
    currentAscendancy?.background?.image || currentClass?.background?.image,
  )
  const characterLevel = useMemo(() => {
    const code = getActivePobCode()
    if (!code) return '1'
    return String(getBuildCharacterLevel(code) || '--')
  }, [getActivePobCode, pobBuildRevision])
  const viewLabels = useMemo(() => ({
    passive: uiText(lang, 'Passive', '天赋', '天賦', '패시브'),
    equipment: uiText(lang, 'Equipment', '装备', '裝備', '장비'),
    skills: uiText(lang, 'Skills', '技能', '技能', '스킬'),
  }), [lang])
  const saveLabels = {
    saved: l('Saved', '已保存', '已儲存', '저장됨'),
    dirty: l('Unsaved changes', '有未保存修改', '有未儲存的修改', '저장하지 않은 변경 사항'),
    saving: l('Saving', '正在保存', '正在儲存', '저장 중'),
    error: l('Save failed', '保存失败', '儲存失敗', '저장 실패'),
  }

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
  const armedCount = monitoring?.purchaseTargets.filter((target) => target.status === 'armed').length || 0
  const pendingCount = monitoring?.targets.reduce((total, target) => total + target.pendingOpportunityCount, 0) || 0
  const isActivelyMonitoring = armedCount > 0 && !monitoring?.globalPaused

  return (
    <header className="workbench-header">
      <div className="app-command-bar">
        <div className="app-brand" aria-label={SUPERPOE_NAME}>
          <img className="app-brand-logo" src="/assets/ui/superpoe2-logo.png" alt="" />
          <span><strong>{SUPERPOE_NAME}</strong><small>{SUPERPOE_VERSION_LABEL}</small></span>
        </div>

        <div className="current-build">
          <button className="icon-command compact back-command" onClick={onHome} title={l('Back to build center', '返回构筑中心', '返回構築中心', '빌드 센터로 돌아가기')} aria-label={l('Back to build center', '返回构筑中心', '返回構築中心', '빌드 센터로 돌아가기')}><ArrowLeft /></button>
          <span className="current-build-profile">
            <span className="class-emblem">
              <FallbackImage src={characterImageUrl || undefined} alt="" decoding="async" fallback={className.slice(0, 1)} />
            </span>
            <span className="current-build-copy">
              <input
                className="current-build-name"
                value={buildName}
                maxLength={80}
                onChange={(event) => onBuildNameChange(event.target.value)}
                onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }}
                aria-label={l('Build name', '构筑名称', '構築名稱', '빌드 이름')}
                title={l('Rename build', '修改构筑名称', '重新命名構築', '빌드 이름 변경')}
              />
              <small>Lv.{characterLevel} · {className}{ascendancyName ? ` · ${ascendancyName}` : ''}</small>
            </span>
            <span className="character-summary-tooltip" role="tooltip">
              <strong>{l('Character details', '人物基本信息', '角色基本資訊', '캐릭터 정보')}</strong>
              <span><i>{l('Level', '等级', '等級', '레벨')}</i><b>{characterLevel}</b></span>
              <span><i>{l('Class', '职业', '職業', '클래스')}</i><b>{className}</b></span>
              <span><i>{l('Ascendancy', '升华', '昇華', '전직')}</i><b>{ascendancyName || l('Not selected', '未选择', '未選擇', '선택 안 함')}</b></span>
              <span><i>{l('Realm', '服务器', '伺服器', '리전')}</i><b>{buildRealmLabel(buildRealm, lang)}</b></span>
              <span><i>{l('Tree version', '天赋版本', '天賦版本', '트리 버전')}</i><b>{treeVersion.replace('_', '.')}</b></span>
              <span><i>{l('Allocated passives', '已分配天赋', '已配置天賦', '할당된 패시브')}</i><b>{allocatedNodes.size}</b></span>
            </span>
          </span>
        </div>

        <div className="command-actions">
          <div className={`build-status-control ${buildRealm}`}>
            <select
              className={`build-realm-select ${buildRealm}`}
              value={buildRealm}
              onChange={(event) => setBuildRealm(event.target.value as 'cn' | 'global')}
              aria-label={l('Game realm', '游戏服务器', '遊戲伺服器', '게임 리전')}
              title={l('Change this build realm', '修改当前构筑的游戏服务器', '修改目前構築的遊戲伺服器', '현재 빌드의 게임 리전 변경')}
            >
              <option value="cn">{buildRealmLabel('cn', lang)}</option>
              <option value="global">{buildRealmLabel('global', lang)}</option>
            </select>
            <span className={`save-state ${saveStatus}`}><i />{saveLabels[saveStatus]}</span>
          </div>
          <span className="version-indicator" title={l('Build version is fixed', '构筑版本已确定', '構築版本已確定', '빌드 버전이 고정되었습니다')} aria-label={`${t('toolbar.version')} ${treeVersion.replace('_', '.')}`}>
            <LockKeyhole />
            <span>{treeVersion.replace('_', '.')}</span>
          </span>
          <button className="secondary-command toolbar-text-command" onClick={() => { setActiveMenu(null); onImport() }} title={t('toolbar.importTitle')}><FileInput /><span>{l('Import', '导入', '匯入', '가져오기')}</span></button>
          <button className="secondary-command toolbar-text-command" onClick={() => toggleMenu('export')} title={t('toolbar.exportTitle')}><FileOutput /><span>{l('Export', '导出', '匯出', '내보내기')}</span></button>
          <button className="primary-command" onClick={() => { setActiveMenu(null); onSave() }}><Save />{l('Save', '保存', '儲存', '저장')}</button>
          <GameRuntimeIndicator />
          <button className="icon-command" onClick={() => { setActiveMenu(null); onSettings() }} title={l('Global settings', '全局设置', '全域設定', '전역 설정')} aria-label={l('Global settings', '全局设置', '全域設定', '전역 설정')}><Settings /></button>
          <button className="icon-command" onClick={() => toggleMenu('more')} title={l('More', '更多操作', '更多操作', '더 보기')} aria-label={l('More', '更多操作', '更多操作', '더 보기')} aria-expanded={activeMenu === 'more'}><MoreVertical /></button>
        </div>
      </div>

      <div className="workspace-tabs-bar">
        <nav className="workspace-tabs" aria-label={l('Build workspace', '构筑编辑页面', '構築編輯頁面', '빌드 작업 공간')}>
          {VIEW_ORDER.map((view) => {
            const Icon = VIEW_ICONS[view]
            const count = view === 'passive' ? allocatedNodes.size : null
            return (
              <button key={view} className={activeView === view ? 'active' : ''} onClick={() => onViewChange(view)} aria-label={viewLabels[view]} title={viewLabels[view]}>
                <Icon /> <span>{viewLabels[view]}</span>{count != null && <small>{count}</small>}
              </button>
            )
          })}
          <i className="workspace-tabs-divider" aria-hidden="true" />
          <button className={`workspace-global-entry monitoring-entry${isActivelyMonitoring ? ' is-monitoring' : ''}`} onClick={onTradeCenter} aria-label={l('Trade Center', '交易中心', '交易中心', '거래 센터')} title={l('Open global Trade Center', '打开全局交易中心', '開啟全域交易中心', '전역 거래 센터 열기')}>
            <Store /><span>{l('Trade Center', '交易中心', '交易中心', '거래 센터')}</span>{isActivelyMonitoring && <span className="monitoring-tab-icon" aria-hidden="true"><BellRing /></span>}{monitoring && <small className="monitoring-tab-count">{armedCount}/{MAX_ACTIVE_PURCHASE_TARGETS}</small>}{pendingCount > 0 && <small className="monitoring-tab-alert">{pendingCount}</small>}
          </button>
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
            <button className="icon-command compact" disabled={!undoStack.length} onClick={undo} title={l('Undo', '撤销', '復原', '실행 취소')} aria-label={l('Undo', '撤销', '復原', '실행 취소')}><Undo2 /></button>
            <button className="icon-command compact" disabled={!redoStack.length} onClick={redo} title={l('Redo', '重做', '重做', '다시 실행')} aria-label={l('Redo', '重做', '重做', '다시 실행')}><Redo2 /></button>
            <div className="zoom-control">
              <button onClick={() => setZoom(Math.max(MIN_ZOOM, zoom / 1.3))} title={t('toolbar.zoomOut')} aria-label={t('toolbar.zoomOut')}><ZoomOut /></button>
              <button onClick={resetZoom} title={t('toolbar.zoomReset')}>{Math.round(zoom * 100)}%</button>
              <button onClick={handleZoomFit} title={t('toolbar.zoomFit')}>{t('toolbar.fit')}</button>
              <button onClick={() => setZoom(Math.min(MAX_ZOOM, zoom * 1.3))} title={t('toolbar.zoomIn')} aria-label={t('toolbar.zoomIn')}><ZoomIn /></button>
            </div>
          </>}

          <span className="toolbar-spacer" />
          <button className="icon-command compact" title={l('Help', '帮助', '說明', '도움말')} aria-label={l('Help', '帮助', '說明', '도움말')}><CircleHelp /></button>
        </div>
      </div>

      {activeMenu && <div className="command-popover">
        {activeMenu === 'export' && <ExportPanel embedded buildName={buildName} sourceUrl={buildSourceUrl} />}
        {activeMenu === 'more' && <div className="native-file-menu" role="menu">
          <button role="menuitem" onClick={() => { setActiveMenu(null); onSaveCopy() }} disabled={saveStatus === 'saving'}><Files /><span><strong>{l('Save build copy', '保存构筑副本', '儲存構築副本', '빌드 복사본 저장')}</strong><small>{l('Create a portable .spoe native file', '创建可传输的 .spoe 原生文件', '建立可攜式 .spoe 原生檔案', '이동 가능한 .spoe 기본 파일 생성')}</small></span></button>
        </div>}
      </div>}
    </header>
  )
}
