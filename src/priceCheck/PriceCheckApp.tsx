import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronLeft, ChevronRight, ExternalLink, Home, List, Search, ShieldCheck, Store, X } from 'lucide-react'
import type { PriceCheckContextState, TradeFilterBoolean, TradeFilterRarity, TradeListedStatus, TradePriceCheckCriteria, TradePriceCheckDraft, TradeXiletradeFilters } from '@/types/market'
import { uiText } from '@/i18n/uiLocale'
import { loadTranslations, normalizeDisplayTags, translateGameText } from '@/i18n/translationLoader'
import { loadAppSettings } from '@/engine/appSettings'
import { deriveWeaponComparisonStatsFromRaw } from '@/engine/itemDisplayStats'
import { loadItemBaseData, type ItemBaseData } from '@/engine/itemBaseData'
import { EquipmentWeaponStats } from '@/components/equipment/EquipmentWeaponStats'
import { localizedPrice } from './priceFormatting'
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

type XiletradeRangeKey = 'itemLevel' | 'quality' | 'requiredLevel' | 'armour' | 'energyShield' | 'evasion' | 'runicWard' | 'attacksPerSecond' | 'damagePerSecond' | 'criticalChance' | 'elementalDps' | 'physicalDps' | 'block' | 'damage' | 'spirit' | 'runeSockets'
type XiletradeMiscKey = keyof NonNullable<TradeXiletradeFilters['misc']>

interface XiletradeFilterDraft {
  rarity: '' | TradeFilterRarity
  ranges: Record<XiletradeRangeKey, { min: string; max: string }>
  misc: Record<XiletradeMiscKey, '' | TradeFilterBoolean>
  priceMin: string
  priceMax: string
  priceCurrency: string
  indexed: '' | '1day' | '3days' | '1week' | '2weeks'
  saleType: '' | 'priced' | 'unpriced'
}

const xiletradeRangeKeys: XiletradeRangeKey[] = [
  'itemLevel', 'quality', 'requiredLevel', 'armour', 'energyShield', 'evasion', 'runicWard',
  'attacksPerSecond', 'damagePerSecond', 'criticalChance', 'elementalDps', 'physicalDps',
  'block', 'damage', 'spirit', 'runeSockets',
]

const xiletradeMiscKeys: XiletradeMiscKey[] = [
  'mirrored', 'corrupted', 'twiceCorrupted', 'identified', 'fractured', 'alternateArt',
  'crafted', 'mutated', 'desecrated', 'veiled', 'sanctified',
]

function createXiletradeFilterDraft(): XiletradeFilterDraft {
  return {
    rarity: '',
    ranges: Object.fromEntries(xiletradeRangeKeys.map((key) => [key, { min: '', max: '' }])) as XiletradeFilterDraft['ranges'],
    misc: Object.fromEntries(xiletradeMiscKeys.map((key) => [key, ''])) as XiletradeFilterDraft['misc'],
    priceMin: '', priceMax: '', priceCurrency: '', indexed: '', saleType: '',
  }
}

function toXiletradeFilters(draft: XiletradeFilterDraft): TradeXiletradeFilters | undefined {
  const range = (key: XiletradeRangeKey) => {
    const value = draft.ranges[key]
    const min = numeric(value.min)
    const max = numeric(value.max)
    return min == null && max == null ? undefined : { ...(min == null ? {} : { min }), ...(max == null ? {} : { max }) }
  }
  const itemLevel = range('itemLevel')
  const quality = range('quality')
  const requiredLevel = range('requiredLevel')
  const equipment = Object.fromEntries(xiletradeRangeKeys.slice(3).flatMap((key) => {
    const value = range(key)
    return value ? [[key, value]] : []
  })) as NonNullable<TradeXiletradeFilters['equipment']>
  const misc = Object.fromEntries(xiletradeMiscKeys.flatMap((key) => draft.misc[key] ? [[key, draft.misc[key]]] : [])) as NonNullable<TradeXiletradeFilters['misc']>
  const priceMin = numeric(draft.priceMin)
  const priceMax = numeric(draft.priceMax)
  const priceCurrency = draft.priceCurrency.trim()
  const trade = priceMin == null && priceMax == null && !priceCurrency && !draft.indexed && !draft.saleType
    ? undefined
    : {
      ...((priceMin != null || priceMax != null || priceCurrency) ? { price: { ...(priceMin == null ? {} : { min: priceMin }), ...(priceMax == null ? {} : { max: priceMax }), ...(priceCurrency ? { currency: priceCurrency } : {}) } } : {}),
      ...(draft.indexed ? { indexed: draft.indexed } : {}),
      ...(draft.saleType ? { saleType: draft.saleType } : {}),
    }
  const result: TradeXiletradeFilters = {
    ...(draft.rarity ? { rarity: draft.rarity } : {}),
    ...(itemLevel ? { itemLevel } : {}),
    ...(quality ? { quality } : {}),
    ...(requiredLevel ? { requiredLevel } : {}),
    ...(Object.keys(equipment).length ? { equipment } : {}),
    ...(Object.keys(misc).length ? { misc } : {}),
    ...(trade ? { trade } : {}),
  }
  return Object.keys(result).length ? result : undefined
}

function xiletradeRangeLabel(key: XiletradeRangeKey, l: (en: string, zhCN: string, zhTW: string, koKR: string) => string): string {
  const labels: Record<XiletradeRangeKey, [string, string, string, string]> = {
    itemLevel: ['Item level', '物品等级', '物品等級', '아이템 레벨'], quality: ['Quality', '品质', '品質', '품질'], requiredLevel: ['Required level', '需求等级', '需求等級', '요구 레벨'],
    armour: ['Armour', '护甲', '護甲', '방어도'], energyShield: ['Energy shield', '能量护盾', '能量護盾', '에너지 보호막'], evasion: ['Evasion', '闪避', '閃避', '회피'], runicWard: ['Runic ward', '符文结界', '符文結界', '룬 결계'],
    attacksPerSecond: ['Attacks / sec', '每秒攻击', '每秒攻擊', '초당 공격'], damagePerSecond: ['DPS', 'DPS', 'DPS', 'DPS'], criticalChance: ['Critical chance', '暴击率', '暴擊率', '치명타 확률'], elementalDps: ['Elemental DPS', '元素 DPS', '元素 DPS', '원소 DPS'], physicalDps: ['Physical DPS', '物理 DPS', '物理 DPS', '물리 DPS'], block: ['Block', '格挡', '格擋', '막기'], damage: ['Damage', '伤害', '傷害', '피해'], spirit: ['Spirit', '精魂', '精魂', '정신력'], runeSockets: ['Rune sockets', '符文孔', '符文孔', '룬 홈'],
  }
  return l(...labels[key])
}

function xiletradeMiscLabel(key: XiletradeMiscKey, l: (en: string, zhCN: string, zhTW: string, koKR: string) => string): string {
  const labels: Record<XiletradeMiscKey, [string, string, string, string]> = {
    mirrored: ['Mirrored', '镜像', '鏡像', '복제'], corrupted: ['Corrupted', '腐化', '腐化', '타락'], twiceCorrupted: ['Twice corrupted', '双重腐化', '雙重腐化', '이중 타락'], identified: ['Identified', '已鉴定', '已鑑定', '감정됨'], fractured: ['Fractured', '分裂', '分裂', '분열'], alternateArt: ['Alternate art', '异画', '異畫', '대체 외형'], crafted: ['Crafted', '打造', '製作', '제작'], mutated: ['Mutated', '变异', '變異', '변이'], desecrated: ['Desecrated', '亵渎', '褻瀆', '모독'], veiled: ['Unrevealed', '未揭示', '未揭示', '미공개'], sanctified: ['Sanctified', '圣化', '聖化', '성화'],
  }
  return l(...labels[key])
}

function slotLabel(slotName: string | undefined, l: (en: string, zhCN: string, zhTW: string, koKR: string) => string): string | undefined {
  if (!slotName) return undefined
  const labels: Record<string, [string, string, string, string]> = {
    Helmet: ['Helmet', '头盔', '頭盔', '투구'],
    Gloves: ['Gloves', '手套', '手套', '장갑'],
    'Body Armour': ['Body armour', '胸甲', '胸甲', '갑옷'],
    Boots: ['Boots', '鞋子', '鞋子', '장화'],
    'Ring 1': ['Ring 1', '戒指 1', '戒指 1', '반지 1'],
    'Ring 2': ['Ring 2', '戒指 2', '戒指 2', '반지 2'],
    Amulet: ['Amulet', '项链', '項鍊', '목걸이'],
    Belt: ['Belt', '腰带', '腰帶', '허리띠'],
    'Weapon 1': ['Main hand', '主手', '主手', '주 무기'],
    'Weapon 2': ['Off hand', '副手', '副手', '보조 무기'],
    'Weapon 1 Swap': ['Main hand (swap)', '主手（切换）', '主手（切換）', '주 무기 (교체)'],
    'Weapon 2 Swap': ['Off hand (swap)', '副手（切换）', '副手（切換）', '보조 무기 (교체)'],
  }
  const message = labels[slotName]
  return message ? l(...message) : slotName
}

function searchReferenceErrorCopy(
  error: string,
  l: (en: string, zhCN: string, zhTW: string, koKR: string) => string,
): { title: string; message: string; detail: string } | undefined {
  const match = error.match(/^Official trade search returned an invalid reference(?: \[([^\]]+)\])?: (.+)$/)
  if (!match) return undefined
  const code = match[1] || ''
  const detail = match[2]
  const reason = code === 'invalid-search-code'
    ? (/too long/i.test(detail)
      ? l('The search ID returned by the official site is too long.', '官方返回的搜索编号过长。', '官方返回的搜尋編號過長。', '공식 사이트에서 반환한 검색 ID가 너무 깁니다.')
      : l('The search ID returned by the official site contains unsupported characters.', '官方返回的搜索编号包含不支持的字符。', '官方返回的搜尋編號包含不支援的字元。', '공식 사이트에서 반환한 검색 ID에 지원되지 않는 문자가 있습니다.'))
    : code === 'invalid-search-code-encoding'
      ? l('The search ID returned by the official site has invalid URL encoding.', '官方返回的搜索编号 URL 编码无效。', '官方返回的搜尋編號 URL 編碼無效。', '공식 사이트에서 반환한 검색 ID의 URL 인코딩이 잘못되었습니다.')
      : code === 'invalid-league'
        ? l('The selected league cannot be used to build the official result link.', '当前赛季无法用于生成官方结果链接。', '目前賽季無法用於產生官方結果連結。', '선택한 리그로 공식 결과 링크를 만들 수 없습니다.')
        : l('The official result link failed local validation.', '官方结果链接未通过本地校验。', '官方結果連結未通過本機驗證。', '공식 결과 링크가 로컬 검증에 실패했습니다.')
  return {
    title: l('Search reference rejected', '搜索引用校验失败', '搜尋引用驗證失敗', '검색 참조 검증 실패'),
    message: l('The official site returned a result, but SuperPoE could not safely create a reusable result link.', '官方集市已返回结果，但 SuperPoE 无法安全生成可复用的结果链接。', '官方市集已返回結果，但 SuperPoE 無法安全產生可重用的結果連結。', '공식 거래소는 결과를 반환했지만 SuperPoE가 안전한 결과 링크를 만들지 못했습니다.'),
    detail: `${reason} ${l('Technical detail', '技术详情', '技術詳情', '기술 세부 정보')}: ${detail}`,
  }
}

export function PriceCheckApp() {
  const bridge = window.superpoePriceCheck
  const [state, setState] = useState<PriceCheckContextState | null>(null)
  const [leagueId, setLeagueId] = useState('')
  const [listedStatus, setListedStatus] = useState<TradeListedStatus>('securable')
  const [useBaseType, setUseBaseType] = useState(false)
  const [modifiers, setModifiers] = useState<Record<string, ModifierInput>>({})
  const [xiletradeFilters, setXiletradeFilters] = useState<XiletradeFilterDraft>(() => createXiletradeFilterDraft())
  const [filtersOpen, setFiltersOpen] = useState(true)
  const [selectedListingId, setSelectedListingId] = useState<string | null>(null)
  const [hideoutBusyId, setHideoutBusyId] = useState<string | null>(null)
  const [listingActionError, setListingActionError] = useState<string | null>(null)
  const [searchActionError, setSearchActionError] = useState<string | null>(null)
  const [uiScalePercent, setUiScalePercent] = useState(() => loadAppSettings().uiScalePercent)
  const [translationRevision, setTranslationRevision] = useState(0)
  const [itemBases, setItemBases] = useState<Record<string, ItemBaseData>>({})
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

  useEffect(() => {
    let active = true
    void loadItemBaseData().then((index) => {
      if (active) setItemBases(index.bases)
    })
    return () => { active = false }
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
    setListedStatus(state.realm === 'cn' ? 'securable' : 'online')
    setUseBaseType(state.draft.unique)
    setXiletradeFilters(createXiletradeFilterDraft())
    setModifiers(Object.fromEntries(state.draft.modifiers.map((modifier) => [modifier.id, {
      selected: modifier.searchable && modifier.group !== 'rune',
      min: modifier.currentValue == null ? '' : String(modifier.currentValue), max: '',
    }])))
    setFiltersOpen(true)
  }, [draftKey, state?.initialLeagueId, state?.mode, state?.realm])

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
  const referenceError = state?.error ? searchReferenceErrorCopy(state.error, l) : undefined
  const [elevating, setElevating] = useState(false)
  const [elevationMessage, setElevationMessage] = useState<string | null>(null)

  const localizedDraft = useMemo(() => {
    const draft = state?.draft
    if (!draft) return undefined
    const name = language === 'zh-rCN' ? (draft.localizedName || translateGameText(draft.name, language)) : translateGameText(draft.name, language)
    const baseType = language === 'zh-rCN' ? (draft.localizedBaseType || translateGameText(draft.baseType, language)) : translateGameText(draft.baseType, language)
    return { name, baseType }
  }, [language, state?.draft, translationRevision])

  const checkedItemWeaponStats = useMemo(() => {
    const raw = state?.draft?.rawText
    if (!raw || !Object.keys(itemBases).length) return []
    try {
      return deriveWeaponComparisonStatsFromRaw(raw, itemBases, 'price-check-source')
    } catch {
      return []
    }
  }, [itemBases, state?.draft?.rawText])

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
    const xiletrade = toXiletradeFilters(xiletradeFilters)
    const criteria: TradePriceCheckCriteria = {
      listedStatus, useBaseType: state.draft.unique || useBaseType,
      modifiers: state.draft.modifiers.flatMap((modifier) => {
        const input = modifiers[modifier.id]
        return modifier.searchable && input?.selected ? [{ id: modifier.id, min: numeric(input.min), max: numeric(input.max) }] : []
      }),
      ...(xiletrade ? { xiletrade } : {}),
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

  const updateXiletradeRange = (key: XiletradeRangeKey, side: 'min' | 'max', value: string) => {
    setXiletradeFilters((current) => ({
      ...current,
      ranges: { ...current.ranges, [key]: { ...current.ranges[key], [side]: value } },
    }))
  }

  const updateXiletradeMisc = (key: XiletradeMiscKey, value: '' | TradeFilterBoolean) => {
    setXiletradeFilters((current) => ({ ...current, misc: { ...current.misc, [key]: value } }))
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
      <div className="pc-title"><strong>{l('Price checker', '装备查价', '裝備查價', '아이템 가격 확인')}</strong><span>{localizedDraft?.name || l('Waiting for an item', '等待装备', '等待裝備', '아이템 대기 중')}{state?.slotName ? ` · ${slotLabel(state.slotName, l)}` : ''}</span></div>
      <div className="pc-escape-hint"><kbd>ESC</kbd><span>{l('Return to game', '返回游戏', '返回遊戲', '게임으로 돌아가기')}</span></div>
      <div className="pc-window-actions"><span>{state?.realm === 'cn' ? l('CN', '国服', '國服', '중국') : l('Global', '国际服', '國際服', '글로벌')}</span><button className="pc-cancel-button" title={l('Cancel price check', '取消查价', '取消查價', '가격 확인 취소')} onClick={() => void bridge?.hide?.()}><X /><span>{l('Cancel', '取消', '取消', '취소')}</span></button></div>
    </header>
    {!state || state.phase === 'idle' ? <div className="pc-empty">{l('Select Price check from an item.', '请从装备上选择“查价”。', '請從裝備上選擇「查價」。', '아이템에서 가격 확인을 선택하세요.')}</div> : null}
    {state?.draft && <>
      {checkedItemWeaponStats.length > 0 && <section className="pc-source-metrics" aria-label={l('Checked item metrics', '被查价装备指标', '被查價裝備指標', '조회 아이템 지표')}>
        <div className="pc-source-metrics-copy"><span>{l('Checked item metrics', '被查价装备指标', '被查價裝備指標', '조회 아이템 지표')}</span><strong>{localizedDraft?.name || state.draft.name}</strong><small>{localizedDraft?.baseType || state.draft.baseType}</small></div>
        <EquipmentWeaponStats stats={checkedItemWeaponStats} language={language} />
      </section>}
      <section className="pc-controls">
        <label><span>{l('League', '赛季', '賽季', '리그')}</span><select value={leagueId} onChange={(event) => setLeagueId(event.target.value)}>{state.leagues.map((league) => <option key={league.id} value={league.id}>{translateGameText(league.text, language)}</option>)}</select></label>
        <label><span>{l('Listed', '上架', '上架', '등록')}</span><select value={listedStatus} onChange={(event) => setListedStatus(event.target.value as TradeListedStatus)} aria-label={l('Listed status', '上架状态', '上架狀態', '등록 상태')}><option value="securable">{l('Instant', '一口价', '直購', '즉시 구매')}</option><option value="available">{l('Any available', '可交易', '可交易', '거래 가능')}</option><option value="onlineleague">{l('Online in league', '赛季在线', '賽季在線', '리그 온라인')}</option><option value="online">{l('Online', '在线', '在線', '온라인')}</option><option value="any">{l('Any', '全部', '全部', '모두')}</option></select></label>
      </section>
      <button className="pc-filter-summary" onClick={() => setFiltersOpen((value) => !value)}><span>{l(`${selectedCount} modifiers selected`, `已选 ${selectedCount} 条词缀`, `已選 ${selectedCount} 條詞綴`, `${selectedCount}개 속성 선택`)}</span><ChevronDown className={filtersOpen ? 'open' : ''} /></button>
      {filtersOpen && <section className="pc-filters">
        <div className="pc-properties"><label><input type="checkbox" checked={useBaseType} onChange={(event) => setUseBaseType(event.target.checked)} />{l('Match base type', '匹配底材', '匹配基底', '베이스 유형 일치')}</label></div>
        <section className="pc-xiletrade-panel">
          <header><strong>{l('Xiletrade filters', 'Xiletrade 筛选', 'Xiletrade 篩選', 'Xiletrade 필터')}</strong><span>{l('Use only the fields you need', '按需填写筛选条件', '按需填寫篩選條件', '필요한 조건만 입력')}</span></header>
          <div className="pc-xiletrade-basic">
            <label><span>{l('Rarity', '稀有度', '稀有度', '희귀도')}</span><select value={xiletradeFilters.rarity} onChange={(event) => setXiletradeFilters((current) => ({ ...current, rarity: event.target.value as XiletradeFilterDraft['rarity'] }))}><option value="">{l('Any', '全部', '全部', '모두')}</option><option value="normal">{l('Normal', '普通', '普通', '일반')}</option><option value="magic">{l('Magic', '魔法', '魔法', '마법')}</option><option value="rare">{l('Rare', '稀有', '稀有', '희귀')}</option><option value="unique">{l('Unique', '传奇', '傳奇', '고유')}</option><option value="nonunique">{l('Any non-unique', '任意非传奇', '任意非傳奇', '고유 제외')}</option></select></label>
            {(['quality', 'requiredLevel'] as XiletradeRangeKey[]).map((key) => <label className="pc-xiletrade-range" key={key}><span>{xiletradeRangeLabel(key, l)}</span><input placeholder={l('Min', '最小', '最小', '최소')} value={xiletradeFilters.ranges[key].min} onChange={(event) => updateXiletradeRange(key, 'min', event.target.value)} /><input placeholder={l('Max', '最大', '最大', '최대')} value={xiletradeFilters.ranges[key].max} onChange={(event) => updateXiletradeRange(key, 'max', event.target.value)} /></label>)}
          </div>
          <div className="pc-xiletrade-section-title">{l('Equipment values', '装备数值', '裝備數值', '장비 수치')}</div>
          <div className="pc-xiletrade-grid">
            {(['armour', 'energyShield', 'evasion', 'runicWard', 'attacksPerSecond', 'damagePerSecond', 'criticalChance', 'elementalDps', 'physicalDps', 'block', 'damage', 'spirit', 'runeSockets'] as XiletradeRangeKey[]).map((key) => <label className="pc-xiletrade-range" key={key}><span>{xiletradeRangeLabel(key, l)}</span><input aria-label={`${xiletradeRangeLabel(key, l)} ${l('minimum', '最小值', '最小值', '최솟값')}`} placeholder={l('Min', '最小', '最小', '최소')} value={xiletradeFilters.ranges[key].min} onChange={(event) => updateXiletradeRange(key, 'min', event.target.value)} /><input aria-label={`${xiletradeRangeLabel(key, l)} ${l('maximum', '最大值', '最大值', '최댓값')}`} placeholder={l('Max', '最大', '最大', '최대')} value={xiletradeFilters.ranges[key].max} onChange={(event) => updateXiletradeRange(key, 'max', event.target.value)} /></label>)}
          </div>
          <div className="pc-xiletrade-section-title">{l('Item state', '装备状态', '裝備狀態', '아이템 상태')}</div>
          <div className="pc-xiletrade-state-grid">
            {xiletradeMiscKeys.map((key) => <label key={key}><span>{xiletradeMiscLabel(key, l)}</span><select value={xiletradeFilters.misc[key]} onChange={(event) => updateXiletradeMisc(key, event.target.value as '' | TradeFilterBoolean)}><option value="">{l('Any', '全部', '全部', '모두')}</option><option value="true">{l('Yes', '是', '是', '예')}</option><option value="false">{l('No', '否', '否', '아니오')}</option></select></label>)}
          </div>
          <div className="pc-xiletrade-section-title">{l('Trade filters', '交易筛选', '交易篩選', '거래 필터')}</div>
          <div className="pc-xiletrade-trade-grid">
            <label className="pc-xiletrade-range"><span>{l('Price', '价格', '價格', '가격')}</span><input placeholder={l('Min', '最小', '最小', '최소')} value={xiletradeFilters.priceMin} onChange={(event) => setXiletradeFilters((current) => ({ ...current, priceMin: event.target.value }))} /><input placeholder={l('Max', '最大', '最大', '최대')} value={xiletradeFilters.priceMax} onChange={(event) => setXiletradeFilters((current) => ({ ...current, priceMax: event.target.value }))} /></label>
            <label><span>{l('Currency', '货币', '貨幣', '통화')}</span><input placeholder="chaos" value={xiletradeFilters.priceCurrency} onChange={(event) => setXiletradeFilters((current) => ({ ...current, priceCurrency: event.target.value }))} /></label>
            <label><span>{l('Indexed', '上架时间', '上架時間', '등록 기간')}</span><select value={xiletradeFilters.indexed} onChange={(event) => setXiletradeFilters((current) => ({ ...current, indexed: event.target.value as XiletradeFilterDraft['indexed'] }))}><option value="">{l('Any time', '不限', '不限', '제한 없음')}</option><option value="1day">{l('Last day', '最近 1 天', '最近 1 天', '최근 1일')}</option><option value="3days">{l('Last 3 days', '最近 3 天', '最近 3 天', '최근 3일')}</option><option value="1week">{l('Last week', '最近 1 周', '最近 1 週', '최근 1주')}</option><option value="2weeks">{l('Last 2 weeks', '最近 2 周', '最近 2 週', '최근 2주')}</option></select></label>
            <label><span>{l('Sale type', '出售类型', '出售類型', '판매 유형')}</span><select value={xiletradeFilters.saleType} onChange={(event) => setXiletradeFilters((current) => ({ ...current, saleType: event.target.value as XiletradeFilterDraft['saleType'] }))}><option value="">{l('Any', '全部', '全部', '모두')}</option><option value="priced">{l('Priced', '有价格', '有價格', '가격 있음')}</option><option value="unpriced">{l('Unpriced', '未定价', '未定價', '가격 없음')}</option></select></label>
          </div>
        </section>
        <div className="pc-modifiers">{state.draft.modifiers.map((modifier) => {
          const input = modifiers[modifier.id] || { selected: false, min: '', max: '' }
          const lines = language === 'zh-rCN' && modifier.localizedLines?.length
            ? modifier.localizedLines.map(normalizeDisplayTags)
            : modifier.lines.map((line) => normalizeDisplayTags(translateGameText(line, language)))
          const sourceLabel = modifierSourceLabel(modifier, l)
          return <div className={`pc-modifier${modifier.searchable ? '' : ' unavailable'}`} key={modifier.id}><label><input type="checkbox" disabled={!modifier.searchable} checked={input.selected} onChange={(event) => setModifiers((current) => ({ ...current, [modifier.id]: { ...input, selected: event.target.checked } }))} /><span className="pc-modifier-copy"><em className={`pc-modifier-source source-${modifier.group}`}>{sourceLabel}</em><span>{lines.join(' / ')}</span></span></label>{modifier.searchable && modifier.valueMode === 'numeric' ? <div className="pc-range-fields"><label className="pc-range-field"><input placeholder={l('Min', '最小', '最小', '최소')} aria-label={l('Minimum value', '最小值', '最小값', '최솟값')} value={input.min} onChange={(event) => setModifiers((current) => ({ ...current, [modifier.id]: { ...input, min: event.target.value } }))} /></label><label className="pc-range-field"><input placeholder={l('Max', '最大', '最大', '최대')} aria-label={l('Maximum value', '最大值', '最大값', '최댓값')} value={input.max} onChange={(event) => setModifiers((current) => ({ ...current, [modifier.id]: { ...input, max: event.target.value } }))} /></label></div> : !modifier.searchable ? <small>{l('No match', '无法匹配', '無法匹配', '일치 없음')}</small> : null}</div>
        })}</div>
      </section>}
      {searchActionError && <div className="pc-error pc-listing-error">{searchActionError}</div>}
      {state.captureWarnings?.length ? <div className="pc-warning pc-listing-error">
        <strong>{l('Some item lines were not included', '部分词缀未纳入查询', '部分詞綴未納入查詢', '일부 속성이 검색에 포함되지 않음')}</strong>
        <span>{state.captureWarnings.join(' | ')}</span>
      </div> : null}
      <section className="pc-searchbar"><button disabled={busy || !leagueId} onClick={() => void runSearch()}><Search />{busy ? l('Working...', '处理中...', '處理中...', '처리 중...') : l('Price Check', '查价', '查價', '가격 확인')}</button><button className="secondary market-search-button" disabled={busy || !leagueId} onClick={() => void searchInTradeCenter()}><Store />{l('Search Market', '搜索集市', '搜尋市集', '거래소 검색')}</button>{state.search && <button className="secondary" onClick={() => void bridge?.openTradePage?.(state.search!.url)}><ExternalLink />{l('Official page', '官网结果', '官網結果', '공식 페이지')}</button>}</section>
    </>}
    {state?.error && <div className={`pc-error${captureError ? ' pc-guided-error' : referenceError ? ' pc-diagnostic-error' : ''}`}>
      {captureError ? <>
        <strong>{/running as administrator/i.test(state.error) ? l('Permission mismatch', '权限不匹配', '權限不相符', '권한 불일치') : l('Item capture failed', '装备复制失败', '裝備複製失敗', '아이템 복사 실패')}</strong>
        <p>{/running as administrator/i.test(state.error)
          ? l('Path of Exile 2 is running as administrator. Restart SuperPoE with the same permission, then try again.', 'Path of Exile 2 正以管理员权限运行，请先让 SuperPoE 以相同权限重启，再重试。', 'Path of Exile 2 正以管理員權限執行，請先讓 SuperPoE 以相同權限重新啟動，再重試。', 'Path of Exile 2가 관리자 권한으로 실행 중입니다. SuperPoE를 같은 권한으로 다시 시작한 뒤 다시 시도하세요.')
          : l('Keep Path of Exile 2 focused, hover an item, and press the price-check hotkey again. If the game runs as administrator, restart SuperPoE with matching permissions.', '请保持 Path of Exile 2 在前台，将鼠标悬停在装备上并再次按查价热键。如果游戏以管理员权限运行，请让 SuperPoE 以相同权限重启。', '請保持 Path of Exile 2 在前景，將滑鼠停在裝備上並再次按查價熱鍵。如果遊戲以管理員權限執行，請讓 SuperPoE 以相同權限重新啟動。', 'Path of Exile 2를 전면에 두고 아이템 위에 마우스를 올린 뒤 가격 확인 단축키를 다시 누르세요. 게임이 관리자 권한으로 실행 중이면 SuperPoE도 같은 권한으로 다시 시작하세요.')}</p>
        <div className="pc-error-actions"><button type="button" onClick={() => void restartAsAdministrator()} disabled={elevating || !bridge?.restartAsAdministrator}><ShieldCheck />{elevating ? l('Restarting...', '重启中...', '重新啟動中...', '다시 시작 중...') : l('Restart as administrator', '以管理员身份重启', '以管理員身份重新啟動', '관리자 권한으로 다시 시작')}</button>{elevationMessage && <small>{elevationMessage}</small>}</div>
      </> : referenceError ? <>
        <strong>{referenceError.title}</strong>
        <p>{referenceError.message}</p>
        <small>{referenceError.detail}</small>
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
              <b>{localizedPrice(listing.price, language, l)}</b>
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
