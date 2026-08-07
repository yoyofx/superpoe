import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type FocusEvent as ReactFocusEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Check, Clipboard, ClipboardPaste, ExternalLink, FileText, Folder, FolderTree, PanelLeftClose, PanelLeftOpen, Plus, Search, Tags, Trash2, X } from 'lucide-react'
import type {
  EquipmentLibraryEntry, EquipmentLibrarySourceKind,
  CanonicalItemModifierView, MarketFavoriteSource, MarketRealm, TradeLeague,
} from '@/types/market'
import { PriceCheckDialog } from './PriceCheckDialog'

interface EquipmentLibraryWorkspaceProps {
  realm: MarketRealm
  zh: boolean
}

type LibraryDirectoryView =
  | { kind: 'all' }
  | { kind: 'category'; category: LibraryCategory }

type LibraryCategory = 'market' | 'build' | 'custom'

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

const LIBRARY_CATEGORIES: Array<{ category: LibraryCategory; sourceKinds: EquipmentLibrarySourceKind[]; zh: string; en: string }> = [
  { category: 'market', sourceKinds: ['market-favorite'], zh: '集市收藏', en: 'Market favorites' },
  { category: 'build', sourceKinds: ['pob-import', 'equipment-favorite'], zh: '构建导入', en: 'Build imports' },
  { category: 'custom', sourceKinds: ['manual'], zh: '自定义', en: 'Custom' },
]

function belongsToCategory(entry: EquipmentLibraryEntry, category: LibraryCategory): boolean {
  const sourceKinds = LIBRARY_CATEGORIES.find((candidate) => candidate.category === category)?.sourceKinds || []
  return entry.sources.some((source) => sourceKinds.includes(source.kind))
}

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

function modifierText(modifier: CanonicalItemModifierView, zh: boolean): string {
  return (zh ? modifier.localized?.['zh-CN'] : undefined) || modifier.text
}

function itemName(entry: EquipmentLibraryEntry, zh: boolean): string {
  return (zh ? entry.view.localized?.['zh-CN']?.name : undefined) || entry.view.name
}

function itemBaseType(entry: EquipmentLibraryEntry, zh: boolean): string {
  return (zh ? entry.view.localized?.['zh-CN']?.baseType : undefined) || entry.view.baseType
}

export function EquipmentLibraryWorkspace({ realm, zh }: EquipmentLibraryWorkspaceProps) {
  const bridge = window.pob2Market
  const [entries, setEntries] = useState<EquipmentLibraryEntry[]>([])
  const [view, setView] = useState<LibraryDirectoryView>({ kind: 'all' })
  const [query, setQuery] = useState('')
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null)
  const [leagueId, setLeagueId] = useState('')
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
  const [customItemRaw, setCustomItemRaw] = useState<string | null>(null)
  const [priceCheckEntryId, setPriceCheckEntryId] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!bridge) return
    try {
      const nextEntries = await bridge.listLibrary({ query, sourceKind: 'all', includeArchived: false })
      setEntries(nextEntries)
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

  const visibleEntries = useMemo(() => entries.filter((entry) => {
    if (view.kind === 'category') return belongsToCategory(entry, view.category)
    return true
  }), [entries, view])
  const selectedEntry = visibleEntries.find((entry) => entry.id === selectedEntryId) || visibleEntries[0]
  const tooltipEntry = tooltip ? entries.find((entry) => entry.id === tooltip.entryId) : undefined
  const floatingEntry = floatingDetail ? entries.find((entry) => entry.id === floatingDetail.entryId) : undefined
  const currentDirectoryLabel = view.kind === 'category'
    ? (LIBRARY_CATEGORIES.find((directory) => directory.category === view.category)?.[zh ? 'zh' : 'en'] || '')
    : (zh ? '全部装备' : 'All equipment')

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
  }

  const deleteEntry = async () => {
    if (!bridge || !selectedEntry) return
    if (!window.confirm(zh ? `确定删除“${itemName(selectedEntry, zh)}”？此操作无法撤销。` : `Delete “${itemName(selectedEntry, zh)}”? This cannot be undone.`)) return
    await run(() => bridge.deleteLibrary(selectedEntry.id), zh ? '装备已删除' : 'Equipment deleted')
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
      const entry = await bridge.saveEquipmentItem({ raw: customItemRaw.trim(), source: { kind: 'manual' } })
      setCustomItemRaw(null)
      setView({ kind: 'category', category: 'custom' })
      await load()
      setSelectedEntryId(entry.id)
      setNotice(zh ? '自定义装备已添加' : 'Custom item added')
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setBusy(false)
    }
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
    const rarityKey = entry.view.rarity.toLowerCase()
    const modifierGroups = (['implicit', 'enchant', 'rune', 'explicit'] as const)
      .map((group) => ({ group, entries: entry.view.modifiers.filter((modifier) => modifier.group === group) }))
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
          <span>{zh ? '稀有度' : 'Rarity'} <strong>{entry.view.rarity}</strong></span>
          {entry.view.itemLevel != null && <span>{zh ? '物品等级' : 'Item level'} <strong>{entry.view.itemLevel}</strong></span>}
          {entry.view.quality != null && <span>{zh ? '品质' : 'Quality'} <strong>{entry.view.quality}%</strong></span>}
          {entry.view.sockets && <span>{zh ? '孔位' : 'Sockets'} <strong>{entry.view.sockets}</strong></span>}
          {entry.view.corrupted && <span className="library-item-inspector-corrupted">{zh ? '已腐化' : 'Corrupted'}</span>}
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
        <span className="library-item-card-icon">{entry.view.iconUrl ? <img src={entry.view.iconUrl} alt="" /> : <FileText />}</span>
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
      <button className="library-workspace-add-custom" disabled={busy} onClick={() => { setError(null); setCustomItemRaw('') }}><Plus /><span>{zh ? '添加自定义装备' : 'Add custom item'}</span></button>
      {selectedEntry && <div className="library-workspace-selection-actions">
        <strong title={itemName(selectedEntry, zh)}>{itemName(selectedEntry, zh)}</strong>
        <button
          className={copyPobState === 'error' ? 'copy-error' : ''}
          disabled={busy || !selectedEntry.item.raw}
          onClick={() => void copyPobItem()}
          title={!selectedEntry.item.raw ? (zh ? '此装备没有可复制的 PoB 词条' : 'No PoB item text is available') : (zh ? '复制 PoB 词条' : 'Copy PoB item')}
          aria-live="polite"
        >
          {copyPobState === 'copied' ? <Check /> : <Clipboard />}
          <span>{copyPobState === 'copied' ? (zh ? '已复制' : 'Copied') : copyPobState === 'error' ? (zh ? '复制失败' : 'Copy failed') : (zh ? '复制 PoB 词条' : 'Copy PoB item')}</span>
        </button>
        <button className="primary" disabled={busy || !leagueId} onClick={() => setPriceCheckEntryId(selectedEntry.id)} title={zh ? '选择词条并查价' : 'Configure price check'}><Search /><span>{zh ? '查价' : 'Price check'}</span></button>
        {selectedEntry.sources[0] && <button disabled={busy} onClick={() => void bridge?.openLibrarySource(selectedEntry.id, selectedEntry.sources[0].sourceKey)} title={zh ? '打开来源' : 'Open source'}><ExternalLink /></button>}
        <button className="danger" disabled={busy} onClick={() => void deleteEntry()} title={zh ? '删除装备' : 'Delete equipment'}><Trash2 /></button>
      </div>}
    </div>
    <div className={`library-workspace-layout${directoryCollapsed ? ' directory-collapsed' : ''}`} style={{ '--library-directory-width': `${directoryCollapsed ? 42 : directoryWidth}px` } as CSSProperties}>
      <aside className="library-workspace-directory">
        <header>
          <strong>{zh ? '仓库分类' : 'Library categories'}</strong>
          <span>{LIBRARY_CATEGORIES.length + 1}</span>
          <button className="library-workspace-directory-toggle" onClick={() => setDirectoryCollapsed((collapsed) => !collapsed)} title={directoryCollapsed ? (zh ? '展开分类' : 'Expand categories') : (zh ? '收起分类' : 'Collapse categories')} aria-label={directoryCollapsed ? (zh ? '展开分类' : 'Expand categories') : (zh ? '收起分类' : 'Collapse categories')}>
            {directoryCollapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
          </button>
        </header>
        <div className="library-workspace-directory-list">
          <button className={`library-workspace-directory-entry${view.kind === 'all' ? ' selected' : ''}`} onClick={() => selectDirectory({ kind: 'all' })}><FolderTree /><span>{zh ? '全部装备' : 'All equipment'}</span><small>{entries.length}</small></button>
          {LIBRARY_CATEGORIES.map((directory) => <button className={`library-workspace-directory-entry source-directory${view.kind === 'category' && view.category === directory.category ? ' selected' : ''}`} key={directory.category} onClick={() => selectDirectory({ kind: 'category', category: directory.category })}><Folder /><span>{zh ? directory.zh : directory.en}</span><small>{entries.filter((entry) => belongsToCategory(entry, directory.category)).length}</small></button>)}
        </div>
      </aside>
      <div
        className="library-workspace-splitter"
        role="separator"
        aria-label={zh ? '调整分类栏宽度' : 'Resize category pane'}
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
        title={zh ? '拖动调整分类栏宽度，双击恢复默认' : 'Drag to resize; double-click to reset'}
      />
      <section className="library-workspace-grid-pane">
        {notice && <div className="library-workspace-notice">{notice}<button onClick={() => setNotice(null)}><X /></button></div>}
        {error && <div className="library-workspace-error">{error}<button onClick={() => setError(null)}><X /></button></div>}
        <div className="library-workspace-grid">
          {visibleEntries.map(renderCard)}
          {!visibleEntries.length && <div className="library-workspace-empty-grid"><Tags /><strong>{zh ? '这个目录还没有装备' : 'This directory is empty'}</strong><span>{query ? (zh ? '没有匹配当前搜索条件的装备。' : 'No equipment matches the current search.') : (zh ? '从集市、构建或自定义入口添加装备后，它们会出现在这里。' : 'Items added from the market, builds, or custom input will appear here.')}</span></div>}
        </div>
      </section>
    </div>
    {tooltipEntry && tooltip && <div className="library-item-tooltip library-item-inspector-tooltip" role="tooltip" style={{ left: tooltip.left, top: tooltip.top }}>{renderItemInspector(tooltipEntry)}</div>}
    {floatingDetail && floatingEntry && createPortal(<div className="library-item-floating equipment-inspector equipment-inspector-floating" style={{ left: floatingDetail.left, top: floatingDetail.top }}>
      {renderItemInspector(floatingEntry, true)}
    </div>, document.body)}
    {customItemRaw != null && createPortal(<div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setCustomItemRaw(null) }}>
      <section className="workflow-dialog custom-item-dialog" role="dialog" aria-modal="true" aria-labelledby="custom-item-title">
        <header className="dialog-header"><div><span>{zh ? '装备仓库' : 'Equipment library'}</span><h2 id="custom-item-title">{zh ? '添加自定义装备' : 'Add custom item'}</h2></div><button className="icon-command" disabled={busy} onClick={() => setCustomItemRaw(null)} aria-label={zh ? '关闭' : 'Close'}><X /></button></header>
        <div className="dialog-body custom-item-dialog-body"><label><span>PoB Raw</span><textarea autoFocus spellCheck={false} value={customItemRaw} onChange={(event) => setCustomItemRaw(event.target.value)} placeholder={'Rarity: RARE\nItem Name\nBase Type\n...'} /></label>{error && <div className="library-workspace-error">{error}</div>}</div>
        <footer className="dialog-footer"><button className="secondary-command" disabled={busy} onClick={() => setCustomItemRaw(null)}>{zh ? '取消' : 'Cancel'}</button><span /><button className="primary-command" disabled={busy || !customItemRaw.trim()} onClick={() => void createCustomItem()}><ClipboardPaste />{zh ? '解析并添加' : 'Parse and add'}</button></footer>
      </section>
    </div>, document.body)}
    {priceCheckEntryId && (() => {
      const entry = entries.find((candidate) => candidate.id === priceCheckEntryId)
      const source = entry ? marketSource(entry) : undefined
      return <PriceCheckDialog
        realm={source?.realm || realm}
        target={{ kind: 'library', entryId: priceCheckEntryId }}
        zh={zh}
        initialLeagueId={source?.leagueId || leagueId}
        onClose={() => setPriceCheckEntryId(null)}
        onSearched={(result) => setNotice(zh ? `查价搜索已更新，共 ${result.total} 条结果` : `Price search updated with ${result.total} results`)}
      />
    })()}
  </section>
}
