import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronLeft, ChevronRight, ExternalLink, Home, List, Search, ShieldCheck, Store, X } from 'lucide-react'
import type { PriceCheckContextState, TradeListedStatus, TradePriceCheckCriteria, TradePriceCheckDraft } from '@/types/market'
import { uiText } from '@/i18n/uiLocale'
import { loadTranslations, normalizeDisplayTags, translateGameText } from '@/i18n/translationLoader'
import { loadAppSettings } from '@/engine/appSettings'
import './priceCheck.css'

interface ModifierInput { selected: boolean; min: string; max: string }

function modifierSourceLabel(
  modifier: TradePriceCheckDraft['modifiers'][number],
  l: (en: string, zhCN: string, zhTW: string, koKR: string) => string,
): string {
  const tags = new Set(modifier.sourceTags || [])
  if (tags.has('rune') || modifier.group === 'rune') return l('Socketed', '镶嵌', '鑲嵌', '장착')
  if (tags.has('enchant') || modifier.group === 'enchant') return l('Enchant', '附魔', '附魔', '인챈트')
  if (tags.has('implicit') || modifier.group === 'implicit') return l('Base', '基底', '基底', '기본')
  if (tags.has('crafted')) return l('Crafted', '打造', '製作', '제작')
  if (tags.has('fractured')) return l('Fractured', '分裂', '分裂', '분열')
  if (tags.has('desecrated')) return l('Desecrated', '亵渎', '褻瀆', '모독')
  if (tags.has('mutated')) return l('Mutated', '变异', '變異', '변이')
  if (tags.has('corrupted')) return l('Corrupted', '腐化', '腐化', '타락')
  if (modifier.affixKind === 'prefix') return l('Prefix', '前缀', '前綴', '접두어')
  if (modifier.affixKind === 'suffix') return l('Suffix', '后缀', '後綴', '접미어')
  return l('Modifier', '外延', '外延', '속성')
}

function numeric(value: string): number | undefined {
  const parsed = Number(value)
  return value.trim() && Number.isFinite(parsed) ? parsed : undefined
}

export function PriceCheckApp() {
  const bridge = window.superpoePriceCheck
  const [state, setState] = useState<PriceCheckContextState | null>(null)
  const [leagueId, setLeagueId] = useState('')
  const [listedStatus, setListedStatus] = useState<TradeListedStatus>('securable')
  const [useBaseType, setUseBaseType] = useState(false)
  const [itemLevelMin, setItemLevelMin] = useState('')
  const [itemLevelMax, setItemLevelMax] = useState('')
  const [modifiers, setModifiers] = useState<Record<string, ModifierInput>>({})
  const [filtersOpen, setFiltersOpen] = useState(true)
  const [selectedListingId, setSelectedListingId] = useState<string | null>(null)
  const [hideoutBusyId, setHideoutBusyId] = useState<string | null>(null)
  const [listingActionError, setListingActionError] = useState<string | null>(null)
  const [searchActionError, setSearchActionError] = useState<string | null>(null)
  const [uiScalePercent, setUiScalePercent] = useState(() => loadAppSettings().uiScalePercent)
  const [translationRevision, setTranslationRevision] = useState(0)
  const language = state?.language || 'en'
  const l = (en: string, zhCN: string, zhTW: string, koKR: string) => uiText(language, en, zhCN, zhTW, koKR)
  // The coordinator keeps one generation for the whole price-check session. Its
  // state snapshots are cloned between IPC updates, so object/content identity
  // must not be used to reinitialise the user's filters after a search.
  const draftKey = state?.draft ? String(state.generation) : ''

  useEffect(() => {
    if (!bridge?.getState || !bridge.onState) return
    void bridge.getState().then(setState)
    return bridge.onState(setState)
  }, [bridge])

  useEffect(() => {
    const syncScale = () => setUiScalePercent(loadAppSettings().uiScalePercent)
    window.addEventListener('storage', syncScale)
    return () => window.removeEventListener('storage', syncScale)
  }, [])

  // Price check is rendered in its own window, so it does not inherit the
  // translation loading performed by the main application shell.
  useEffect(() => {
    let active = true
    void loadTranslations(language).catch(() => undefined).finally(() => {
      if (active) setTranslationRevision((value) => value + 1)
    })
    return () => { active = false }
  }, [language])

  useEffect(() => {
    const factor = uiScalePercent / 100
    if (bridge?.setUiScale) {
      document.documentElement.style.removeProperty('zoom')
      void bridge.setUiScale(factor).catch(() => {
        document.documentElement.style.setProperty('zoom', String(factor))
        window.dispatchEvent(new Event('resize'))
      })
      return
    }
    document.documentElement.style.setProperty('zoom', String(factor))
    window.dispatchEvent(new Event('resize'))
  }, [bridge, uiScalePercent])

  useEffect(() => {
    if (!state?.draft) return
    setLeagueId(state.leagues.some((league) => league.id === state.initialLeagueId) ? state.initialLeagueId! : state.leagues[0]?.id || '')
    setListedStatus('securable')
    setUseBaseType(state.draft.unique)
    setModifiers(Object.fromEntries(state.draft.modifiers.map((modifier) => [modifier.id, {
      selected: modifier.searchable && modifier.group !== 'rune',
      min: modifier.currentValue == null ? '' : String(modifier.currentValue), max: '',
    }])))
    setFiltersOpen(true)
  }, [draftKey, state?.initialLeagueId, state?.realm])

  useEffect(() => {
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') void bridge?.hide?.() }
    addEventListener('keydown', key)
    return () => removeEventListener('keydown', key)
  }, [bridge])

  useEffect(() => {
    if (selectedListingId && !state?.listings.some((listing) => listing.id === selectedListingId)) {
      setSelectedListingId(null)
    }
  }, [selectedListingId, state?.listings])

  const selectedCount = useMemo(() => Object.values(modifiers).filter((value) => value.selected).length, [modifiers])
  const busy = state?.phase === 'parsing' || state?.phase === 'searching' || state?.phase === 'fetching-page'
  const captureError = Boolean(state?.error && /did not copy an item|running as administrator/i.test(state.error))
  const [elevating, setElevating] = useState(false)
  const [elevationMessage, setElevationMessage] = useState<string | null>(null)

  const localizedDraft = useMemo(() => {
    const draft = state?.draft
    if (!draft) return undefined
    const name = language === 'zh-rCN' ? (draft.localizedName || translateGameText(draft.name, language)) : translateGameText(draft.name, language)
    const baseType = language === 'zh-rCN' ? (draft.localizedBaseType || translateGameText(draft.baseType, language)) : translateGameText(draft.baseType, language)
    return { name, baseType }
  }, [language, state?.draft, translationRevision])

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

  const runSearch = async (): Promise<PriceCheckContextState | undefined> => {
    if (!bridge?.search || !state?.draft || !leagueId) return undefined
    setSearchActionError(null)
    const criteria: TradePriceCheckCriteria = {
      listedStatus, useBaseType: state.draft.unique || useBaseType,
      itemLevelMin: numeric(itemLevelMin), itemLevelMax: numeric(itemLevelMax),
      modifiers: state.draft.modifiers.flatMap((modifier) => {
        const input = modifiers[modifier.id]
        return modifier.searchable && input?.selected ? [{ id: modifier.id, min: numeric(input.min), max: numeric(input.max) }] : []
      }),
    }
    try {
      return await bridge.search(leagueId, criteria)
    } catch (error) {
      setSearchActionError(error instanceof Error ? error.message : String(error))
      return undefined
    }
  }

  const searchInTradeCenter = async () => {
    const nextState = await runSearch()
    const url = nextState?.search?.url
    if (!url || !bridge?.openInTradeCenter) return
    try {
      await bridge.openInTradeCenter(url)
    } catch (error) {
      setSearchActionError(error instanceof Error ? error.message : String(error))
    }
  }

  const restartAsAdministrator = async () => {
    if (!bridge?.restartAsAdministrator) return
    setElevating(true)
    setElevationMessage(null)
    try {
      const result = await bridge.restartAsAdministrator()
      if (result.status === 'started') setElevationMessage(l('Restarting with administrator permissions...', '正在以管理员权限重启...', '正在以管理員權限重新啟動...', '관리자 권한으로 다시 시작하는 중...'))
      else if (result.status === 'already-elevated') setElevationMessage(l('Already running as administrator.', '当前已是管理员权限。', '目前已是管理員權限。', '이미 관리자 권한으로 실행 중입니다.'))
      else if (result.status === 'unsupported') setElevationMessage(l('Administrator restart is only available on Windows.', '管理员重启仅支持 Windows。', '管理員重新啟動僅支援 Windows。', '관리자 재시작은 Windows에서만 사용할 수 있습니다.'))
      else setElevationMessage(l('UAC request cancelled.', '已取消 UAC 提权。', '已取消 UAC 提權。', 'UAC 요청이 취소되었습니다.'))
    } catch {
      setElevationMessage(l('Unable to restart as administrator.', '无法以管理员权限重启。', '無法以管理員權限重新啟動。', '관리자 권한으로 다시 시작할 수 없습니다.'))
    } finally {
      setElevating(false)
    }
  }

  return <main className="pc-shell">
    <header className="pc-titlebar">
      <div className="pc-title"><strong>{localizedDraft?.name || l('Price checker', '装备查价', '裝備查價', '아이템 가격 확인')}</strong><span>{localizedDraft?.baseType || l('Waiting for an item', '等待装备', '等待裝備', '아이템 대기 중')}</span></div>
      <div className="pc-escape-hint"><kbd>ESC</kbd><span>{l('Return to game', '返回游戏', '返回遊戲', '게임으로 돌아가기')}</span></div>
      <div className="pc-window-actions"><span>{state?.realm === 'cn' ? l('CN', '国服', '國服', '중국') : l('Global', '国际服', '國際服', '글로벌')}</span><button className="pc-cancel-button" title={l('Cancel price check', '取消查价', '取消查價', '가격 확인 취소')} onClick={() => void bridge?.hide?.()}><X /><span>{l('Cancel', '取消', '取消', '취소')}</span></button></div>
    </header>
    {!state || state.phase === 'idle' ? <div className="pc-empty">{l('Select Price check from an item.', '请从装备上选择“查价”。', '請從裝備上選擇「查價」。', '아이템에서 가격 확인을 선택하세요.')}</div> : null}
    {state?.draft && <>
      <section className="pc-controls">
        <label><span>{l('League', '赛季', '賽季', '리그')}</span><select value={leagueId} onChange={(event) => setLeagueId(event.target.value)}>{state.leagues.map((league) => <option key={league.id} value={league.id}>{translateGameText(league.text, language)}</option>)}</select></label>
        <label><span>{l('Listed', '上架', '上架', '등록')}</span><select value={listedStatus} onChange={(event) => setListedStatus(event.target.value as TradeListedStatus)} aria-label={l('Listed status', '上架状态', '上架狀態', '등록 상태')}><option value="securable">{l('Instant', '一口价', '直購', '즉시 구매')}</option></select></label>
      </section>
      <button className="pc-filter-summary" onClick={() => setFiltersOpen((value) => !value)}><span>{l(`${selectedCount} modifiers selected`, `已选 ${selectedCount} 条词缀`, `已選 ${selectedCount} 條詞綴`, `${selectedCount}개 속성 선택`)}</span><ChevronDown className={filtersOpen ? 'open' : ''} /></button>
      {filtersOpen && <section className="pc-filters">
        {!state.draft.unique && <div className="pc-properties"><label><input type="checkbox" checked={useBaseType} onChange={(event) => setUseBaseType(event.target.checked)} />{l('Match base type', '匹配底材', '匹配基底', '베이스 유형 일치')}</label><div><input placeholder={l('Min ilvl', '最低物等', '最低物等', '최소 레벨')} value={itemLevelMin} onChange={(event) => setItemLevelMin(event.target.value)} /><input placeholder={l('Max ilvl', '最高物等', '最高物等', '최대 레벨')} value={itemLevelMax} onChange={(event) => setItemLevelMax(event.target.value)} /></div></div>}
        <div className="pc-modifiers">{state.draft.modifiers.map((modifier) => {
          const input = modifiers[modifier.id] || { selected: false, min: '', max: '' }
          const lines = language === 'zh-rCN' && modifier.localizedLines?.length
            ? modifier.localizedLines.map(normalizeDisplayTags)
            : modifier.lines.map((line) => normalizeDisplayTags(translateGameText(line, language)))
          const sourceLabel = modifierSourceLabel(modifier, l)
          return <div className={`pc-modifier${modifier.searchable ? '' : ' unavailable'}`} key={modifier.id}><label><input type="checkbox" disabled={!modifier.searchable} checked={input.selected} onChange={(event) => setModifiers((current) => ({ ...current, [modifier.id]: { ...input, selected: event.target.checked } }))} /><span className="pc-modifier-copy"><em className={`pc-modifier-source source-${modifier.group}`}>{sourceLabel}</em><span>{lines.join(' / ')}</span></span></label>{modifier.searchable && modifier.valueMode === 'numeric' ? <div className="pc-range-fields"><label className="pc-range-field"><input placeholder={l('Min', '最小', '最小', '최소')} aria-label={l('Minimum value', '最小值', '最小值', '최솟값')} value={input.min} onChange={(event) => setModifiers((current) => ({ ...current, [modifier.id]: { ...input, min: event.target.value } }))} /></label><label className="pc-range-field"><input placeholder={l('Max', '最大', '最大', '최대')} aria-label={l('Maximum value', '最大值', '最大值', '최댓값')} value={input.max} onChange={(event) => setModifiers((current) => ({ ...current, [modifier.id]: { ...input, max: event.target.value } }))} /></label></div> : !modifier.searchable ? <small>{l('No match', '无法匹配', '無法匹配', '일치 없음')}</small> : null}</div>
        })}</div>
      </section>}
      {searchActionError && <div className="pc-error pc-listing-error">{searchActionError}</div>}
      {state.captureWarnings?.length ? <div className="pc-warning pc-listing-error">
        <strong>{l('Some item lines were not included', '部分词缀未纳入查询', '部分詞綴未納入查詢', '일부 속성이 검색에 포함되지 않음')}</strong>
        <span>{state.captureWarnings.join(' | ')}</span>
      </div> : null}
      <section className="pc-searchbar"><button disabled={busy || !leagueId} onClick={() => void runSearch()}><Search />{busy ? l('Working...', '处理中...', '處理中...', '처리 중...') : l('Price Check', '查价', '查價', '가격 확인')}</button><button className="secondary market-search-button" disabled={busy || !leagueId} onClick={() => void searchInTradeCenter()}><Store />{l('Search Market', '搜索集市', '搜尋市集', '거래소 검색')}</button>{state.search && <button className="secondary" onClick={() => void bridge?.openTradePage?.(state.search!.url)}><ExternalLink />{l('Official page', '官网结果', '官網結果', '공식 페이지')}</button>}</section>
    </>}
    {state?.error && <div className={`pc-error${captureError ? ' pc-guided-error' : ''}`}>
      {captureError ? <>
        <strong>{/running as administrator/i.test(state.error) ? l('Permission mismatch', '权限不匹配', '權限不相符', '권한 불일치') : l('Item capture failed', '装备复制失败', '裝備複製失敗', '아이템 복사 실패')}</strong>
        <p>{/running as administrator/i.test(state.error)
          ? l('Path of Exile 2 is running as administrator. Restart SuperPoE with the same permission, then try again.', 'Path of Exile 2 正以管理员权限运行，请先让 SuperPoE 以相同权限重启，再重试。', 'Path of Exile 2 正以管理員權限執行，請先讓 SuperPoE 以相同權限重新啟動，再重試。', 'Path of Exile 2가 관리자 권한으로 실행 중입니다. SuperPoE를 같은 권한으로 다시 시작한 뒤 다시 시도하세요.')
          : l('Keep Path of Exile 2 focused, hover an item, and press the price-check hotkey again. If the game runs as administrator, restart SuperPoE with matching permissions.', '请保持 Path of Exile 2 在前台，将鼠标悬停在装备上并再次按查价热键。如果游戏以管理员权限运行，请让 SuperPoE 以相同权限重启。', '請保持 Path of Exile 2 在前景，將滑鼠停在裝備上並再次按查價熱鍵。如果遊戲以管理員權限執行，請讓 SuperPoE 以相同權限重新啟動。', 'Path of Exile 2를 전면에 두고 아이템 위에 마우스를 올린 뒤 가격 확인 단축키를 다시 누르세요. 게임이 관리자 권한으로 실행 중이면 SuperPoE도 같은 권한으로 다시 시작하세요.')}</p>
        <div className="pc-error-actions"><button type="button" onClick={() => void restartAsAdministrator()} disabled={elevating || !bridge?.restartAsAdministrator}><ShieldCheck />{elevating ? l('Restarting...', '重启中...', '重新啟動中...', '다시 시작 중...') : l('Restart as administrator', '以管理员身份重启', '以管理員身份重新啟動', '관리자 권한으로 다시 시작')}</button>{elevationMessage && <small>{elevationMessage}</small>}</div>
      </> : state.error}
    </div>}
    {state?.search && <section className="pc-results">
      <div className="pc-result-list">
        <header><strong>{l('Listings', '价格列表', '價格列表', '가격 목록')}</strong><span>{state.search.total} {l('results', '条结果', '筆結果', '개 결과')}</span></header>
        {listingActionError && <div className="pc-error pc-listing-error">{listingActionError}</div>}
        {state.listings.length ? state.listings.map((listing) => {
          const selected = selectedListingId === listing.id
          return <article className={selected ? 'selected' : ''} key={listing.id}>
            <div className="pc-listing-main">
              <b>{listing.price?.display || l('No price', '未标价', '未標價', '가격 없음')}</b>
              <span>{listedTime(listing.listedAt)}</span>
              <span className={`seller-status ${listing.seller.status}`}>{listing.seller.status}</span>
              <span className="seller-name">{listing.seller.accountName || l('Unknown seller', '未知卖家', '未知賣家', '알 수 없는 판매자')}</span>
              <div className="pc-listing-actions">
                <button disabled={!listing.hideoutAvailable || hideoutBusyId === listing.id} title={listing.hideoutAvailable ? l('Visit hideout', '前往藏身处', '前往藏身處', '은신처 방문') : l('Hideout travel unavailable', '该商品不支持前往藏身处', '此商品不支援前往藏身處', '은신처 방문을 사용할 수 없음')} onClick={() => void visitHideout(listing.id)}><Home /><span>{l('Hideout', '藏身处', '藏身處', '은신처')}</span></button>
                <button className={selected ? 'active' : ''} onClick={() => { setSelectedListingId(listing.id); void bridge?.showDetail?.(listing.id) }}><List /><span>{l('Details', '详细', '詳細', '상세')}</span></button>
              </div>
            </div>
          </article>
        }) : <div className="pc-empty compact">{l('No listings on this page.', '本页没有可显示的商品。', '本頁沒有可顯示的商品。', '이 페이지에 매물이 없습니다.')}</div>}
        <footer><button disabled={state.search.page <= 1 || busy} onClick={() => void bridge?.fetchPage?.(state.search!.page - 1)}><ChevronLeft /></button><span>{state.search.page} / {state.search.pageCount}</span><button disabled={state.search.page >= state.search.pageCount || busy} onClick={() => void bridge?.fetchPage?.(state.search!.page + 1)}><ChevronRight /></button></footer>
      </div>
    </section>}
  </main>
}
