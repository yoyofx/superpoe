import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type FocusEvent as ReactFocusEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { Check, Clipboard, ClipboardPaste, FileText, PanelLeftClose, PanelLeftOpen, Plus, Search, Tags, Trash2, X } from 'lucide-react'
import type {
  EquipmentCollectionRoot, EquipmentLibraryEntry, EquipmentLibraryFolder, EquipmentLibrarySourceKind,
  MarketFavoriteSource, MarketRealm, TradeLeague,
} from '@/types/market'
import { useTranslation } from '@/i18n/useTranslation'
import type { Language } from '@/i18n/translationLoader'
import { uiText, type UiMessage } from '@/i18n/uiLocale'
import { EquipmentItemInspector, equipmentItemBaseType, equipmentItemName } from '@/components/equipment/EquipmentItemInspector'
import { EquipmentCollectionTree, type EquipmentCollectionSelection } from '@/components/equipment/EquipmentCollectionTree'

interface EquipmentLibraryWorkspaceProps {
  realm: MarketRealm
}

interface TooltipPosition {
  entryId: string
  left: number
  top: number
}

interface FloatingDetailPosition extends TooltipPosition {}

interface DragState {
  pointerId: number
  offsetX: number
  offsetY: number
}

interface DirectoryResizeState {
  pointerId: number
  startX: number
  startWidth: number
}

const LIBRARY_CATEGORIES: Array<{ id: EquipmentCollectionRoot; label: UiMessage }> = [
  { id: 'market', label: { en: 'Market favorites', 'zh-rCN': '集市收藏', 'zh-rTW': '市集收藏', 'ko-KR': '거래소 즐겨찾기' } },
  { id: 'build', label: { en: 'Build imports', 'zh-rCN': '构筑导入', 'zh-rTW': '構築匯入', 'ko-KR': '빌드 가져오기' } },
  { id: 'custom', label: { en: 'Custom', 'zh-rCN': '自定义', 'zh-rTW': '自訂', 'ko-KR': '사용자 지정' } },
]

function marketSource(entry: EquipmentLibraryEntry): MarketFavoriteSource | undefined {
  return entry.sources.find((source): source is MarketFavoriteSource => source.kind === 'market-favorite')
}

function sourceLabel(kind: EquipmentLibrarySourceKind, language: Language): string {
  const labels: Record<EquipmentLibrarySourceKind, UiMessage> = {
    'market-favorite': { en: 'Market', 'zh-rCN': '集市', 'zh-rTW': '市集', 'ko-KR': '거래소' },
    'pob-import': { en: 'PoB', 'zh-rCN': 'PoB', 'zh-rTW': 'PoB', 'ko-KR': 'PoB' },
    'equipment-favorite': { en: 'Equipment', 'zh-rCN': '装备界面', 'zh-rTW': '裝備介面', 'ko-KR': '장비 화면' },
    'price-check': { en: 'Price check', 'zh-rCN': '查价器', 'zh-rTW': '查價器', 'ko-KR': '가격 확인' },
    manual: { en: 'Custom', 'zh-rCN': '自定义', 'zh-rTW': '自訂', 'ko-KR': '사용자 지정' },
  }
  return labels[kind][language]
}

function itemName(entry: EquipmentLibraryEntry, language: Language): string {
  return equipmentItemName(entry.view, language)
}

function itemBaseType(entry: EquipmentLibraryEntry, language: Language): string {
  return equipmentItemBaseType(entry.view, language)
}

export function EquipmentLibraryWorkspace({ realm }: EquipmentLibraryWorkspaceProps) {
  const { lang } = useTranslation()
  const l = (en: string, zhCN: string, zhTW: string, koKR: string) => uiText(lang, en, zhCN, zhTW, koKR)
  const bridge = window.pob2Market
  const [entries, setEntries] = useState<EquipmentLibraryEntry[]>([])
  const [folders, setFolders] = useState<EquipmentLibraryFolder[]>([])
  const [view, setView] = useState<EquipmentCollectionSelection>({ kind: 'all' })
  const [query, setQuery] = useState('')
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null)
  const [leagueId, setLeagueId] = useState('')
  const [tooltip, setTooltip] = useState<TooltipPosition | null>(null)
  const tooltipHideTimerRef = useRef<number | null>(null)
  const [floatingDetail, setFloatingDetail] = useState<FloatingDetailPosition | null>(null)
  const dragRef = useRef<DragState | null>(null)
  const directoryResizeRef = useRef<DirectoryResizeState | null>(null)
  const [directoryWidth, setDirectoryWidth] = useState(222)
  const [directoryCollapsed, setDirectoryCollapsed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copyPobState, setCopyPobState] = useState<'idle' | 'copied' | 'error'>('idle')
  const [customItemRaw, setCustomItemRaw] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!bridge) return
    try {
      const [nextEntries, sidebar] = await Promise.all([
        bridge.listLibrary({ query, sourceKind: 'all', includeArchived: false }),
        bridge.getSidebar(),
      ])
      setEntries(nextEntries)
      setFolders(sidebar.folders)
      setSelectedEntryId((current) => current && nextEntries.some((entry) => entry.id === current) ? current : null)
      setError(null)
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : String(caught))
    }
  }, [bridge, query])

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 100)
    return () => window.clearTimeout(timer)
  }, [load])

  useEffect(() => bridge?.onLibraryChanged(() => void load()), [bridge, load])

  useEffect(() => {
    let active = true
    void bridge?.listLeagues(realm).then((next: TradeLeague[]) => {
      if (!active) return
      setLeagueId((current) => next.some((league) => league.id === current) ? current : next[0]?.id || '')
    }).catch(() => {})
    return () => { active = false }
  }, [bridge, realm])

  const visibleEntries = useMemo(() => entries.filter((entry) => {
    if (view.kind === 'root') return entry.collectionRoot === view.root && entry.folderId === view.folderId
    return true
  }), [entries, view])
  const selectedEntry = selectedEntryId ? visibleEntries.find((entry) => entry.id === selectedEntryId) : undefined
  const tooltipEntry = tooltip ? entries.find((entry) => entry.id === tooltip.entryId) : undefined
  const floatingEntry = floatingDetail ? entries.find((entry) => entry.id === floatingDetail.entryId) : undefined
  useEffect(() => {
    setSelectedEntryId((current) => current && visibleEntries.some((entry) => entry.id === current) ? current : null)
  }, [visibleEntries])

  useEffect(() => {
    setTooltip(null)
    setCopyPobState('idle')
  }, [selectedEntry?.id])

  const cancelTooltipHide = () => {
    if (tooltipHideTimerRef.current == null) return
    window.clearTimeout(tooltipHideTimerRef.current)
    tooltipHideTimerRef.current = null
  }

  const hideTooltip = () => {
    cancelTooltipHide()
    setTooltip(null)
  }

  const scheduleTooltipHide = () => {
    cancelTooltipHide()
    tooltipHideTimerRef.current = window.setTimeout(() => {
      tooltipHideTimerRef.current = null
      setTooltip(null)
    }, 260)
  }

  useEffect(() => () => cancelTooltipHide(), [])

  const run = async (operation: () => Promise<unknown>, success?: string) => {
    setBusy(true)
    setNotice(null)
    setError(null)
    try {
      await operation()
      if (success) setNotice(success)
      await load()
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setBusy(false)
    }
  }

  const selectDirectory = (nextView: EquipmentCollectionSelection) => {
    setView(nextView)
    setSelectedEntryId(null)
    setTooltip(null)
    setFloatingDetail(null)
  }

  const createFolder = async (root: EquipmentCollectionRoot, name: string, parentId?: string) => {
    if (!bridge) return
    const folder = await bridge.createFolder({ scope: 'items', collectionRoot: root, name, parentId })
    await load()
    setView({ kind: 'root', root, folderId: folder.id })
  }

  const renameFolder = async (folderId: string, name: string) => {
    if (!bridge) return
    await bridge.updateFolder({ id: folderId, name })
    await load()
  }

  const deleteFolder = async (folder: EquipmentLibraryFolder) => {
    if (!bridge || !window.confirm(l(`Delete “${folder.name}”? Its contents will move to the parent folder.`, `删除“${folder.name}”？其中的装备和子目录将移到上级目录。`, `刪除「${folder.name}」？其中的裝備和子目錄將移至上層目錄。`, `“${folder.name}” 폴더를 삭제할까요? 내용은 상위 폴더로 이동합니다.`))) return
    await bridge.deleteFolder(folder.id)
    setView({ kind: 'root', root: folder.collectionRoot! })
    await load()
  }

  const deleteEntry = async (entry = selectedEntry) => {
    if (!bridge || !entry) return
    if (!window.confirm(l(`Delete “${itemName(entry, lang)}”? This cannot be undone.`, `确定删除“${itemName(entry, lang)}”？此操作无法撤销。`, `確定刪除「${itemName(entry, lang)}」？此操作無法復原。`, `“${itemName(entry, lang)}” 장비를 삭제할까요? 이 작업은 취소할 수 없습니다.`))) return
    await run(() => bridge.deleteLibrary(entry.id), l('Equipment deleted', '装备已删除', '裝備已刪除', '장비 삭제됨'))
  }

  const copyPobItem = async () => {
    const rawText = selectedEntry?.item.raw.trim()
    if (!rawText) return
    try {
      await navigator.clipboard.writeText(rawText)
      setCopyPobState('copied')
      window.setTimeout(() => setCopyPobState('idle'), 2000)
    } catch {
      setCopyPobState('error')
      window.setTimeout(() => setCopyPobState('idle'), 3000)
    }
  }

  const createCustomItem = async () => {
    if (!bridge || !customItemRaw?.trim()) return
    setBusy(true)
    setNotice(null)
    setError(null)
    try {
      const folderId = view.kind === 'root' && view.root === 'custom' ? view.folderId : undefined
      const entry = await bridge.saveEquipmentItem({ raw: customItemRaw.trim(), collectionRoot: 'custom', folderId, source: { kind: 'manual' } })
      setCustomItemRaw(null)
      setView({ kind: 'root', root: 'custom', folderId })
      await load()
      setSelectedEntryId(entry.id)
      setNotice(l('Custom item added', '自定义装备已添加', '自訂裝備已新增', '사용자 지정 장비 추가됨'))
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setBusy(false)
    }
  }

  const showTooltip = (event: ReactMouseEvent<HTMLElement> | ReactFocusEvent<HTMLElement>, entry: EquipmentLibraryEntry) => {
    if (floatingDetail) return
    cancelTooltipHide()
    const rect = event.currentTarget.getBoundingClientRect()
    const width = 326
    const height = Math.min(360, Math.max(0, window.innerHeight - 20))
    const left = rect.right + 10 + width <= window.innerWidth ? rect.right + 10 : Math.max(10, rect.left - width - 10)
    const maxTop = Math.max(10, window.innerHeight - height - 10)
    const preferredTop = window.innerHeight - rect.top - 10 >= height ? rect.top : rect.bottom - height - 10
    const top = Math.max(10, Math.min(preferredTop, maxTop))
    setTooltip({ entryId: entry.id, left, top })
  }

  const openFloatingDetails = (event: ReactMouseEvent<HTMLElement>, entry: EquipmentLibraryEntry) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const width = 430
    const height = Math.min(610, window.innerHeight - 28)
    const left = rect.right + 12 + width <= window.innerWidth ? rect.right + 12 : Math.max(14, rect.left - width - 12)
    const top = Math.max(14, Math.min(rect.top, window.innerHeight - height - 14))
    setSelectedEntryId(entry.id)
    setTooltip(null)
    setFloatingDetail({ entryId: entry.id, left, top })
  }

  const handleCardClick = (event: ReactMouseEvent<HTMLButtonElement>, entry: EquipmentLibraryEntry) => {
    if (event.altKey) {
      setSelectedEntryId(entry.id)
      openFloatingDetails(event, entry)
      return
    }
    setSelectedEntryId((current) => current === entry.id ? null : entry.id)
  }

  const handleFloatingPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (!floatingDetail || event.button !== 0) return
    const floatingElement = event.currentTarget.parentElement
    if (!floatingElement) return
    const rect = floatingElement.getBoundingClientRect()
    dragRef.current = { pointerId: event.pointerId, offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const handleFloatingPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const floatingElement = event.currentTarget.parentElement
    if (!floatingElement) return
    const rect = floatingElement.getBoundingClientRect()
    const left = Math.max(8, Math.min(event.clientX - drag.offsetX, window.innerWidth - rect.width - 8))
    const top = Math.max(8, Math.min(event.clientY - drag.offsetY, window.innerHeight - rect.height - 8))
    setFloatingDetail((current) => current ? { ...current, left, top } : current)
  }

  const finishFloatingDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return
    dragRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }

  const clampDirectoryWidth = (width: number) => Math.max(180, Math.min(360, width))

  const handleDirectoryResizeStart = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return
    if (directoryCollapsed) setDirectoryCollapsed(false)
    directoryResizeRef.current = { pointerId: event.pointerId, startX: event.clientX, startWidth: directoryWidth }
    event.currentTarget.setPointerCapture(event.pointerId)
    event.preventDefault()
  }

  const handleDirectoryResizeMove = (event: ReactPointerEvent<HTMLElement>) => {
    const resize = directoryResizeRef.current
    if (!resize || resize.pointerId !== event.pointerId) return
    setDirectoryWidth(clampDirectoryWidth(resize.startWidth + event.clientX - resize.startX))
  }

  const finishDirectoryResize = (event: ReactPointerEvent<HTMLElement>) => {
    if (directoryResizeRef.current?.pointerId !== event.pointerId) return
    directoryResizeRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }

  const handleDirectoryResizeKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault()
      setDirectoryWidth((current) => clampDirectoryWidth(current + (event.key === 'ArrowRight' ? 16 : -16)))
    } else if (event.key === 'Home') {
      event.preventDefault()
      setDirectoryWidth(180)
    } else if (event.key === 'End') {
      event.preventDefault()
      setDirectoryWidth(360)
    }
  }

  const renderItemInspector = (entry: EquipmentLibraryEntry, floating = false) => <EquipmentItemInspector
    view={entry.view}
    language={lang}
    sourceLabels={entry.sources.map((source) => sourceLabel(source.kind, lang))}
    price={marketSource(entry)?.price?.display}
    tags={entry.tags}
    note={entry.note}
    headerProps={floating ? {
      onPointerDown: handleFloatingPointerDown,
      onPointerMove: handleFloatingPointerMove,
      onPointerUp: finishFloatingDrag,
      onPointerCancel: finishFloatingDrag,
    } : undefined}
    headerAction={floating ? <button className="library-item-floating-close" onPointerDown={(event) => event.stopPropagation()} onClick={() => setFloatingDetail(null)} title={l('Close item details', '关闭装备详情', '關閉裝備詳情', '아이템 상세 정보 닫기')} aria-label={l('Close item details', '关闭装备详情', '關閉裝備詳情', '아이템 상세 정보 닫기')}><X /></button> : undefined}
  />

  const renderCard = (entry: EquipmentLibraryEntry) => {
    return <article
      className={`library-item-card${selectedEntry?.id === entry.id ? ' selected' : ''}`}
      key={entry.id}
      onMouseEnter={(event) => showTooltip(event, entry)}
      onMouseLeave={scheduleTooltipHide}
      onFocus={(event) => showTooltip(event, entry)}
      onBlur={scheduleTooltipHide}
    >
      <button className="library-item-card-main" onClick={(event) => handleCardClick(event, entry)} aria-pressed={selectedEntry?.id === entry.id}>
        <span className="library-item-card-icon">{entry.view.iconUrl ? <img src={entry.view.iconUrl} alt="" /> : <FileText />}</span>
        <span className="library-item-card-copy">
          <strong>{itemName(entry, lang)}</strong>
          <small>{itemBaseType(entry, lang)}</small>
          <em>{entry.sources.map((itemSource) => sourceLabel(itemSource.kind, lang)).join(' / ')}</em>
        </span>
      </button>
    </article>
  }

  return <section className="equipment-library-workspace">
    <div className="library-workspace-commandbar">
      <div className="library-workspace-command-leading">
        <label className="library-workspace-search"><Search /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={l('Search item, base, or modifier', '搜索装备名称、底材或词条', '搜尋裝備名稱、基底或詞綴', '아이템, 베이스 또는 속성 검색')} /></label>
        <span className="library-workspace-result-count" aria-live="polite">{l(`${visibleEntries.length} items`, `${visibleEntries.length} 件`, `${visibleEntries.length} 件`, `${visibleEntries.length}개`)}</span>
      </div>
      <div className="library-workspace-command-actions">
        <div className="library-workspace-global-actions">
          <button className="library-workspace-add-custom" disabled={busy} onClick={() => { setError(null); setCustomItemRaw('') }} title={l('Add a custom equipment item', '添加自定义装备', '新增自訂裝備', '사용자 지정 장비 추가')}><Plus /><span>{l('Add custom item', '添加自定义装备', '新增自訂裝備', '사용자 지정 장비 추가')}</span></button>
        </div>
        {selectedEntry && <div className="library-workspace-selection-actions" aria-label={l('Selected equipment actions', '已选装备操作', '已選裝備操作', '선택한 장비 작업')}>
          <button
            className={copyPobState === 'error' ? 'copy-error' : ''}
            disabled={busy || !selectedEntry.item.raw}
            onClick={() => void copyPobItem()}
            title={!selectedEntry.item.raw ? l('No PoB item text is available', '此装备没有可复制的 PoB 词条', '此裝備沒有可複製的 PoB 詞綴', '복사할 PoB 아이템 텍스트가 없습니다') : l('Copy PoB item', '复制 PoB 词条', '複製 PoB 詞綴', 'PoB 아이템 복사')}
            aria-live="polite"
          >
            {copyPobState === 'copied' ? <Check /> : <Clipboard />}
            <span>{copyPobState === 'copied' ? l('Copied', '已复制', '已複製', '복사됨') : copyPobState === 'error' ? l('Copy failed', '复制失败', '複製失敗', '복사 실패') : l('Copy PoB item', '复制 PoB 词条', '複製 PoB 詞綴', 'PoB 아이템 복사')}</span>
          </button>
          <button className="primary" disabled={busy || !leagueId} onClick={() => { void window.superpoePriceCheck?.open({ source: { kind: 'library', entryId: selectedEntry.id }, initialLeagueId: marketSource(selectedEntry)?.leagueId || leagueId }) }} title={l('Configure price check', '选择词条并查价', '選擇詞綴並查價', '속성을 선택하고 가격 확인')}><Search /><span>{l('Price check', '查价', '查價', '가격 확인')}</span></button>
          <button className="danger" disabled={busy} onClick={() => void deleteEntry()} title={l('Delete equipment', '删除装备', '刪除裝備', '장비 삭제')}><Trash2 /></button>
        </div>}
      </div>
    </div>
    <div className={`library-workspace-layout${directoryCollapsed ? ' directory-collapsed' : ''}`} style={{ '--library-directory-width': `${directoryCollapsed ? 42 : directoryWidth}px` } as CSSProperties}>
      <aside className="library-workspace-directory">
        <header>
          <strong>{l('Library categories', '仓库分类', '倉庫分類', '라이브러리 분류')}</strong>
          <span>{folders.filter((folder) => folder.scope === 'items').length}</span>
          <button className="library-workspace-directory-toggle" onClick={() => setDirectoryCollapsed((collapsed) => !collapsed)} title={directoryCollapsed ? l('Expand categories', '展开分类', '展開分類', '분류 펼치기') : l('Collapse categories', '收起分类', '收合分類', '분류 접기')} aria-label={directoryCollapsed ? l('Expand categories', '展开分类', '展開分類', '분류 펼치기') : l('Collapse categories', '收起分类', '收合分類', '분류 접기')}>
            {directoryCollapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
          </button>
        </header>
        <EquipmentCollectionTree
          roots={LIBRARY_CATEGORIES.map((root) => ({ id: root.id, label: root.label[lang] }))}
          folders={folders}
          entries={entries}
          selection={view}
          allLabel={l('All equipment', '全部装备', '全部裝備', '모든 장비')}
          labels={{
            collapse: l('Collapse', '折叠', '收合', '접기'), expand: l('Expand', '展开', '展開', '펼치기'),
            newFolder: l('New folder', '新建目录', '建立目錄', '새 폴더'),
            rename: l('Rename', '重命名', '重新命名', '이름 변경'), delete: l('Delete', '删除', '刪除', '삭제'),
          }}
          onSelect={selectDirectory}
          onCreate={createFolder}
          onRename={renameFolder}
          onDelete={deleteFolder}
          onToggle={async (folder) => { await bridge?.updateFolder({ id: folder.id, expanded: !folder.expanded }); await load() }}
        />
      </aside>
      <div
        className="library-workspace-splitter"
        role="separator"
        aria-label={l('Resize category pane', '调整分类栏宽度', '調整分類欄寬度', '분류 창 크기 조절')}
        aria-orientation="vertical"
        aria-valuemin={180}
        aria-valuemax={360}
        aria-valuenow={directoryCollapsed ? 42 : directoryWidth}
        tabIndex={0}
        onPointerDown={handleDirectoryResizeStart}
        onPointerMove={handleDirectoryResizeMove}
        onPointerUp={finishDirectoryResize}
        onPointerCancel={finishDirectoryResize}
        onDoubleClick={() => setDirectoryWidth(222)}
        onKeyDown={handleDirectoryResizeKeyDown}
        title={l('Drag to resize; double-click to reset', '拖动调整分类栏宽度，双击恢复默认', '拖曳調整分類欄寬度，雙擊恢復預設', '드래그하여 크기 조절, 두 번 클릭하여 초기화')}
      />
      <section className="library-workspace-grid-pane">
        {notice && <div className="library-workspace-notice">{notice}<button onClick={() => setNotice(null)}><X /></button></div>}
        {error && <div className="library-workspace-error">{error}<button onClick={() => setError(null)}><X /></button></div>}
        <div className="library-workspace-grid">
          {visibleEntries.map(renderCard)}
          {!visibleEntries.length && <div className="library-workspace-empty-grid"><Tags /><strong>{l('This directory is empty', '这个目录还没有装备', '這個目錄尚無裝備', '이 디렉터리가 비어 있습니다')}</strong><span>{query ? l('No equipment matches the current search.', '没有匹配当前搜索条件的装备。', '沒有符合目前搜尋條件的裝備。', '현재 검색과 일치하는 장비가 없습니다.') : l('Items added from the market, builds, or custom input will appear here.', '从集市、构筑或自定义入口添加装备后，它们会出现在这里。', '從市集、構築或自訂輸入新增的裝備會顯示於此。', '거래소, 빌드 또는 사용자 지정 입력에서 추가한 장비가 여기에 표시됩니다.')}</span></div>}
        </div>
      </section>
    </div>
    {tooltipEntry && tooltip && <div className="library-item-tooltip library-item-inspector-tooltip" role="tooltip" style={{ left: tooltip.left, top: tooltip.top }} onMouseEnter={cancelTooltipHide} onMouseLeave={hideTooltip}>{renderItemInspector(tooltipEntry)}</div>}
    {floatingDetail && floatingEntry && createPortal(<div className="library-item-floating equipment-inspector equipment-inspector-floating" style={{ left: floatingDetail.left, top: floatingDetail.top }}>
      {renderItemInspector(floatingEntry, true)}
    </div>, document.body)}
    {customItemRaw != null && createPortal(<div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setCustomItemRaw(null) }}>
      <section className="workflow-dialog custom-item-dialog" role="dialog" aria-modal="true" aria-labelledby="custom-item-title">
        <header className="dialog-header"><div><span>{l('Equipment library', '装备仓库', '裝備倉庫', '장비 라이브러리')}</span><h2 id="custom-item-title">{l('Add custom item', '添加自定义装备', '新增自訂裝備', '사용자 지정 장비 추가')}</h2></div><button className="icon-command" disabled={busy} onClick={() => setCustomItemRaw(null)} aria-label={l('Close', '关闭', '關閉', '닫기')}><X /></button></header>
        <div className="dialog-body custom-item-dialog-body"><label><span>PoB Raw</span><textarea autoFocus spellCheck={false} value={customItemRaw} onChange={(event) => setCustomItemRaw(event.target.value)} placeholder={'Rarity: RARE\nItem Name\nBase Type\n...'} /></label>{error && <div className="library-workspace-error">{error}</div>}</div>
        <footer className="dialog-footer"><button className="secondary-command" disabled={busy} onClick={() => setCustomItemRaw(null)}>{l('Cancel', '取消', '取消', '취소')}</button><span /><button className="primary-command" disabled={busy || !customItemRaw.trim()} onClick={() => void createCustomItem()}><ClipboardPaste />{l('Parse and add', '解析并添加', '解析並新增', '분석 및 추가')}</button></footer>
      </section>
    </div>, document.body)}
  </section>
}
