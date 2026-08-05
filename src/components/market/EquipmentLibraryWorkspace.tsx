import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type FocusEvent as ReactFocusEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Check, Clipboard, ExternalLink, FileText, Folder, FolderPlus, FolderTree, PanelLeftClose, PanelLeftOpen, Pencil, Search, Save, Tags, Trash2, X } from 'lucide-react'
import type {
  EquipmentLibraryEntry, EquipmentLibraryFolder, EquipmentLibrarySidebarSnapshot, EquipmentLibrarySourceKind,
  LibraryModifier, MarketFavoriteSource, MarketRealm, TradeLeague,
} from '@/types/market'

interface EquipmentLibraryWorkspaceProps {
  realm: MarketRealm
  zh: boolean
}

type LibraryDirectoryView =
  | { kind: 'all' }
  | { kind: 'unfiled' }
  | { kind: 'source'; sourceKind: EquipmentLibrarySourceKind }
  | { kind: 'folder'; folderId: string }

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

const EMPTY_SIDEBAR: EquipmentLibrarySidebarSnapshot = { folders: [], searches: [] }

const SOURCE_DIRECTORIES: Array<{ kind: EquipmentLibrarySourceKind; zh: string; en: string }> = [
  { kind: 'market-favorite', zh: '集市收藏', en: 'Market favorites' },
  { kind: 'pob-import', zh: 'PoB 导入', en: 'PoB imports' },
  { kind: 'equipment-favorite', zh: '装备界面收藏', en: 'Equipment favorites' },
  { kind: 'manual', zh: '自定义装备', en: 'Custom items' },
  { kind: 'price-check', zh: '查价装备', en: 'Price checks' },
]

function marketSource(entry: EquipmentLibraryEntry): MarketFavoriteSource | undefined {
  return entry.sources.find((source): source is MarketFavoriteSource => source.kind === 'market-favorite')
}

function sourceLabel(kind: EquipmentLibrarySourceKind, zh: boolean): string {
  const labels: Record<EquipmentLibrarySourceKind, [string, string]> = {
    'market-favorite': ['集市', 'Market'],
    'pob-import': ['PoB', 'PoB'],
    'equipment-favorite': ['装备界面', 'Equipment'],
    'price-check': ['查价器', 'Price check'],
    manual: ['自定义', 'Custom'],
  }
  return labels[kind][zh ? 0 : 1]
}

function folderPath(folder: EquipmentLibraryFolder, folders: EquipmentLibraryFolder[]): string {
  const names = [folder.name]
  const visited = new Set([folder.id])
  let parentId = folder.parentId
  while (parentId && !visited.has(parentId)) {
    visited.add(parentId)
    const parent = folders.find((candidate) => candidate.id === parentId)
    if (!parent) break
    names.unshift(parent.name)
    parentId = parent.parentId
  }
  return names.join(' / ')
}

function modifierText(modifier: LibraryModifier, zh: boolean): string {
  return (zh ? modifier.localized?.['zh-CN']?.displayText : undefined) || modifier.original.displayText
}

function itemName(entry: EquipmentLibraryEntry, zh: boolean): string {
  return (zh ? entry.item.localized?.['zh-CN']?.name : undefined) || entry.item.name
}

function itemBaseType(entry: EquipmentLibraryEntry, zh: boolean): string {
  return (zh ? entry.item.localized?.['zh-CN']?.baseType : undefined) || entry.item.baseType
}

export function EquipmentLibraryWorkspace({ realm, zh }: EquipmentLibraryWorkspaceProps) {
  const bridge = window.pob2Market
  const [entries, setEntries] = useState<EquipmentLibraryEntry[]>([])
  const [sidebar, setSidebar] = useState<EquipmentLibrarySidebarSnapshot>(EMPTY_SIDEBAR)
  const [view, setView] = useState<LibraryDirectoryView>({ kind: 'all' })
  const [query, setQuery] = useState('')
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null)
  const [leagueId, setLeagueId] = useState('')
  const [folderEditor, setFolderEditor] = useState<{ mode: 'create' | 'rename'; name: string; folderId?: string } | null>(null)
  const [deleteFolderCandidate, setDeleteFolderCandidate] = useState<EquipmentLibraryFolder | null>(null)
  const [tooltip, setTooltip] = useState<TooltipPosition | null>(null)
  const [floatingDetail, setFloatingDetail] = useState<FloatingDetailPosition | null>(null)
  const dragRef = useRef<DragState | null>(null)
  const directoryResizeRef = useRef<DirectoryResizeState | null>(null)
  const [directoryWidth, setDirectoryWidth] = useState(222)
  const [directoryCollapsed, setDirectoryCollapsed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copyPobState, setCopyPobState] = useState<'idle' | 'copied' | 'error'>('idle')

  const load = useCallback(async () => {
    if (!bridge) return
    try {
      const [nextEntries, nextSidebar] = await Promise.all([
        bridge.listLibrary({ query, sourceKind: 'all', includeArchived: false }),
        bridge.getSidebar(),
      ])
      setEntries(nextEntries)
      setSidebar(nextSidebar)
      setSelectedEntryId((current) => current && nextEntries.some((entry) => entry.id === current) ? current : nextEntries[0]?.id || null)
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

  const folders = useMemo(() => sidebar.folders.filter((folder) => folder.scope === 'items'), [sidebar.folders])
  const selectedFolderId = view.kind === 'folder' ? view.folderId : undefined
  const selectedFolder = selectedFolderId ? folders.find((folder) => folder.id === selectedFolderId) : undefined
  const visibleEntries = useMemo(() => entries.filter((entry) => {
    if (view.kind === 'folder') return entry.folderId === view.folderId
    if (view.kind === 'unfiled') return !entry.folderId
    if (view.kind === 'source') return entry.sources.some((source) => source.kind === view.sourceKind)
    return true
  }), [entries, view])
  const selectedEntry = visibleEntries.find((entry) => entry.id === selectedEntryId) || visibleEntries[0]
  const tooltipEntry = tooltip ? entries.find((entry) => entry.id === tooltip.entryId) : undefined
  const floatingEntry = floatingDetail ? entries.find((entry) => entry.id === floatingDetail.entryId) : undefined
  const currentDirectoryLabel = view.kind === 'folder' && selectedFolder
    ? folderPath(selectedFolder, folders)
    : view.kind === 'source'
      ? (SOURCE_DIRECTORIES.find((directory) => directory.kind === view.sourceKind)?.[zh ? 'zh' : 'en'] || '')
      : view.kind === 'unfiled'
        ? (zh ? '未分类' : 'Unfiled')
        : (zh ? '全部装备' : 'All equipment')
  const unfiledCount = entries.filter((entry) => !entry.folderId).length

  useEffect(() => {
    setSelectedEntryId((current) => current && visibleEntries.some((entry) => entry.id === current) ? current : visibleEntries[0]?.id || null)
  }, [visibleEntries])

  useEffect(() => {
    setTooltip(null)
    setCopyPobState('idle')
  }, [selectedEntry?.id])

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

  const selectDirectory = (nextView: LibraryDirectoryView) => {
    setView(nextView)
    setTooltip(null)
    if (!bridge || (nextView.kind !== 'folder' && nextView.kind !== 'unfiled' && nextView.kind !== 'all')) return
    void run(async () => {
      const next = await bridge.selectFolder('items', nextView.kind === 'folder' ? nextView.folderId : undefined)
      setSidebar(next)
    })
  }

  const submitFolderEditor = async () => {
    if (!bridge || !folderEditor || !folderEditor.name.trim()) return
    const name = folderEditor.name.trim()
    if (folderEditor.mode === 'create') {
      await run(() => bridge.createFolder({ scope: 'items', name, ...(selectedFolderId ? { parentId: selectedFolderId } : {}) }), zh ? '目录已创建' : 'Folder created')
    } else if (folderEditor.folderId) {
      await run(() => bridge.updateFolder({ id: folderEditor.folderId!, name }), zh ? '目录已重命名' : 'Folder renamed')
    }
    setFolderEditor(null)
  }

  const deleteFolder = async () => {
    if (!bridge || !deleteFolderCandidate) return
    setView({ kind: 'all' })
    await run(() => bridge.deleteFolder(deleteFolderCandidate.id), zh ? '目录已删除' : 'Folder deleted')
    setDeleteFolderCandidate(null)
  }

  const moveEntry = async (folderId: string) => {
    if (!bridge || !selectedEntry) return
    await run(() => bridge.updateLibrary({ id: selectedEntry.id, folderId: folderId || null }), zh ? '装备已移动' : 'Equipment moved')
  }

  const deleteEntry = async () => {
    if (!bridge || !selectedEntry) return
    if (!window.confirm(zh ? `确定删除“${itemName(selectedEntry, zh)}”？此操作无法撤销。` : `Delete “${itemName(selectedEntry, zh)}”? This cannot be undone.`)) return
    await run(() => bridge.deleteLibrary(selectedEntry.id), zh ? '装备已删除' : 'Equipment deleted')
  }

  const copyPobItem = async () => {
    const rawText = selectedEntry?.item.rawText?.trim()
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

  const searchSimilar = async () => {
    if (!bridge || !selectedEntry || !leagueId) return
    const source = marketSource(selectedEntry)
    await run(async () => {
      const result = await bridge.searchLibrary({ entryId: selectedEntry.id, realm: source?.realm || realm, leagueId: source?.leagueId || leagueId })
      const total = result.resolvedModifierCount + result.unresolvedModifierCount
      setNotice(zh
        ? `已生成集市相似搜索，匹配 ${result.resolvedModifierCount}/${total} 条词条${result.unresolvedModifierCount ? `，${result.unresolvedModifierCount} 条未匹配` : ''}`
        : `Market search created: ${result.resolvedModifierCount}/${total} modifiers matched${result.unresolvedModifierCount ? `, ${result.unresolvedModifierCount} unmatched` : ''}`)
    })
  }

  const showTooltip = (event: ReactMouseEvent<HTMLElement> | ReactFocusEvent<HTMLElement>, entry: EquipmentLibraryEntry) => {
    if (floatingDetail) return
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
    setSelectedEntryId(entry.id)
    if (event.altKey) openFloatingDetails(event, entry)
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

  const renderItemInspector = (entry: EquipmentLibraryEntry, floating = false): ReactNode => {
    const rarityKey = entry.item.rarity.toLowerCase()
    const modifierGroups = (['implicit', 'enchant', 'rune', 'explicit'] as const)
      .map((group) => ({ group, entries: entry.item.modifiers.filter((modifier) => modifier.group === group) }))
      .filter(({ entries: groupEntries }) => groupEntries.length)
    return <>
      <header
        className={`inspector-title item-header-${rarityKey} rarity-${rarityKey}`}
        onPointerDown={floating ? handleFloatingPointerDown : undefined}
        onPointerMove={floating ? handleFloatingPointerMove : undefined}
        onPointerUp={floating ? finishFloatingDrag : undefined}
        onPointerCancel={floating ? finishFloatingDrag : undefined}
      >
        <div className="item-header-copy">
          <h2>{itemName(entry, zh)}</h2>
          <p>{itemBaseType(entry, zh)}</p>
        </div>
        {floating && <button className="library-item-floating-close" onPointerDown={(event) => event.stopPropagation()} onClick={() => setFloatingDetail(null)} title={zh ? '关闭装备详情' : 'Close item details'} aria-label={zh ? '关闭装备详情' : 'Close item details'}><X /></button>}
      </header>
      <div className="inspector-scroll">
        <div className="item-property-type">{itemBaseType(entry, zh)}</div>
        <div className="library-item-inspector-sources">{entry.sources.map((source) => <span key={source.sourceKey}>{sourceLabel(source.kind, zh)}</span>)}</div>
        {marketSource(entry)?.price && <div className="library-item-inspector-price">{marketSource(entry)!.price!.display}</div>}
        <div className="item-metadata">
          <span>{zh ? '稀有度' : 'Rarity'} <strong>{entry.item.rarity}</strong></span>
          {entry.item.itemLevel != null && <span>{zh ? '物品等级' : 'Item level'} <strong>{entry.item.itemLevel}</strong></span>}
          {entry.item.quality != null && <span>{zh ? '品质' : 'Quality'} <strong>{entry.item.quality}%</strong></span>}
          {entry.item.sockets && <span>{zh ? '孔位' : 'Sockets'} <strong>{entry.item.sockets}</strong></span>}
          {entry.item.corrupted && <span className="library-item-inspector-corrupted">{zh ? '已腐化' : 'Corrupted'}</span>}
        </div>
        <div className="item-modifiers">
          {modifierGroups.map(({ group, entries: groupEntries }) => <section className={`modifier-group modifier-${group}`} key={group}>
            {groupEntries.map((modifier) => {
              const styleTag = modifier.sourceTags.find((tag) => ['crafted', 'fractured', 'mutated', 'rune', 'enchant'].includes(tag))
              return <p key={modifier.id} className={styleTag ? `mod-${styleTag}` : ''}>{modifierText(modifier, zh)}</p>
            })}
          </section>)}
          {!modifierGroups.length && <p>{zh ? '暂无词条快照' : 'No modifier snapshot'}</p>}
        </div>
        {(entry.tags.length > 0 || entry.note) && <div className="library-item-inspector-notes">{entry.tags.length > 0 && <span>{entry.tags.join(' · ')}</span>}{entry.note && <p>{entry.note}</p>}</div>}
      </div>
    </>
  }

  const renderFolder = (folder: EquipmentLibraryFolder, depth = 0): ReactNode => {
    const children = folders.filter((candidate) => candidate.parentId === folder.id)
    const count = entries.filter((entry) => entry.folderId === folder.id).length
    return <div className="library-workspace-tree-node" style={{ '--tree-depth': depth } as CSSProperties} key={folder.id}>
      <div className={`library-workspace-folder${view.kind === 'folder' && view.folderId === folder.id ? ' selected' : ''}`}>
        <button onClick={() => void run(() => bridge!.updateFolder({ id: folder.id, expanded: !folder.expanded }))} title={folder.expanded ? (zh ? '折叠' : 'Collapse') : (zh ? '展开' : 'Expand')}>{folder.expanded ? '−' : '+'}</button>
        <button className="library-workspace-folder-name" onClick={() => selectDirectory({ kind: 'folder', folderId: folder.id })} title={folderPath(folder, folders)}><Folder /><span>{folder.name}</span><small>{count}</small></button>
      </div>
      {folder.expanded && <div className="library-workspace-tree-children">{children.map((child) => renderFolder(child, depth + 1))}</div>}
    </div>
  }

  const renderCard = (entry: EquipmentLibraryEntry) => {
    return <article
      className={`library-item-card${selectedEntry?.id === entry.id ? ' selected' : ''}`}
      key={entry.id}
      onMouseEnter={(event) => showTooltip(event, entry)}
      onMouseLeave={() => setTooltip(null)}
      onFocus={(event) => showTooltip(event, entry)}
      onBlur={() => setTooltip(null)}
    >
      <button className="library-item-card-main" onClick={(event) => handleCardClick(event, entry)} aria-pressed={selectedEntry?.id === entry.id}>
        <span className="library-item-card-icon">{entry.item.iconUrl ? <img src={entry.item.iconUrl} alt="" /> : <FileText />}</span>
        <span className="library-item-card-copy">
          <strong>{itemName(entry, zh)}</strong>
          <small>{itemBaseType(entry, zh)}</small>
          <em>{entry.sources.map((itemSource) => sourceLabel(itemSource.kind, zh)).join(' / ')}</em>
        </span>
      </button>
    </article>
  }

  return <section className="equipment-library-workspace">
    <div className="library-workspace-commandbar">
      <label className="library-workspace-search"><Search /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={zh ? '搜索装备名称、底材或词条' : 'Search item, base, or modifier'} /></label>
      <div className="library-workspace-command-context"><Folder /><strong>{currentDirectoryLabel}</strong><small>{visibleEntries.length}{zh ? ' 件' : ' items'}</small></div>
      {selectedEntry && <div className="library-workspace-selection-actions">
        <strong title={itemName(selectedEntry, zh)}>{itemName(selectedEntry, zh)}</strong>
        <button
          className={copyPobState === 'error' ? 'copy-error' : ''}
          disabled={busy || !selectedEntry.item.rawText}
          onClick={() => void copyPobItem()}
          title={!selectedEntry.item.rawText ? (zh ? '此装备没有可复制的 PoB 词条' : 'No PoB item text is available') : (zh ? '复制 PoB 词条' : 'Copy PoB item')}
          aria-live="polite"
        >
          {copyPobState === 'copied' ? <Check /> : <Clipboard />}
          <span>{copyPobState === 'copied' ? (zh ? '已复制' : 'Copied') : copyPobState === 'error' ? (zh ? '复制失败' : 'Copy failed') : (zh ? '复制 PoB 词条' : 'Copy PoB item')}</span>
        </button>
        <button className="primary" disabled={busy || !leagueId} onClick={() => void searchSimilar()} title={zh ? '集市找相似' : 'Find similar on market'}><Search /><span>{zh ? '集市找相似' : 'Market similar'}</span></button>
        {selectedEntry.sources[0] && <button disabled={busy} onClick={() => void bridge?.openLibrarySource(selectedEntry.id, selectedEntry.sources[0].sourceKey)} title={zh ? '打开来源' : 'Open source'}><ExternalLink /></button>}
        <select value={selectedEntry.folderId || ''} onChange={(event) => void moveEntry(event.target.value)} aria-label={zh ? '移动到目录' : 'Move to folder'}><option value="">{zh ? '未分类' : 'Unfiled'}</option>{folders.map((folder) => <option value={folder.id} key={folder.id}>{folderPath(folder, folders)}</option>)}</select>
        <button className="danger" disabled={busy} onClick={() => void deleteEntry()} title={zh ? '删除装备' : 'Delete equipment'}><Trash2 /></button>
      </div>}
    </div>
    <div className={`library-workspace-layout${directoryCollapsed ? ' directory-collapsed' : ''}`} style={{ '--library-directory-width': `${directoryCollapsed ? 42 : directoryWidth}px` } as CSSProperties}>
      <aside className="library-workspace-directory">
        <header>
          <strong>{zh ? '仓库目录' : 'Vault directories'}</strong>
          <span>{folders.length + SOURCE_DIRECTORIES.length + 2}</span>
          <button className="library-workspace-directory-toggle" onClick={() => setDirectoryCollapsed((collapsed) => !collapsed)} title={directoryCollapsed ? (zh ? '展开目录' : 'Expand directories') : (zh ? '收起目录' : 'Collapse directories')} aria-label={directoryCollapsed ? (zh ? '展开目录' : 'Expand directories') : (zh ? '收起目录' : 'Collapse directories')}>
            {directoryCollapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
          </button>
        </header>
        <div className="library-workspace-directory-actions">
          <button onClick={() => setFolderEditor({ mode: 'create', name: '' })} title={zh ? '新建目录' : 'New folder'}><FolderPlus /></button>
          <button disabled={view.kind !== 'folder' || !selectedFolder} onClick={() => selectedFolder && setFolderEditor({ mode: 'rename', name: selectedFolder.name, folderId: selectedFolder.id })} title={zh ? '重命名目录' : 'Rename folder'}><Pencil /></button>
          <button className="danger" disabled={view.kind !== 'folder' || !selectedFolder} onClick={() => selectedFolder && setDeleteFolderCandidate(selectedFolder)} title={zh ? '删除目录' : 'Delete folder'}><Trash2 /></button>
        </div>
        {folderEditor && <div className="library-workspace-folder-editor">
          <input autoFocus value={folderEditor.name} onChange={(event) => setFolderEditor({ ...folderEditor, name: event.target.value })} onKeyDown={(event) => { if (event.key === 'Enter') void submitFolderEditor(); if (event.key === 'Escape') setFolderEditor(null) }} placeholder={zh ? '目录名称' : 'Folder name'} />
          <button onClick={() => setFolderEditor(null)} title={zh ? '取消' : 'Cancel'}><X /></button>
          <button disabled={!folderEditor.name.trim()} onClick={() => void submitFolderEditor()} title={zh ? '保存' : 'Save'}><Save /></button>
        </div>}
        {deleteFolderCandidate && <div className="library-workspace-folder-delete"><span>{zh ? `删除“${deleteFolderCandidate.name}”？` : `Delete “${deleteFolderCandidate.name}”?`}</span><button onClick={() => setDeleteFolderCandidate(null)}><X /></button><button className="danger" onClick={() => void deleteFolder()}><Trash2 /></button></div>}
        <div className="library-workspace-directory-list">
          <button className={`library-workspace-directory-entry${view.kind === 'all' ? ' selected' : ''}`} onClick={() => selectDirectory({ kind: 'all' })}><FolderTree /><span>{zh ? '全部装备' : 'All equipment'}</span><small>{entries.length}</small></button>
          {SOURCE_DIRECTORIES.map((directory) => <button className={`library-workspace-directory-entry source-directory${view.kind === 'source' && view.sourceKind === directory.kind ? ' selected' : ''}`} key={directory.kind} onClick={() => selectDirectory({ kind: 'source', sourceKind: directory.kind })}><Folder /><span>{zh ? directory.zh : directory.en}</span><small>{entries.filter((entry) => entry.sources.some((source) => source.kind === directory.kind)).length}</small></button>)}
          <button className={`library-workspace-directory-entry${view.kind === 'unfiled' ? ' selected' : ''}`} onClick={() => selectDirectory({ kind: 'unfiled' })}><Folder /><span>{zh ? '未分类' : 'Unfiled'}</span><small>{unfiledCount}</small></button>
          <div className="library-workspace-directory-divider"><span>{zh ? '自定义目录' : 'Custom folders'}</span></div>
          <div className="library-workspace-tree">{folders.filter((folder) => !folder.parentId).map((folder) => renderFolder(folder))}{!folders.length && <div className="library-workspace-empty-tree"><Folder /><span>{zh ? '暂无自定义目录' : 'No custom folders'}</span></div>}</div>
       </div>
      </aside>
      <div
        className="library-workspace-splitter"
        role="separator"
        aria-label={zh ? '调整目录宽度' : 'Resize directory'}
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
        title={zh ? '拖动调整目录宽度，双击恢复默认' : 'Drag to resize; double-click to reset'}
      />
      <section className="library-workspace-grid-pane">
        {notice && <div className="library-workspace-notice">{notice}<button onClick={() => setNotice(null)}><X /></button></div>}
        {error && <div className="library-workspace-error">{error}<button onClick={() => setError(null)}><X /></button></div>}
        <div className="library-workspace-grid">
          {visibleEntries.map(renderCard)}
          {!visibleEntries.length && <div className="library-workspace-empty-grid"><Tags /><strong>{zh ? '这个目录还没有装备' : 'This directory is empty'}</strong><span>{query ? (zh ? '没有匹配当前搜索条件的装备。' : 'No equipment matches the current search.') : (zh ? '从装备界面或集市收藏装备后，它们会出现在这里。' : 'Market and equipment favorites will appear here.')}</span></div>}
        </div>
      </section>
    </div>
    {tooltipEntry && tooltip && <div className="library-item-tooltip library-item-inspector-tooltip" role="tooltip" style={{ left: tooltip.left, top: tooltip.top }}>{renderItemInspector(tooltipEntry)}</div>}
    {floatingDetail && floatingEntry && createPortal(<div className="library-item-floating equipment-inspector equipment-inspector-floating" style={{ left: floatingDetail.left, top: floatingDetail.top }}>
      {renderItemInspector(floatingEntry, true)}
    </div>, document.body)}
  </section>
}
