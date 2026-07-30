import { useCallback, useEffect, useMemo, useState } from 'react'
import { Archive, ExternalLink, Folder, Maximize2, Minimize2, PackageOpen, Save, Search, Tag, Trash2, X } from 'lucide-react'
import type { EquipmentLibraryEntry, EquipmentLibrarySource, EquipmentLibrarySourceKind, MarketRealm, TradeLeague } from '@/types/market'

interface EquipmentLibraryPanelProps {
  realm: MarketRealm
  zh: boolean
  onClose: () => void
  expanded?: boolean
  onToggleExpanded?: () => void
}

const SOURCE_KINDS: Array<EquipmentLibrarySourceKind | 'all'> = [
  'all', 'market-favorite', 'equipment-favorite', 'pob-import', 'price-check', 'manual',
]

function sourceLabel(kind: EquipmentLibrarySourceKind | 'all', zh: boolean): string {
  const labels = zh ? {
    all: '全部来源', 'market-favorite': '集市收藏', 'equipment-favorite': '装备收藏',
    'pob-import': 'PoB 导入', 'price-check': '查价器', manual: '手动',
  } : {
    all: 'All sources', 'market-favorite': 'Market', 'equipment-favorite': 'Equipment',
    'pob-import': 'PoB import', 'price-check': 'Price check', manual: 'Manual',
  }
  return labels[kind]
}

function sourceDetail(source: EquipmentLibrarySource): string {
  if (source.kind === 'market-favorite') return source.price?.display || source.leagueId || source.realm.toUpperCase()
  if (source.kind === 'equipment-favorite') return source.slotName || source.equipmentSetId
  if (source.kind === 'pob-import') return source.pobItemId
  if (source.kind === 'price-check') return source.realm.toUpperCase()
  return ''
}

export function EquipmentLibraryPanel({ realm, zh, onClose, expanded = false, onToggleExpanded }: EquipmentLibraryPanelProps) {
  const bridge = window.pob2Market
  const [entries, setEntries] = useState<EquipmentLibraryEntry[]>([])
  const [query, setQuery] = useState('')
  const [sourceKind, setSourceKind] = useState<EquipmentLibrarySourceKind | 'all'>('all')
  const [includeArchived, setIncludeArchived] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [folder, setFolder] = useState('')
  const [tags, setTags] = useState('')
  const [note, setNote] = useState('')
  const [leagues, setLeagues] = useState<TradeLeague[]>([])
  const [leagueId, setLeagueId] = useState('')
  const [searchingId, setSearchingId] = useState<string | null>(null)
  const [searchNotice, setSearchNotice] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!bridge) return
    try {
      setEntries(await bridge.listLibrary({ query, sourceKind, includeArchived }))
      setError(null)
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setLoading(false)
    }
  }, [bridge, includeArchived, query, sourceKind])

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 120)
    return () => window.clearTimeout(timer)
  }, [load])

  useEffect(() => bridge?.onLibraryChanged(() => void load()), [bridge, load])

  useEffect(() => {
    let active = true
    void bridge?.listLeagues(realm).then((nextLeagues) => {
      if (!active) return
      setLeagues(nextLeagues)
      setLeagueId((current) => nextLeagues.some((league) => league.id === current) ? current : nextLeagues[0]?.id || '')
    }).catch(() => {})
    return () => { active = false }
  }, [bridge, realm])

  const visibleCount = useMemo(() => entries.length, [entries])

  const beginEdit = (entry: EquipmentLibraryEntry) => {
    setEditingId(entry.id)
    setFolder(entry.folder || '')
    setTags(entry.tags.join(', '))
    setNote(entry.note || '')
  }

  const saveMetadata = async (entry: EquipmentLibraryEntry) => {
    if (!bridge) return
    try {
      await bridge.updateLibrary({
        id: entry.id,
        folder,
        tags: tags.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean),
        note,
      })
      setEditingId(null)
      await load()
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : String(caught))
    }
  }

  const removeSource = async (sourceKey: string) => {
    if (!bridge) return
    await bridge.removeLibrarySource(sourceKey)
    await load()
  }

  const deleteEntry = async (entry: EquipmentLibraryEntry) => {
    if (!bridge || !window.confirm(zh ? `永久删除“${entry.item.name}”？` : `Permanently delete “${entry.item.name}”?`)) return
    await bridge.deleteLibrary(entry.id)
    await load()
  }

  const searchEntry = async (entry: EquipmentLibraryEntry) => {
    if (!bridge || !leagueId) return
    setSearchingId(entry.id)
    setSearchNotice(null)
    try {
      const result = await bridge.searchLibrary({ entryId: entry.id, realm, leagueId })
      setSearchNotice(zh
        ? `已生成官方搜索：${result.total} 条结果，使用 ${result.resolvedModifierCount} 条词缀，${result.unresolvedModifierCount} 条未解析。`
        : `Official search created: ${result.total} results, ${result.resolvedModifierCount} modifiers used, ${result.unresolvedModifierCount} unresolved.`)
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setSearchingId(null)
    }
  }

  return <aside className="equipment-library-panel" aria-label={zh ? '装备仓库' : 'Equipment library'}>
    <header className="equipment-library-header">
      <span><strong>{zh ? '装备仓库' : 'Equipment Library'}</strong><small>{visibleCount}</small></span>
      <div>
        {onToggleExpanded && <button className="icon-command compact" onClick={onToggleExpanded} title={expanded ? (zh ? '侧栏模式' : 'Sidebar view') : (zh ? '独立仓库界面' : 'Full library view')} aria-label={expanded ? (zh ? '侧栏模式' : 'Sidebar view') : (zh ? '独立仓库界面' : 'Full library view')}>{expanded ? <Minimize2 /> : <Maximize2 />}</button>}
        <button className="icon-command compact" onClick={onClose} title={zh ? '关闭仓库' : 'Close library'} aria-label={zh ? '关闭仓库' : 'Close library'}><X /></button>
      </div>
    </header>

    <div className="equipment-library-controls">
      <label className="equipment-library-search"><Search /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={zh ? '搜索装备、标签、备注' : 'Search items, tags, notes'} /></label>
      <select value={sourceKind} onChange={(event) => setSourceKind(event.target.value as EquipmentLibrarySourceKind | 'all')} aria-label={zh ? '来源筛选' : 'Source filter'}>
        {SOURCE_KINDS.map((kind) => <option key={kind} value={kind}>{sourceLabel(kind, zh)}</option>)}
      </select>
      <select className="equipment-library-league" value={leagueId} onChange={(event) => setLeagueId(event.target.value)} aria-label={zh ? '交易赛季' : 'Trade league'} disabled={!leagues.length}>
        {!leagues.length && <option value="">{zh ? '正在读取赛季' : 'Loading leagues'}</option>}
        {leagues.map((league) => <option key={league.id} value={league.id}>{league.text}</option>)}
      </select>
      <label className="equipment-library-archived"><input type="checkbox" checked={includeArchived} onChange={(event) => setIncludeArchived(event.target.checked)} />{zh ? '显示归档' : 'Show archived'}</label>
    </div>

    <div className="equipment-library-status">
      {error && <div className="equipment-library-error" role="alert">{error}</div>}
      {searchNotice && <div className="equipment-library-notice" role="status">{searchNotice}</div>}
    </div>
    <div className="equipment-library-list">
      {!loading && !entries.length && <div className="equipment-library-empty"><PackageOpen /><span>{zh ? '还没有符合条件的装备' : 'No matching equipment yet'}</span></div>}
      {entries.map((entry) => <article className={`equipment-library-entry rarity-${entry.item.rarity.toLowerCase()}${entry.archived ? ' archived' : ''}`} key={entry.id}>
        <div className="equipment-library-item-head">
          {entry.item.iconUrl ? <img src={entry.item.iconUrl} alt="" /> : <div className="equipment-library-icon"><PackageOpen /></div>}
          <span><strong>{entry.item.name}</strong><small>{entry.item.baseType}</small></span>
          <div className="equipment-library-item-actions">
            <button className="icon-command compact" disabled={!leagueId || searchingId === entry.id} onClick={() => void searchEntry(entry)} title={zh ? '在官方集市查找相似装备' : 'Find similar items on official market'} aria-label={zh ? '在官方集市查找相似装备' : 'Find similar items on official market'}><Search /></button>
            <button className="icon-command compact" onClick={() => void bridge?.updateLibrary({ id: entry.id, archived: !entry.archived })} title={entry.archived ? (zh ? '取消归档' : 'Unarchive') : (zh ? '归档' : 'Archive')} aria-label={entry.archived ? (zh ? '取消归档' : 'Unarchive') : (zh ? '归档' : 'Archive')}><Archive /></button>
            <button className="icon-command compact danger" onClick={() => void deleteEntry(entry)} title={zh ? '删除' : 'Delete'} aria-label={zh ? '删除' : 'Delete'}><Trash2 /></button>
          </div>
        </div>

        <div className="equipment-library-facts">
          {entry.item.itemLevel != null && <span>iLvl {entry.item.itemLevel}</span>}
          {entry.item.quality != null && <span>Q {entry.item.quality}%</span>}
          {entry.item.sockets && <span>{entry.item.sockets}</span>}
          {entry.folder && <span><Folder />{entry.folder}</span>}
          {entry.tags.map((tag) => <span key={tag}><Tag />{tag}</span>)}
        </div>

        {!!entry.item.modifiers.length && <div className="equipment-library-mods">
          {entry.item.modifiers.map((modifier) => <span key={modifier.id} data-group={modifier.group}>{modifier.original.displayText}</span>)}
        </div>}

        <div className="equipment-library-sources">
          {entry.sources.map((source) => <div key={source.sourceKey}>
            <span><b>{sourceLabel(source.kind, zh)}</b>{sourceDetail(source) && <small>{sourceDetail(source)}</small>}</span>
            {source.kind === 'market-favorite' && <button className="icon-command compact" onClick={() => void bridge?.openLibrarySource(entry.id, source.sourceKey)} title={zh ? '打开来源' : 'Open source'} aria-label={zh ? '打开来源' : 'Open source'}><ExternalLink /></button>}
            <button className="icon-command compact" onClick={() => void removeSource(source.sourceKey)} title={zh ? '移除此来源' : 'Remove source'} aria-label={zh ? '移除此来源' : 'Remove source'}><X /></button>
          </div>)}
        </div>

        {editingId === entry.id ? <div className="equipment-library-editor">
          <label><span>{zh ? '目录' : 'Folder'}</span><input value={folder} onChange={(event) => setFolder(event.target.value)} maxLength={120} /></label>
          <label><span>{zh ? '标签' : 'Tags'}</span><input value={tags} onChange={(event) => setTags(event.target.value)} maxLength={512} placeholder={zh ? '逗号分隔' : 'Comma separated'} /></label>
          <label><span>{zh ? '备注' : 'Note'}</span><textarea value={note} onChange={(event) => setNote(event.target.value)} maxLength={4000} rows={3} /></label>
          <div><button className="secondary-command" onClick={() => setEditingId(null)}>{zh ? '取消' : 'Cancel'}</button><button className="primary-command" onClick={() => void saveMetadata(entry)}><Save />{zh ? '保存' : 'Save'}</button></div>
        </div> : <button className="equipment-library-edit" onClick={() => beginEdit(entry)}>{entry.note || (zh ? '添加目录、标签或备注' : 'Add folder, tags, or note')}</button>}
      </article>)}
    </div>
  </aside>
}
