import { useCallback, useEffect, useMemo, useState, type CSSProperties, type DragEvent as ReactDragEvent, type ReactNode } from 'react'
import {
  Bookmark, Check, ChevronDown, ChevronRight, ExternalLink, Eye, Folder, FolderInput, FolderPlus, FolderTree, Home,
  Maximize2, MessageSquareText, Minimize2, PanelLeftClose, PanelLeftOpen, Pencil, Save, Search, Tags, Trash2, X,
} from 'lucide-react'
import type {
  EquipmentLibraryEntry, EquipmentLibraryFolder, EquipmentLibrarySidebarSnapshot, LibraryTreeScope,
  EquipmentLibrarySourceKind, MarketFavoriteSource, MarketRealm, SavedMarketSearch, TradeLeague,
} from '@/types/market'

interface EquipmentLibraryPanelProps {
  realm: MarketRealm
  zh: boolean
  currentUrl: string
  activeTab: LibraryTreeScope
  expanded: boolean
  onTabChange: (tab: LibraryTreeScope) => void
  onToggleExpanded: () => void
  onClose: () => void
}

const EMPTY_SIDEBAR: EquipmentLibrarySidebarSnapshot = { folders: [], searches: [] }

type LibraryDragPayload =
  | { kind: 'folder'; id: string }
  | { kind: 'item'; id: string }
  | { kind: 'search'; id: string }

type FolderEditorState =
  | { mode: 'create'; name: string; parentId?: string }
  | { mode: 'rename'; name: string; folderId: string }

function marketSource(entry: EquipmentLibraryEntry): MarketFavoriteSource | undefined {
  return entry.sources.find((source): source is MarketFavoriteSource => source.kind === 'market-favorite')
}

function tierLabel(entry: EquipmentLibraryEntry['item']['modifiers'][number]): string | undefined {
  if (entry.tier?.rank) return `T${entry.tier.rank}`
  const match = entry.tier?.name?.match(/(?:Tier|T|P|S)\s*(\d+)/i)
  return match ? `T${match[1]}` : undefined
}

function modifierClass(modifier: EquipmentLibraryEntry['item']['modifiers'][number]): string {
  const tier = tierLabel(modifier)?.toLowerCase()
  return [tier, `group-${modifier.group}`, ...modifier.sourceTags.map((tag) => `source-${tag}`)].filter(Boolean).join(' ')
}

function sourceLabel(kind: EquipmentLibrarySourceKind, zh: boolean): string {
  const labels: Record<EquipmentLibrarySourceKind, [string, string]> = {
    'market-favorite': ['集市', 'Market'],
    'pob-import': ['PoB', 'PoB'],
    'equipment-favorite': ['装备', 'Equipment'],
    'price-check': ['查价器', 'Price check'],
    manual: ['手动', 'Manual'],
  }
  return labels[kind][zh ? 0 : 1]
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

export function EquipmentLibraryPanel({ realm, zh, currentUrl, activeTab, expanded, onTabChange, onToggleExpanded, onClose }: EquipmentLibraryPanelProps) {
  const bridge = window.pob2Market
  const [entries, setEntries] = useState<EquipmentLibraryEntry[]>([])
  const [sidebar, setSidebar] = useState<EquipmentLibrarySidebarSnapshot>(EMPTY_SIDEBAR)
  const [query, setQuery] = useState('')
  const [sourceKind, setSourceKind] = useState<EquipmentLibrarySourceKind | 'all'>('all')
  const [leagues, setLeagues] = useState<TradeLeague[]>([])
  const [leagueId, setLeagueId] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [tags, setTags] = useState('')
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
  const [detailsOpenId, setDetailsOpenId] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!bridge) return
    try {
      const [nextEntries, nextSidebar] = await Promise.all([
        bridge.listLibrary({ query, sourceKind, includeArchived: false }),
        bridge.getSidebar(),
      ])
      setEntries(nextEntries)
      setSidebar(nextSidebar)
      setError(null)
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : String(caught))
    }
  }, [bridge, query, sourceKind])

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 100)
    return () => window.clearTimeout(timer)
  }, [load])

  useEffect(() => bridge?.onLibraryChanged(() => void load()), [bridge, load])

  useEffect(() => {
    let active = true
    void bridge?.listLeagues(realm).then((next) => {
      if (!active) return
      setLeagues(next)
      setLeagueId((current) => next.some((league) => league.id === current) ? current : next[0]?.id || '')
    }).catch(() => {})
    return () => { active = false }
  }, [bridge, realm])

  const folders = useMemo(() => sidebar.folders.filter((folder) => folder.scope === activeTab), [activeTab, sidebar.folders])
  const selectedFolderId = activeTab === 'items' ? sidebar.selectedItemFolderId : sidebar.selectedSearchFolderId

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
    setSidebar(await bridge!.selectFolder(scope, id))
  })

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
      await run('new-folder', () => bridge.createFolder({ scope: activeTab, name, ...(folderEditor.parentId ? { parentId: folderEditor.parentId } : {}) }), zh ? '目录已创建' : 'Folder created')
    } else {
      await run(folderEditor.folderId, () => bridge.updateFolder({ id: folderEditor.folderId, name }), zh ? '目录已重命名' : 'Folder renamed')
    }
    setFolderEditor(null)
  }

  const deleteFolder = async (folder: EquipmentLibraryFolder) => {
    if (!bridge) return
    await run(folder.id, () => bridge.deleteFolder(folder.id), zh ? '目录已删除' : 'Folder deleted')
    setDeleteCandidate(null)
  }

  const saveCurrentSearch = async () => {
    if (!bridge || !currentUrl) return
    const name = window.prompt(zh ? '搜索名称' : 'Search name', document.title || (zh ? '已保存的搜索' : 'Saved search'))?.trim()
    if (!name) return
    const searchNote = window.prompt(zh ? '备注（可选）' : 'Note (optional)', '')?.trim() || undefined
    await run('save-search', () => bridge.saveSearch({ realm, name, note: searchNote, url: currentUrl, ...(selectedFolderId ? { folderId: selectedFolderId } : {}) }), zh ? '已保存当前搜索' : 'Current search saved')
  }

  const beginEdit = (entry: EquipmentLibraryEntry) => {
    setEditingId(entry.id)
    setNote(entry.note || '')
    setTags(entry.tags.join(', '))
  }

  const visitHideout = async (entryId: string) => {
    const result = await bridge!.visitHideout(entryId)
    if (!result.ok && result.reason === 'game-offline') {
      throw new Error(zh
        ? '暂时无法前往藏身处。请先启动游戏并登录角色后再试；如果已经在线，该商品可能已经失效。'
        : 'Unable to travel to the hideout. Start the game and log in to a character, or check whether the listing is still available.')
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
      : (zh ? '默认' : 'Default')
    const success = zh ? `已移动到“${destination}”` : `Moved to “${destination}”`
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
      void run(`drag:${payload.id}`, () => bridge!.updateLibrary({ id: payload.id, folderId: folderId || null }), success)
    } else {
      void run(`drag:${payload.id}`, () => bridge!.updateSearch({ id: payload.id, folderId: folderId || null }), success)
    }
  }

  const endDrag = () => {
    setDragging(null)
    setDragOverFolderId(null)
    setDragOverPosition('inside')
  }

  const renderEntry = (entry: EquipmentLibraryEntry) => {
    const source = marketSource(entry)
    const similarLeagueId = source?.leagueId || leagueId
    const selected = detailsOpenId === entry.id
    return <article
      className={`trade-helper-item rarity-${entry.item.rarity.toLowerCase()}${dragging?.kind === 'item' && dragging.id === entry.id ? ' dragging' : ''}${selected ? ' selected details-open' : ''}`}
      draggable
      tabIndex={0}
      aria-selected={selected}
      onClick={() => setDetailsOpenId(entry.id)}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        setDetailsOpenId(entry.id)
      }}
      onDragStart={(event) => startDrag(event, { kind: 'item', id: entry.id })}
      onDragEnd={endDrag}
      key={entry.id}
    >
      <header>
        {entry.item.iconUrl && <img src={entry.item.iconUrl} alt="" />}
        <span><strong>{entry.item.name}</strong><small>{entry.item.baseType}</small></span>
        <button onClick={() => beginEdit(entry)} title={zh ? '编辑备注和标签' : 'Edit note and tags'} aria-label={zh ? '编辑备注和标签' : 'Edit note and tags'}><Pencil /></button>
      </header>
      {source?.price && <div className="trade-helper-price">{source.price.display}</div>}
      <div className="trade-helper-sources">{entry.sources.map((entrySource) => <span className={`source-${entrySource.kind}`} key={entrySource.sourceKey}>{sourceLabel(entrySource.kind, zh)}</span>)}<span className="modifier-count">{entry.item.modifiers.length ? `${entry.item.modifiers.length}${zh ? ' 条词缀' : ' mods'}` : (zh ? '暂无词条' : 'No modifiers')}</span></div>
      <div className="trade-helper-affixes">
        {entry.item.modifiers.map((modifier) => <div className={modifierClass(modifier)} key={modifier.id}>
          {modifier.affixKind && <span className={`affix-kind ${modifier.affixKind}`}>{modifier.affixKind === 'prefix' ? (zh ? '前缀' : 'Pre') : (zh ? '后缀' : 'Suf')}</span>}
          {tierLabel(modifier) && <span className="affix-tier">{tierLabel(modifier)}</span>}
          <span>{modifier.original.displayText}</span>
        </div>)}
        {!entry.item.modifiers.length && <span className="trade-helper-no-modifiers">{zh ? '此收藏没有词条快照，重新收藏可更新装备详情。' : 'No modifier snapshot is available. Favorite the listing again to refresh it.'}</span>}
      </div>
      {editingId === entry.id && <div className="trade-helper-editor">
        <label><span>{zh ? '标签' : 'Tags'}</span><input value={tags} onChange={(event) => setTags(event.target.value)} /></label>
        <label><span>{zh ? '备注' : 'Note'}</span><textarea rows={2} value={note} onChange={(event) => setNote(event.target.value)} /></label>
        <div><button onClick={() => setEditingId(null)}><X /></button><button onClick={() => void run(entry.id, async () => {
          await bridge!.updateLibrary({ id: entry.id, note, tags: tags.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean) })
          setEditingId(null)
        })}><Save /></button></div>
      </div>}
      <footer>
        <button className={selected ? 'active' : ''} onClick={(event) => {
          event.stopPropagation()
          setDetailsOpenId((current) => current === entry.id ? null : entry.id)
        }} title={zh ? '装备详情' : 'Item details'} aria-label={zh ? '装备详情' : 'Item details'} aria-pressed={selected}><Eye /></button>
        {source && <button className="primary-action" disabled={busyId === entry.id} onClick={() => void run(entry.id, () => visitHideout(entry.id), zh ? '已发送前往藏身处请求' : 'Hideout travel request sent')} title={zh ? '前往藏身处' : 'Travel to hideout'}><Home /><span>{zh ? '藏身处' : 'Hideout'}</span></button>}
        {source && <button onClick={() => void bridge?.openLibrarySource(entry.id, source.sourceKey)} title={zh ? '打开来源' : 'Open source'}><ExternalLink /></button>}
        <button className="primary-action" disabled={!similarLeagueId || busyId === entry.id} onClick={() => void run(entry.id, () => bridge!.searchLibrary({ entryId: entry.id, realm: source?.realm || realm, leagueId: similarLeagueId }), zh ? '已生成相似装备搜索' : 'Similar-item search created')} title={zh ? '找相似装备' : 'Find similar items'}><Search /><span>{zh ? '找相似' : 'Similar'}</span></button>
        <button onClick={() => setMovingId((current) => current === `item:${entry.id}` ? null : `item:${entry.id}`)} title={zh ? '移动到目录' : 'Move to folder'}><FolderInput /></button>
        <button className="danger" onClick={() => window.confirm(zh ? `删除“${entry.item.name}”？` : `Delete “${entry.item.name}”?`) && void run(entry.id, () => bridge!.deleteLibrary(entry.id))} title={zh ? '删除' : 'Delete'}><Trash2 /></button>
      </footer>
      {movingId === `item:${entry.id}` && <div className="trade-helper-move"><FolderInput /><select value={entry.folderId || ''} onChange={(event) => void run(entry.id, async () => {
        await bridge!.updateLibrary({ id: entry.id, folderId: event.target.value || null })
        setMovingId(null)
      })}><option value="">{zh ? '默认' : 'Default'}</option>{folders.map((folder) => <option value={folder.id} key={folder.id}>{folderPath(folder, folders)}</option>)}</select></div>}
    </article>
  }

  const renderSearch = (search: SavedMarketSearch) => <article
    className={`trade-helper-search${dragging?.kind === 'search' && dragging.id === search.id ? ' dragging' : ''}`}
    draggable
    onDragStart={(event) => startDrag(event, { kind: 'search', id: search.id })}
    onDragEnd={endDrag}
    key={search.id}
  >
    <span><strong>{search.note || search.name}</strong>{search.note && <small>{search.name}</small>}<em>{search.realm === 'cn' ? '腾讯服' : 'Global'}</em></span>
    <footer>
      <button onClick={() => void bridge?.openSearch(search.id)} title={zh ? '跳转到搜索' : 'Open search'}><ExternalLink /></button>
      <button onClick={() => {
        const name = window.prompt(zh ? '搜索名称' : 'Search name', search.name)?.trim()
        if (name) void run(search.id, () => bridge!.updateSearch({ id: search.id, name }))
      }} title={zh ? '重命名' : 'Rename'}><Pencil /></button>
      <button onClick={() => {
        const nextNote = window.prompt(zh ? '搜索备注' : 'Search note', search.note || '')
        if (nextNote != null) void run(search.id, () => bridge!.updateSearch({ id: search.id, note: nextNote }))
      }} title={zh ? '编辑备注' : 'Edit note'}><MessageSquareText /></button>
      <button onClick={() => setMovingId((current) => current === `search:${search.id}` ? null : `search:${search.id}`)} title={zh ? '移动到目录' : 'Move to folder'}><FolderInput /></button>
      <button className="danger" onClick={() => window.confirm(zh ? '删除这个搜索收藏？' : 'Delete this saved search?') && void run(search.id, () => bridge!.deleteSearch(search.id))} title={zh ? '删除' : 'Delete'}><Trash2 /></button>
    </footer>
    {movingId === `search:${search.id}` && <div className="trade-helper-move"><FolderInput /><select value={search.folderId || ''} onChange={(event) => void run(search.id, async () => {
      await bridge!.updateSearch({ id: search.id, folderId: event.target.value || null })
      setMovingId(null)
    })}><option value="">{zh ? '默认' : 'Default'}</option>{folders.map((folder) => <option value={folder.id} key={folder.id}>{folderPath(folder, folders)}</option>)}</select></div>}
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
        <button onClick={() => void run(folder.id, () => bridge!.updateFolder({ id: folder.id, expanded: !folder.expanded }))} title={folder.expanded ? (zh ? '折叠' : 'Collapse') : (zh ? '展开' : 'Expand')}>{folder.expanded ? <ChevronDown /> : <ChevronRight />}</button>
        <button className="folder-name" onClick={() => void selectFolder(activeTab, folder.id)} title={folderPath(folder, folders)}><Folder /><span>{folder.name}</span><small>{folderEntries.length + folderSearches.length}</small></button>
      </div>
      {folder.expanded && <div className="trade-helper-tree-children">
        {children.map((child) => renderFolder(child, depth + 1))}
      </div>}
    </div>
  }

  const rootFolders = folders.filter((folder) => !folder.parentId)
  const rootEntries = entries.filter((entry) => !entry.folderId)
  const rootSearches = sidebar.searches.filter((search) => !search.folderId)
  const visibleEntries = selectedFolderId ? entries.filter((entry) => entry.folderId === selectedFolderId) : rootEntries
  const visibleSearches = selectedFolderId ? sidebar.searches.filter((search) => search.folderId === selectedFolderId) : rootSearches
  const selectedFolder = selectedFolderId ? folders.find((folder) => folder.id === selectedFolderId) : undefined
  const contentCount = activeTab === 'items' ? visibleEntries.length : visibleSearches.length

  return <aside className="equipment-library-panel trade-helper-sidebar">
    <header className="trade-helper-header"><Bookmark /><strong>{zh ? '装备仓库' : 'Equipment Library'}</strong><span className="trade-helper-header-actions"><button onClick={onToggleExpanded} title={expanded ? (zh ? '缩小仓库' : 'Reduce library') : (zh ? '展开仓库' : 'Expand library')}>{expanded ? <Minimize2 /> : <Maximize2 />}</button><button onClick={onClose} title={zh ? '收起仓库' : 'Collapse library'}><X /></button></span></header>
    <nav className="trade-helper-tabs">
      <button className={activeTab === 'items' ? 'active' : ''} onClick={() => onTabChange('items')}>{zh ? '物品收藏' : 'Items'}</button>
      <button className={activeTab === 'searches' ? 'active' : ''} onClick={() => onTabChange('searches')}>{zh ? '搜索收藏' : 'Searches'}</button>
    </nav>
    <div className={`trade-helper-workspace${directoryCompact ? ' directory-compact' : ''}`}>
      <section className="trade-helper-directory-pane">
        <header><strong>{zh ? '目录' : 'Folders'}</strong><span>{folders.length}</span><button onClick={() => setDirectoryCompact((compact) => !compact)} title={directoryCompact ? (zh ? '展开目录栏' : 'Expand folders') : (zh ? '缩小目录栏' : 'Compact folders')}>{directoryCompact ? <PanelLeftOpen /> : <PanelLeftClose />}</button></header>
        <div className="trade-helper-folder-create">
          <button onClick={() => createFolder()} title={zh ? '新建根目录' : 'Create root folder'} aria-label={zh ? '新建根目录' : 'Create root folder'}><FolderPlus /></button>
          <button disabled={!selectedFolderId} onClick={() => createFolder(selectedFolderId)} title={zh ? '新建子目录' : 'Create subfolder'} aria-label={zh ? '新建子目录' : 'Create subfolder'}><FolderTree /></button>
          <button disabled={!selectedFolder} onClick={() => selectedFolder && renameFolder(selectedFolder)} title={zh ? '重命名当前目录' : 'Rename selected folder'} aria-label={zh ? '重命名当前目录' : 'Rename selected folder'}><Pencil /></button>
          <button className="danger" disabled={!selectedFolder} onClick={() => {
            if (!selectedFolder) return
            setFolderEditor(null)
            setDeleteCandidate(selectedFolder)
          }} title={zh ? '删除当前目录' : 'Delete selected folder'} aria-label={zh ? '删除当前目录' : 'Delete selected folder'}><Trash2 /></button>
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
            placeholder={folderEditor.mode === 'create' ? (zh ? '新目录名称' : 'New folder name') : (zh ? '目录名称' : 'Folder name')}
          />
          <button onClick={() => setFolderEditor(null)} title={zh ? '取消' : 'Cancel'}><X /></button>
          <button disabled={!folderEditor.name.trim()} onClick={() => void submitFolderEditor()} title={zh ? '确认' : 'Confirm'}><Check /></button>
        </div>}
        {deleteCandidate && <div className="trade-helper-folder-delete">
          <span title={deleteCandidate.name}>{zh ? `删除“${deleteCandidate.name}”？` : `Delete “${deleteCandidate.name}”?`}</span>
          <button onClick={() => setDeleteCandidate(null)} title={zh ? '取消' : 'Cancel'}><X /></button>
          <button className="danger" onClick={() => void deleteFolder(deleteCandidate)} title={zh ? '确认删除' : 'Confirm deletion'}><Trash2 /></button>
        </div>}
        <button
          className={`trade-helper-root${!selectedFolderId ? ' selected' : ''}${dragOverFolderId === 'root' ? ' drop-inside' : ''}`}
          aria-label={zh ? '默认' : 'Default'}
          title={zh ? '默认' : 'Default'}
          onClick={() => void selectFolder(activeTab)}
          onDragOver={(event) => dragOver(event)}
          onDragLeave={() => setDragOverFolderId(null)}
          onDrop={(event) => dropInto(event)}
        ><Tags /><span>{zh ? '默认' : 'Default'}</span><small>{activeTab === 'items' ? rootEntries.length : rootSearches.length}</small></button>
        <div className="trade-helper-tree">
          {rootFolders.map((folder) => renderFolder(folder))}
          {!rootFolders.length && <div className="trade-helper-directory-empty"><Folder /><span>{zh ? '暂无目录' : 'No folders'}</span></div>}
        </div>
      </section>
      <section className="trade-helper-content-pane">
        <div className="trade-helper-content-top">
          {(notice || error) && <div className={error ? 'trade-helper-message error' : 'trade-helper-message'}>{error || notice}<button onClick={() => { setError(null); setNotice(null) }}><X /></button></div>}
          <div className="trade-helper-actions">
            {activeTab === 'searches' && <button disabled={!currentUrl} onClick={() => void saveCurrentSearch()}><Bookmark />{zh ? '保存当前搜索' : 'Save current search'}</button>}
          {activeTab === 'items' && <>
            <label><Search /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={zh ? '搜索收藏' : 'Search favorites'} /></label>
            <select value={sourceKind} onChange={(event) => setSourceKind(event.target.value as EquipmentLibrarySourceKind | 'all')} aria-label={zh ? '来源分类' : 'Source category'}>
              <option value="all">{zh ? '全部来源' : 'All sources'}</option>
              <option value="market-favorite">{zh ? '集市收藏' : 'Market favorites'}</option>
              <option value="pob-import">{zh ? 'PoB 导入' : 'PoB imports'}</option>
              <option value="equipment-favorite">{zh ? '装备收藏' : 'Equipment favorites'}</option>
              <option value="price-check">{zh ? '查价器' : 'Price checks'}</option>
              <option value="manual">{zh ? '手动添加' : 'Manual'}</option>
            </select>
          </>}
          </div>
        </div>
        <header className="trade-helper-content-header">
          <span><Folder /><strong>{selectedFolder ? folderPath(selectedFolder, folders) : (zh ? '默认' : 'Default')}</strong></span>
          <small>{contentCount}{zh ? ' 项' : ' items'}</small>
        </header>
        <div className="trade-helper-content-list">
          {activeTab === 'items' && visibleEntries.map(renderEntry)}
          {activeTab === 'searches' && visibleSearches.map(renderSearch)}
          {!contentCount && <div className="trade-helper-empty"><Bookmark /><span>{activeTab === 'items' ? (zh ? '此目录还没有收藏装备' : 'No favorite items in this folder') : (zh ? '此目录还没有收藏搜索' : 'No saved searches in this folder')}</span></div>}
        </div>
      </section>
    </div>
  </aside>
}
