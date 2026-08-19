import { useEffect, useMemo, useState } from 'react'
import { ArrowUpDown, BookmarkPlus, Check, ChevronDown, ChevronLeft, ChevronRight, Coins, ExternalLink, Home, Info, List, RefreshCw, Search, SlidersHorizontal, X } from 'lucide-react'
import { EquipmentItemInspector, equipmentItemBaseType, equipmentItemName } from '@/components/equipment/EquipmentItemInspector'
import { EquipmentDifferenceTooltip } from '@/equipmentDifference/components/EquipmentDifferenceTooltip'
import type { BuildContextSnapshot } from '@/equipmentDifference/types'
import type {
  FindBetterAugmentBehavior, FindBetterSearchOptions, FindBetterSortMode, FindBetterStatWeight,
  PriceCheckContextState, PriceCheckListingView, TradeListedStatus, TradePriceCheckCriteria,
} from '@/types/market'
import { formatUiNumber, uiText } from '@/i18n/uiLocale'
import { loadTranslations, translateGameText } from '@/i18n/translationLoader'
import { loadAppSettings } from '@/engine/appSettings'
import './findBetter.css'

interface PowerStat {
  stat: string
  en: string
  zhCN: string
  zhTW: string
  ko: string
  group: 'offence' | 'defence' | 'resource' | 'mechanic'
  lowerIsBetter?: boolean
}

const POWER_STATS: PowerStat[] = [
  { stat: 'FullDPS', en: 'Full DPS', zhCN: '完整 DPS', zhTW: '完整 DPS', ko: '전체 DPS', group: 'offence' },
  { stat: 'CombinedDPS', en: 'Combined DPS', zhCN: '合并 DPS', zhTW: '合併 DPS', ko: '합산 DPS', group: 'offence' },
  { stat: 'TotalDPS', en: 'Hit DPS', zhCN: '击中 DPS', zhTW: '擊中 DPS', ko: '적중 DPS', group: 'offence' },
  { stat: 'WithImpaleDPS', en: 'Impale + Hit DPS', zhCN: '穿刺 + 击中 DPS', zhTW: '穿刺 + 擊中 DPS', ko: '꿰뚫기 + 적중 DPS', group: 'offence' },
  { stat: 'AverageDamage', en: 'Average Hit', zhCN: '平均击中伤害', zhTW: '平均擊中傷害', ko: '평균 적중', group: 'offence' },
  { stat: 'Speed', en: 'Attack/Cast Speed', zhCN: '攻击/施法速度', zhTW: '攻擊/施法速度', ko: '공격/시전 속도', group: 'offence' },
  { stat: 'TotalDot', en: 'DoT DPS', zhCN: '持续伤害 DPS', zhTW: '持續傷害 DPS', ko: '지속 피해 DPS', group: 'offence' },
  { stat: 'BleedDPS', en: 'Bleed DPS', zhCN: '流血 DPS', zhTW: '流血 DPS', ko: '출혈 DPS', group: 'offence' },
  { stat: 'IgniteDPS', en: 'Ignite DPS', zhCN: '点燃 DPS', zhTW: '點燃 DPS', ko: '점화 DPS', group: 'offence' },
  { stat: 'PoisonDPS', en: 'Poison DPS', zhCN: '中毒 DPS', zhTW: '中毒 DPS', ko: '중독 DPS', group: 'offence' },
  { stat: 'CritChance', en: 'Crit Chance', zhCN: '暴击几率', zhTW: '暴擊機率', ko: '치명타 확률', group: 'offence' },
  { stat: 'CritMultiplier', en: 'Crit Multiplier', zhCN: '暴击伤害', zhTW: '暴擊傷害', ko: '치명타 배율', group: 'offence' },
  { stat: 'BleedChance', en: 'Bleed Chance', zhCN: '流血几率', zhTW: '流血機率', ko: '출혈 확률', group: 'offence' },
  { stat: 'FreezeChance', en: 'Freeze Chance', zhCN: '冻结几率', zhTW: '凍結機率', ko: '동결 확률', group: 'offence' },
  { stat: 'IgniteChance', en: 'Ignite Chance', zhCN: '点燃几率', zhTW: '點燃機率', ko: '점화 확률', group: 'offence' },
  { stat: 'ShockChance', en: 'Shock Chance', zhCN: '感电几率', zhTW: '感電機率', ko: '감전 확률', group: 'offence' },
  { stat: 'Life', en: 'Life', zhCN: '生命', zhTW: '生命', ko: '생명력', group: 'defence' },
  { stat: 'Armour', en: 'Armour', zhCN: '护甲', zhTW: '護甲', ko: '방어도', group: 'defence' },
  { stat: 'Evasion', en: 'Evasion', zhCN: '闪避', zhTW: '閃避', ko: '회피', group: 'defence' },
  { stat: 'EnergyShield', en: 'Energy Shield', zhCN: '能量护盾', zhTW: '能量護盾', ko: '에너지 보호막', group: 'defence' },
  { stat: 'EnergyShieldRecoveryCap', en: 'Recoverable ES', zhCN: '可恢复能量护盾', zhTW: '可恢復能量護盾', ko: '회복 가능한 ES', group: 'defence' },
  { stat: 'EnergyShieldRegen', en: 'Energy Shield regen', zhCN: '能量护盾回复', zhTW: '能量護盾回復', ko: '에너지 보호막 재생', group: 'defence' },
  { stat: 'EnergyShieldLeechRate', en: 'Energy Shield leech', zhCN: '能量护盾偷取', zhTW: '能量護盾偷取', ko: '에너지 보호막 흡수', group: 'resource' },
  { stat: 'Ward', en: 'Ward', zhCN: '符文结界', zhTW: '符文結界', ko: '결계', group: 'defence' },
  { stat: 'TotalEHP', en: 'Effective Hit Pool', zhCN: '有效生命池', zhTW: '有效生命池', ko: '유효 생명력', group: 'defence' },
  { stat: 'SecondMinimalMaximumHitTaken', en: 'Eff. Maximum Hit Taken', zhCN: '有效最大承受击中', zhTW: '有效最大承受擊中', ko: '유효 최대 적중 피해', group: 'defence' },
  { stat: 'PhysicalTakenHit', en: 'Taken Phys dmg', zhCN: '承受物理伤害', zhTW: '承受物理傷害', ko: '받는 물리 피해', group: 'defence', lowerIsBetter: true },
  { stat: 'LightningTakenHit', en: 'Taken Lightning dmg', zhCN: '承受闪电伤害', zhTW: '承受閃電傷害', ko: '받는 번개 피해', group: 'defence', lowerIsBetter: true },
  { stat: 'ColdTakenHit', en: 'Taken Cold dmg', zhCN: '承受冰霜伤害', zhTW: '承受冰霜傷害', ko: '받는 냉기 피해', group: 'defence', lowerIsBetter: true },
  { stat: 'FireTakenHit', en: 'Taken Fire dmg', zhCN: '承受火焰伤害', zhTW: '承受火焰傷害', ko: '받는 화염 피해', group: 'defence', lowerIsBetter: true },
  { stat: 'ChaosTakenHit', en: 'Taken Chaos dmg', zhCN: '承受混沌伤害', zhTW: '承受混沌傷害', ko: '받는 카오스 피해', group: 'defence', lowerIsBetter: true },
  { stat: 'LifeRegen', en: 'Life regen', zhCN: '生命回复', zhTW: '生命回復', ko: '생명력 재생', group: 'resource' },
  { stat: 'LifeLeechRate', en: 'Life leech', zhCN: '生命偷取', zhTW: '生命偷取', ko: '생명력 흡수', group: 'resource' },
  { stat: 'Mana', en: 'Mana', zhCN: '魔力', zhTW: '魔力', ko: '마나', group: 'resource' },
  { stat: 'ManaRegen', en: 'Mana regen', zhCN: '魔力回复', zhTW: '魔力回復', ko: '마나 재생', group: 'resource' },
  { stat: 'ManaLeechRate', en: 'Mana leech', zhCN: '魔力偷取', zhTW: '魔力偷取', ko: '마나 흡수', group: 'resource' },
  { stat: 'Spirit', en: 'Spirit', zhCN: '精神', zhTW: '精神', ko: '정신력', group: 'resource' },
  { stat: 'Str', en: 'Strength', zhCN: '力量', zhTW: '力量', ko: '힘', group: 'resource' },
  { stat: 'Dex', en: 'Dexterity', zhCN: '敏捷', zhTW: '敏捷', ko: '민첩', group: 'resource' },
  { stat: 'Int', en: 'Intelligence', zhCN: '智慧', zhTW: '智慧', ko: '지능', group: 'resource' },
  { stat: 'TotalAttr', en: 'Total Attributes', zhCN: '全属性', zhTW: '全屬性', ko: '총 능력치', group: 'resource' },
  { stat: 'MeleeAvoidChance', en: 'Melee avoid chance', zhCN: '近战躲避几率', zhTW: '近戰躲避機率', ko: '근접 회피 확률', group: 'mechanic' },
  { stat: 'SpellAvoidChance', en: 'Spell avoid chance', zhCN: '法术躲避几率', zhTW: '法術躲避機率', ko: '주문 회피 확률', group: 'mechanic' },
  { stat: 'ProjectileAvoidChance', en: 'Projectile avoid chance', zhCN: '投射物躲避几率', zhTW: '投射物躲避機率', ko: '투사체 회피 확률', group: 'mechanic' },
  { stat: 'EffectiveMovementSpeedMod', en: 'Move speed', zhCN: '移动速度', zhTW: '移動速度', ko: '이동 속도', group: 'mechanic' },
  { stat: 'BlockChance', en: 'Block Chance', zhCN: '格挡几率', zhTW: '格擋機率', ko: '막기 확률', group: 'mechanic' },
  { stat: 'SpellBlockChance', en: 'Spell Block Chance', zhCN: '法术格挡几率', zhTW: '法術格擋機率', ko: '주문 막기 확률', group: 'mechanic' },
  { stat: 'SpellSuppressionChance', en: 'Spell Suppression Chance', zhCN: '法术压制几率', zhTW: '法術壓制機率', ko: '주문 억제 확률', group: 'mechanic' },
  { stat: 'EffectiveLootRarityMod', en: 'Rarity of Items found', zhCN: '物品稀有度', zhTW: '物品稀有度', ko: '아이템 희귀도', group: 'mechanic' },
]

const DEFAULT_WEIGHTS: FindBetterStatWeight[] = [
  { stat: 'FullDPS', label: 'Full DPS', weightMult: 1 },
  { stat: 'TotalEHP', label: 'Effective Hit Pool', weightMult: .5 },
]

const FETCH_PAGES_DEFAULT = 2
const FETCH_PAGES_MIN = 1
const FETCH_PAGES_MAX = 10

function clampFetchPages(value: string): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return FETCH_PAGES_DEFAULT
  return Math.min(FETCH_PAGES_MAX, Math.max(FETCH_PAGES_MIN, Math.trunc(parsed)))
}

const PRICE_CURRENCY_OPTIONS: ReadonlyArray<{ id: string; aliases: readonly string[]; en: string; zhCN: string; zhTW: string; ko: string }> = [
  { id: 'divine', aliases: ['divine', 'divine orb'], en: 'Divine Orb', zhCN: '神圣石', zhTW: '神聖石', ko: '신성한 오브' },
  { id: 'exalted', aliases: ['exalted', 'exalted orb'], en: 'Exalted Orb', zhCN: '崇高石', zhTW: '崇高石', ko: '엑잘티드 오브' },
  { id: 'chaos', aliases: ['chaos', 'chaos orb'], en: 'Chaos Orb', zhCN: '混沌石', zhTW: '混沌石', ko: '카오스 오브' },
  { id: 'aug', aliases: ['aug', 'augmentation', 'orb of augmentation'], en: 'Orb of Augmentation', zhCN: '增幅石', zhTW: '增幅石', ko: '증폭의 오브' },
  { id: 'transmute', aliases: ['transmute', 'transmutation', 'orb of transmutation'], en: 'Orb of Transmutation', zhCN: '蜕变石', zhTW: '蛻變石', ko: '변성의 오브' },
  { id: 'regal', aliases: ['regal', 'regal orb'], en: 'Regal Orb', zhCN: '富豪石', zhTW: '富豪石', ko: '제왕의 오브' },
  { id: 'vaal', aliases: ['vaal', 'vaal orb'], en: 'Vaal Orb', zhCN: '瓦尔宝珠', zhTW: '瓦爾寶珠', ko: '바알 오브' },
  { id: 'annul', aliases: ['annul', 'annulment', 'orb of annulment'], en: 'Orb of Annulment', zhCN: '无效石', zhTW: '無效石', ko: '소멸의 오브' },
  { id: 'alch', aliases: ['alch', 'alchemy', 'orb of alchemy'], en: 'Orb of Alchemy', zhCN: '点金石', zhTW: '點金石', ko: '연금술의 오브' },
  { id: 'mirror', aliases: ['mirror', 'mirror of kalandra'], en: 'Mirror of Kalandra', zhCN: '卡兰德的魔镜', zhTW: '卡蘭德的魔鏡', ko: '칼란드라의 거울' },
]

function priceCurrencyLabel(currency: string, language: PriceCheckContextState['language']): string {
  const normalized = currency.trim().toLocaleLowerCase().replace(/[_-]+/g, ' ')
  const option = PRICE_CURRENCY_OPTIONS.find((candidate) => candidate.aliases.includes(normalized))
  return option ? uiText(language, option.en, option.zhCN, option.zhTW, option.ko) : currency
}

function localizedPrice(price: PriceCheckListingView['price'], language: PriceCheckContextState['language'], l: (en: string, zh: string, tw: string, ko: string) => string): string {
  if (!price) return l('No price', '未标价', '未標價', '가격 없음')
  return `${formatUiNumber(price.amount, language, { maximumFractionDigits: 2 })} ${priceCurrencyLabel(price.currency, language)}`
}

const SORT_MODES: Array<{ id: FindBetterSortMode; en: string; zh: string; tip: string }> = [
  { id: 'stat-value', en: '(Highest) Stat Value', zh: '（最高）属性价值', tip: 'PoB2 本地按装备替换后的属性收益排序' },
  { id: 'stat-value-price', en: 'Stat Value / Price', zh: '属性价值 / 价格', tip: 'PoB2 用收益减去价格惩罚排序' },
  { id: 'price', en: '(Lowest) Price', zh: '（最低）价格', tip: '按价格从低到高排序' },
  { id: 'weight', en: '(Highest) Weighted Sum', zh: '（最高）加权总和', tip: '保持交易站返回的权重顺序' },
]

function numeric(value: string): number | undefined {
  const parsed = Number(value)
  return value.trim() && Number.isFinite(parsed) ? parsed : undefined
}

function localizedStat(stat: PowerStat, language: PriceCheckContextState['language']): string {
  if (language === 'zh-rCN') return stat.zhCN
  if (language === 'zh-rTW') return stat.zhTW
  if (language === 'ko-KR') return stat.ko
  return stat.en
}

function fetchedResultCount(search: PriceCheckContextState['search']): number {
  if (!search) return 0
  return Math.min(search.total, search.pageCount * 10)
}

function listedTime(value: string | undefined, l: (en: string, zh: string, tw: string, ko: string) => string): string {
  if (!value) return l('Unknown time', '时间未知', '時間未知', '시간 알 수 없음')
  const elapsed = Date.now() - Date.parse(value)
  if (!Number.isFinite(elapsed)) return value
  const minutes = Math.max(0, Math.floor(elapsed / 60_000))
  if (minutes < 1) return l('Just now', '刚刚', '剛剛', '방금')
  if (minutes < 60) return l(`${minutes}m ago`, `${minutes} 分钟前`, `${minutes} 分鐘前`, `${minutes}분 전`)
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return l(`${hours}h ago`, `${hours} 小时前`, `${hours} 小時前`, `${hours}시간 전`)
  return l(`${Math.floor(hours / 24)}d ago`, `${Math.floor(hours / 24)} 天前`, `${Math.floor(hours / 24)} 天前`, `${Math.floor(hours / 24)}일 전`)
}

function localizedTradeError(value: string | undefined, l: (en: string, zh: string, tw: string, ko: string) => string): string | undefined {
  if (!value) return undefined
  if (/rate[- ]limited|\b429\b/i.test(value)) {
    return l('The official trade API is temporarily rate-limited. Please wait a moment and try again.', '官方交易接口暂时限流，请稍等片刻后重试。', '官方交易介面暫時限流，請稍候片刻後重試。', '공식 거래 API가 일시적으로 요청을 제한했습니다. 잠시 후 다시 시도하세요.')
  }
  return value
}

function candidateDelta(value: number | undefined, percent: number | undefined, language: PriceCheckContextState['language']): string {
  if (value == null || !Number.isFinite(value)) return '--'
  const displayValue = formatUiNumber(value, language, { maximumFractionDigits: Math.abs(value) >= 1000 ? 0 : 1 })
  const signedValue = value > 0 ? `+${displayValue}` : displayValue
  if (percent == null || !Number.isFinite(percent)) return signedValue
  const displayPercent = formatUiNumber(percent, language, { maximumFractionDigits: 1 })
  return `${signedValue} (${percent > 0 ? '+' : ''}${displayPercent}%)`
}

function behaviorLabel(value: FindBetterAugmentBehavior, l: (en: string, zh: string, tw: string, ko: string) => string): string {
  if (value === 'keep') return l('Keep', '保留', '保留', '유지')
  if (value === 'remove') return l('Remove', '移除', '移除', '제거')
  return l('Copy Current', '复制当前', '複製目前', '현재 복사')
}

function LegacyFindBetterApp() {
  const bridge = window.superpoePriceCheck
  const [state, setState] = useState<PriceCheckContextState | null>(null)
  const [leagueId, setLeagueId] = useState('')
  const [listedStatus, setListedStatus] = useState<TradeListedStatus>('securable')
  const [useBaseType, setUseBaseType] = useState(false)
  const [sortBy, setSortBy] = useState<FindBetterSortMode>('stat-value')
  const [weights, setWeights] = useState<FindBetterStatWeight[]>(() => DEFAULT_WEIGHTS.map((entry) => ({ ...entry })))
  const [includeCorrupted, setIncludeCorrupted] = useState(true)
  const [includeMirrored, setIncludeMirrored] = useState(true)
  const [runeBehavior, setRuneBehavior] = useState<FindBetterAugmentBehavior>('copy-current')
  const [anointBehavior, setAnointBehavior] = useState<FindBetterAugmentBehavior>('copy-current')
  const [jewelType, setJewelType] = useState<'base' | 'radius'>('base')
  const [maxPrice, setMaxPrice] = useState('')
  const [maxPriceCurrency, setMaxPriceCurrency] = useState('divine')
  const [maxLevel, setMaxLevel] = useState('')
  const [sockets, setSockets] = useState('')
  const [fetchPages, setFetchPages] = useState(FETCH_PAGES_DEFAULT)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [weightsOpen, setWeightsOpen] = useState(false)
  const [selectedListingId, setSelectedListingId] = useState<string | null>(null)
  const [hideoutBusyId, setHideoutBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [uiScalePercent, setUiScalePercent] = useState(() => loadAppSettings().uiScalePercent)
  const [translationRevision, setTranslationRevision] = useState(0)
  const language = state?.language || 'en'
  const l = (en: string, zh: string, tw: string, ko: string) => uiText(language, en, zh, tw, ko)
  const draftKey = state?.draft ? String(state.generation) : ''
  const jewelSlot = Boolean(state?.slotName && /jewel/i.test(state.slotName))
  const augmentableSlot = Boolean(state?.slotName && /weapon|helmet|body armour|gloves|boots/i.test(state.slotName))
  const socketableSlot = Boolean(state?.slotName && !/jewel|flask|belt|ring|amulet|charm/i.test(state.slotName))
  const anointableSlot = Boolean(state?.slotName && /amulet/i.test(state.slotName))

  useEffect(() => {
    if (!bridge?.getState || !bridge.onState) return
    void bridge.getState().then(setState)
    return bridge.onState(setState)
  }, [bridge])

  useEffect(() => {
    let active = true
    void loadTranslations(language).catch(() => undefined).finally(() => { if (active) setTranslationRevision((value) => value + 1) })
    return () => { active = false }
  }, [language])

  useEffect(() => {
    const syncScale = () => setUiScalePercent(loadAppSettings().uiScalePercent)
    window.addEventListener('storage', syncScale)
    return () => window.removeEventListener('storage', syncScale)
  }, [])

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
    setUseBaseType(false)
  }, [draftKey, state?.initialLeagueId, state?.realm])

  useEffect(() => {
    // The coordinator increments generation for every window open, including
    // reopening the same equipped item. Reset only on that open transition so
    // changing controls inside the dialog does not unexpectedly clear them.
    if (!state || state.generation <= 0) return
    setWeights(DEFAULT_WEIGHTS.map((entry) => ({ ...entry })))
    setFetchPages(FETCH_PAGES_DEFAULT)
  }, [state?.generation])

  useEffect(() => {
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') void bridge?.hide?.() }
    addEventListener('keydown', key)
    return () => removeEventListener('keydown', key)
  }, [bridge])

  const busy = state?.phase === 'parsing' || state?.phase === 'searching' || state?.phase === 'fetching-page'
  const localizedName = state?.draft
    ? language === 'zh-rCN' ? (state.draft.localizedName || translateGameText(state.draft.name, language)) : translateGameText(state.draft.name, language)
    : undefined
  const localizedBase = state?.draft
    ? language === 'zh-rCN' ? (state.draft.localizedBaseType || translateGameText(state.draft.baseType, language)) : translateGameText(state.draft.baseType, language)
    : undefined
  const visibleError = localizedTradeError(error || state?.error, l)

  const visibleListings = useMemo(() => {
    if (!state?.listings) return []
    return state.listings
  }, [sortBy, state?.listings, translationRevision])

  const setWeight = (stat: PowerStat, value: number) => {
    setWeights((current) => {
      const next = current.filter((entry) => entry.stat !== stat.stat)
      if (value > 0) next.push({ stat: stat.stat, label: stat.en, weightMult: Number(value.toFixed(2)), ...(stat.lowerIsBetter ? { lowerIsBetter: true } : {}) })
      return next
    })
  }

  const weightFor = (stat: string) => weights.find((entry) => entry.stat === stat)?.weightMult || 0
  const runSearch = async () => {
    if (!bridge?.search || !state?.draft || !leagueId) return
    setError(null)
    const options: FindBetterSearchOptions = {
      sortBy,
      statWeights: weights.filter((entry) => entry.weightMult > 0),
      includeCorrupted,
      includeMirrored,
      runeBehavior,
      anointBehavior,
      fetchPages,
      ...(jewelSlot && !state.draft.unique ? { jewelType } : {}),
      ...(numeric(maxPrice) == null ? {} : { maxPrice: numeric(maxPrice) }),
      ...(maxPriceCurrency ? { maxPriceCurrency } : {}),
      ...(numeric(maxLevel) == null ? {} : { maxLevel: numeric(maxLevel) }),
      ...(numeric(sockets) == null ? {} : { sockets: numeric(sockets) }),
    }
    const criteria: TradePriceCheckCriteria = {
      listedStatus,
      // PoB2 weighted searches use the slot category by default, including
      // when the currently equipped item is unique. Matching its base type is
      // an explicit user choice and must not turn into a hidden type filter.
      useBaseType,
      modifiers: [],
      findBetter: options,
    }
    try { await bridge.search(leagueId, criteria) } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
  }

  const searchInTradeCenter = async () => {
    if (!state?.search || !bridge?.openInTradeCenter) return
    try { await bridge.openInTradeCenter(state.search.url) } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
  }

  const visitHideout = async (listingId: string) => {
    if (!bridge?.visitHideout) return
    setHideoutBusyId(listingId)
    try {
      const result = await bridge.visitHideout(listingId)
      if (!result.ok) setError(l('The game is offline.', '游戏未运行，请登录角色后再试。', '遊戲未執行，請登入角色後再試。', '게임이 실행 중이 아닙니다.'))
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setHideoutBusyId(null) }
  }

  return <main className="fb-shell">
    <header className="fb-titlebar">
      <div className="fb-title"><strong>{l('Find a better item', '寻找更好的装备', '尋找更好的裝備', '더 나은 장비 찾기')}</strong><span>{localizedName || l('Waiting for an equipped item', '等待已装备的装备', '等待已裝備的裝備', '장착한 아이템 대기 중')}{localizedBase ? ` · ${localizedBase}` : ''}{state?.slotName ? ` · ${state.slotName}` : ''}</span></div>
      <div className="fb-title-meta"><span>{state?.realm === 'cn' ? l('CN', '国服', '國服', '중국') : l('Global', '国际服', '國際服', '글로벌')}</span><button title={l('Close', '关闭', '關閉', '닫기')} onClick={() => void bridge?.hide?.()}><X /></button></div>
    </header>
    {!state || state.phase === 'idle' ? <div className="fb-empty">{l('Select Find a better item from an equipped item.', '请从已装备的装备中选择“找到更好的”。', '請從已裝備的裝備中選擇「找更好的」。', '장착한 장비에서 더 나은 장비 찾기를 선택하세요.')}</div> : null}
    {state?.draft && <>
      <section className="fb-context-bar">
        <div><span>{l('Active build', '当前构筑', '目前構築', '현재 빌드')}</span><b>{l('PoB2 weighted search', 'PoB2 加权搜索', 'PoB2 加權搜尋', 'PoB2 가중 검색')}</b></div>
        <div><span>{l('League', '当前赛季', '目前賽季', '현재 리그')}</span><select value={leagueId} onChange={(event) => setLeagueId(event.target.value)}>{state.leagues.map((league) => <option key={league.id} value={league.id}>{translateGameText(league.text, language)}</option>)}</select></div>
        <div><span>{l('Listed', '上架', '上架', '등록')}</span><select value={listedStatus} onChange={(event) => setListedStatus(event.target.value as TradeListedStatus)}><option value="securable">{l('Instant buyout', '一口价', '直購', '즉시 구매')}</option><option value="available">{l('Instant + in person', '一口价或当面', '直購或當面', '즉시 또는 직접 거래')}</option><option value="onlineleague">{l('Online in league', '赛季在线', '賽季在線', '리그 온라인')}</option><option value="online">{l('Online', '在线', '在線', '온라인')}</option><option value="any">{l('Any', '全部', '全部', '모두')}</option></select></div>
      </section>
      <section className="fb-workbench">
        <div className="fb-panel fb-options-panel">
          <header><div><Search /><strong>{l('Find best options', '寻找最佳选项', '尋找最佳選項', '최적 찾기 옵션')}</strong></div><span>{l('PoB2 Trader', 'PoB2 交易器', 'PoB2 交易器', 'PoB2 거래기')}</span></header>
           <div className="fb-option-grid">
             {augmentableSlot && <label><span>{l('Rune behavior', '符文处理', '符文處理', '룬 처리')}</span><select value={runeBehavior} onChange={(event) => setRuneBehavior(event.target.value as FindBetterAugmentBehavior)}>{(['copy-current', 'keep', 'remove'] as FindBetterAugmentBehavior[]).map((value) => <option key={value} value={value}>{behaviorLabel(value, l)}</option>)}</select></label>}
            {anointableSlot && <label><span>{l('Anoint behavior', '附魔处理', '附魔處理', '인챈트 처리')}</span><select value={anointBehavior} onChange={(event) => setAnointBehavior(event.target.value as FindBetterAugmentBehavior)}>{(['copy-current', 'keep', 'remove'] as FindBetterAugmentBehavior[]).map((value) => <option key={value} value={value}>{behaviorLabel(value, l)}</option>)}</select></label>}
            {jewelSlot && !state.draft.unique && <label><span>{l('Jewel type', '珠宝类型', '珠寶類型', '주얼 유형')}</span><select value={jewelType} onChange={(event) => setJewelType(event.target.value as 'base' | 'radius')}><option value="base">{l('Base', '基底珠宝', '基底珠寶', '기본')}</option><option value="radius">{l('Radius', '范围珠宝', '範圍珠寶', '반경')}</option></select></label>}
            <label><span>{l('Max price', '最高价格', '最高價格', '최대 가격')}</span><div className="fb-inline-input"><input value={maxPrice} onChange={(event) => setMaxPrice(event.target.value)} inputMode="decimal" placeholder="-" /><select value={maxPriceCurrency} onChange={(event) => setMaxPriceCurrency(event.target.value)}><option value="">{l('Equivalent', '等价', '等價', '등가')}</option>{PRICE_CURRENCY_OPTIONS.map((option) => <option key={option.id} value={option.id}>{uiText(language, option.en, option.zhCN, option.zhTW, option.ko)}</option>)}</select></div></label>
            <label><span>{l('Max item level', '最高物等', '最高物等', '최대 아이템 레벨')}</span><input value={maxLevel} onChange={(event) => setMaxLevel(event.target.value)} inputMode="numeric" placeholder="-" /></label>
             <label title={l('Official trade API limit: 1 to 10 pages, up to 10 items per page. It also enforces request-rate limits; SuperPoE throttles and retries temporary throttling.', '官方交易接口限制：1 到 10 页，每页最多 10 件装备；接口还有请求速率限制，SuperPoE 会控速并自动重试临时限流。', '官方交易介面限制：1 到 10 頁，每頁最多 10 件裝備；介面還有請求速率限制，SuperPoE 會控速並自動重試暫時限流。', '공식 거래 API 제한: 1~10페이지, 페이지당 최대 10개 아이템입니다. 요청 속도 제한도 있어 SuperPoE가 속도를 조절하고 일시적인 제한을 자동 재시도합니다.')}><span>{l('Fetch pages', '抓取页数', '擷取頁數', '가져올 페이지 수')}</span><input type="number" min={FETCH_PAGES_MIN} max={FETCH_PAGES_MAX} step="1" value={fetchPages} onChange={(event) => setFetchPages(clampFetchPages(event.target.value))} /></label>
             {socketableSlot && <label><span>{l('Empty sockets', '空插槽数', '空插槽數', '빈 소켓')}</span><input value={sockets} onChange={(event) => setSockets(event.target.value)} inputMode="numeric" placeholder="-" /></label>}
             <div className="fb-check-row">
               <label className="fb-check"><input type="checkbox" checked={includeCorrupted} onChange={(event) => setIncludeCorrupted(event.target.checked)} /><span>{l('Corrupted modifiers', '腐化词缀', '腐化詞綴', '타락 속성')}</span></label>
               <label className="fb-check"><input type="checkbox" checked={includeMirrored} onChange={(event) => setIncludeMirrored(event.target.checked)} /><span>{l('Mirrored items', '镜像装备', '鏡像裝備', '복제 아이템')}</span></label>
               <label className="fb-check"><input type="checkbox" checked={useBaseType} onChange={(event) => setUseBaseType(event.target.checked)} /><span>{l('Match current base type', '匹配当前底材', '匹配目前基底', '현재 베이스 유형 일치')}</span></label>
             </div>
          </div>
          <div className="fb-option-note"><Info />{l('Copy Current keeps the current rune/anoint context when PoB2 evaluates candidates. Keep searches for new ones; Remove excludes them. The official trade API allows 1 to 10 pages, with up to 10 items per page. It also enforces request-rate limits; SuperPoE throttles requests and retries temporary throttling.', '“复制当前”会让 PoB2 评估候选装备时保留当前符文/附魔上下文；“保留”搜索新的符文/附魔；“移除”则排除它们。官方交易接口支持抓取 1 到 10 页，每页最多 10 件装备；接口还有请求速率限制，SuperPoE 会控速并自动重试临时限流。', '「複製目前」會讓 PoB2 評估候選裝備時保留目前符文/附魔上下文；「保留」搜尋新的符文/附魔；「移除」則排除它們。官方交易介面支援擷取 1 到 10 頁，每頁最多 10 件裝備；介面還有請求速率限制，SuperPoE 會控速並自動重試暫時限流。', '현재 복사는 현재 룬/인챈트 문맥을 유지합니다. 유지는 새 항목을 검색하고 제거는 제외합니다. 공식 거래 API는 1~10페이지, 페이지당 최대 10개 아이템을 지원하며 요청 속도 제한이 있습니다. SuperPoE가 속도를 조절하고 일시적인 제한을 자동 재시도합니다.')}</div>
        </div>
        <div className="fb-panel fb-weights-panel">
          <header><div><SlidersHorizontal /><strong>{l('Adjust search weights', '调整搜索权重', '調整搜尋權重', '검색 가중치 조정')}</strong></div><button onClick={() => setWeights(DEFAULT_WEIGHTS.map((entry) => ({ ...entry })))} title={l('Reset weights', '重置权重', '重設權重', '가중치 초기화')}><RefreshCw /></button></header>
          <div className="fb-weight-summary"><span>{l('Active stats', '启用指标', '啟用指標', '활성 지표')}</span><b>{weights.length}</b><small>{weights.map((entry) => `${entry.label} × ${entry.weightMult.toFixed(2)}`).join(' · ')}</small></div>
          <button className="fb-weight-toggle" onClick={() => setWeightsOpen((value) => !value)}><span>{weightsOpen ? l('Hide all PoB2 power stats', '隐藏全部 PoB2 强度指标', '隱藏全部 PoB2 強度指標', '모든 PoB2 능력치 숨기기') : l('Show all PoB2 power stats', '显示全部 PoB2 强度指标', '顯示全部 PoB2 強度指標', '모든 PoB2 능력치 표시')}</span><ChevronDown className={weightsOpen ? 'open' : ''} /></button>
          {weightsOpen && <div className="fb-weight-list">{(['offence', 'defence', 'resource', 'mechanic'] as PowerStat['group'][]).map((group) => <section key={group}><h4>{group === 'offence' ? l('Offence', '攻击', '攻擊', '공격') : group === 'defence' ? l('Defence', '防御', '防禦', '방어') : group === 'resource' ? l('Resources', '资源', '資源', '자원') : l('Mechanics', '机制', '機制', '메커니즘')}</h4>{POWER_STATS.filter((stat) => stat.group === group).map((stat) => <label className="fb-weight-row" key={stat.stat}><span>{localizedStat(stat, language)}</span><input type="range" min="0" max="1" step=".01" value={weightFor(stat.stat)} onChange={(event) => setWeight(stat, Number(event.target.value))} /><output>{weightFor(stat.stat) ? weightFor(stat.stat).toFixed(2) : l('Off', '关闭', '關閉', '끔')}</output></label>)}</section>)}</div>}
        </div>
      </section>
      <section className="fb-search-row"><label><ArrowUpDown /><span>{l('Sort by', '排序方式', '排序方式', '정렬 기준')}</span><select value={sortBy} onChange={(event) => setSortBy(event.target.value as FindBetterSortMode)}>{SORT_MODES.map((mode) => <option key={mode.id} value={mode.id}>{language === 'zh-rCN' ? mode.zh : mode.en}</option>)}</select></label><span className="fb-sort-tip">{SORT_MODES.find((mode) => mode.id === sortBy)?.tip}</span><button className="fb-primary" disabled={busy || !leagueId || weights.length === 0} onClick={() => void runSearch()}><Search />{busy ? l('Calculating weights...', '正在计算权重...', '正在計算權重...', '가중치 계산 중...') : l('Find a better item', '寻找更好的装备', '尋找更好的裝備', '더 나은 장비 찾기')}</button>{state.search && <button className="fb-secondary" onClick={() => void searchInTradeCenter()}><ExternalLink />{l('Open in Market', '在集市打开', '在市集開啟', '거래소에서 열기')}</button>}</section>
      {state.captureWarnings?.length ? <div className="fb-warning"><Info /><span>{state.captureWarnings.join(' | ')}</span></div> : null}
    </>}
    {visibleError ? <div className="fb-error">{visibleError}</div> : null}
    {state?.search && <section className="fb-results">
      <header><div><strong>{l('Candidate items', '候选装备', '候選裝備', '후보 아이템')}</strong><span>{l(`Fetched ${fetchedResultCount(state.search)} / ${state.search.total} results`, `已抓取 ${fetchedResultCount(state.search)} / ${state.search.total} 条结果`, `已抓取 ${fetchedResultCount(state.search)} / ${state.search.total} 筆結果`, `${fetchedResultCount(state.search)} / ${state.search.total}개 결과 가져옴`)}</span></div><small>{l('Generated by PoB2 weighted query', '由 PoB2 加权查询生成', '由 PoB2 加權查詢產生', 'PoB2 가중 쿼리로 생성됨')}</small></header>
      {visibleListings.length ? visibleListings.map((listing, index) => <article className={selectedListingId === listing.id ? 'selected' : ''} key={listing.id}>
        <div className="fb-result-rank">{index + 1}</div><div className="fb-result-copy"><div><b>{localizedPrice(listing.price, language, l)}</b>{listing.tradeScore != null && Number.isFinite(listing.tradeScore) && <span className="fb-trade-score" title={l('PoB2 local score', 'PoB2 本地评分', 'PoB2 本地評分', 'PoB2 로컬 점수')}>{l('Score', '评分', '評分', '점수')} {listing.tradeScore.toFixed(3)}</span>}<span className={`fb-seller-status ${listing.seller.status}`}>{listing.seller.status}</span><span>{listing.seller.accountName || l('Unknown seller', '未知卖家', '未知賣家', '알 수 없는 판매자')}</span></div><strong>{listing.item.name}</strong><small>{listing.item.baseType} · {listedTime(listing.listedAt, l)}</small></div><div className="fb-result-actions"><button disabled={!listing.hideoutAvailable || hideoutBusyId === listing.id} onClick={() => void visitHideout(listing.id)} title={l('Visit hideout', '前往藏身处', '前往藏身處', '은신처 방문')}><Home /></button><button className={selectedListingId === listing.id ? 'active' : ''} onClick={() => { setSelectedListingId(listing.id); void bridge?.showDetail?.(listing.id) }} title={l('View details', '查看详情', '查看詳情', '상세 보기')}><List /></button></div>
      </article>) : <div className="fb-empty compact">{l('No candidates on this page.', '本页没有候选装备。', '本頁沒有候選裝備。', '이 페이지에 후보 아이템이 없습니다.')}</div>}
      <footer><button disabled={state.search.page <= 1 || busy} onClick={() => void bridge?.fetchPage?.(state.search!.page - 1)}><ChevronLeft /></button><span>{state.search.page} / {state.search.pageCount}</span><button disabled={state.search.page >= state.search.pageCount || busy} onClick={() => void bridge?.fetchPage?.(state.search!.page + 1)}><ChevronRight /></button></footer>
    </section>}
  </main>
}

export function FindBetterApp() {
  const bridge = window.superpoeFindBetter
  const [state, setState] = useState<PriceCheckContextState | null>(null)
  const [leagueId, setLeagueId] = useState('')
  const [listedStatus, setListedStatus] = useState<TradeListedStatus>('securable')
  const [useBaseType, setUseBaseType] = useState(false)
  const [sortBy, setSortBy] = useState<FindBetterSortMode>('stat-value')
  const [weights, setWeights] = useState<FindBetterStatWeight[]>(() => DEFAULT_WEIGHTS.map((entry) => ({ ...entry })))
  const [includeCorrupted, setIncludeCorrupted] = useState(true)
  const [includeMirrored, setIncludeMirrored] = useState(true)
  const [runeBehavior, setRuneBehavior] = useState<FindBetterAugmentBehavior>('copy-current')
  const [anointBehavior, setAnointBehavior] = useState<FindBetterAugmentBehavior>('copy-current')
  const [jewelType, setJewelType] = useState<'base' | 'radius'>('base')
  const [maxPrice, setMaxPrice] = useState('')
  const [maxPriceCurrency, setMaxPriceCurrency] = useState('divine')
  const [maxLevel, setMaxLevel] = useState('')
  const [sockets, setSockets] = useState('')
  const [fetchPages, setFetchPages] = useState(FETCH_PAGES_DEFAULT)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [weightsOpen, setWeightsOpen] = useState(false)
  const [selectedListingId, setSelectedListingId] = useState<string | null>(null)
  const [hideoutBusyId, setHideoutBusyId] = useState<string | null>(null)
  const [savedListingIds, setSavedListingIds] = useState<Set<string>>(() => new Set())
  const [saveBusyId, setSaveBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [uiScalePercent, setUiScalePercent] = useState(() => loadAppSettings().uiScalePercent)
  const [translationRevision, setTranslationRevision] = useState(0)
  const language = state?.language || 'en'
  const l = (en: string, zh: string, tw: string, ko: string) => uiText(language, en, zh, tw, ko)
  const draftKey = state?.draft ? String(state.generation) : ''
  const jewelSlot = Boolean(state?.slotName && /jewel/i.test(state.slotName))
  const augmentableSlot = Boolean(state?.slotName && /weapon|helmet|body armour|gloves|boots/i.test(state.slotName))
  const socketableSlot = Boolean(state?.slotName && !/jewel|flask|belt|ring|amulet|charm/i.test(state.slotName))
  const anointableSlot = Boolean(state?.slotName && /amulet/i.test(state.slotName))
  const busy = state?.phase === 'parsing' || state?.phase === 'searching' || state?.phase === 'fetching-page'
  const localizedName = state?.draft
    ? language === 'zh-rCN' ? (state.draft.localizedName || translateGameText(state.draft.name, language)) : translateGameText(state.draft.name, language)
    : undefined
  const localizedBase = state?.draft
    ? language === 'zh-rCN' ? (state.draft.localizedBaseType || translateGameText(state.draft.baseType, language)) : translateGameText(state.draft.baseType, language)
    : undefined
  const selectedListing = useMemo(() => state?.listings.find((listing) => listing.id === selectedListingId), [selectedListingId, state?.listings])
  const differenceContext = useMemo<BuildContextSnapshot | null>(() => {
    const context = state?.buildContext
    if (!context?.xml) return null
    return {
      xml: context.xml,
      buildRevision: context.buildRevision ?? 0,
      activeItemSetId: context.activeItemSetId ?? '',
      activeWeaponSet: context.activeWeaponSet ?? 1,
      buildItemId: context.buildItemId,
      configOverrides: context.configOverrides,
    }
  }, [state?.buildContext])
  const visibleError = localizedTradeError(error || state?.error, l)

  useEffect(() => {
    if (!bridge?.getState || !bridge.onState) return
    void bridge.getState().then(setState)
    return bridge.onState(setState)
  }, [bridge])

  useEffect(() => {
    let active = true
    void loadTranslations(language).catch(() => undefined).finally(() => { if (active) setTranslationRevision((value) => value + 1) })
    return () => { active = false }
  }, [language])

  useEffect(() => {
    const syncScale = () => setUiScalePercent(loadAppSettings().uiScalePercent)
    window.addEventListener('storage', syncScale)
    return () => window.removeEventListener('storage', syncScale)
  }, [])

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
  }, [bridge, uiScalePercent])

  useEffect(() => {
    if (!state?.draft) return
    setLeagueId(state.leagues.some((league) => league.id === state.initialLeagueId) ? state.initialLeagueId! : state.leagues[0]?.id || '')
    setUseBaseType(false)
  }, [draftKey, state?.initialLeagueId, state?.realm])

  useEffect(() => {
    // The coordinator increments generation for every window open, including
    // reopening the same equipped item. Reset weights on that open transition
    // so each search starts from the documented defaults.
    if (!state || state.generation <= 0) return
    setWeights(DEFAULT_WEIGHTS.map((entry) => ({ ...entry })))
    setFetchPages(FETCH_PAGES_DEFAULT)
  }, [state?.generation])

  useEffect(() => {
    if (!state?.search) return
    setSelectedListingId((current) => current && state.listings.some((listing) => listing.id === current) ? current : state.listings[0]?.id || null)
  }, [state?.search?.contextId, state?.search?.page, state?.listings])

  useEffect(() => {
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') void bridge?.hide?.() }
    addEventListener('keydown', key)
    return () => removeEventListener('keydown', key)
  }, [bridge])

  const setWeight = (stat: PowerStat, value: number) => {
    setWeights((current) => {
      const next = current.filter((entry) => entry.stat !== stat.stat)
      if (value > 0) next.push({ stat: stat.stat, label: stat.en, weightMult: Number(value.toFixed(2)), ...(stat.lowerIsBetter ? { lowerIsBetter: true } : {}) })
      return next
    })
  }
  const weightFor = (stat: string) => weights.find((entry) => entry.stat === stat)?.weightMult || 0
  const runSearch = async () => {
    if (!bridge?.search || !state?.draft || !leagueId) return
    setError(null)
    const options: FindBetterSearchOptions = {
      sortBy,
      statWeights: weights.filter((entry) => entry.weightMult > 0),
      includeCorrupted,
      includeMirrored,
      runeBehavior,
      anointBehavior,
      fetchPages,
      ...(jewelSlot && !state.draft.unique ? { jewelType } : {}),
      ...(numeric(maxPrice) == null ? {} : { maxPrice: numeric(maxPrice) }),
      ...(maxPriceCurrency ? { maxPriceCurrency } : {}),
      ...(numeric(maxLevel) == null ? {} : { maxLevel: numeric(maxLevel) }),
      ...(numeric(sockets) == null ? {} : { sockets: numeric(sockets) }),
    }
    const criteria: TradePriceCheckCriteria = {
      listedStatus,
      // PoB2 weighted searches use the slot category by default, including
      // when the currently equipped item is unique. Matching its base type is
      // an explicit user choice and must not turn into a hidden type filter.
      useBaseType,
      modifiers: [],
      findBetter: options,
    }
    try { await bridge.search(leagueId, criteria) } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
  }

  const searchInTradeCenter = async () => {
    if (!state?.search || !bridge?.openInTradeCenter) return
    try { await bridge.openInTradeCenter(state.search.url) } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
  }

  const visitHideout = async (listingId: string) => {
    if (!bridge?.visitHideout) return
    setHideoutBusyId(listingId)
    try {
      const result = await bridge.visitHideout(listingId)
      if (!result.ok) setError(l('The game is offline.', '游戏未运行，请登录角色后再试。', '遊戲未執行，請登入角色後再試。', '게임이 실행 중이 아닙니다.'))
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setHideoutBusyId(null) }
  }

  const saveListing = async (listingId: string) => {
    if (!bridge?.favorite || savedListingIds.has(listingId)) return
    setSaveBusyId(listingId)
    try {
      await bridge.favorite(listingId)
      setSavedListingIds((current) => new Set(current).add(listingId))
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setSaveBusyId(null) }
  }

  const statGroupLabel = (group: PowerStat['group']) => group === 'offence'
    ? l('Offence', '攻击', '攻擊', '공격')
    : group === 'defence' ? l('Defence', '防御', '防禦', '방어')
      : group === 'resource' ? l('Resources', '资源', '資源', '자원')
        : l('Mechanics', '机制', '機制', '메커니즘')

  const activeWeightSummary = weights.map((entry) => {
    const stat = POWER_STATS.find((candidate) => candidate.stat === entry.stat)
    return `${stat ? localizedStat(stat, language) : entry.label} × ${entry.weightMult.toFixed(2)}`
  }).join(' · ')

  return <main className="fb-dialog">
    <header className="fb-dialog-titlebar">
      <div className="fb-dialog-title"><strong>{l('Find a better item', '找到更好的装备', '找更好的裝備', '더 나은 장비 찾기')}</strong><span>{localizedName || l('Waiting for an equipped item', '等待已装备的装备', '等待已裝備的裝備', '장착한 아이템 대기 중')}{localizedBase ? ` · ${localizedBase}` : ''}{state?.slotName ? ` · ${state.slotName}` : ''}</span></div>
      <div className="fb-dialog-title-meta"><span>{state?.realm === 'cn' ? l('CN', '国服', '國服', '중국') : l('Global', '国际服', '國際服', '글로벌')}</span><button title={l('Close', '关闭', '關閉', '닫기')} onClick={() => void bridge?.hide?.()}><X /></button></div>
    </header>
    <div className="fb-dialog-body">
      <section className="fb-main-area">
        <div className="fb-command-bar">
          <div className="fb-command-summary">
            <div><Coins className="fb-command-coin" aria-hidden="true" /><strong>{l('Search workspace', '搜索工作区', '搜尋工作區', '검색 작업 공간')}</strong><span>{state?.search ? `${state.search.total} ${l('candidate items', '个候选装备', '個候選裝備', '개 후보 아이템')}` : l('Ready to compare against the current build', '准备按当前构筑进行比较', '準備按目前構築進行比較', '현재 빌드와 비교할 준비가 되었습니다')}</span></div>
            <small>{weights.length ? activeWeightSummary : l('No active weights', '没有启用的权重', '沒有啟用的權重', '활성 가중치 없음')}</small>
          </div>
          <div className="fb-command-actions">
            <div className="fb-priority-controls">
              <label className="fb-priority-field"><span><ArrowUpDown />{l('Sort by', '排序方式', '排序方式', '정렬 기준')}</span><select value={sortBy} onChange={(event) => setSortBy(event.target.value as FindBetterSortMode)}>{SORT_MODES.map((mode) => <option key={mode.id} value={mode.id}>{language === 'zh-rCN' ? mode.zh : mode.en}</option>)}</select></label>
              <label className="fb-priority-field"><span>{l('Max price', '最高价格', '最高價格', '최대 가격')}</span><div className="fb-inline-input"><input value={maxPrice} onChange={(event) => setMaxPrice(event.target.value)} inputMode="decimal" placeholder="-" /><select value={maxPriceCurrency} onChange={(event) => setMaxPriceCurrency(event.target.value)}><option value="">{l('Equivalent', '等价', '等價', '등가')}</option>{PRICE_CURRENCY_OPTIONS.map((option) => <option key={option.id} value={option.id}>{uiText(language, option.en, option.zhCN, option.zhTW, option.ko)}</option>)}</select></div></label>
            </div>
            <button className={`fb-settings-trigger${settingsOpen ? ' open' : ''}`} aria-expanded={settingsOpen} onClick={() => setSettingsOpen((value) => !value)}><SlidersHorizontal />{l('Search settings', '搜索设置', '搜尋設定', '검색 설정')}<small>{weights.length}</small><ChevronDown className={settingsOpen ? 'open' : ''} /></button>
            {state?.search && <button className="fb-secondary" onClick={() => void searchInTradeCenter()}><ExternalLink />{l('Open in Market', '在集市打开', '在市集開啟', '거래소에서 열기')}</button>}
            <button key={state?.generation ?? 0} className="fb-primary fb-find-better-button" disabled={busy || !leagueId || weights.length === 0 || !state?.draft} onClick={() => { setSettingsOpen(false); void runSearch() }}><Search />{busy ? l('Calculating...', '正在计算...', '正在計算...', '계산 중...') : l('Find better', '找到更好', '找更好', '더 나은 장비 찾기')}</button>
          </div>
        </div>
        {settingsOpen && <section className="fb-settings-panel">
          <div className="fb-settings-section">
            <header><div><Search /><strong>{l('Search conditions', '查询条件', '查詢條件', '검색 조건')}</strong></div><div className="fb-settings-header-actions"><span>{l('Infrequent settings', '低频设置', '低頻設定', '낮은 빈도의 설정')}</span><button className="fb-weight-launch" onClick={() => setWeightsOpen(true)}><SlidersHorizontal />{l('Adjust weights', '调整权重', '調整權重', '가중치 조정')}<small>{weights.length}</small></button></div></header>
            {!state?.draft ? <div className="fb-empty compact">{l('Waiting for the equipped item context.', '等待已装备装备的上下文。', '等待已裝備裝備的上下文。', '장착한 아이템 정보를 기다리는 중입니다.')}</div> : <>
              <div className="fb-context-grid"><label><span>{l('League', '当前赛季', '目前賽季', '현재 리그')}</span><select value={leagueId} onChange={(event) => setLeagueId(event.target.value)}>{state.leagues.map((league) => <option key={league.id} value={league.id}>{translateGameText(league.text, language)}</option>)}</select></label><label><span>{l('Listed', '上架', '上架', '등록')}</span><select value={listedStatus} onChange={(event) => setListedStatus(event.target.value as TradeListedStatus)}><option value="securable">{l('Instant buyout', '一口价', '直購', '즉시 구매')}</option><option value="available">{l('Instant + in person', '一口价或当面', '直購或當面', '즉시 또는 직접 거래')}</option><option value="onlineleague">{l('Online in league', '赛季在线', '賽季在線', '리그 온라인')}</option><option value="online">{l('Online', '在线', '在線', '온라인')}</option><option value="any">{l('Any', '全部', '全部', '모두')}</option></select></label></div>
              <div className="fb-option-grid">
                {augmentableSlot && <label><span>{l('Rune behavior', '符文处理', '符文處理', '룬 처리')}</span><select value={runeBehavior} onChange={(event) => setRuneBehavior(event.target.value as FindBetterAugmentBehavior)}>{(['copy-current', 'keep', 'remove'] as FindBetterAugmentBehavior[]).map((value) => <option key={value} value={value}>{behaviorLabel(value, l)}</option>)}</select></label>}
                {anointableSlot && <label><span>{l('Anoint behavior', '附魔处理', '附魔處理', '인챈트 처리')}</span><select value={anointBehavior} onChange={(event) => setAnointBehavior(event.target.value as FindBetterAugmentBehavior)}>{(['copy-current', 'keep', 'remove'] as FindBetterAugmentBehavior[]).map((value) => <option key={value} value={value}>{behaviorLabel(value, l)}</option>)}</select></label>}
                {jewelSlot && !state.draft.unique && <label><span>{l('Jewel type', '珠宝类型', '珠寶類型', '주얼 유형')}</span><select value={jewelType} onChange={(event) => setJewelType(event.target.value as 'base' | 'radius')}><option value="base">{l('Base', '基底珠宝', '基底珠寶', '기본')}</option><option value="radius">{l('Radius', '范围珠宝', '範圍珠寶', '반경')}</option></select></label>}
                 <label><span>{l('Max item level', '最高物等', '最高物等', '최대 아이템 레벨')}</span><input value={maxLevel} onChange={(event) => setMaxLevel(event.target.value)} inputMode="numeric" placeholder="-" /></label>
                 <label title={l('Official trade API limit: 1 to 10 pages, up to 10 items per page. It also enforces request-rate limits; SuperPoE throttles and retries temporary throttling.', '官方交易接口限制：1 到 10 页，每页最多 10 件装备；接口还有请求速率限制，SuperPoE 会控速并自动重试临时限流。', '官方交易介面限制：1 到 10 頁，每頁最多 10 件裝備；介面還有請求速率限制，SuperPoE 會控速並自動重試暫時限流。', '공식 거래 API 제한: 1~10페이지, 페이지당 최대 10개 아이템입니다. 요청 속도 제한도 있어 SuperPoE가 속도를 조절하고 일시적인 제한을 자동 재시도합니다.')}><span>{l('Fetch pages', '抓取页数', '擷取頁數', '가져올 페이지 수')}</span><input type="number" min={FETCH_PAGES_MIN} max={FETCH_PAGES_MAX} step="1" value={fetchPages} onChange={(event) => setFetchPages(clampFetchPages(event.target.value))} /></label>
                 {socketableSlot && <label><span>{l('Empty sockets', '空插槽数', '空插槽數', '빈 소켓')}</span><input value={sockets} onChange={(event) => setSockets(event.target.value)} inputMode="numeric" placeholder="-" /></label>}
                 <div className="fb-check-row">
                   <label className="fb-check"><input type="checkbox" checked={includeCorrupted} onChange={(event) => setIncludeCorrupted(event.target.checked)} /><span>{l('Corrupted modifiers', '腐化词缀', '腐化詞綴', '타락 속성')}</span></label>
                   <label className="fb-check"><input type="checkbox" checked={includeMirrored} onChange={(event) => setIncludeMirrored(event.target.checked)} /><span>{l('Mirrored items', '镜像装备', '鏡像裝備', '복제 아이템')}</span></label>
                   <label className="fb-check"><input type="checkbox" checked={useBaseType} onChange={(event) => setUseBaseType(event.target.checked)} /><span>{l('Match current base type', '匹配当前底材', '匹配目前基底', '현재 베이스 유형 일치')}</span></label>
                 </div>
              </div>
              <div className="fb-option-note"><Info />{l('Candidate scores and differences are calculated against the current build. The build is not changed. The official trade API allows 1 to 10 pages, with up to 10 items per page. It also enforces request-rate limits; SuperPoE throttles requests and retries temporary throttling.', '候选评分和差异均按当前构筑计算，不会修改当前构筑。官方交易接口支持抓取 1 到 10 页，每页最多 10 件装备；接口还有请求速率限制，SuperPoE 会控速并自动重试临时限流。', '候選評分和差異均按目前構築計算，不會修改目前構築。官方交易介面支援擷取 1 到 10 頁，每頁最多 10 件裝備；介面還有請求速率限制，SuperPoE 會控速並自動重試暫時限流。', '후보 점수와 차이는 현재 빌드 기준이며 빌드는 변경되지 않습니다. 공식 거래 API는 1~10페이지, 페이지당 최대 10개 아이템을 지원하며 요청 속도 제한이 있습니다. SuperPoE가 속도를 조절하고 일시적인 제한을 자동 재시도합니다.')}</div>
            </>}
          </div>
        </section>}
        {visibleError ? <div className="fb-error">{visibleError}</div> : null}
        {state?.captureWarnings?.length ? <div className="fb-warning"><Info /><span>{state.captureWarnings.join(' | ')}</span></div> : null}
        <div className="fb-browser-grid">
          <section className="fb-results-pane">
            <header className="fb-results-header"><div><strong>{l('Candidate items', '候选装备', '候選裝備', '후보 아이템')}</strong><span>{state?.search ? l(`Fetched ${fetchedResultCount(state.search)} / ${state.search.total} results`, `已抓取 ${fetchedResultCount(state.search)} / ${state.search.total} 条结果`, `已抓取 ${fetchedResultCount(state.search)} / ${state.search.total} 筆結果`, `${fetchedResultCount(state.search)} / ${state.search.total}개 결과 가져옴`) : l('Run a search to compare items', '执行查询后比较装备', '執行查詢後比較裝備', '검색을 실행하면 장비를 비교합니다')}</span></div><small>{l('Select an item to inspect its full stats and difference.', '选择装备查看完整属性和差异。', '選擇裝備查看完整屬性和差異。', '아이템을 선택하면 전체 속성과 차이를 확인합니다.')}</small></header>
            <div className="fb-results-scroll">
              {state?.search && state.listings.length > 0 ? <div className="fb-result-grid">{state.listings.map((listing, index) => <article className={`fb-result-card${selectedListingId === listing.id ? ' selected' : ''}`} key={listing.id}>
                <button className="fb-result-card-main" onClick={() => setSelectedListingId(listing.id)} aria-pressed={selectedListingId === listing.id}>
                  <span className="fb-result-card-rank">{index + 1}</span><span className="fb-result-card-icon">{listing.item.iconUrl ? <img src={listing.item.iconUrl} alt="" /> : <List />}</span>
                  <span className="fb-result-card-copy"><strong>{equipmentItemName(listing.item, language)}</strong><small>{equipmentItemBaseType(listing.item, language)}</small><em>{listing.item.rarity} · {listedTime(listing.listedAt, l)}</em></span>
              <span className="fb-result-card-price"><Coins aria-hidden="true" />{localizedPrice(listing.price, language, l)}</span>
                  {listing.tradeScore != null && Number.isFinite(listing.tradeScore) && <span className="fb-result-card-score">{l('Score', '评分', '評分', '점수')} {listing.tradeScore.toFixed(3)}</span>}
                  <span className="fb-result-card-metrics"><span><b>{l('Weapon DPS', '武器 DPS', '武器 DPS', '무기 DPS')}</b>{listing.candidateMetrics?.weaponDps == null ? '--' : formatUiNumber(listing.candidateMetrics.weaponDps, language, { maximumFractionDigits: 1 })}</span><span><b>{l('Final DPS', '最终 DPS', '最終 DPS', '최종 DPS')}</b>{candidateDelta(listing.candidateMetrics?.fullDpsDelta, listing.candidateMetrics?.fullDpsPercent, language)}</span><span><b>{l('Final EHP', '最终 EHP', '最終 EHP', '최종 EHP')}</b>{candidateDelta(listing.candidateMetrics?.totalEhpDelta, listing.candidateMetrics?.totalEhpPercent, language)}</span></span>
                </button>
                <div className="fb-result-card-actions"><button disabled={!listing.hideoutAvailable || hideoutBusyId === listing.id} onClick={() => void visitHideout(listing.id)} title={l('Visit hideout', '前往藏身处', '前往藏身處', '은신처 방문')}><Home /></button><button disabled={saveBusyId === listing.id || savedListingIds.has(listing.id)} onClick={() => void saveListing(listing.id)} title={savedListingIds.has(listing.id) ? l('Saved to equipment library', '已收藏到装备仓库', '已收藏到裝備倉庫', '장비 라이브러리에 저장됨') : l('Save to equipment library', '收藏到装备仓库', '收藏到裝備倉庫', '장비 라이브러리에 저장')}>{savedListingIds.has(listing.id) ? <Check /> : <BookmarkPlus />}</button><button className={selectedListingId === listing.id ? 'active' : ''} onClick={() => setSelectedListingId(listing.id)} title={l('View details and difference', '查看详情和差异', '查看詳情和差異', '상세 및 차이 보기')}><List /></button></div>
              </article>)}</div> : <div className="fb-results-empty">{busy ? l('Fetching candidate items...', '正在获取候选装备...', '正在取得候選裝備...', '후보 아이템을 가져오는 중...') : state?.search ? l('No candidates on this page.', '本页没有候选装备。', '本頁沒有候選裝備。', '이 페이지에 후보 아이템이 없습니다.') : l('Search results will appear here.', '查询结果会显示在这里。', '查詢結果會顯示在這裡。', '검색 결과가 여기에 표시됩니다.')}</div>}
            </div>
            {state?.search && <footer className="fb-results-footer"><button disabled={state.search.page <= 1 || busy} onClick={() => void bridge?.fetchPage?.(state.search!.page - 1)}><ChevronLeft /></button><span>{state.search.page} / {state.search.pageCount}</span><button disabled={state.search.page >= state.search.pageCount || busy} onClick={() => void bridge?.fetchPage?.(state.search!.page + 1)}><ChevronRight /></button></footer>}
          </section>
          <aside className="fb-detail-column">
            {selectedListing ? <section className="fb-selected-detail"><header><div><strong>{l('Item details and difference', '装备属性与差异', '裝備屬性與差異', '아이템 속성 및 차이')}</strong><span>{selectedListing.seller.accountName || l('Unknown seller', '未知卖家', '未知賣家', '알 수 없는 판매자')} · {selectedListing.seller.status} · {selectedListing.price?.display || l('No price', '未标价', '未標價', '가격 없음')}</span></div><button onClick={() => setSelectedListingId(null)} title={l('Clear selection', '清除选择', '清除選擇', '선택 지우기')}><X /></button></header><EquipmentItemInspector view={selectedListing.item} language={language} sourceLabels={[l('Market listing', '集市商品', '市集商品', '거래소 매물')]} price={selectedListing.price?.display} showQuickNavigation footer={differenceContext && selectedListing.raw ? <EquipmentDifferenceTooltip context={differenceContext} candidate={{ raw: selectedListing.raw, source: 'market-listing' }} language={language} sourceSlotName={state?.slotName} slotOnlyTooltips={false} /> : <div className="fb-no-difference">{l('Build context is unavailable for difference calculation.', '缺少构筑上下文，无法计算装备差异。', '缺少構築上下文，無法計算裝備差異。', '차이 계산에 필요한 빌드 정보가 없습니다.')}</div>} /></section> : <div className="fb-detail-empty"><List /><strong>{l('Select a candidate item', '选择一个候选装备', '选择一个候选装备', '후보 아이템을 선택하세요')}</strong><span>{l('Its full modifiers and the PoB2 difference will stay visible here while you browse.', '浏览候选装备时，完整词缀和 PoB2 差异会固定显示在这里。', '瀏覽候選裝備時，完整詞綴和 PoB2 差異會固定顯示在這裡。', '후보를 탐색하는 동안 전체 속성과 PoB2 차이가 여기에 표시됩니다.')}</span></div>}
          </aside>
        </div>
        {weightsOpen && <div className="fb-weight-overlay" role="presentation" onMouseDown={() => setWeightsOpen(false)}>
          <section className="fb-weight-modal" role="dialog" aria-modal="true" aria-label={l('Adjust search weights', '调整搜索权重', '調整搜尋權重', '검색 가중치 조정')} onMouseDown={(event) => event.stopPropagation()}>
            <header><div><SlidersHorizontal /><strong>{l('Adjust search weights', '调整搜索权重', '調整搜尋權重', '검색 가중치 조정')}</strong><small>{l('Used to rank candidate items locally.', '用于本地计算候选装备排序。', '用於本地計算候選裝備排序。', '후보 아이템의 로컬 순위 계산에 사용됩니다.')}</small></div><button onClick={() => setWeightsOpen(false)} title={l('Close', '关闭', '關閉', '닫기')}><X /></button></header>
            <div className="fb-weight-modal-summary"><span>{l('Active stats', '启用指标', '啟用指標', '활성 지표')}</span><b>{weights.length}</b><small>{activeWeightSummary || l('No active stats', '没有启用指标', '沒有啟用指標', '활성 지표 없음')}</small></div>
            <div className="fb-weight-modal-list">{(['offence', 'defence', 'resource', 'mechanic'] as PowerStat['group'][]).map((group) => <section key={group}><h4>{statGroupLabel(group)}</h4>{POWER_STATS.filter((stat) => stat.group === group).map((stat) => <label className="fb-weight-row" key={stat.stat}><span>{localizedStat(stat, language)}</span><input type="range" min="0" max="1" step=".01" value={weightFor(stat.stat)} onChange={(event) => setWeight(stat, Number(event.target.value))} /><output>{weightFor(stat.stat) ? weightFor(stat.stat).toFixed(2) : l('Off', '关闭', '關閉', '끔')}</output></label>)}</section>)}</div>
            <footer><button className="fb-weight-reset" onClick={() => setWeights(DEFAULT_WEIGHTS.map((entry) => ({ ...entry })))}><RefreshCw />{l('Reset defaults', '恢复默认', '恢復預設', '기본값 복원')}</button><button className="fb-primary" onClick={() => setWeightsOpen(false)}>{l('Done', '完成', '完成', '완료')}</button></footer>
          </section>
        </div>}
      </section>
    </div>
  </main>
}
