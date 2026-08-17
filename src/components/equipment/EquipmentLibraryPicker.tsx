import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { Check, FileText, Gem, LoaderCircle, Search, X } from 'lucide-react'
import { createPortal } from 'react-dom'
import type { EquipmentCollectionRoot, EquipmentLibraryEntry, EquipmentLibraryFolder } from '@/types/market'
import { EquipmentItemInspector, equipmentItemBaseType, equipmentItemName } from './EquipmentItemInspector'
import { EquipmentCollectionTree, type EquipmentCollectionSelection } from './EquipmentCollectionTree'
import { useTranslation } from '@/i18n/useTranslation'
import { uiText, type UiMessage } from '@/i18n/uiLocale'
import { fitsEquipmentLibrarySlot, isEquipmentLibraryJewel } from '@/engine/equipmentLibrarySlot'
import { EquipmentDifferenceTooltip } from '@/equipmentDifference/components/EquipmentDifferenceTooltip'
import type { BuildContextSnapshot } from '@/equipmentDifference'

export type EquipmentLibraryPickerMode = 'equipment' | 'jewel'

interface Props {
  mode: EquipmentLibraryPickerMode
  title: UiMessage
  subtitle?: UiMessage
  currentSlot?: string
  differenceContext?: BuildContextSnapshot | null
  differenceSlotName?: string
  onClose: () => void
  onSelect: (entry: EquipmentLibraryEntry) => void
  filterEntry?: (entry: EquipmentLibraryEntry) => boolean
}

const ROOTS: Array<{ id: EquipmentCollectionRoot; label: UiMessage }> = [
  { id: 'market', label: { en: 'Market favorites', 'zh-rCN': '集市收藏', 'zh-rTW': '市集收藏', 'ko-KR': '거래소 즐겨찾기' } },
  { id: 'build', label: { en: 'Build imports', 'zh-rCN': '构筑导入', 'zh-rTW': '構築匯入', 'ko-KR': '빌드 가져오기' } },
  { id: 'custom', label: { en: 'Custom', 'zh-rCN': '自定义', 'zh-rTW': '自訂', 'ko-KR': '사용자 지정' } },
]

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

export function EquipmentLibraryPicker({ mode, title, subtitle, currentSlot, differenceContext, differenceSlotName, onClose, onSelect, filterEntry }: Props) {
  const { lang } = useTranslation()
  const l = (en: string, zhCN: string, zhTW: string, koKR: string) => uiText(lang, en, zhCN, zhTW, koKR)
  const [entries, setEntries] = useState<EquipmentLibraryEntry[]>([])
  const [folders, setFolders] = useState<EquipmentLibraryFolder[]>([])
  const [selection, setSelection] = useState<EquipmentCollectionSelection>({ kind: 'all' })
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tooltip, setTooltip] = useState<{ entryId: string; left: number; top: number } | null>(null)
  const tooltipHideTimerRef = useRef<number | null>(null)

  const load = useCallback(async () => {
    if (!window.pob2Market) {
      setError(l('Equipment library is unavailable', '装备仓库不可用', '裝備倉庫不可用', '장비 보관함을 사용할 수 없습니다'))
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const [nextEntries, sidebar] = await Promise.all([
        window.pob2Market.listLibrary({ sourceKind: 'all', includeArchived: false }),
        window.pob2Market.getSidebar(),
      ])
      setEntries(nextEntries.filter((entry) => Boolean(entry.item.raw)))
      setFolders(sidebar.folders.filter((folder) => folder.scope === 'items'))
      setError(null)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setLoading(false)
    }
  }, [lang])

  useEffect(() => { void load() }, [load])
  useEffect(() => {
    const handler = () => void load()
    return window.pob2Market?.onLibraryChanged(handler)
  }, [load])
  useEffect(() => {
    const handler = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])
  useEffect(() => () => {
    if (tooltipHideTimerRef.current != null) window.clearTimeout(tooltipHideTimerRef.current)
  }, [])

  const compatibleEntries = useMemo(() => entries.filter((entry) => {
    if (mode === 'jewel' && !isEquipmentLibraryJewel(entry)) return false
    if (mode === 'equipment' && !fitsEquipmentLibrarySlot(entry, currentSlot)) return false
    return filterEntry ? filterEntry(entry) : true
  }), [currentSlot, entries, filterEntry, mode])

  const visibleEntries = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase()
    return compatibleEntries.filter((entry) => {
      if (selection.kind === 'root') {
        if (entry.collectionRoot !== selection.root) return false
        if (selection.folderId && entry.folderId !== selection.folderId) return false
        if (!selection.folderId && entry.folderId) return false
      }
      if (!normalizedQuery) return true
      const values = [entry.view.name, entry.view.baseType, entry.view.tradeCategory, ...entry.view.modifiers.flatMap((modifier) => [modifier.text, ...Object.values(modifier.localized || {})])]
      return values.filter(Boolean).join('\n').toLocaleLowerCase().includes(normalizedQuery)
    })
  }, [compatibleEntries, query, selection])

  const selected = selectedId ? visibleEntries.find((entry) => entry.id === selectedId) : undefined
  useEffect(() => {
    if (selectedId && !visibleEntries.some((entry) => entry.id === selectedId)) setSelectedId(null)
  }, [selectedId, visibleEntries])

  const selectDirectory = (next: EquipmentCollectionSelection) => {
    setSelection(next)
    setSelectedId(null)
    hideTooltip()
  }

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

  const showTooltip = (event: ReactMouseEvent<HTMLElement>, entry: EquipmentLibraryEntry) => {
    cancelTooltipHide()
    const rect = event.currentTarget.getBoundingClientRect()
    const width = 326
    const height = Math.min(360, Math.max(0, window.innerHeight - 20))
    const left = rect.right + 10 + width <= window.innerWidth ? rect.right + 10 : Math.max(10, rect.left - width - 10)
    const top = Math.max(10, Math.min(rect.top, window.innerHeight - height - 10))
    setTooltip({ entryId: entry.id, left, top })
  }

  const tooltipEntry = tooltip ? entries.find((entry) => entry.id === tooltip.entryId) : undefined
  const renderCard = (entry: EquipmentLibraryEntry) => <article
    className={`library-item-card${selectedId === entry.id ? ' selected' : ''}`}
    key={entry.id}
    onMouseEnter={(event) => showTooltip(event, entry)}
    onMouseLeave={scheduleTooltipHide}
  >
    <button type="button" className="library-item-card-main" onClick={() => setSelectedId((current) => current === entry.id ? null : entry.id)} aria-pressed={selectedId === entry.id}>
      <span className="library-item-card-icon">{entry.view.iconUrl ? <img src={entry.view.iconUrl} alt="" /> : <FileText />}</span>
      <span className="library-item-card-copy"><strong>{equipmentItemName(entry.view, lang)}</strong><small>{equipmentItemBaseType(entry.view, lang)}</small><em>{entry.sources.map((source) => source.kind).join(' / ')}</em></span>
    </button>
  </article>

  return createPortal(<div className="equipment-picker-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section className="equipment-library-picker" role="dialog" aria-modal="true" aria-labelledby="equipment-library-picker-title">
      <div className="library-workspace-toolbar">
        <div><Gem aria-hidden="true" /><span><strong id="equipment-library-picker-title">{title[lang]}</strong><small>{subtitle?.[lang] || (currentSlot ? `${l('Current slot', '当前槽位', '目前插槽', '현재 슬롯')}: ${currentSlot}` : l('Select from the shared equipment library', '从公共装备仓库中选择', '從公共裝備倉庫中選擇', '공용 장비 보관함에서 선택'))}</small></span></div>
        <div><button type="button" onClick={onClose} title={l('Close', '关闭', '關閉', '닫기')} aria-label={l('Close', '关闭', '關閉', '닫기')}><X /></button></div>
      </div>
      <div className="library-workspace-commandbar equipment-picker-commandbar">
        <div className="library-workspace-command-leading"><label className="library-workspace-search"><Search /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder={mode === 'jewel' ? l('Search jewel name, base, or modifier', '搜索珠宝名称、底材或词条', '搜尋珠寶名稱、基底或詞綴', '주얼 이름, 베이스 또는 속성 검색') : l('Search item name, base, or modifier', '搜索装备名称、底材或词条', '搜尋裝備名稱、基底或詞綴', '아이템 이름, 베이스 또는 속성 검색')} /></label><span className="library-workspace-result-count">{l(`${visibleEntries.length} items`, `${visibleEntries.length} 件`, `${visibleEntries.length} 件`, `${visibleEntries.length}개`)}</span></div>
        <div className="library-workspace-command-actions">{selected && <div className="library-workspace-selection-actions"><button type="button" className="primary" onClick={() => onSelect(selected)}><Check /><span>{mode === 'jewel' ? l('Bind jewel', '绑定珠宝', '綁定珠寶', '주얼 장착') : l('Change equipment', '更换装备', '更換裝備', '장비 변경')}</span></button></div>}</div>
      </div>
      <div className="library-workspace-layout equipment-picker-layout">
        <aside className="library-workspace-directory"><header><strong>{l('Library categories', '仓库分类', '倉庫分類', '라이브러리 분류')}</strong><span>{folders.length}</span></header><EquipmentCollectionTree roots={ROOTS.map((root) => ({ id: root.id, label: root.label[lang] }))} folders={folders} entries={compatibleEntries} selection={selection} readOnly allLabel={mode === 'jewel' ? l('All jewels', '全部珠宝', '全部珠寶', '모든 주얼') : l('All equipment', '全部装备', '全部裝備', '모든 장비')} labels={{ collapse: l('Collapse', '折叠', '收合', '접기'), expand: l('Expand', '展开', '展開', '펼치기'), newFolder: '', rename: '', delete: '' }} onSelect={selectDirectory} onCreate={async () => undefined} onRename={async () => undefined} onDelete={async () => undefined} onToggle={async (folder) => { await window.pob2Market?.updateFolder({ id: folder.id, expanded: !folder.expanded }); await load() }} /></aside>
        <div className="library-workspace-splitter" aria-hidden="true" />
        <section className="library-workspace-grid-pane">{loading ? <div className="library-workspace-empty-grid"><LoaderCircle className="spinning" /><strong>{l('Loading equipment library…', '正在读取装备仓库…', '正在讀取裝備倉庫…', '장비 보관함 불러오는 중…')}</strong></div> : error ? <div className="library-workspace-empty-grid"><strong>{error}</strong></div> : <div className="library-workspace-grid">{visibleEntries.map(renderCard)}{!visibleEntries.length && <div className="library-workspace-empty-grid"><Gem /><strong>{l('No matching items', '没有匹配的装备', '沒有符合的裝備', '일치하는 아이템이 없습니다')}</strong></div>}</div>}</section>
      </div>
      {tooltipEntry && tooltip && <div className="library-item-tooltip library-item-inspector-tooltip" role="tooltip" style={{ left: tooltip.left, top: tooltip.top }} onMouseEnter={cancelTooltipHide} onMouseLeave={hideTooltip}>
        <EquipmentItemInspector view={tooltipEntry.view} language={lang} />
        {differenceContext && tooltipEntry.item.raw && <EquipmentDifferenceTooltip
          context={differenceContext}
          candidate={{ raw: tooltipEntry.item.raw, source: 'equipment-library' }}
          language={lang}
          sourceSlotName={differenceSlotName || currentSlot}
          slotOnlyTooltips={Boolean(differenceSlotName || currentSlot)}
        />}
      </div>}
    </section>
  </div>, document.body)
}

export function equipmentLibraryFolderPath(folder: EquipmentLibraryFolder, folders: EquipmentLibraryFolder[]): string {
  return folderPath(folder, folders)
}
