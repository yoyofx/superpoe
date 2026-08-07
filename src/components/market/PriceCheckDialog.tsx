import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { CheckSquare2, Search, Square, X } from 'lucide-react'
import type {
  MarketRealm, TradeLeague, TradeListedStatus, TradePriceCheckDraft,
  TradePriceCheckModifierCriteria, TradePriceCheckTarget, TradeSearchResult,
} from '@/types/market'

interface PriceCheckDialogProps {
  realm: MarketRealm
  target: TradePriceCheckTarget
  zh: boolean
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

function modifierLabel(group: string, zh: boolean): string {
  const labels: Record<string, [string, string]> = {
    enchant: ['附魔', 'Enchant'], rune: ['符文', 'Rune'], implicit: ['固有', 'Implicit'], explicit: ['词缀', 'Explicit'],
  }
  return (labels[group] || [group, group])[zh ? 0 : 1]
}

export function PriceCheckDialog({ realm, target, zh, initialLeagueId, onClose, onSearched }: PriceCheckDialogProps) {
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
      setError(zh ? '集市服务不可用' : 'Market service is unavailable')
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
  }, [bridge, realm, targetKey, zh])

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
        <div><span>{zh ? 'POB2 BUY SIMILAR' : 'POB2 BUY SIMILAR'}</span><h2 id="price-check-title">{zh ? '装备查价' : 'Price check'}</h2></div>
        <button onClick={onClose} disabled={searching} title={zh ? '关闭' : 'Close'} aria-label={zh ? '关闭' : 'Close'}><X /></button>
      </header>
      <div className="price-check-body">
        {loading && <div className="price-check-loading">{zh ? '正在解析装备和集市词条...' : 'Resolving item and trade modifiers...'}</div>}
        {!loading && draft && <>
          <div className={`price-check-item rarity-${draft.rarity.toLowerCase()}`}>
            <strong>{zh ? draft.localizedName || draft.name : draft.name}</strong>
            <span>{zh ? draft.localizedBaseType || draft.baseType : draft.baseType}</span>
          </div>
          <div className="price-check-toolbar">
            <label><span>{zh ? '联盟' : 'League'}</span><select value={leagueId} onChange={(event) => setLeagueId(event.target.value)}>{leagues.map((league) => <option value={league.id} key={league.id}>{league.text}</option>)}</select></label>
            <label><span>{zh ? '上架状态' : 'Listed'}</span><select value={listedStatus} onChange={(event) => setListedStatus(event.target.value as TradeListedStatus)}>
              <option value="securable">{zh ? '一口价' : 'Instant buyout'}</option>
              <option value="available">{zh ? '一口价及在线' : 'Instant & in person'}</option>
              <option value="online">{zh ? '在线' : 'Online'}</option>
              <option value="any">{zh ? '全部' : 'Any'}</option>
            </select></label>
          </div>
          {!draft.unique && <div className="price-check-properties">
            <label className="price-check-checkbox"><input type="checkbox" checked={useBaseType} onChange={(event) => setUseBaseType(event.target.checked)} /><span>{zh ? `指定底材：${draft.localizedBaseType || draft.baseType}` : `Specific base: ${draft.baseType}`}</span></label>
            <label><span>{zh ? '物品等级' : 'Item level'}</span><span className="price-check-range"><input inputMode="numeric" placeholder={zh ? '最小' : 'Min'} value={itemLevelMin} onChange={(event) => setItemLevelMin(event.target.value)} /><input inputMode="numeric" placeholder={zh ? '最大' : 'Max'} value={itemLevelMax} onChange={(event) => setItemLevelMax(event.target.value)} /></span></label>
          </div>}
          <div className="price-check-modifier-header"><span>{zh ? `词条 ${selectedCount}/${searchableCount}` : `Modifiers ${selectedCount}/${searchableCount}`}</span><div><button onClick={() => selectAll(true)} title={zh ? '全选可搜索词条' : 'Select all searchable modifiers'}><CheckSquare2 /></button><button onClick={() => selectAll(false)} title={zh ? '清空词条选择' : 'Clear modifier selection'}><Square /></button></div></div>
          <div className="price-check-modifiers">
            {draft.modifiers.map((modifier) => {
              const input = modifierInputs[modifier.id] || { selected: false, min: '', max: '' }
              const lines = zh && modifier.localizedLines?.length ? modifier.localizedLines : modifier.lines
              return <div className={`price-check-modifier${modifier.searchable ? '' : ' unavailable'}`} key={modifier.id}>
                <label className="price-check-checkbox"><input type="checkbox" disabled={!modifier.searchable} checked={input.selected} onChange={(event) => updateModifier(modifier.id, { selected: event.target.checked })} /><span><small>{modifierLabel(modifier.group, zh)}</small>{lines.map((line, index) => <em key={`${line}-${index}`}>{line}</em>)}</span></label>
                {modifier.searchable && modifier.valueMode === 'numeric' && <span className="price-check-range"><input inputMode="decimal" aria-label={zh ? '最小值' : 'Minimum'} placeholder={zh ? '最小' : 'Min'} value={input.min} onChange={(event) => updateModifier(modifier.id, { min: event.target.value })} /><input inputMode="decimal" aria-label={zh ? '最大值' : 'Maximum'} placeholder={zh ? '最大' : 'Max'} value={input.max} onChange={(event) => updateModifier(modifier.id, { max: event.target.value })} /></span>}
                {!modifier.searchable && <span className="price-check-unmatched">{zh ? '集市无匹配' : 'No trade match'}</span>}
              </div>
            })}
          </div>
        </>}
        {error && <div className="price-check-error">{error}</div>}
      </div>
      <footer className="dialog-footer"><span>{draft?.unique ? (zh ? '唯一装备固定名称与底材' : 'Unique name and base are fixed') : ''}</span><div><button onClick={onClose} disabled={searching}>{zh ? '取消' : 'Cancel'}</button><button className="primary" disabled={loading || searching || !draft || !leagueId} onClick={() => void runSearch()}><Search /><span>{searching ? (zh ? '正在搜索...' : 'Searching...') : (zh ? '搜索集市' : 'Search market')}</span></button></div></footer>
    </section>
  </div>, document.body)
}
