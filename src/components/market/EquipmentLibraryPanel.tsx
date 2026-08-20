import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent as ReactDragEvent, type ReactNode } from 'react'
import {
  ArrowLeft, BellOff, BellRing, Bookmark, Check, ChevronDown, ChevronRight, ExternalLink, Eye, Folder, FolderInput, FolderPlus, Home,
  ListChecks, PanelLeftClose, PanelLeftOpen, Pencil, Save, Search, Square,
  RefreshCw, Replace, Shirt, SquareCheckBig, Tags, Trash2, X,
} from 'lucide-react'
import type {
  EquipmentLibraryEntry, EquipmentLibraryFolder, EquipmentLibrarySidebarSnapshot, LibraryTreeScope,
  EquipmentLibrarySourceKind, MarketFavoriteSource, MarketMonitoringSnapshot, MarketRealm, MarketSearchReference, SavedMarketSearch, TradeLeague,
} from '@/types/market'
import { MAX_ACTIVE_PURCHASE_TARGETS } from '@/types/market'
import type { Language } from '@/i18n/translationLoader'
import { uiText, type UiMessage } from '@/i18n/uiLocale'
import { EquipmentItemInspector, equipmentItemName } from '@/components/equipment/EquipmentItemInspector'
import { EquipmentCollectionTree, type EquipmentCollectionSelection } from '@/components/equipment/EquipmentCollectionTree'
import { parseEquipmentXml } from '@/engine/equipment'
import { deriveWeaponComparisonStatsFromRaw } from '@/engine/itemDisplayStats'
import { loadItemBaseData, type ItemBaseData } from '@/engine/itemBaseData'
import { useTreeStore } from '@/store/treeStore'
import type { BuildContextSnapshot } from '@/equipmentDifference'

interface EquipmentLibraryPanelProps {
  realm: MarketRealm
  language: Language
  currentSearch?: MarketSearchReference
  monitoring: MarketMonitoringSnapshot | null
  activeTab: LibraryTreeScope
  onTabChange: (tab: LibraryTreeScope) => void
  onClose: () => void
  headerTitle?: string
}

const EMPTY_SIDEBAR: EquipmentLibrarySidebarSnapshot = { folders: [], searches: [] }

type LibraryDragPayload =
  | { kind: 'folder'; id: string }
  | { kind: 'item'; id: string; ids?: string[] }
  | { kind: 'search'; id: string }

type FolderEditorState =
  | { mode: 'create'; name: string; parentId?: string }
  | { mode: 'rename'; name: string; folderId: string }

type SearchEditorState = {
  mode: 'create' | 'edit'
  id?: string
  name: string
  note: string
  folderId: string
}

function marketSource(entry: EquipmentLibraryEntry): MarketFavoriteSource | undefined {
  return entry.sources.find((source): source is MarketFavoriteSource => source.kind === 'market-favorite')
}

function sourceLabel(kind: EquipmentLibrarySourceKind, language: Language): string {
  const labels: Record<EquipmentLibrarySourceKind, UiMessage> = {
    'market-favorite': { en: 'Market', 'zh-rCN': '集市', 'zh-rTW': '市集', 'ko-KR': '거래소' },
    'pob-import': { en: 'PoB', 'zh-rCN': 'PoB', 'zh-rTW': 'PoB', 'ko-KR': 'PoB' },
    'equipment-favorite': { en: 'Equipment', 'zh-rCN': '装备', 'zh-rTW': '裝備', 'ko-KR': '장비' },
    'price-check': { en: 'Price check', 'zh-rCN': '查价器', 'zh-rTW': '查價器', 'ko-KR': '가격 확인' },
    manual: { en: 'Manual', 'zh-rCN': '手动', 'zh-rTW': '手動', 'ko-KR': '수동' },
  }
  return labels[kind][language]
}

function folderPath(folder: EquipmentLibraryFolder, folders: EquipmentLibraryFolder[]): string {
  const names = [folder.name]
  let parentId = folder.parentId
  const visited = new Set([folder.id])
  while (parentId && !visited.has(parentId)) {
    visited.add(parentId)
    const parent = folders.find((candidate) => candidate.id === parentId)
    if (!parent) break
    names.unshift(parent.name)
    parentId = parent.parentId
  }
  return names.join(' / ')
}

function isDescendant(folder: EquipmentLibraryFolder, ancestorId: string, folders: EquipmentLibraryFolder[]): boolean {
  let parentId = folder.parentId
  const visited = new Set<string>()
  while (parentId && !visited.has(parentId)) {
    if (parentId === ancestorId) return true
    visited.add(parentId)
    parentId = folders.find((candidate) => candidate.id === parentId)?.parentId
  }
  return false
}

export function EquipmentLibraryPanel({ realm, language, currentSearch, monitoring, activeTab, onTabChange, onClose, headerTitle }: EquipmentLibraryPanelProps) {
  const l = (en: string, zhCN: string, zhTW: string, koKR: string) => uiText(language, en, zhCN, zhTW, koKR)
  const importedBuildCode = useTreeStore((state) => state.importedBuildCode)
  const pobBuildRevision = useTreeStore((state) => state.pobBuildRevision)
  const activeWeaponSet = useTreeStore((state) => state.activeWeaponSet)
  const activeCalculationProfileId = useTreeStore((state) => state.activeCalculationProfileId)
  const calculationProfiles = useTreeStore((state) => state.calculationProfiles)
  const getActivePobXml = useTreeStore((state) => state.getActivePobXml)
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
  const bridge = window.pob2Market
  const [entries, setEntries] = useState<EquipmentLibraryEntry[]>([])
  const [itemBases, setItemBases] = useState<Record<string, ItemBaseData>>({})
  const [sidebar, setSidebar] = useState<EquipmentLibrarySidebarSnapshot>(EMPTY_SIDEBAR)
  const [query, setQuery] = useState('')
  const [itemSelection, setItemSelection] = useState<EquipmentCollectionSelection>({ kind: 'root', root: 'market' })
  const [leagues, setLeagues] = useState<TradeLeague[]>([])
  const [leagueId, setLeagueId] = useState('')
  const [movingId, setMovingId] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dragging, setDragging] = useState<LibraryDragPayload | null>(null)
  const [dragOverFolderId, setDragOverFolderId] = useState<string | 'root' | null>(null)
  const [dragOverPosition, setDragOverPosition] = useState<'before' | 'inside' | 'after'>('inside')
  const [directoryCompact, setDirectoryCompact] = useState(false)
  const [folderEditor, setFolderEditor] = useState<FolderEditorState | null>(null)
  const [deleteCandidate, setDeleteCandidate] = useState<EquipmentLibraryFolder | null>(null)
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null)
  const [detailEntryId, setDetailEntryId] = useState<string | null>(null)
  const [bulkSelecting, setBulkSelecting] = useState(false)
  const [selectedEntryIds, setSelectedEntryIds] = useState<Set<string>>(() => new Set())
  const [searchEditor, setSearchEditor] = useState<SearchEditorState | null>(null)
  const contentListRef = useRef<HTMLDivElement | null>(null)
  const listScrollTopRef = useRef(0)

  useEffect(() => {
    let active = true
    void loadItemBaseData().then((index) => {
      if (active) setItemBases(index.bases)
    }).catch(() => {})
    return () => { active = false }
  }, [])

  const load = useCallback(async () => {
    if (!bridge) return
    try {
      const [nextEntries, nextSidebar] = await Promise.all([
        bridge.listLibrary({ query, sourceKind: 'all', includeArchived: false }),
        bridge.getSidebar(),
      ])
      setEntries(nextEntries)
      setSidebar(nextSidebar)
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
    setBulkSelecting(false)
    setSelectedEntryIds(new Set())
    setDetailEntryId(null)
  }, [activeTab])

  useEffect(() => {
    const availableIds = new Set(entries.map((entry) => entry.id))
    setSelectedEntryIds((current) => {
      const next = new Set([...current].filter((id) => availableIds.has(id)))
      return next.size === current.size ? current : next
    })
  }, [entries])

  useEffect(() => {
    const folderId = sidebar.selectedItemFolderId
    setItemSelection((current) => current.kind === 'root'
      && current.root === 'market'
      && current.folderId === folderId
      ? current
      : { kind: 'root', root: 'market', ...(folderId ? { folderId } : {}) })
  }, [sidebar.selectedItemFolderId])

  useEffect(() => {
    let active = true
    void bridge?.listLeagues(realm).then((next) => {
      if (!active) return
      setLeagues(next)
      setLeagueId((current) => next.some((league) => league.id === current) ? current : next[0]?.id || '')
    }).catch(() => {})
    return () => { active = false }
  }, [bridge, realm])

  const folders = useMemo(() => sidebar.folders.filter((folder) => folder.scope === activeTab
    && (activeTab !== 'items' || folder.collectionRoot === 'market')), [activeTab, sidebar.folders])
  const weaponStatsByEntryId = useMemo(() => new Map(
    entries.map((entry) => [entry.id, deriveWeaponComparisonStatsFromRaw(entry.item.raw, itemBases, entry.id)]),
  ), [entries, itemBases])
  const selectedFolderId = activeTab === 'items' && itemSelection.kind === 'root' ? itemSelection.folderId : sidebar.selectedSearchFolderId

  const run = async (id: string, operation: () => Promise<unknown>, success?: string) => {
    setBusyId(id)
    setNotice(null)
    setError(null)
    try {
      await operation()
      if (success) setNotice(success)
      await load()
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setBusyId(null)
    }
  }

  const selectFolder = (scope: LibraryTreeScope, id?: string) => run(id || 'root', async () => {
    setBulkSelecting(false)
    setSelectedEntryIds(new Set())
    setDetailEntryId(null)
    if (scope === 'items') {
      setItemSelection({ kind: 'root', root: 'market', folderId: id })
      setSidebar(await bridge!.selectFolder(scope, id))
    } else setSidebar(await bridge!.selectFolder(scope, id))
  })

  const toggleEntrySelection = (entryId: string) => {
    setSelectedEntryIds((current) => {
      const next = new Set(current)
      if (next.has(entryId)) next.delete(entryId)
      else next.add(entryId)
      return next
    })
  }

  const startBulkSelection = () => {
    setMovingId(null)
    setSelectedEntryId(null)
    setDetailEntryId(null)
    setSelectedEntryIds(new Set())
    setBulkSelecting(true)
  }

  const createFolder = (parentId?: string) => {
    setDirectoryCompact(false)
    setDeleteCandidate(null)
    setFolderEditor({ mode: 'create', name: '', ...(parentId ? { parentId } : {}) })
  }

  const renameFolder = (folder: EquipmentLibraryFolder) => {
    setDirectoryCompact(false)
    setDeleteCandidate(null)
    setFolderEditor({ mode: 'rename', name: folder.name, folderId: folder.id })
  }

  const submitFolderEditor = async () => {
    if (!bridge || !folderEditor) return
    const name = folderEditor.name.trim()
    if (!name) return
    if (folderEditor.mode === 'create') {
      await run('new-folder', () => bridge.createFolder({ scope: activeTab, ...(activeTab === 'items' ? { collectionRoot: 'market' as const } : {}), name, ...(folderEditor.parentId ? { parentId: folderEditor.parentId } : {}) }), l('Folder created', '目录已创建', '目錄已建立', '폴더 생성됨'))
    } else {
      await run(folderEditor.folderId, () => bridge.updateFolder({ id: folderEditor.folderId, name }), l('Folder renamed', '目录已重命名', '目錄已重新命名', '폴더 이름 변경됨'))
    }
    setFolderEditor(null)
  }

  const deleteFolder = async (folder: EquipmentLibraryFolder) => {
    if (!bridge) return
    await run(folder.id, () => bridge.deleteFolder(folder.id), l('Folder deleted', '目录已删除', '目錄已刪除', '폴더 삭제됨'))
    setDeleteCandidate(null)
  }

  const openSearchCreator = async () => {
    if (!bridge || !currentSearch) return
    const existing = sidebar.searches.find((search) => search.realm === currentSearch.realm
      && search.leagueId === currentSearch.leagueId && search.searchCode === currentSearch.searchCode)
    if (existing) {
      await selectFolder('searches', existing.folderId)
      setNotice(l(`“${existing.name}” is already saved`, `“${existing.name}”已经收藏`, `「${existing.name}」已收藏`, `“${existing.name}”이(가) 이미 저장되어 있습니다`))
      return
    }
    setSearchEditor({
      mode: 'create',
      name: currentSearch.leagueId || l('Saved search', '已保存的搜索', '已儲存的搜尋', '저장된 검색'),
      note: '',
      folderId: selectedFolderId || '',
    })
  }

  const submitSearchEditor = async () => {
    if (!bridge || !searchEditor?.name.trim()) return
    const editor = searchEditor
    const input = { name: editor.name.trim(), note: editor.note.trim(), ...(editor.folderId ? { folderId: editor.folderId } : {}) }
    if (editor.mode === 'create') {
      await run('save-search', () => bridge.saveSearch(input), l('Current search saved', '已保存当前搜索', '已儲存目前搜尋', '현재 검색 저장됨'))
    } else if (editor.id) {
      const id = editor.id
      await run(id, () => bridge.updateSearch({ id, ...input, folderId: editor.folderId || null }), l('Saved search updated', '保存的搜索已更新', '已儲存搜尋已更新', '저장된 검색 업데이트됨'))
    }
    setSearchEditor(null)
  }

  const visitHideout = async (entryId: string) => {
    const result = await bridge!.visitHideout(entryId)
    if (!result.ok && result.reason === 'game-offline') {
      throw new Error(l('Unable to travel to the hideout. Start the game and log in to a character, or check whether the listing is still available.', '暂时无法前往藏身处。请先启动游戏并登录角色后再试；如果已经在线，该商品可能已经失效。', '暫時無法前往藏身處。請先啟動遊戲並登入角色後再試；若已在線，該商品可能已失效。', '은신처로 이동할 수 없습니다. 게임을 실행하고 캐릭터에 로그인하거나 매물이 유효한지 확인하세요.'))
    }
  }

  const startDrag = (event: ReactDragEvent, payload: LibraryDragPayload) => {
    setDragging(payload)
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', `${payload.kind}:${payload.id}`)
  }

  const canDropOn = (folderId?: string, position: 'before' | 'inside' | 'after' = 'inside') => {
    if (!dragging || dragging.kind !== 'folder') return Boolean(dragging)
    if (!folderId) return true
    if (dragging.id === folderId) return false
    const target = folders.find((folder) => folder.id === folderId)
    if (!target) return false
    const parentId = position === 'inside' ? target.id : target.parentId
    if (!parentId) return true
    if (parentId === dragging.id) return false
    const parent = folders.find((folder) => folder.id === parentId)
    return Boolean(parent && !isDescendant(parent, dragging.id, folders))
  }

  const dragOver = (event: ReactDragEvent, folderId?: string, position: 'before' | 'inside' | 'after' = 'inside') => {
    if (!canDropOn(folderId, position)) return
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = 'move'
    setDragOverFolderId(folderId || 'root')
    setDragOverPosition(position)
  }

  const dropInto = (event: ReactDragEvent, folderId?: string, position: 'before' | 'inside' | 'after' = 'inside') => {
    event.preventDefault()
    event.stopPropagation()
    const payload = dragging
    setDragging(null)
    setDragOverFolderId(null)
    setDragOverPosition('inside')
    if (!payload || !canDropOn(folderId, position)) return
    const target = folderId ? folders.find((folder) => folder.id === folderId) : undefined
    const destinationFolderId = payload.kind === 'folder' && position !== 'inside' ? target?.parentId : folderId
    const destination = destinationFolderId
      ? folderPath(folders.find((folder) => folder.id === destinationFolderId)!, folders)
      : l('Default', '默认', '預設', '기본')
    const success = l(`Moved to “${destination}”`, `已移动到“${destination}”`, `已移動至「${destination}」`, `“${destination}”(으)로 이동됨`)
    if (payload.kind === 'folder') {
      let beforeId: string | null = null
      if (target && position === 'before') beforeId = target.id
      if (target && position === 'after') {
        const siblings = folders.filter((folder) => folder.parentId === target.parentId && folder.id !== payload.id)
        const targetIndex = siblings.findIndex((folder) => folder.id === target.id)
        beforeId = siblings[targetIndex + 1]?.id || null
      }
      void run(`drag:${payload.id}`, () => bridge!.updateFolder({
        id: payload.id,
        parentId: destinationFolderId || null,
        beforeId,
      }), success)
    } else if (payload.kind === 'item') {
      const entryIds = payload.ids?.length ? payload.ids : [payload.id]
      void run(`drag:${entryIds.join(',')}`, () => bridge!.moveLibrary({ entryIds, ...(folderId ? { targetFolderId: folderId } : {}) }), success)
    } else {
      void run(`drag:${payload.id}`, () => bridge!.updateSearch({ id: payload.id, folderId: folderId || null }), success)
    }
  }

  const handleItemTreeDragOver = (event: ReactDragEvent<HTMLElement>, target: EquipmentCollectionSelection) => {
    if (activeTab !== 'items' || target.kind !== 'root' || target.root !== 'market') return
    dragOver(event, target.folderId)
  }

  const handleItemTreeDrop = (event: ReactDragEvent<HTMLElement>, target: EquipmentCollectionSelection) => {
    if (activeTab !== 'items' || target.kind !== 'root' || target.root !== 'market') return
    dropInto(event, target.folderId)
  }

  const endDrag = () => {
    setDragging(null)
    setDragOverFolderId(null)
    setDragOverPosition('inside')
  }

  const dropSearchBefore = (event: ReactDragEvent, target: SavedMarketSearch) => {
    if (dragging?.kind !== 'search' || dragging.id === target.id) return
    event.preventDefault()
    event.stopPropagation()
    const source = sidebar.searches.find((search) => search.id === dragging.id)
    setDragging(null)
    if (!source || source.folderId !== target.folderId) return
    void run(`sort:${source.id}`, () => bridge!.updateSearch({ id: source.id, beforeId: target.id }))
  }

  const openTryOn = (entry: EquipmentLibraryEntry) => {
    if (!window.pob2Desktop?.openEquipmentTryOn) {
      setError(l('The try-on window is unavailable in this environment.', '当前环境无法打开试穿窗口。', '目前環境無法開啟試穿視窗。', '이 환경에서는 시험 착용 창을 열 수 없습니다.'))
      return
    }
    void window.pob2Desktop.openEquipmentTryOn({
      entry,
      context: equipmentDifferenceContext,
      language,
    }).catch((caught: unknown) => setError(caught instanceof Error ? caught.message : String(caught)))
  }

  const renderEntryActions = (entry: EquipmentLibraryEntry, className = '', includePrimaryActions = true, includeDetailButton = false, includeDeleteButton = true) => {
    const source = marketSource(entry)
    const similarLeagueId = source?.leagueId || leagueId
    const displayName = equipmentItemName(entry.view, language)
    return <footer className={className}>
      {includePrimaryActions && source && <button className="primary-action" disabled={busyId === entry.id} onClick={(event) => { event.stopPropagation(); void run(entry.id, () => visitHideout(entry.id), l('Hideout travel request sent', '已发送前往藏身处请求', '已傳送前往藏身處請求', '은신처 이동 요청 전송됨')) }} title={l('Travel to hideout', '前往藏身处', '前往藏身處', '은신처로 이동')} aria-label={l('Travel to hideout', '前往藏身处', '前往藏身處', '은신처로 이동')}><Home /></button>}
      {includePrimaryActions && <button className="primary-action" disabled={!entry.item.raw} onClick={(event) => { event.stopPropagation(); openTryOn(entry) }} title={l('Preview this item on the current build', '在当前构筑中试穿并查看差异', '在目前構築中試穿並查看差異', '현재 빌드에 시험 장착하고 차이를 확인')} aria-label={l('Try on', '试穿', '試穿', '시험 착용')}><Shirt /></button>}
      {includePrimaryActions && <button className="primary-action" disabled={!similarLeagueId || busyId === entry.id} onClick={(event) => { event.stopPropagation(); void window.superpoePriceCheck?.open({ source: { kind: 'library', entryId: entry.id }, initialLeagueId: marketSource(entry)?.leagueId || similarLeagueId }) }} title={l('Configure price check', '选择词条并查价', '選擇詞綴並查價', '속성을 선택하고 가격 확인')} aria-label={l('Price check', '查价', '查價', '가격 확인')}><Search /></button>}
      {includeDeleteButton && <button className="danger" onClick={(event) => { event.stopPropagation(); if (window.confirm(l(`Delete “${displayName}”?`, `删除“${displayName}”？`, `刪除「${displayName}」？`, `“${displayName}”을(를) 삭제할까요?`))) { setDetailEntryId(null); void run(entry.id, () => bridge!.deleteLibrary(entry.id)) } }} title={l('Delete', '删除', '刪除', '삭제')}><Trash2 /></button>}
      {includeDetailButton && <button className="trade-helper-item-detail" onClick={(event) => { event.stopPropagation(); openEntryDetail(entry.id) }} title={l('View item details', '查看装备详情', '查看裝備詳情', '장비 상세 보기')} aria-label={l('View item details', '查看装备详情', '查看裝備詳情', '장비 상세 보기')}><Eye /></button>}
    </footer>
  }

  const renderEntry = (entry: EquipmentLibraryEntry) => {
    const source = marketSource(entry)
    const selected = bulkSelecting ? selectedEntryIds.has(entry.id) : selectedEntryId === entry.id
    return <article
      className={`trade-helper-item rarity-${entry.view.rarity.toLowerCase()}${dragging?.kind === 'item' && (dragging.ids || [dragging.id]).includes(entry.id) ? ' dragging' : ''}${selected ? ' selected' : ''}${bulkSelecting ? ' bulk-selecting' : ''}`}
      title={l('Double-click to view details', '双击可查看详情', '雙擊可查看詳情', '두 번 클릭하여 상세 보기')}
      draggable
      onDragStart={(event) => {
        const entryIds = bulkSelecting && selectedEntryIds.has(entry.id) ? [...selectedEntryIds] : [entry.id]
        startDrag(event, { kind: 'item', id: entry.id, ids: entryIds })
      }}
      onDragEnd={endDrag}
      tabIndex={bulkSelecting ? 0 : -1}
      aria-selected={selected}
      onClick={() => { if (bulkSelecting) toggleEntrySelection(entry.id) }}
      onDoubleClick={(event) => {
        if (event.target instanceof Element && event.target.closest('button')) return
        if (!bulkSelecting) openEntryDetail(entry.id)
      }}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        if (bulkSelecting) toggleEntrySelection(entry.id)
      }}
      key={entry.id}
    >
      <EquipmentItemInspector
        view={entry.view}
        language={language}
        sourceLabels={entry.sources.map((entrySource) => sourceLabel(entrySource.kind, language))}
        price={source?.price?.display}
        tags={entry.tags}
        note={entry.note}
        weaponStats={weaponStatsByEntryId.get(entry.id) || []}
        headerAction={bulkSelecting
          ? <button className="trade-helper-item-select" aria-pressed={selected} onClick={(event) => { event.stopPropagation(); toggleEntrySelection(entry.id) }} title={selected ? l('Deselect', '取消选择', '取消選擇', '선택 해제') : l('Select item', '选择装备', '選擇裝備', '아이템 선택')} aria-label={selected ? l('Deselect', '取消选择', '取消選擇', '선택 해제') : l('Select item', '选择装备', '選擇裝備', '아이템 선택')}>{selected ? <SquareCheckBig /> : <Square />}</button>
          : undefined}
        />
      {!bulkSelecting && renderEntryActions(entry, '', true, true)}
    </article>
  }

  const renderSearch = (search: SavedMarketSearch) => <article
    className={`trade-helper-search${dragging?.kind === 'search' && dragging.id === search.id ? ' dragging' : ''}`}
    draggable
    onDragStart={(event) => startDrag(event, { kind: 'search', id: search.id })}
    onDragEnd={endDrag}
    onDragOver={(event) => {
      if (dragging?.kind === 'search' && dragging.id !== search.id) {
        event.preventDefault()
        event.dataTransfer.dropEffect = 'move'
      }
    }}
    onDrop={(event) => dropSearchBefore(event, search)}
    key={search.id}
  >
    <span><strong>{search.name}</strong><em>{search.realm === 'cn' ? '腾讯服' : 'Global'}</em></span>
    <footer>
      {(() => {
        const target = monitoring?.purchaseTargets.find((candidate) => candidate.sourceSearchId === search.id && candidate.status !== 'completed')
        const limitReached = (monitoring?.purchaseTargets.filter((candidate) => candidate.status === 'armed').length || 0) >= MAX_ACTIVE_PURCHASE_TARGETS
        return <button className="primary-action" disabled={!target && (search.validity === 'invalid' || limitReached)} onClick={() => void run(`target:${search.id}`, () => target
          ? bridge!.setMonitorTarget(target.id, 'completed')
          : bridge!.createMonitorTarget(search.id), target ? l('Monitoring cancelled', '已取消监控', '已取消監控', '모니터링 취소됨') : l('Monitoring started', '已开始监控', '已開始監控', '모니터링 시작됨'))} title={target ? l('Cancel monitoring', '取消监控', '取消監控', '모니터링 취소') : limitReached ? l(`Up to ${MAX_ACTIVE_PURCHASE_TARGETS} searches can be monitored`, `最多同时监控 ${MAX_ACTIVE_PURCHASE_TARGETS} 条搜索`, `最多同時監控 ${MAX_ACTIVE_PURCHASE_TARGETS} 筆搜尋`, `최대 ${MAX_ACTIVE_PURCHASE_TARGETS}개 검색을 모니터링할 수 있습니다`) : l('Start monitoring', '开始监控', '開始監控', '모니터링 시작')} aria-label={target ? l('Cancel monitoring', '取消监控', '取消監控', '모니터링 취소') : l('Start monitoring', '开始监控', '開始監控', '모니터링 시작')}>{target ? <BellOff /> : <BellRing />}</button>
      })()}
      <button disabled={search.validity === 'invalid'} onClick={() => void bridge?.openSearch(search.id)} title={l('Open search', '跳转到搜索', '前往搜尋', '검색 열기')}><ExternalLink /></button>
      <button onClick={() => setSearchEditor({ mode: 'edit', id: search.id, name: search.name, note: search.note || '', folderId: search.folderId || '' })} title={l('Edit search', '编辑搜索', '編輯搜尋', '검색 편집')}><Pencil /></button>
      {search.querySnapshot && <button onClick={() => void run(`recover:${search.id}`, () => bridge!.recoverSearch(search.id), l('Search code regenerated', '搜索码已重新生成', '搜尋碼已重新產生', '검색 코드 재생성됨'))} title={l('Regenerate search code', '重新生成搜索码', '重新產生搜尋碼', '검색 코드 재생성')}><RefreshCw /></button>}
      <button disabled={!currentSearch || currentSearch.realm !== search.realm} onClick={() => window.confirm(l('Replace this saved search with the current page?', '用当前页面的搜索条件替换这个收藏？', '使用目前頁面的搜尋條件取代此收藏？', '저장된 검색을 현재 페이지로 교체할까요?')) && void run(search.id, () => bridge!.replaceSearchFromCurrent(search.id), l('Search conditions updated', '搜索条件已更新', '搜尋條件已更新', '검색 조건 업데이트됨'))} title={l('Update from current search', '用当前搜索更新', '使用目前搜尋更新', '현재 검색에서 업데이트')}><Replace /></button>
      <button onClick={() => setMovingId((current) => current === `search:${search.id}` ? null : `search:${search.id}`)} title={l('Move to folder', '移动到目录', '移動至目錄', '폴더로 이동')}><FolderInput /></button>
      <button className="danger" onClick={() => window.confirm(l('Delete this saved search? Independent purchase targets are retained.', '删除这个保存的搜索？独立购买目标不会被删除。', '刪除此已儲存搜尋？獨立購買目標不會被刪除。', '저장된 검색을 삭제할까요? 독립 구매 대상은 유지됩니다.')) && void run(search.id, () => bridge!.deleteSearch(search.id))} title={l('Delete', '删除', '刪除', '삭제')}><Trash2 /></button>
    </footer>
    {movingId === `search:${search.id}` && <div className="trade-helper-move"><FolderInput /><select value={search.folderId || ''} onChange={(event) => void run(search.id, async () => {
      await bridge!.updateSearch({ id: search.id, folderId: event.target.value || null })
      setMovingId(null)
    })}><option value="">{l('Default', '默认', '預設', '기본')}</option>{folders.map((folder) => <option value={folder.id} key={folder.id}>{folderPath(folder, folders)}</option>)}</select></div>}
  </article>

  const renderFolder = (folder: EquipmentLibraryFolder, depth = 0): ReactNode => {
    const children = folders.filter((candidate) => candidate.parentId === folder.id)
    const folderEntries = activeTab === 'items' ? entries.filter((entry) => entry.folderId === folder.id) : []
    const folderSearches = activeTab === 'searches' ? sidebar.searches.filter((search) => search.folderId === folder.id) : []
    return <div className="trade-helper-tree-node" style={{ '--tree-depth': depth } as CSSProperties} key={folder.id}>
      <div
        className={`trade-helper-folder${selectedFolderId === folder.id ? ' selected' : ''}${dragOverFolderId === folder.id ? ` drop-${dragOverPosition}` : ''}${dragging?.kind === 'folder' && dragging.id === folder.id ? ' dragging' : ''}`}
        draggable
        onDragStart={(event) => startDrag(event, { kind: 'folder', id: folder.id })}
        onDragEnd={endDrag}
        onDragOver={(event) => {
          const rect = event.currentTarget.getBoundingClientRect()
          const ratio = (event.clientY - rect.top) / Math.max(rect.height, 1)
          const position = dragging?.kind === 'folder' ? (ratio < .28 ? 'before' : ratio > .72 ? 'after' : 'inside') : 'inside'
          dragOver(event, folder.id, position)
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragOverFolderId(null)
        }}
        onDrop={(event) => dropInto(event, folder.id, dragOverPosition)}
      >
        <button onClick={() => void run(folder.id, () => bridge!.updateFolder({ id: folder.id, expanded: !folder.expanded }))} title={folder.expanded ? l('Collapse', '折叠', '收合', '접기') : l('Expand', '展开', '展開', '펼치기')}>{folder.expanded ? <ChevronDown /> : <ChevronRight />}</button>
        <button className="folder-name" onClick={() => void selectFolder(activeTab, folder.id)} title={folder.name}><Folder /><span>{folder.name}</span><small>{folderEntries.length + folderSearches.length}</small></button>
      </div>
      {folder.expanded && <div className="trade-helper-tree-children">
        {children.map((child) => renderFolder(child, depth + 1))}
      </div>}
    </div>
  }

  const rootFolders = folders.filter((folder) => !folder.parentId)
  const categoryEntries = entries.filter((entry) => entry.collectionRoot === 'market')
  const rootSearches = sidebar.searches.filter((search) => !search.folderId)
  const visibleEntries = categoryEntries.filter((entry) => entry.folderId === selectedFolderId)
  const visibleSearches = selectedFolderId ? sidebar.searches.filter((search) => search.folderId === selectedFolderId) : rootSearches
  const selectedFolder = selectedFolderId ? folders.find((folder) => folder.id === selectedFolderId) : undefined
  const contentCount = activeTab === 'items' ? visibleEntries.length : visibleSearches.length
  const allVisibleEntriesSelected = Boolean(visibleEntries.length) && visibleEntries.every((entry) => selectedEntryIds.has(entry.id))
  const detailEntry = detailEntryId ? visibleEntries.find((entry) => entry.id === detailEntryId) : undefined
  const itemDropTarget: EquipmentCollectionSelection | null = activeTab === 'items' && dragOverFolderId
    ? { kind: 'root', root: 'market', ...(dragOverFolderId === 'root' ? {} : { folderId: dragOverFolderId }) }
    : null

  useEffect(() => {
    if (detailEntryId && (!detailEntry || activeTab !== 'items')) setDetailEntryId(null)
  }, [activeTab, detailEntry, detailEntryId])

  const openEntryDetail = (entryId: string) => {
    if (bulkSelecting) return
    listScrollTopRef.current = contentListRef.current?.scrollTop || 0
    setSelectedEntryId(entryId)
    setDetailEntryId(entryId)
  }

  const closeEntryDetail = () => {
    setDetailEntryId(null)
    window.requestAnimationFrame(() => {
      if (contentListRef.current) contentListRef.current.scrollTop = listScrollTopRef.current
    })
  }

  const deleteSelectedEntries = async () => {
    if (!bridge || !selectedEntryIds.size) return
    const count = selectedEntryIds.size
    if (!window.confirm(l(`Delete the ${count} selected items? This cannot be undone.`, `确定删除选中的 ${count} 件装备？此操作无法撤销。`, `確定刪除選取的 ${count} 件裝備？此操作無法復原。`, `선택한 장비 ${count}개를 삭제할까요? 이 작업은 취소할 수 없습니다.`))) return
    await run('bulk-delete', async () => {
      const deleted = await bridge.deleteLibraries([...selectedEntryIds])
      setSelectedEntryIds(new Set())
      setBulkSelecting(false)
      return deleted
    }, l(`${count} items deleted`, `已删除 ${count} 件装备`, `已刪除 ${count} 件裝備`, `장비 ${count}개 삭제됨`))
  }

  return <aside className="equipment-library-panel trade-helper-sidebar">
    <header className="trade-helper-header"><Bookmark /><strong>{headerTitle || l('Equipment Library', '装备仓库', '裝備倉庫', '장비 라이브러리')}</strong><span className="trade-helper-header-actions"><button onClick={onClose} title={l('Collapse shortcuts', '收起快捷栏', '收合快捷欄', '바로 가기 접기')}><X /></button></span></header>
    <nav className="trade-helper-tabs">
      <button className={activeTab === 'items' ? 'active' : ''} onClick={() => onTabChange('items')}>{l('Equipment favorites', '装备收藏', '裝備收藏', '장비 즐겨찾기')}</button>
      <button className={activeTab === 'searches' ? 'active' : ''} onClick={() => onTabChange('searches')}>{l('Search favorites', '搜索收藏', '搜尋收藏', '검색 즐겨찾기')}</button>
    </nav>
    <div className={`trade-helper-workspace${directoryCompact ? ' directory-compact' : ''}`}>
      {activeTab === 'items' && <section className="trade-helper-directory-pane">
        <header><strong>{l('Market favorite folders', '集市收藏目录', '市集收藏目錄', '거래소 즐겨찾기 폴더')}</strong><span>{folders.length}</span><button onClick={() => setDirectoryCompact((compact) => !compact)} title={directoryCompact ? l('Expand folders', '展开目录栏', '展開目錄欄', '폴더 펼치기') : l('Compact folders', '缩小目录栏', '縮小目錄欄', '폴더 축소')}>{directoryCompact ? <PanelLeftOpen /> : <PanelLeftClose />}</button></header>
        <EquipmentCollectionTree
          roots={[{ id: 'market', label: l('Market favorites', '集市收藏', '市集收藏', '거래소 즐겨찾기') }]}
          folders={sidebar.folders}
          entries={entries.filter((entry) => entry.collectionRoot === 'market')}
          selection={itemSelection}
          labels={{
            collapse: l('Collapse', '折叠', '收合', '접기'), expand: l('Expand', '展开', '展開', '펼치기'),
            newFolder: l('New folder', '新建目录', '建立目錄', '새 폴더'),
            rename: l('Rename', '重命名', '重新命名', '이름 변경'), delete: l('Delete', '删除', '刪除', '삭제'),
          }}
           onSelect={(selection) => {
             const next = selection.kind === 'all' ? { kind: 'root' as const, root: 'market' as const } : selection
             void selectFolder('items', next.folderId)
           }}
           onCreate={async (_root, name, parentId) => {
             const folder = await bridge!.createFolder({ scope: 'items', collectionRoot: 'market', name, parentId })
             setItemSelection({ kind: 'root', root: 'market', folderId: folder.id })
             await bridge!.selectFolder('items', folder.id)
             await load()
           }}
          onRename={async (folderId, name) => { await bridge!.updateFolder({ id: folderId, name }); await load() }}
          onDelete={async (folder) => {
            if (!window.confirm(l(`Delete “${folder.name}”? Its contents will move to the parent folder.`, `删除“${folder.name}”？其中的装备和子目录将移到上级目录。`, `刪除「${folder.name}」？其中的裝備和子目錄將移至上層目錄。`, `“${folder.name}” 폴더를 삭제할까요? 내용은 상위 폴더로 이동합니다.`))) return
             await bridge!.deleteFolder(folder.id)
             setItemSelection({ kind: 'root', root: 'market' })
             await bridge!.selectFolder('items')
             await load()
          }}
          onToggle={async (folder) => { await bridge!.updateFolder({ id: folder.id, expanded: !folder.expanded }); await load() }}
          dropTarget={itemDropTarget}
          onDragOver={handleItemTreeDragOver}
          onDrop={handleItemTreeDrop}
          onDragLeave={() => setDragOverFolderId(null)}
        />
      </section>}
      {activeTab === 'searches' && <section className="trade-helper-directory-pane">
        <header><strong>{l('Folders', '目录', '目錄', '폴더')}</strong><span>{folders.length}</span><button onClick={() => setDirectoryCompact((compact) => !compact)} title={directoryCompact ? l('Expand folders', '展开目录栏', '展開目錄欄', '폴더 펼치기') : l('Compact folders', '缩小目录栏', '縮小目錄欄', '폴더 축소')}>{directoryCompact ? <PanelLeftOpen /> : <PanelLeftClose />}</button></header>
        <div className="trade-helper-folder-create">
          <button onClick={() => createFolder(selectedFolderId)} title={l('Create folder', '新建目录', '建立目錄', '폴더 생성')} aria-label={l('Create folder', '新建目录', '建立目錄', '폴더 생성')}><FolderPlus /></button>
          <button disabled={!selectedFolder} onClick={() => selectedFolder && renameFolder(selectedFolder)} title={l('Rename selected folder', '重命名当前目录', '重新命名目前目錄', '선택한 폴더 이름 변경')} aria-label={l('Rename selected folder', '重命名当前目录', '重新命名目前目錄', '선택한 폴더 이름 변경')}><Pencil /></button>
          <button className="danger" disabled={!selectedFolder} onClick={() => {
            if (!selectedFolder) return
            setFolderEditor(null)
            setDeleteCandidate(selectedFolder)
          }} title={l('Delete selected folder', '删除当前目录', '刪除目前目錄', '선택한 폴더 삭제')} aria-label={l('Delete selected folder', '删除当前目录', '刪除目前目錄', '선택한 폴더 삭제')}><Trash2 /></button>
        </div>
        {folderEditor && <div className="trade-helper-folder-editor">
          <input
            autoFocus
            value={folderEditor.name}
            onChange={(event) => setFolderEditor({ ...folderEditor, name: event.target.value })}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void submitFolderEditor()
              if (event.key === 'Escape') setFolderEditor(null)
            }}
            placeholder={folderEditor.mode === 'create' ? l('New folder name', '新目录名称', '新目錄名稱', '새 폴더 이름') : l('Folder name', '目录名称', '目錄名稱', '폴더 이름')}
          />
          <button onClick={() => setFolderEditor(null)} title={l('Cancel', '取消', '取消', '취소')}><X /></button>
          <button disabled={!folderEditor.name.trim()} onClick={() => void submitFolderEditor()} title={l('Confirm', '确认', '確認', '확인')}><Check /></button>
        </div>}
        {deleteCandidate && <div className="trade-helper-folder-delete">
          <span title={deleteCandidate.name}>{l(`Delete “${deleteCandidate.name}”?`, `删除“${deleteCandidate.name}”？`, `刪除「${deleteCandidate.name}」？`, `“${deleteCandidate.name}”을(를) 삭제할까요?`)}</span>
          <button onClick={() => setDeleteCandidate(null)} title={l('Cancel', '取消', '取消', '취소')}><X /></button>
          <button className="danger" onClick={() => void deleteFolder(deleteCandidate)} title={l('Confirm deletion', '确认删除', '確認刪除', '삭제 확인')}><Trash2 /></button>
        </div>}
        <button
          className={`trade-helper-root${!selectedFolderId ? ' selected' : ''}${dragOverFolderId === 'root' ? ' drop-inside' : ''}`}
          aria-label={l('Default', '默认', '預設', '기본')}
          title={l('Default', '默认', '預設', '기본')}
          onClick={() => void selectFolder(activeTab)}
          onDragOver={(event) => dragOver(event)}
          onDragLeave={() => setDragOverFolderId(null)}
          onDrop={(event) => dropInto(event)}
        ><Tags /><span>{l('Default', '默认', '預設', '기본')}</span><small>{rootSearches.length}</small></button>
        <div className="trade-helper-tree">
          {rootFolders.map((folder) => renderFolder(folder))}
          {!rootFolders.length && <div className="trade-helper-directory-empty"><Folder /><span>{l('No folders', '暂无目录', '暫無目錄', '폴더 없음')}</span></div>}
        </div>
      </section>}
      <section className="trade-helper-content-pane">
        <div className="trade-helper-content-top">
          {(notice || error) && <div className={error ? 'trade-helper-message error' : 'trade-helper-message'}>{error || notice}<button onClick={() => { setError(null); setNotice(null) }}><X /></button></div>}
          <div className="trade-helper-actions">
            {activeTab === 'searches' && <button disabled={!currentSearch} onClick={() => void openSearchCreator()} title={!currentSearch ? l('Open a valid official search result first', '请先打开有效的官方搜索结果页', '請先開啟有效的官方搜尋結果頁', '유효한 공식 검색 결과 페이지를 먼저 여세요') : undefined}><Bookmark />{l('Save current search', '保存当前搜索', '儲存目前搜尋', '현재 검색 저장')}</button>}
          {activeTab === 'items' && <>
            <label><Search /><input value={query} onChange={(event) => { setBulkSelecting(false); setSelectedEntryIds(new Set()); setQuery(event.target.value) }} placeholder={l('Search favorites', '搜索收藏', '搜尋收藏', '즐겨찾기 검색')} /></label>
          </>}
          </div>
        </div>
        <header className="trade-helper-content-header">
          {detailEntry ? <span className="trade-helper-detail-heading"><button className="trade-helper-detail-back" onClick={closeEntryDetail} title={l('Double-click to return to list', '双击返回列表', '雙擊返回列表', '두 번 클릭하여 목록으로 돌아가기')} aria-label={l('Double-click to return to list', '双击返回列表', '雙擊返回列表', '두 번 클릭하여 목록으로 돌아가기')}><ArrowLeft /><span>{l('Back', '返回', '返回', '뒤로')}</span></button><strong>{equipmentItemName(detailEntry.view, language)}</strong></span> : <span><Folder /><strong>{selectedFolder ? folderPath(selectedFolder, folders) : activeTab === 'items' ? l('Market favorites', '集市收藏', '市集收藏', '거래소 즐겨찾기') : l('Default', '默认', '預設', '기본')}</strong></span>}
          <span className="trade-helper-content-summary">
            {!detailEntry && activeTab === 'items' && !bulkSelecting && Boolean(visibleEntries.length) && <button onClick={startBulkSelection} title={l('Bulk select', '批量选择', '批次選擇', '일괄 선택')} aria-label={l('Bulk select', '批量选择', '批次選擇', '일괄 선택')}><ListChecks /></button>}
            {!detailEntry && activeTab === 'items' && bulkSelecting && <>
              <small>{l(`${selectedEntryIds.size} / ${visibleEntries.length} selected`, `已选 ${selectedEntryIds.size} / ${visibleEntries.length}`, `已選 ${selectedEntryIds.size} / ${visibleEntries.length}`, `${selectedEntryIds.size} / ${visibleEntries.length} 선택됨`)}</small>
              <button onClick={() => setSelectedEntryIds(allVisibleEntriesSelected ? new Set() : new Set(visibleEntries.map((entry) => entry.id)))} title={allVisibleEntriesSelected ? l('Deselect all', '取消全选', '取消全選', '모두 선택 해제') : l('Select all in folder', '全选当前目录', '全選目前目錄', '폴더 내 모두 선택')} aria-label={allVisibleEntriesSelected ? l('Deselect all', '取消全选', '取消全選', '모두 선택 해제') : l('Select all in folder', '全选当前目录', '全選目前目錄', '폴더 내 모두 선택')}>{allVisibleEntriesSelected ? <Square /> : <SquareCheckBig />}</button>
              <button className="danger" disabled={!selectedEntryIds.size || busyId === 'bulk-delete'} onClick={() => void deleteSelectedEntries()} title={l('Delete selected items', '删除选中装备', '刪除選取裝備', '선택한 아이템 삭제')} aria-label={l('Delete selected items', '删除选中装备', '刪除選取裝備', '선택한 아이템 삭제')}><Trash2 /></button>
              <button onClick={() => { setBulkSelecting(false); setSelectedEntryIds(new Set()) }} title={l('Exit bulk selection', '退出批量选择', '退出批次選擇', '일괄 선택 종료')} aria-label={l('Exit bulk selection', '退出批量选择', '退出批次選擇', '일괄 선택 종료')}><X /></button>
            </>}
            {!detailEntry && !bulkSelecting && <small>{l(`${contentCount} items`, `${contentCount} 项`, `${contentCount} 項`, `${contentCount}개`)}</small>}
          </span>
        </header>
        {detailEntry ? <section className="trade-helper-detail-view" title={l('Double-click to return to list', '双击返回列表', '雙擊返回列表', '두 번 클릭하여 목록으로 돌아가기')} onDoubleClick={(event) => {
          if (event.target instanceof Element && event.target.closest('button')) return
          closeEntryDetail()
        }}>
          <div className="trade-helper-detail-scroll">
            <EquipmentItemInspector
              view={detailEntry.view}
              language={language}
              sourceLabels={detailEntry.sources.map((entrySource) => sourceLabel(entrySource.kind, language))}
              price={marketSource(detailEntry)?.price?.display}
              tags={detailEntry.tags}
              note={detailEntry.note}
              weaponStats={weaponStatsByEntryId.get(detailEntry.id) || []}
            />
          </div>
        </section> : <div className="trade-helper-content-list" ref={contentListRef}>
          {activeTab === 'items' && visibleEntries.map(renderEntry)}
          {activeTab === 'searches' && visibleSearches.map(renderSearch)}
          {!contentCount && <div className="trade-helper-empty"><Bookmark /><span>{activeTab === 'items' ? l('No favorite items in this folder', '此目录还没有收藏装备', '此目錄尚無收藏裝備', '이 폴더에 즐겨찾기 장비가 없습니다') : l('No saved searches in this folder', '此目录还没有保存的搜索', '此目錄尚無已儲存搜尋', '이 폴더에 저장된 검색이 없습니다')}</span></div>}
        </div>}
      </section>
      {searchEditor && <div className="trade-helper-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSearchEditor(null) }}>
        <section className="trade-helper-search-dialog" role="dialog" aria-modal="true" aria-labelledby="saved-search-dialog-title">
          <header><div><small>{l('Saved search', '保存的搜索', '已儲存搜尋', '저장된 검색')}</small><strong id="saved-search-dialog-title">{searchEditor.mode === 'create' ? l('Save current search', '保存当前搜索', '儲存目前搜尋', '현재 검색 저장') : l('Edit saved search', '编辑保存的搜索', '編輯已儲存搜尋', '저장된 검색 편집')}</strong></div><button onClick={() => setSearchEditor(null)} title={l('Close', '关闭', '關閉', '닫기')}><X /></button></header>
          <div className="trade-helper-search-dialog-body">
            {searchEditor.mode === 'create' && currentSearch && <div className="trade-helper-search-summary"><GlobeLabel realm={currentSearch.realm} language={language} /><span><strong>{currentSearch.leagueId}</strong><small>{currentSearch.captureSource === 'code-only' ? l('Code only; manual refresh is required if it expires', '仅保存搜索码；失效后需要手动更新', '僅儲存搜尋碼；失效後需手動更新', '검색 코드만 저장되며 만료 시 수동 업데이트가 필요합니다') : l('Query snapshot available for recovery', '已保存查询快照，可恢复搜索码', '已儲存查詢快照，可恢復搜尋碼', '검색 코드를 복구할 수 있는 쿼리 스냅샷이 있습니다')}</small></span></div>}
            <label><span>{l('Name', '名称', '名稱', '이름')}</span><input autoFocus maxLength={160} value={searchEditor.name} onChange={(event) => setSearchEditor({ ...searchEditor, name: event.target.value })} /></label>
            <label><span>{l('Folder', '目录', '目錄', '폴더')}</span><select value={searchEditor.folderId} onChange={(event) => setSearchEditor({ ...searchEditor, folderId: event.target.value })}><option value="">{l('Default', '默认', '預設', '기본')}</option>{folders.map((folder) => <option value={folder.id} key={folder.id}>{folderPath(folder, folders)}</option>)}</select></label>
            <label><span>{l('Note', '备注', '備註', '메모')}</span><textarea maxLength={4000} rows={3} value={searchEditor.note} onChange={(event) => setSearchEditor({ ...searchEditor, note: event.target.value })} /></label>
          </div>
          <footer><button onClick={() => setSearchEditor(null)}>{l('Cancel', '取消', '取消', '취소')}</button><button className="primary" disabled={!searchEditor.name.trim() || busyId === 'save-search'} onClick={() => void submitSearchEditor()}><Save />{l('Save', '保存', '儲存', '저장')}</button></footer>
        </section>
      </div>}
    </div>
  </aside>
}

function GlobeLabel({ realm, language }: { realm: MarketRealm; language: Language }) {
  return <em>{realm === 'cn' ? uiText(language, 'CN', '腾讯服', '騰訊服', '중국') : uiText(language, 'Global', '国际服', '國際服', '글로벌')}</em>
}
