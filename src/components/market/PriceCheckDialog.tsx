import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { CheckSquare2, Search, Square, X } from 'lucide-react'
import type {
  MarketRealm, TradeLeague, TradeListedStatus, TradePriceCheckDraft,
  TradePriceCheckModifierCriteria, TradePriceCheckTarget, TradeSearchResult,
} from '@/types/market'
import type { Language } from '@/i18n/translationLoader'
import { translateGameText } from '@/i18n/translationLoader'
import { uiText } from '@/i18n/uiLocale'

interface PriceCheckDialogProps {
  realm: MarketRealm
  target: TradePriceCheckTarget
  language: Language
  initialLeagueId?: string
  onClose: () => void
  onSearched?: (result: TradeSearchResult) => void
}

interface ModifierInput {
  selected: boolean
  min: string
  max: string
}

function numeric(value: string): number | undefined {
  if (!value.trim()) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function modifierLabel(group: string, language: Language): string {
  const labels: Record<string, [string, string, string, string]> = {
    enchant: ['Enchant', '附魔', '附魔', '인챈트'], rune: ['Rune', '符文', '符文', '룬'], implicit: ['Implicit', '固有', '固有', '고유'], explicit: ['Explicit', '词缀', '詞綴', '명시'],
  }
  const label = labels[group]
  return label ? uiText(language, ...label) : group
}

export function PriceCheckDialog({ realm, target, language, initialLeagueId, onClose, onSearched }: PriceCheckDialogProps) {
  const l = (en: string, zhCN: string, zhTW: string, koKR: string) => uiText(language, en, zhCN, zhTW, koKR)
  const bridge = window.pob2Market
  const [draft, setDraft] = useState<TradePriceCheckDraft | null>(null)
  const [leagues, setLeagues] = useState<TradeLeague[]>([])
  const [leagueId, setLeagueId] = useState(initialLeagueId || '')
  const [listedStatus, setListedStatus] = useState<TradeListedStatus>(realm === 'cn' ? 'securable' : 'available')
  const [useBaseType, setUseBaseType] = useState(false)
  const [itemLevelMin, setItemLevelMin] = useState('')
  const [itemLevelMax, setItemLevelMax] = useState('')
  const [modifierInputs, setModifierInputs] = useState<Record<string, ModifierInput>>({})
  const [loading, setLoading] = useState(true)
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const targetKey = target.kind === 'library' ? `library:${target.entryId}` : `raw:${target.raw}`

  useEffect(() => {
    let active = true
    if (!bridge) {
      setError(l('Market service is unavailable', '集市服务不可用', '市集服務無法使用', '거래소 서비스를 사용할 수 없습니다'))
      setLoading(false)
      return () => { active = false }
    }
    setLoading(true)
    Promise.all([bridge.preparePriceCheck({ realm, target }), bridge.listLeagues(realm)])
      .then(([nextDraft, nextLeagues]) => {
        if (!active) return
        setDraft(nextDraft)
        setLeagues(nextLeagues)
        setLeagueId((current) => nextLeagues.some((league) => league.id === current) ? current : nextLeagues[0]?.id || '')
        setUseBaseType(nextDraft.unique)
        setModifierInputs(Object.fromEntries(nextDraft.modifiers.map((modifier) => [modifier.id, {
          selected: false,
          min: modifier.currentValue == null ? '' : String(modifier.currentValue),
          max: '',
        }])))
        setError(null)
      })
      .catch((caught: unknown) => active && setError(caught instanceof Error ? caught.message : String(caught)))
      .finally(() => active && setLoading(false))
    return () => { active = false }
  }, [bridge, realm, targetKey, language])

  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape' && !searching) onClose() }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [onClose, searching])

  const searchableCount = useMemo(() => draft?.modifiers.filter((modifier) => modifier.searchable).length || 0, [draft])
  const selectedCount = useMemo(() => Object.values(modifierInputs).filter((input) => input.selected).length, [modifierInputs])

  const updateModifier = (id: string, patch: Partial<ModifierInput>) => {
    setModifierInputs((current) => ({ ...current, [id]: { ...current[id], ...patch } }))
  }

  const selectAll = (selected: boolean) => {
    if (!draft) return
    setModifierInputs((current) => Object.fromEntries(draft.modifiers.map((modifier) => [modifier.id, {
      ...current[modifier.id], selected: modifier.searchable && selected,
    }])))
  }

  const runSearch = async () => {
    if (!bridge || !draft || !leagueId) return
    const modifiers: TradePriceCheckModifierCriteria[] = draft.modifiers.flatMap((modifier) => {
      const input = modifierInputs[modifier.id]
      if (!modifier.searchable || !input?.selected) return []
      const min = numeric(input.min)
      const max = numeric(input.max)
      return [{ id: modifier.id, ...(min == null ? {} : { min }), ...(max == null ? {} : { max }) }]
    })
    setSearching(true)
    setError(null)
    try {
      const result = await bridge.runPriceCheck({
        realm, target, leagueId,
        criteria: {
          listedStatus,
          useBaseType: draft.unique || useBaseType,
          itemLevelMin: numeric(itemLevelMin),
          itemLevelMax: numeric(itemLevelMax),
          modifiers,
        },
      })
      onSearched?.(result)
      window.dispatchEvent(new Event('open-market-panel'))
      onClose()
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setSearching(false)
    }
  }

  return createPortal(<div className="modal-backdrop price-check-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !searching) onClose() }}>
    <section className="price-check-dialog" role="dialog" aria-modal="true" aria-labelledby="price-check-title">
      <header className="dialog-header">
        <div><span>POB2 BUY SIMILAR</span><h2 id="price-check-title">{l('Price check', '装备查价', '裝備查價', '장비 가격 확인')}</h2></div>
        <button onClick={onClose} disabled={searching} title={l('Close', '关闭', '關閉', '닫기')} aria-label={l('Close', '关闭', '關閉', '닫기')}><X /></button>
      </header>
      <div className="price-check-body">
        {loading && <div className="price-check-loading">{l('Resolving item and trade modifiers...', '正在解析装备和集市词条...', '正在解析裝備與市集詞綴...', '아이템 및 거래소 속성을 분석하는 중...')}</div>}
        {!loading && draft && <>
          <div className={`price-check-item rarity-${draft.rarity.toLowerCase()}`}>
            <strong>{language === 'zh-rCN' ? draft.localizedName || draft.name : translateGameText(draft.name, language)}</strong>
            <span>{language === 'zh-rCN' ? draft.localizedBaseType || draft.baseType : translateGameText(draft.baseType, language)}</span>
          </div>
          <div className="price-check-toolbar">
            <label><span>{l('League', '联盟', '聯盟', '리그')}</span><select value={leagueId} onChange={(event) => setLeagueId(event.target.value)}>{leagues.map((league) => <option value={league.id} key={league.id}>{league.text}</option>)}</select></label>
            <label><span>{l('Listed', '上架状态', '上架狀態', '등록 상태')}</span><select value={listedStatus} onChange={(event) => setListedStatus(event.target.value as TradeListedStatus)}>
              <option value="securable">{l('Instant buyout', '一口价', '直購價', '즉시 구매')}</option>
              <option value="available">{l('Instant & in person', '一口价及在线', '直購價及在線', '즉시 구매 및 직접 거래')}</option>
              <option value="online">{l('Online', '在线', '在線', '온라인')}</option>
              <option value="any">{l('Any', '全部', '全部', '전체')}</option>
            </select></label>
          </div>
          {!draft.unique && <div className="price-check-properties">
            <label className="price-check-checkbox"><input type="checkbox" checked={useBaseType} onChange={(event) => setUseBaseType(event.target.checked)} /><span>{l(`Specific base: ${draft.baseType}`, `指定底材：${draft.localizedBaseType || draft.baseType}`, `指定基底：${translateGameText(draft.baseType, language)}`, `특정 베이스: ${translateGameText(draft.baseType, language)}`)}</span></label>
            <label><span>{l('Item level', '物品等级', '物品等級', '아이템 레벨')}</span><span className="price-check-range"><input inputMode="numeric" placeholder={l('Min', '最小', '最小', '최소')} value={itemLevelMin} onChange={(event) => setItemLevelMin(event.target.value)} /><input inputMode="numeric" placeholder={l('Max', '最大', '最大', '최대')} value={itemLevelMax} onChange={(event) => setItemLevelMax(event.target.value)} /></span></label>
          </div>}
          <div className="price-check-modifier-header"><span>{l(`Modifiers ${selectedCount}/${searchableCount}`, `词条 ${selectedCount}/${searchableCount}`, `詞綴 ${selectedCount}/${searchableCount}`, `속성 ${selectedCount}/${searchableCount}`)}</span><div><button onClick={() => selectAll(true)} title={l('Select all searchable modifiers', '全选可搜索词条', '全選可搜尋詞綴', '검색 가능한 모든 속성 선택')}><CheckSquare2 /></button><button onClick={() => selectAll(false)} title={l('Clear modifier selection', '清空词条选择', '清除詞綴選擇', '속성 선택 지우기')}><Square /></button></div></div>
          <div className="price-check-modifiers">
            {draft.modifiers.map((modifier) => {
              const input = modifierInputs[modifier.id] || { selected: false, min: '', max: '' }
              const lines = language === 'zh-rCN' && modifier.localizedLines?.length ? modifier.localizedLines : modifier.lines.map((line) => translateGameText(line, language))
              return <div className={`price-check-modifier${modifier.searchable ? '' : ' unavailable'}`} key={modifier.id}>
                <label className="price-check-checkbox"><input type="checkbox" disabled={!modifier.searchable} checked={input.selected} onChange={(event) => updateModifier(modifier.id, { selected: event.target.checked })} /><span><small>{modifierLabel(modifier.group, language)}</small>{lines.map((line, index) => <em key={`${line}-${index}`}>{line}</em>)}</span></label>
                {modifier.searchable && modifier.valueMode === 'numeric' && <span className="price-check-range"><input inputMode="decimal" aria-label={l('Minimum', '最小值', '最小值', '최솟값')} placeholder={l('Min', '最小', '最小', '최소')} value={input.min} onChange={(event) => updateModifier(modifier.id, { min: event.target.value })} /><input inputMode="decimal" aria-label={l('Maximum', '最大值', '最大值', '최댓값')} placeholder={l('Max', '最大', '最大', '최대')} value={input.max} onChange={(event) => updateModifier(modifier.id, { max: event.target.value })} /></span>}
                {!modifier.searchable && <span className="price-check-unmatched">{l('No trade match', '集市无匹配', '市集無符合項目', '거래소 일치 항목 없음')}</span>}
              </div>
            })}
          </div>
        </>}
        {error && <div className="price-check-error">{error}</div>}
      </div>
      <footer className="dialog-footer"><span>{draft?.unique ? l('Unique name and base are fixed', '唯一装备固定名称与底材', '傳奇裝備固定名稱與基底', '고유 장비의 이름과 베이스는 고정됩니다') : ''}</span><div><button onClick={onClose} disabled={searching}>{l('Cancel', '取消', '取消', '취소')}</button><button className="primary" disabled={loading || searching || !draft || !leagueId} onClick={() => void runSearch()}><Search /><span>{searching ? l('Searching...', '正在搜索...', '正在搜尋...', '검색 중...') : l('Search market', '搜索集市', '搜尋市集', '거래소 검색')}</span></button></div></footer>
    </section>
  </div>, document.body)
}
