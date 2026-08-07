import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronLeft, ChevronRight, ExternalLink, Home, List, Search, X } from 'lucide-react'
import type { PriceCheckContextState, TradeListedStatus, TradePriceCheckCriteria } from '@/types/market'
import { uiText } from '@/i18n/uiLocale'
import { EquipmentItemInspector } from '@/components/equipment/EquipmentItemInspector'
import './priceCheck.css'

interface ModifierInput { selected: boolean; min: string; max: string }

function numeric(value: string): number | undefined {
  const parsed = Number(value)
  return value.trim() && Number.isFinite(parsed) ? parsed : undefined
}

export function PriceCheckApp() {
  const bridge = window.superpoePriceCheck
  const [state, setState] = useState<PriceCheckContextState | null>(null)
  const [leagueId, setLeagueId] = useState('')
  const [listedStatus, setListedStatus] = useState<TradeListedStatus>('available')
  const [useBaseType, setUseBaseType] = useState(false)
  const [itemLevelMin, setItemLevelMin] = useState('')
  const [itemLevelMax, setItemLevelMax] = useState('')
  const [modifiers, setModifiers] = useState<Record<string, ModifierInput>>({})
  const [filtersOpen, setFiltersOpen] = useState(true)
  const [expandedListingId, setExpandedListingId] = useState<string | null>(null)
  const [hideoutBusyId, setHideoutBusyId] = useState<string | null>(null)
  const [listingActionError, setListingActionError] = useState<string | null>(null)
  const language = state?.language || 'en'
  const l = (en: string, zhCN: string, zhTW: string, koKR: string) => uiText(language, en, zhCN, zhTW, koKR)

  useEffect(() => {
    if (!bridge?.getState || !bridge.onState) return
    void bridge.getState().then(setState)
    return bridge.onState(setState)
  }, [bridge])

  useEffect(() => {
    if (!state?.draft) return
    setLeagueId(state.leagues.some((league) => league.id === state.initialLeagueId) ? state.initialLeagueId! : state.leagues[0]?.id || '')
    setListedStatus(state.realm === 'cn' ? 'securable' : 'available')
    setUseBaseType(state.draft.unique)
    setModifiers(Object.fromEntries(state.draft.modifiers.map((modifier) => [modifier.id, {
      selected: modifier.searchable && modifier.group !== 'rune',
      min: modifier.currentValue == null ? '' : String(modifier.currentValue), max: '',
    }])))
    setFiltersOpen(true)
  }, [state?.generation, state?.draft, state?.initialLeagueId, state?.leagues, state?.realm])

  useEffect(() => {
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') void bridge?.hide?.() }
    addEventListener('keydown', key)
    return () => removeEventListener('keydown', key)
  }, [bridge])

  const selectedCount = useMemo(() => Object.values(modifiers).filter((value) => value.selected).length, [modifiers])
  const busy = state?.phase === 'parsing' || state?.phase === 'searching' || state?.phase === 'fetching-page'

  const listedTime = (value?: string) => {
    if (!value) return l('Unknown time', '时间未知', '時間未知', '시간 알 수 없음')
    const elapsed = Date.now() - Date.parse(value)
    if (!Number.isFinite(elapsed)) return value
    const minutes = Math.max(0, Math.floor(elapsed / 60_000))
    if (minutes < 1) return l('Just now', '刚刚', '剛剛', '방금')
    if (minutes < 60) return l(`${minutes}m ago`, `${minutes} 分钟前`, `${minutes} 分鐘前`, `${minutes}분 전`)
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return l(`${hours}h ago`, `${hours} 小时前`, `${hours} 小時前`, `${hours}시간 전`)
    const days = Math.floor(hours / 24)
    return l(`${days}d ago`, `${days} 天前`, `${days} 天前`, `${days}일 전`)
  }

  const visitHideout = async (listingId: string) => {
    if (!bridge?.visitHideout) return
    setHideoutBusyId(listingId)
    setListingActionError(null)
    try {
      const result = await bridge.visitHideout(listingId)
      if (!result.ok) setListingActionError(l('The game is offline.', '游戏未运行。', '遊戲未執行。', '게임이 실행 중이 아닙니다.'))
    } catch (error) {
      setListingActionError(error instanceof Error ? error.message : String(error))
    } finally { setHideoutBusyId(null) }
  }

  const runSearch = async () => {
    if (!bridge?.search || !state?.draft || !leagueId) return
    const criteria: TradePriceCheckCriteria = {
      listedStatus, useBaseType: state.draft.unique || useBaseType,
      itemLevelMin: numeric(itemLevelMin), itemLevelMax: numeric(itemLevelMax),
      modifiers: state.draft.modifiers.flatMap((modifier) => {
        const input = modifiers[modifier.id]
        return modifier.searchable && input?.selected ? [{ id: modifier.id, min: numeric(input.min), max: numeric(input.max) }] : []
      }),
    }
    await bridge.search(leagueId, criteria)
    setFiltersOpen(false)
  }

  return <main className="pc-shell">
    <header className="pc-titlebar">
      <div className="pc-title"><strong>{state?.draft?.name || l('Price checker', '装备查价', '裝備查價', '아이템 가격 확인')}</strong><span>{state?.draft?.baseType || l('Waiting for an item', '等待装备', '等待裝備', '아이템 대기 중')}</span></div>
      <div className="pc-window-actions"><span>{state?.realm === 'cn' ? l('CN', '国服', '國服', '중국') : l('Global', '国际服', '國際服', '글로벌')}</span><button title={l('Close', '关闭', '關閉', '닫기')} onClick={() => void bridge?.hide?.()}><X /></button></div>
    </header>
    {!state || state.phase === 'idle' ? <div className="pc-empty">{l('Select Price check from an item.', '请从装备上选择“查价”。', '請從裝備上選擇「查價」。', '아이템에서 가격 확인을 선택하세요.')}</div> : null}
    {state?.draft && <>
      <section className="pc-controls">
        <label><span>{l('League', '赛季', '賽季', '리그')}</span><select value={leagueId} onChange={(event) => setLeagueId(event.target.value)}>{state.leagues.map((league) => <option key={league.id} value={league.id}>{league.text}</option>)}</select></label>
        <label><span>{l('Listed', '上架', '上架', '등록')}</span><select value={listedStatus} onChange={(event) => setListedStatus(event.target.value as TradeListedStatus)}><option value="securable">{l('Instant', '一口价', '直購', '즉시 구매')}</option><option value="available">{l('Available', '可购买', '可購買', '구매 가능')}</option><option value="online">{l('Online', '在线', '線上', '온라인')}</option><option value="any">{l('Any', '全部', '全部', '전체')}</option></select></label>
      </section>
      <button className="pc-filter-summary" onClick={() => setFiltersOpen((value) => !value)}><span>{l(`${selectedCount} modifiers selected`, `已选 ${selectedCount} 条词缀`, `已選 ${selectedCount} 條詞綴`, `${selectedCount}개 속성 선택`)}</span><ChevronDown className={filtersOpen ? 'open' : ''} /></button>
      {filtersOpen && <section className="pc-filters">
        {!state.draft.unique && <div className="pc-properties"><label><input type="checkbox" checked={useBaseType} onChange={(event) => setUseBaseType(event.target.checked)} />{l('Match base type', '匹配底材', '匹配基底', '베이스 유형 일치')}</label><div><input placeholder={l('Min ilvl', '最低物等', '最低物等', '최소 레벨')} value={itemLevelMin} onChange={(event) => setItemLevelMin(event.target.value)} /><input placeholder={l('Max ilvl', '最高物等', '最高物等', '최대 레벨')} value={itemLevelMax} onChange={(event) => setItemLevelMax(event.target.value)} /></div></div>}
        <div className="pc-modifiers">{state.draft.modifiers.map((modifier) => {
          const input = modifiers[modifier.id] || { selected: false, min: '', max: '' }
          const lines = language === 'zh-rCN' && modifier.localizedLines?.length ? modifier.localizedLines : modifier.lines
          return <div className={`pc-modifier${modifier.searchable ? '' : ' unavailable'}`} key={modifier.id}><label><input type="checkbox" disabled={!modifier.searchable} checked={input.selected} onChange={(event) => setModifiers((current) => ({ ...current, [modifier.id]: { ...input, selected: event.target.checked } }))} /><span>{lines.join(' / ')}</span></label>{modifier.searchable && modifier.valueMode === 'numeric' ? <div><input placeholder="Min" value={input.min} onChange={(event) => setModifiers((current) => ({ ...current, [modifier.id]: { ...input, min: event.target.value } }))} /><input placeholder="Max" value={input.max} onChange={(event) => setModifiers((current) => ({ ...current, [modifier.id]: { ...input, max: event.target.value } }))} /></div> : !modifier.searchable ? <small>{l('No match', '无法匹配', '無法匹配', '일치 없음')}</small> : null}</div>
        })}</div>
      </section>}
      <section className="pc-searchbar"><button disabled={busy || !leagueId} onClick={() => void runSearch()}><Search />{busy ? l('Working...', '处理中...', '處理中...', '처리 중...') : l('Search', '搜索集市', '搜尋市集', '검색')}</button>{state.search && <button className="secondary" onClick={() => void bridge?.openTradePage?.(state.search!.url)}><ExternalLink />{l('Official page', '官网结果', '官網結果', '공식 페이지')}</button>}</section>
    </>}
    {state?.error && <div className="pc-error">{state.error}</div>}
    {state?.search && <section className="pc-results">
      <header><strong>{l('Listings', '价格列表', '價格列表', '가격 목록')}</strong><span>{state.search.total} {l('results', '条结果', '筆結果', '개 결과')}</span></header>
      {listingActionError && <div className="pc-error pc-listing-error">{listingActionError}</div>}
      {state.listings.length ? state.listings.map((listing) => {
        const expanded = expandedListingId === listing.id
        return <article className={expanded ? 'expanded' : ''} key={listing.id}>
          <div className="pc-listing-main">
            <b>{listing.price?.display || l('No price', '未标价', '未標價', '가격 없음')}</b>
            <span>{listedTime(listing.listedAt)}</span>
            <span className={`seller-status ${listing.seller.status}`}>{listing.seller.status}</span>
            <span className="seller-name">{listing.seller.accountName || l('Unknown seller', '未知卖家', '未知賣家', '알 수 없는 판매자')}</span>
            <div className="pc-listing-actions">
              <button disabled={!listing.hideoutAvailable || hideoutBusyId === listing.id} title={listing.hideoutAvailable ? l('Visit hideout', '前往藏身处', '前往藏身處', '은신처 방문') : l('Hideout travel unavailable', '该商品不支持前往藏身处', '此商品不支援前往藏身處', '은신처 방문을 사용할 수 없음')} onClick={() => void visitHideout(listing.id)}><Home /><span>{l('Hideout', '藏身处', '藏身處', '은신처')}</span></button>
              <button className={expanded ? 'active' : ''} onClick={() => setExpandedListingId(expanded ? null : listing.id)}><List /><span>{l('Details', '详细', '詳細', '상세')}</span><ChevronDown /></button>
            </div>
          </div>
          {expanded && <div className="pc-listing-details"><EquipmentItemInspector
            view={listing.item}
            language={language}
            sourceLabels={[l('Market listing', '集市商品', '市集商品', '거래소 매물')]}
            price={listing.price?.display}
          /></div>}
        </article>
      }) : <div className="pc-empty compact">{l('No listings on this page.', '本页没有可显示的商品。', '本頁沒有可顯示的商品。', '이 페이지에 매물이 없습니다.')}</div>}
      <footer><button disabled={state.search.page <= 1 || busy} onClick={() => void bridge?.fetchPage?.(state.search!.page - 1)}><ChevronLeft /></button><span>{state.search.page} / {state.search.pageCount}</span><button disabled={state.search.page >= state.search.pageCount || busy} onClick={() => void bridge?.fetchPage?.(state.search!.page + 1)}><ChevronRight /></button></footer>
    </section>}
  </main>
}
