import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, ArrowDown, ArrowUp, Coins, RefreshCw, Search, X } from 'lucide-react'
import type { CurrencyMarketItem, CurrencyMarketState, CurrencyQuoteUnit } from '@/types/currencyMarket'
import type { BuildRealm } from '@/types/tree'
import { useTranslation } from '@/i18n/useTranslation'
import type { Language } from '@/i18n/translationLoader'
import { LANGUAGE_LOCALES, formatUiDate, formatUiNumber, uiText } from '@/i18n/uiLocale'

interface CurrencyMarketWorkspaceProps { realm: BuildRealm }
type SortKey = 'name' | 'category' | 'price' | 'quality' | 'updated'

const qualityOrder = { anomalous: 0, missing: 1, thin: 2, good: 3 }

export function CurrencyMarketWorkspace({ realm }: CurrencyMarketWorkspaceProps) {
  const { lang } = useTranslation()
  const l = (en: string, zhCN: string, zhTW: string, koKR: string) => uiText(lang, en, zhCN, zhTW, koKR)
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
    return [...counts.entries()].sort((a, b) => a[1].label.localeCompare(b[1].label, LANGUAGE_LOCALES[lang]))
  }, [lang, state])

  const items = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase()
    const result = (state?.snapshot.items || []).filter((item) => category === 'all' || item.categoryId === category)
      .filter((item) => !needle || item.name.toLocaleLowerCase().includes(needle) || item.englishName?.toLocaleLowerCase().includes(needle))
    return result.sort((a, b) => {
      let comparison = 0
      if (sortKey === 'name') comparison = a.name.localeCompare(b.name, LANGUAGE_LOCALES[lang])
      else if (sortKey === 'category') comparison = a.categoryLabel.localeCompare(b.categoryLabel, LANGUAGE_LOCALES[lang])
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
  }, [category, lang, query, quoteUnit, sortDirection, sortKey, state])

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
  const realmLabel = realm === 'cn' ? l('Tencent CN', '腾讯服', '騰訊服', 'Tencent 중국') : l('Global', '国际服', '國際服', '글로벌')
  const updatedAt = snapshot?.sourceUpdatedAt || snapshot?.fetchedAt
  return <section className="currency-market-workspace">
    <header className="currency-market-toolbar">
      <label className="currency-market-search"><Search /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={l('Search currency', '搜索通货名称', '搜尋通貨名稱', '화폐 검색')} />{query && <button onClick={() => setQuery('')} title={l('Clear search', '清除搜索', '清除搜尋', '검색 지우기')} aria-label={l('Clear search', '清除搜索', '清除搜尋', '검색 지우기')}><X /></button>}</label>
      <select value={category} onChange={(event) => setCategory(event.target.value)} aria-label={l('Currency category', '通货分类', '通貨分類', '화폐 분류')}>
        <option value="all">{l(`All categories (${snapshot?.items.length || 0})`, `全部分类 (${snapshot?.items.length || 0})`, `所有分類 (${snapshot?.items.length || 0})`, `모든 분류 (${snapshot?.items.length || 0})`)}</option>
        {categories.map(([id, entry]) => <option key={id} value={id}>{entry.label} ({entry.count})</option>)}
      </select>
      <div className="currency-quote-control" aria-label={l('Quote unit', '计价单位', '計價單位', '가격 단위')}>
        <button className={quoteUnit === 'exalted' ? 'active' : ''} onClick={() => setQuoteUnit('exalted')}>{l('Exalted', '崇高石', '崇高石', '엑잘티드')}</button>
        <button className={quoteUnit === 'divine' ? 'active' : ''} disabled={!snapshot?.divineInExalted} onClick={() => setQuoteUnit('divine')}>{l('Divine', '神圣石', '神聖石', '디바인')}</button>
      </div>
      <div className={`currency-market-realm ${realm}`}>{realmLabel}</div>
      <div className="currency-market-source"><strong>{snapshot?.sourceLabel || (realm === 'cn' ? 'poecurrency.top' : 'poe2scout.com')}</strong>{snapshot?.sourceLeague && <small>{snapshot.sourceLeague}</small>}</div>
      <div className={`currency-market-freshness ${state?.cacheStatus || ''}`}><span>{refreshing ? l('Refreshing', '正在刷新', '正在重新整理', '새로 고치는 중') : state?.cacheStatus === 'stale' ? l('Stale cache', '缓存已过期', '快取已過期', '오래된 캐시') : state ? l('Cached', '已缓存', '已快取', '캐시됨') : l('Waiting', '等待数据', '等待資料', '대기 중')}</span><small>{updatedAt ? formatDate(updatedAt, lang) : '--'}</small></div>
      <button className="currency-market-refresh" onClick={() => void refresh()} disabled={refreshing} title={l('Refresh currency market', '刷新通货行情', '重新整理通貨行情', '화폐 시세 새로 고침')} aria-label={l('Refresh currency market', '刷新通货行情', '重新整理通貨行情', '화폐 시세 새로 고침')}><RefreshCw className={refreshing ? 'spinning' : ''} /></button>
    </header>
    {error && <div className="currency-market-error"><AlertTriangle /><span>{error}</span><button onClick={() => void refresh()}>{l('Retry', '重试', '重試', '다시 시도')}</button></div>}
    <div className="currency-market-layout">
      <div className="currency-market-table-wrap">
        <table className="currency-market-table">
          <thead><tr>
            <SortableHeader label={l('Currency', '通货', '通貨', '화폐')} column="name" current={sortKey} direction={sortDirection} onChange={changeSort} />
            <SortableHeader label={l('Category', '分类', '分類', '분류')} column="category" current={sortKey} direction={sortDirection} onChange={changeSort} />
            <SortableHeader label={l('Current price', '当前价格', '目前價格', '현재 가격')} column="price" current={sortKey} direction={sortDirection} onChange={changeSort} />
            <th>{quoteUnit === 'exalted' ? l('In divine', '神圣石折算', '神聖石換算', '디바인 환산') : l('In exalted', '崇高石折算', '崇高石換算', '엑잘티드 환산')}</th>
            <SortableHeader label={l('Status', '状态', '狀態', '상태')} column="quality" current={sortKey} direction={sortDirection} onChange={changeSort} />
            <SortableHeader label={l('Updated', '更新时间', '更新時間', '업데이트')} column="updated" current={sortKey} direction={sortDirection} onChange={changeSort} />
          </tr></thead>
          <tbody>
            {loading && !state && Array.from({ length: 9 }, (_, index) => <tr className="currency-market-skeleton" key={index}><td colSpan={6}><i /></td></tr>)}
            {!loading && !state && <tr><td colSpan={6}><EmptyState language={lang} error /></td></tr>}
            {state && !items.length && <tr><td colSpan={6}><EmptyState language={lang} /></td></tr>}
            {items.map((item) => <tr key={item.id} className={selected?.id === item.id ? 'selected' : ''} tabIndex={selected?.id === item.id ? 0 : -1} onClick={() => setSelectedId(item.id)} onKeyDown={(event) => { if (event.key === 'ArrowDown') { event.preventDefault(); moveSelection(1) } else if (event.key === 'ArrowUp') { event.preventDefault(); moveSelection(-1) } }}>
              <td><div className="currency-market-name"><CurrencyIcon item={item} /><span><strong>{item.name}</strong>{item.englishName && item.englishName !== item.name && <small>{item.englishName}</small>}</span></div></td>
              <td className="currency-market-category">{item.categoryLabel}</td>
              <td className="currency-market-price">{formatPrice(quoteUnit === 'divine' ? item.priceDivine : item.priceExalted, lang)} <small>{quoteUnit === 'divine' ? 'D' : 'E'}</small></td>
              <td className="currency-market-conversion">{formatPrice(quoteUnit === 'exalted' ? item.priceDivine : item.priceExalted, lang)} <small>{quoteUnit === 'exalted' ? 'D' : 'E'}</small></td>
              <td><Quality item={item} language={lang} /></td>
              <td className="currency-market-updated">{formatTime(item.updatedAt || snapshot?.fetchedAt, lang)}</td>
            </tr>)}
          </tbody>
        </table>
      </div>
      <CurrencyMarketDetails item={selected} snapshot={snapshot} quoteUnit={quoteUnit} language={lang} />
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

function Quality({ item, language }: { item: CurrencyMarketItem; language: Language }) {
  const label = item.quality === 'good' ? uiText(language, 'Normal', '正常', '正常', '정상') : item.quality === 'thin' ? uiText(language, 'Thin', '样本偏少', '樣本偏少', '표본 부족') : item.quality === 'anomalous' ? uiText(language, 'Anomalous', '异常', '異常', '이상') : uiText(language, 'No price', '暂无价格', '暫無價格', '가격 없음')
  return <span className={`currency-quality ${item.quality}`} title={item.qualityReason}>{label}</span>
}

function CurrencyMarketDetails({ item, snapshot, quoteUnit, language }: { item?: CurrencyMarketItem; snapshot?: CurrencyMarketState['snapshot']; quoteUnit: CurrencyQuoteUnit; language: Language }) {
  const l = (en: string, zhCN: string, zhTW: string, koKR: string) => uiText(language, en, zhCN, zhTW, koKR)
  if (!item) return <aside className="currency-market-details empty"><Coins /><span>{l('Select a currency for details', '选择一项通货查看行情明细', '選擇一項通貨查看行情明細', '화폐를 선택하여 시세 상세 정보 보기')}</span></aside>
  const details = item.sourceDetails
  const primary = quoteUnit === 'divine' ? item.priceDivine : item.priceExalted
  const secondary = quoteUnit === 'divine' ? item.priceExalted : item.priceDivine
  const rawUnit = item.originalQuote?.unit.toUpperCase() || ''
  return <aside className="currency-market-details">
    <header><CurrencyIcon item={item} /><span><strong>{item.name}</strong><small>{item.englishName && item.englishName !== item.name ? `${item.englishName} · ` : ''}{item.categoryLabel}</small></span></header>
    <section className="currency-detail-price"><strong>{formatPrice(primary, language)} <small>{quoteUnit === 'divine' ? 'D' : 'E'}</small></strong><span>{l('Converted', '折算', '換算', '환산')} {formatPrice(secondary, language)} {quoteUnit === 'divine' ? 'E' : 'D'}</span><Quality item={item} language={language} /></section>
    {details.kind === 'poecurrency' ? <>
      <DetailGroup title={l('Current market', '当前市场', '目前市場', '현재 시장')} rows={[
        [l('Latest buy', '最新买入', '最新買入', '최근 매수'), formatRaw(details.latestBuy, rawUnit, language)],
        [l('Latest sell', '最新卖出', '最新賣出', '최근 매도'), formatRaw(details.latestSell, rawUnit, language)],
        [l('Average buy', '买入均价', '買入均價', '평균 매수'), formatRaw(details.averageBuy, rawUnit, language)],
        [l('Average sell', '卖出均价', '賣出均價', '평균 매도'), formatRaw(details.averageSell, rawUnit, language)],
      ]} />
      <DetailGroup title={l('Period averages', '时段参考', '時段參考', '기간 평균')} rows={[
        [l('12h buy', '12 小时买入', '12 小時買入', '12시간 매수'), formatRaw(details.average12hBuy, rawUnit, language)],
        [l('12h sell', '12 小时卖出', '12 小時賣出', '12시간 매도'), formatRaw(details.average12hSell, rawUnit, language)],
        [l('24h buy', '24 小时买入', '24 小時買入', '24시간 매수'), formatRaw(details.average24hBuy, rawUnit, language)],
        [l('24h sell', '24 小时卖出', '24 小時賣出', '24시간 매도'), formatRaw(details.average24hSell, rawUnit, language)],
      ]} />
      <DetailGroup title={l('Change', '变化', '變化', '변동')} rows={[
        [l('Buy change', '买入涨跌', '買入漲跌', '매수 변동'), formatPercent(details.buyChangePercent, language)],
        [l('Sell change', '卖出涨跌', '賣出漲跌', '매도 변동'), formatPercent(details.sellChangePercent, language)],
        [l('Previous buy', '前次买入', '前次買入', '이전 매수'), formatRaw(details.previousBuy, rawUnit, language)],
      ]} />
    </> : <>
      <DetailGroup title={l('Market activity', '市场活跃度', '市場活躍度', '시장 활동')} rows={[
        [l('Selected pair', '采用报价对', '採用報價對', '선택된 거래쌍'), details.pairLabel],
        [l('Value traded', '成交价值', '成交價值', '거래 가치'), formatNumber(details.valueTraded, language)],
        [l('Volume traded', '成交数量', '成交數量', '거래량'), formatNumber(details.volumeTraded, language)],
        [l('Stock value', '当前库存', '目前庫存', '현재 재고'), formatNumber(details.stockValue, language)],
        [l('Highest stock', '最高库存', '最高庫存', '최고 재고'), formatNumber(details.highestStock, language)],
      ]} />
    </>}
    <DetailGroup title={l('Source', '数据来源', '資料來源', '데이터 출처')} rows={[
      [l('Source', '来源', '來源', '출처'), snapshot?.sourceLabel || '--'],
      [l('League', '赛季', '賽季', '리그'), snapshot?.sourceLeague || l('Current CN market', '国服当前行情', '中國服目前行情', '현재 중국 시장')],
      [l('Original quote', '原始报价', '原始報價', '원본 시세'), item.originalQuote?.label || '--'],
      [l('Data time', '数据时间', '資料時間', '데이터 시간'), formatDate(item.updatedAt || snapshot?.sourceUpdatedAt || snapshot?.fetchedAt, language)],
      [l('Divine rate', '神圣石汇率', '神聖石匯率', '디바인 환율'), snapshot?.divineInExalted ? `${formatPrice(snapshot.divineInExalted, language)} E` : '--'],
    ]} />
    {item.qualityReason && <div className="currency-detail-warning"><AlertTriangle />{item.qualityReason}</div>}
  </aside>
}

function DetailGroup({ title, rows }: { title: string; rows: Array<[string, string]> }) {
  return <section className="currency-detail-group"><h3>{title}</h3>{rows.map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</section>
}

function EmptyState({ language, error = false }: { language: Language; error?: boolean }) {
  return <div className="currency-market-empty"><Coins /><strong>{error ? uiText(language, 'Currency market unavailable', '暂时无法读取通货行情', '暫時無法讀取通貨行情', '화폐 시세를 사용할 수 없습니다') : uiText(language, 'No matching currencies', '没有匹配的通货', '沒有符合的通貨', '일치하는 화폐가 없습니다')}</strong><small>{error ? uiText(language, 'Check the network and retry', '检查网络后重试，已有缓存不会被清除', '檢查網路後重試，現有快取不會被清除', '네트워크를 확인하고 다시 시도하세요') : uiText(language, 'Change the search or category', '调整搜索名称或分类', '調整搜尋名稱或分類', '검색어나 분류를 변경하세요')}</small></div>
}

function formatPrice(value: number | undefined, language: Language): string {
  if (value == null || !Number.isFinite(value) || value <= 0) return '--'
  if (value < 0.01) return formatUiNumber(value, language, { maximumSignificantDigits: 4 })
  if (value < 10) return formatUiNumber(value, language, { maximumFractionDigits: 2 })
  return formatUiNumber(value, language, { maximumFractionDigits: 1 })
}
function formatRaw(value: number | undefined, unit: string, language: Language): string { return value == null ? '--' : `${formatPrice(value, language)} ${unit}`.trim() }
function formatNumber(value: number | undefined, language: Language): string { return value == null ? '--' : formatUiNumber(value, language, { maximumFractionDigits: 2 }) }
function formatPercent(value: number | undefined, language: Language): string { return value == null ? '--' : `${value > 0 ? '+' : ''}${formatUiNumber(value, language, { maximumFractionDigits: 2 })}%` }
function parseDate(value?: string): Date | undefined { if (!value) return undefined; const date = new Date(value.includes('T') ? value : value.replace(' ', 'T')); return Number.isNaN(date.getTime()) ? undefined : date }
function formatDate(value: string | undefined, language: Language): string { const date = parseDate(value); return date ? formatUiDate(date, language, { dateStyle: 'short', timeStyle: 'short' }) : '--' }
function formatTime(value: string | undefined, language: Language): string { const date = parseDate(value); return date ? formatUiDate(date, language, { hour: '2-digit', minute: '2-digit' }) : '--' }
