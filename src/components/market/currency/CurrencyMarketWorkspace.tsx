import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, ArrowDown, ArrowUp, Coins, RefreshCw, Search, X } from 'lucide-react'
import type { CurrencyMarketItem, CurrencyMarketState, CurrencyQuoteUnit } from '@/types/currencyMarket'
import type { BuildRealm } from '@/types/tree'

interface CurrencyMarketWorkspaceProps { realm: BuildRealm; zh: boolean }
type SortKey = 'name' | 'category' | 'price' | 'quality' | 'updated'

const qualityOrder = { anomalous: 0, missing: 1, thin: 2, good: 3 }

export function CurrencyMarketWorkspace({ realm, zh }: CurrencyMarketWorkspaceProps) {
  const bridge = window.pob2CurrencyMarket
  const [state, setState] = useState<CurrencyMarketState>()
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string>()
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('all')
  const [quoteUnit, setQuoteUnit] = useState<CurrencyQuoteUnit>('exalted')
  const [sortKey, setSortKey] = useState<SortKey>('price')
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc')
  const [selectedId, setSelectedId] = useState<string>()

  useEffect(() => {
    let active = true
    setLoading(true)
    setError(undefined)
    setState(undefined)
    setSelectedId(undefined)
    void bridge?.get().then((value) => {
      if (!active || value.snapshot.realm !== realm) return
      setState(value)
      setError(value.error)
    }).catch((caught) => { if (active) setError(caught instanceof Error ? caught.message : String(caught)) })
      .finally(() => { if (active) setLoading(false) })
    const off = bridge?.onChanged((value) => {
      if (!active || value.snapshot.realm !== realm) return
      setState(value)
      setError(value.error)
      setRefreshing(false)
    })
    return () => { active = false; off?.() }
  }, [bridge, realm])

  const categories = useMemo(() => {
    const counts = new Map<string, { label: string; count: number }>()
    for (const item of state?.snapshot.items || []) {
      const current = counts.get(item.categoryId)
      counts.set(item.categoryId, { label: item.categoryLabel, count: (current?.count || 0) + 1 })
    }
    return [...counts.entries()].sort((a, b) => a[1].label.localeCompare(b[1].label, zh ? 'zh-CN' : 'en'))
  }, [state, zh])

  const items = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase()
    const result = (state?.snapshot.items || []).filter((item) => category === 'all' || item.categoryId === category)
      .filter((item) => !needle || item.name.toLocaleLowerCase().includes(needle) || item.englishName?.toLocaleLowerCase().includes(needle))
    return result.sort((a, b) => {
      let comparison = 0
      if (sortKey === 'name') comparison = a.name.localeCompare(b.name, zh ? 'zh-CN' : 'en')
      else if (sortKey === 'category') comparison = a.categoryLabel.localeCompare(b.categoryLabel, zh ? 'zh-CN' : 'en')
      else if (sortKey === 'quality') comparison = qualityOrder[a.quality] - qualityOrder[b.quality]
      else if (sortKey === 'updated') comparison = (a.updatedAt || state?.snapshot.fetchedAt || '').localeCompare(b.updatedAt || state?.snapshot.fetchedAt || '')
      else {
        const left = quoteUnit === 'divine' ? a.priceDivine : a.priceExalted
        const right = quoteUnit === 'divine' ? b.priceDivine : b.priceExalted
        if (left == null && right != null) return 1
        if (left != null && right == null) return -1
        comparison = (left || 0) - (right || 0)
      }
      return sortDirection === 'asc' ? comparison : -comparison
    })
  }, [category, query, quoteUnit, sortDirection, sortKey, state, zh])

  const selected = items.find((item) => item.id === selectedId) || items[0]
  const refresh = async () => {
    if (!bridge || refreshing) return
    setRefreshing(true)
    setError(undefined)
    try {
      const value = await bridge.get(true)
      if (value.snapshot.realm === realm) setState(value)
      setError(value.error)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally { setRefreshing(false); setLoading(false) }
  }
  const changeSort = (key: SortKey) => {
    if (sortKey === key) setSortDirection((current) => current === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDirection(key === 'name' || key === 'category' ? 'asc' : 'desc') }
  }
  const moveSelection = (direction: number) => {
    if (!items.length) return
    const currentIndex = Math.max(0, items.findIndex((item) => item.id === selected?.id))
    setSelectedId(items[Math.max(0, Math.min(items.length - 1, currentIndex + direction))].id)
  }

  const snapshot = state?.snapshot
  const realmLabel = realm === 'cn' ? (zh ? '腾讯服' : 'Tencent CN') : (zh ? '国际服' : 'Global')
  const updatedAt = snapshot?.sourceUpdatedAt || snapshot?.fetchedAt
  return <section className="currency-market-workspace">
    <header className="currency-market-toolbar">
      <label className="currency-market-search"><Search /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={zh ? '搜索通货名称' : 'Search currency'} />{query && <button onClick={() => setQuery('')} title={zh ? '清除搜索' : 'Clear search'} aria-label={zh ? '清除搜索' : 'Clear search'}><X /></button>}</label>
      <select value={category} onChange={(event) => setCategory(event.target.value)} aria-label={zh ? '通货分类' : 'Currency category'}>
        <option value="all">{zh ? `全部分类 (${snapshot?.items.length || 0})` : `All categories (${snapshot?.items.length || 0})`}</option>
        {categories.map(([id, entry]) => <option key={id} value={id}>{entry.label} ({entry.count})</option>)}
      </select>
      <div className="currency-quote-control" aria-label={zh ? '计价单位' : 'Quote unit'}>
        <button className={quoteUnit === 'exalted' ? 'active' : ''} onClick={() => setQuoteUnit('exalted')}>{zh ? '崇高石' : 'Exalted'}</button>
        <button className={quoteUnit === 'divine' ? 'active' : ''} disabled={!snapshot?.divineInExalted} onClick={() => setQuoteUnit('divine')}>{zh ? '神圣石' : 'Divine'}</button>
      </div>
      <div className={`currency-market-realm ${realm}`}>{realmLabel}</div>
      <div className="currency-market-source"><strong>{snapshot?.sourceLabel || (realm === 'cn' ? 'poecurrency.top' : 'poe2scout.com')}</strong>{snapshot?.sourceLeague && <small>{snapshot.sourceLeague}</small>}</div>
      <div className={`currency-market-freshness ${state?.cacheStatus || ''}`}><span>{refreshing ? (zh ? '正在刷新' : 'Refreshing') : state?.cacheStatus === 'stale' ? (zh ? '缓存已过期' : 'Stale cache') : state ? (zh ? '已缓存' : 'Cached') : (zh ? '等待数据' : 'Waiting')}</span><small>{updatedAt ? formatDate(updatedAt) : '--'}</small></div>
      <button className="currency-market-refresh" onClick={() => void refresh()} disabled={refreshing} title={zh ? '刷新通货行情' : 'Refresh currency market'} aria-label={zh ? '刷新通货行情' : 'Refresh currency market'}><RefreshCw className={refreshing ? 'spinning' : ''} /></button>
    </header>
    {error && <div className="currency-market-error"><AlertTriangle /><span>{error}</span><button onClick={() => void refresh()}>{zh ? '重试' : 'Retry'}</button></div>}
    <div className="currency-market-layout">
      <div className="currency-market-table-wrap">
        <table className="currency-market-table">
          <thead><tr>
            <SortableHeader label={zh ? '通货' : 'Currency'} column="name" current={sortKey} direction={sortDirection} onChange={changeSort} />
            <SortableHeader label={zh ? '分类' : 'Category'} column="category" current={sortKey} direction={sortDirection} onChange={changeSort} />
            <SortableHeader label={zh ? '当前价格' : 'Current price'} column="price" current={sortKey} direction={sortDirection} onChange={changeSort} />
            <th>{quoteUnit === 'exalted' ? (zh ? '神圣石折算' : 'In divine') : (zh ? '崇高石折算' : 'In exalted')}</th>
            <SortableHeader label={zh ? '状态' : 'Status'} column="quality" current={sortKey} direction={sortDirection} onChange={changeSort} />
            <SortableHeader label={zh ? '更新时间' : 'Updated'} column="updated" current={sortKey} direction={sortDirection} onChange={changeSort} />
          </tr></thead>
          <tbody>
            {loading && !state && Array.from({ length: 9 }, (_, index) => <tr className="currency-market-skeleton" key={index}><td colSpan={6}><i /></td></tr>)}
            {!loading && !state && <tr><td colSpan={6}><EmptyState zh={zh} error /></td></tr>}
            {state && !items.length && <tr><td colSpan={6}><EmptyState zh={zh} /></td></tr>}
            {items.map((item) => <tr key={item.id} className={selected?.id === item.id ? 'selected' : ''} tabIndex={selected?.id === item.id ? 0 : -1} onClick={() => setSelectedId(item.id)} onKeyDown={(event) => { if (event.key === 'ArrowDown') { event.preventDefault(); moveSelection(1) } else if (event.key === 'ArrowUp') { event.preventDefault(); moveSelection(-1) } }}>
              <td><div className="currency-market-name"><CurrencyIcon item={item} /><span><strong>{item.name}</strong>{item.englishName && item.englishName !== item.name && <small>{item.englishName}</small>}</span></div></td>
              <td className="currency-market-category">{item.categoryLabel}</td>
              <td className="currency-market-price">{formatPrice(quoteUnit === 'divine' ? item.priceDivine : item.priceExalted)} <small>{quoteUnit === 'divine' ? 'D' : 'E'}</small></td>
              <td className="currency-market-conversion">{formatPrice(quoteUnit === 'exalted' ? item.priceDivine : item.priceExalted)} <small>{quoteUnit === 'exalted' ? 'D' : 'E'}</small></td>
              <td><Quality item={item} zh={zh} /></td>
              <td className="currency-market-updated">{formatTime(item.updatedAt || snapshot?.fetchedAt)}</td>
            </tr>)}
          </tbody>
        </table>
      </div>
      <CurrencyMarketDetails item={selected} snapshot={snapshot} quoteUnit={quoteUnit} zh={zh} />
    </div>
  </section>
}

function SortableHeader({ label, column, current, direction, onChange }: { label: string; column: SortKey; current: SortKey; direction: 'asc' | 'desc'; onChange: (key: SortKey) => void }) {
  return <th><button onClick={() => onChange(column)}>{label}{current === column && (direction === 'asc' ? <ArrowUp /> : <ArrowDown />)}</button></th>
}

function CurrencyIcon({ item }: { item: CurrencyMarketItem }) {
  const [failed, setFailed] = useState(false)
  return item.iconUrl && !failed ? <img src={item.iconUrl} alt="" onError={() => setFailed(true)} /> : <i><Coins /></i>
}

function Quality({ item, zh }: { item: CurrencyMarketItem; zh: boolean }) {
  const label = item.quality === 'good' ? (zh ? '正常' : 'Normal') : item.quality === 'thin' ? (zh ? '样本偏少' : 'Thin') : item.quality === 'anomalous' ? (zh ? '异常' : 'Anomalous') : (zh ? '暂无价格' : 'No price')
  return <span className={`currency-quality ${item.quality}`} title={item.qualityReason}>{label}</span>
}

function CurrencyMarketDetails({ item, snapshot, quoteUnit, zh }: { item?: CurrencyMarketItem; snapshot?: CurrencyMarketState['snapshot']; quoteUnit: CurrencyQuoteUnit; zh: boolean }) {
  if (!item) return <aside className="currency-market-details empty"><Coins /><span>{zh ? '选择一项通货查看行情明细' : 'Select a currency for details'}</span></aside>
  const details = item.sourceDetails
  const primary = quoteUnit === 'divine' ? item.priceDivine : item.priceExalted
  const secondary = quoteUnit === 'divine' ? item.priceExalted : item.priceDivine
  const rawUnit = item.originalQuote?.unit.toUpperCase() || ''
  return <aside className="currency-market-details">
    <header><CurrencyIcon item={item} /><span><strong>{item.name}</strong><small>{item.englishName && item.englishName !== item.name ? `${item.englishName} · ` : ''}{item.categoryLabel}</small></span></header>
    <section className="currency-detail-price"><strong>{formatPrice(primary)} <small>{quoteUnit === 'divine' ? 'D' : 'E'}</small></strong><span>{zh ? '折算' : 'Converted'} {formatPrice(secondary)} {quoteUnit === 'divine' ? 'E' : 'D'}</span><Quality item={item} zh={zh} /></section>
    {details.kind === 'poecurrency' ? <>
      <DetailGroup title={zh ? '当前市场' : 'Current market'} rows={[
        [zh ? '最新买入' : 'Latest buy', formatRaw(details.latestBuy, rawUnit)],
        [zh ? '最新卖出' : 'Latest sell', formatRaw(details.latestSell, rawUnit)],
        [zh ? '买入均价' : 'Average buy', formatRaw(details.averageBuy, rawUnit)],
        [zh ? '卖出均价' : 'Average sell', formatRaw(details.averageSell, rawUnit)],
      ]} />
      <DetailGroup title={zh ? '时段参考' : 'Period averages'} rows={[
        [zh ? '12 小时买入' : '12h buy', formatRaw(details.average12hBuy, rawUnit)],
        [zh ? '12 小时卖出' : '12h sell', formatRaw(details.average12hSell, rawUnit)],
        [zh ? '24 小时买入' : '24h buy', formatRaw(details.average24hBuy, rawUnit)],
        [zh ? '24 小时卖出' : '24h sell', formatRaw(details.average24hSell, rawUnit)],
      ]} />
      <DetailGroup title={zh ? '变化' : 'Change'} rows={[
        [zh ? '买入涨跌' : 'Buy change', formatPercent(details.buyChangePercent)],
        [zh ? '卖出涨跌' : 'Sell change', formatPercent(details.sellChangePercent)],
        [zh ? '前次买入' : 'Previous buy', formatRaw(details.previousBuy, rawUnit)],
      ]} />
    </> : <>
      <DetailGroup title={zh ? '市场活跃度' : 'Market activity'} rows={[
        [zh ? '采用报价对' : 'Selected pair', details.pairLabel],
        [zh ? '成交价值' : 'Value traded', formatNumber(details.valueTraded)],
        [zh ? '成交数量' : 'Volume traded', formatNumber(details.volumeTraded)],
        [zh ? '当前库存' : 'Stock value', formatNumber(details.stockValue)],
        [zh ? '最高库存' : 'Highest stock', formatNumber(details.highestStock)],
      ]} />
    </>}
    <DetailGroup title={zh ? '数据来源' : 'Source'} rows={[
      [zh ? '来源' : 'Source', snapshot?.sourceLabel || '--'],
      [zh ? '赛季' : 'League', snapshot?.sourceLeague || (zh ? '国服当前行情' : 'Current CN market')],
      [zh ? '原始报价' : 'Original quote', item.originalQuote?.label || '--'],
      [zh ? '数据时间' : 'Data time', formatDate(item.updatedAt || snapshot?.sourceUpdatedAt || snapshot?.fetchedAt)],
      [zh ? '神圣石汇率' : 'Divine rate', snapshot?.divineInExalted ? `${formatPrice(snapshot.divineInExalted)} E` : '--'],
    ]} />
    {item.qualityReason && <div className="currency-detail-warning"><AlertTriangle />{item.qualityReason}</div>}
  </aside>
}

function DetailGroup({ title, rows }: { title: string; rows: Array<[string, string]> }) {
  return <section className="currency-detail-group"><h3>{title}</h3>{rows.map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</section>
}

function EmptyState({ zh, error = false }: { zh: boolean; error?: boolean }) {
  return <div className="currency-market-empty"><Coins /><strong>{error ? (zh ? '暂时无法读取通货行情' : 'Currency market unavailable') : (zh ? '没有匹配的通货' : 'No matching currencies')}</strong><small>{error ? (zh ? '检查网络后重试，已有缓存不会被清除' : 'Check the network and retry') : (zh ? '调整搜索名称或分类' : 'Change the search or category')}</small></div>
}

function formatPrice(value?: number): string {
  if (value == null || !Number.isFinite(value) || value <= 0) return '--'
  if (value < 0.01) return value.toLocaleString(undefined, { maximumSignificantDigits: 4 })
  if (value < 10) return value.toLocaleString(undefined, { maximumFractionDigits: 2 })
  return value.toLocaleString(undefined, { maximumFractionDigits: 1 })
}
function formatRaw(value: number | undefined, unit: string): string { return value == null ? '--' : `${formatPrice(value)} ${unit}`.trim() }
function formatNumber(value?: number): string { return value == null ? '--' : value.toLocaleString(undefined, { maximumFractionDigits: 2 }) }
function formatPercent(value?: number): string { return value == null ? '--' : `${value > 0 ? '+' : ''}${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}%` }
function parseDate(value?: string): Date | undefined { if (!value) return undefined; const date = new Date(value.includes('T') ? value : value.replace(' ', 'T')); return Number.isNaN(date.getTime()) ? undefined : date }
function formatDate(value?: string): string { const date = parseDate(value); return date ? date.toLocaleString() : '--' }
function formatTime(value?: string): string { const date = parseDate(value); return date ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '--' }
