import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type FocusEvent as ReactFocusEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Check, Clipboard, ClipboardPaste, ExternalLink, FileText, Folder, FolderTree, PanelLeftClose, PanelLeftOpen, Plus, Search, Tags, Trash2, X } from 'lucide-react'
import type {
  EquipmentLibraryEntry, EquipmentLibrarySourceKind,
  CanonicalItemModifierView, MarketFavoriteSource, MarketRealm, TradeLeague,
} from '@/types/market'
import { PriceCheckDialog } from './PriceCheckDialog'
import { useTranslation } from '@/i18n/useTranslation'
import { translateGameText, type Language } from '@/i18n/translationLoader'
import { uiText, type UiMessage } from '@/i18n/uiLocale'

interface EquipmentLibraryWorkspaceProps {
  realm: MarketRealm
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

const LIBRARY_CATEGORIES: Array<{ category: LibraryCategory; sourceKinds: EquipmentLibrarySourceKind[]; label: UiMessage }> = [
  { category: 'market', sourceKinds: ['market-favorite'], label: { en: 'Market favorites', 'zh-rCN': '集市收藏', 'zh-rTW': '市集收藏', 'ko-KR': '거래소 즐겨찾기' } },
  { category: 'build', sourceKinds: ['pob-import', 'equipment-favorite'], label: { en: 'Build imports', 'zh-rCN': '构建导入', 'zh-rTW': '構築匯入', 'ko-KR': '빌드 가져오기' } },
  { category: 'custom', sourceKinds: ['manual'], label: { en: 'Custom', 'zh-rCN': '自定义', 'zh-rTW': '自訂', 'ko-KR': '사용자 지정' } },
]

function belongsToCategory(entry: EquipmentLibraryEntry, category: LibraryCategory): boolean {
  const sourceKinds = LIBRARY_CATEGORIES.find((candidate) => candidate.category === category)?.sourceKinds || []
  return entry.sources.some((source) => sourceKinds.includes(source.kind))
}

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

function modifierText(modifier: CanonicalItemModifierView, language: Language): string {
  return language === 'zh-rCN' ? modifier.localized?.['zh-CN'] || modifier.text : translateGameText(modifier.text, language)
}

function itemName(entry: EquipmentLibraryEntry, language: Language): string {
  return language === 'zh-rCN' ? entry.view.localized?.['zh-CN']?.name || entry.view.name : translateGameText(entry.view.name, language)
}

function itemBaseType(entry: EquipmentLibraryEntry, language: Language): string {
  return language === 'zh-rCN' ? entry.view.localized?.['zh-CN']?.baseType || entry.view.baseType : translateGameText(entry.view.baseType, language)
}

export function EquipmentLibraryWorkspace({ realm }: EquipmentLibraryWorkspaceProps) {
  const { lang } = useTranslation()
  const l = (en: string, zhCN: string, zhTW: string, koKR: string) => uiText(lang, en, zhCN, zhTW, koKR)
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
    ? (LIBRARY_CATEGORIES.find((directory) => directory.category === view.category)?.label[lang] || '')
    : l('All equipment', '全部装备', '全部裝備', '모든 장비')

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
    if (!window.confirm(l(`Delete “${itemName(selectedEntry, lang)}”? This cannot be undone.`, `确定删除“${itemName(selectedEntry, lang)}”？此操作无法撤销。`, `確定刪除「${itemName(selectedEntry, lang)}」？此操作無法復原。`, `“${itemName(selectedEntry, lang)}” 장비를 삭제할까요? 이 작업은 취소할 수 없습니다.`))) return
    await run(() => bridge.deleteLibrary(selectedEntry.id), l('Equipment deleted', '装备已删除', '裝備已刪除', '장비 삭제됨'))
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
      setNotice(l('Custom item added', '自定义装备已添加', '自訂裝備已新增', '사용자 지정 장비 추가됨'))
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
          <h2>{itemName(entry, lang)}</h2>
          <p>{itemBaseType(entry, lang)}</p>
        </div>
        {floating && <button className="library-item-floating-close" onPointerDown={(event) => event.stopPropagation()} onClick={() => setFloatingDetail(null)} title={l('Close item details', '关闭装备详情', '關閉裝備詳情', '아이템 상세 정보 닫기')} aria-label={l('Close item details', '关闭装备详情', '關閉裝備詳情', '아이템 상세 정보 닫기')}><X /></button>}
      </header>
      <div className="inspector-scroll">
        <div className="item-property-type">{itemBaseType(entry, lang)}</div>
        <div className="library-item-inspector-sources">{entry.sources.map((source) => <span key={source.sourceKey}>{sourceLabel(source.kind, lang)}</span>)}</div>
        {marketSource(entry)?.price && <div className="library-item-inspector-price">{marketSource(entry)!.price!.display}</div>}
        <div className="item-metadata">
          <span>{l('Rarity', '稀有度', '稀有度', '희귀도')} <strong>{entry.view.rarity}</strong></span>
          {entry.view.itemLevel != null && <span>{l('Item level', '物品等级', '物品等級', '아이템 레벨')} <strong>{entry.view.itemLevel}</strong></span>}
          {entry.view.quality != null && <span>{l('Quality', '品质', '品質', '퀄리티')} <strong>{entry.view.quality}%</strong></span>}
          {entry.view.sockets && <span>{l('Sockets', '孔位', '插槽', '홈')} <strong>{entry.view.sockets}</strong></span>}
          {entry.view.corrupted && <span className="library-item-inspector-corrupted">{l('Corrupted', '已腐化', '已汙染', '타락')}</span>}
        </div>
        <div className="item-modifiers">
          {modifierGroups.map(({ group, entries: groupEntries }) => <section className={`modifier-group modifier-${group}`} key={group}>
            {groupEntries.map((modifier) => {
              const styleTag = modifier.sourceTags.find((tag) => ['crafted', 'fractured', 'mutated', 'rune', 'enchant'].includes(tag))
              return <p key={modifier.id} className={styleTag ? `mod-${styleTag}` : ''}>{modifierText(modifier, lang)}</p>
            })}
          </section>)}
          {!modifierGroups.length && <p>{l('No modifier snapshot', '暂无词条快照', '暫無詞綴快照', '속성 스냅샷 없음')}</p>}
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
          <strong>{itemName(entry, lang)}</strong>
          <small>{itemBaseType(entry, lang)}</small>
          <em>{entry.sources.map((itemSource) => sourceLabel(itemSource.kind, lang)).join(' / ')}</em>
        </span>
      </button>
    </article>
  }

  return <section className="equipment-library-workspace">
    <div className="library-workspace-commandbar">
      <label className="library-workspace-search"><Search /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={l('Search item, base, or modifier', '搜索装备名称、底材或词条', '搜尋裝備名稱、基底或詞綴', '아이템, 베이스 또는 속성 검색')} /></label>
      <div className="library-workspace-command-context"><Folder /><strong>{currentDirectoryLabel}</strong><small>{l(`${visibleEntries.length} items`, `${visibleEntries.length} 件`, `${visibleEntries.length} 件`, `${visibleEntries.length}개`)}</small></div>
      <button className="library-workspace-add-custom" disabled={busy} onClick={() => { setError(null); setCustomItemRaw('') }}><Plus /><span>{l('Add custom item', '添加自定义装备', '新增自訂裝備', '사용자 지정 장비 추가')}</span></button>
      {selectedEntry && <div className="library-workspace-selection-actions">
        <strong title={itemName(selectedEntry, lang)}>{itemName(selectedEntry, lang)}</strong>
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
        <button className="primary" disabled={busy || !leagueId} onClick={() => setPriceCheckEntryId(selectedEntry.id)} title={l('Configure price check', '选择词条并查价', '選擇詞綴並查價', '속성을 선택하고 가격 확인')}><Search /><span>{l('Price check', '查价', '查價', '가격 확인')}</span></button>
        {selectedEntry.sources[0] && <button disabled={busy} onClick={() => void bridge?.openLibrarySource(selectedEntry.id, selectedEntry.sources[0].sourceKey)} title={l('Open source', '打开来源', '開啟來源', '출처 열기')}><ExternalLink /></button>}
        <button className="danger" disabled={busy} onClick={() => void deleteEntry()} title={l('Delete equipment', '删除装备', '刪除裝備', '장비 삭제')}><Trash2 /></button>
      </div>}
    </div>
    <div className={`library-workspace-layout${directoryCollapsed ? ' directory-collapsed' : ''}`} style={{ '--library-directory-width': `${directoryCollapsed ? 42 : directoryWidth}px` } as CSSProperties}>
      <aside className="library-workspace-directory">
        <header>
          <strong>{l('Library categories', '仓库分类', '倉庫分類', '라이브러리 분류')}</strong>
          <span>{LIBRARY_CATEGORIES.length + 1}</span>
          <button className="library-workspace-directory-toggle" onClick={() => setDirectoryCollapsed((collapsed) => !collapsed)} title={directoryCollapsed ? l('Expand categories', '展开分类', '展開分類', '분류 펼치기') : l('Collapse categories', '收起分类', '收合分類', '분류 접기')} aria-label={directoryCollapsed ? l('Expand categories', '展开分类', '展開分類', '분류 펼치기') : l('Collapse categories', '收起分类', '收合分類', '분류 접기')}>
            {directoryCollapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
          </button>
        </header>
        <div className="library-workspace-directory-list">
          <button className={`library-workspace-directory-entry${view.kind === 'all' ? ' selected' : ''}`} onClick={() => selectDirectory({ kind: 'all' })}><FolderTree /><span>{l('All equipment', '全部装备', '全部裝備', '모든 장비')}</span><small>{entries.length}</small></button>
          {LIBRARY_CATEGORIES.map((directory) => <button className={`library-workspace-directory-entry source-directory${view.kind === 'category' && view.category === directory.category ? ' selected' : ''}`} key={directory.category} onClick={() => selectDirectory({ kind: 'category', category: directory.category })}><Folder /><span>{directory.label[lang]}</span><small>{entries.filter((entry) => belongsToCategory(entry, directory.category)).length}</small></button>)}
        </div>
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
          {!visibleEntries.length && <div className="library-workspace-empty-grid"><Tags /><strong>{l('This directory is empty', '这个目录还没有装备', '這個目錄尚無裝備', '이 디렉터리가 비어 있습니다')}</strong><span>{query ? l('No equipment matches the current search.', '没有匹配当前搜索条件的装备。', '沒有符合目前搜尋條件的裝備。', '현재 검색과 일치하는 장비가 없습니다.') : l('Items added from the market, builds, or custom input will appear here.', '从集市、构建或自定义入口添加装备后，它们会出现在这里。', '從市集、構築或自訂輸入新增的裝備會顯示於此。', '거래소, 빌드 또는 사용자 지정 입력에서 추가한 장비가 여기에 표시됩니다.')}</span></div>}
        </div>
      </section>
    </div>
    {tooltipEntry && tooltip && <div className="library-item-tooltip library-item-inspector-tooltip" role="tooltip" style={{ left: tooltip.left, top: tooltip.top }}>{renderItemInspector(tooltipEntry)}</div>}
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
    {priceCheckEntryId && (() => {
      const entry = entries.find((candidate) => candidate.id === priceCheckEntryId)
      const source = entry ? marketSource(entry) : undefined
      return <PriceCheckDialog
        realm={source?.realm || realm}
        target={{ kind: 'library', entryId: priceCheckEntryId }}
        language={lang}
        initialLeagueId={source?.leagueId || leagueId}
        onClose={() => setPriceCheckEntryId(null)}
        onSearched={(result) => setNotice(l(`Price search updated with ${result.total} results`, `查价搜索已更新，共 ${result.total} 条结果`, `查價搜尋已更新，共 ${result.total} 筆結果`, `가격 검색이 업데이트되었습니다. 결과 ${result.total}개`))}
      />
    })()}
  </section>
}
