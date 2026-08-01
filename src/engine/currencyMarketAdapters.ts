import type {
  CurrencyMarketItem,
  CurrencyMarketSnapshot,
  Poe2ScoutDetails,
  PoecurrencyDetails,
} from '../types/currencyMarket.js'

type UnknownRecord = Record<string, unknown>

const CATEGORY_LABELS: Record<string, string> = {
  currency: '通货',
  fragment: '碎片',
  fragments: '碎片',
  rune: '符文',
  runes: '符文',
  essence: '精华',
  essences: '精华',
  expedition: '探险',
  ritual: '祭祀',
  delirium: '迷雾',
  breach: '裂隙',
  abyss: '深渊',
  idol: '雕像',
  incursion: '穿越',
  lineagesupportgems: '血脉辅助宝石',
  ultimatum: '终极迷局',
  uncutgems: '未切割宝石',
  vaal: '瓦尔',
  vaultkeys: '宝库钥匙',
  verisium: '维里西姆',
}

function record(value: unknown): UnknownRecord | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : undefined
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function positive(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined
}

function finite(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function boolean(value: unknown): boolean {
  return value === true
}

function stableId(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/[^a-z0-9\u3400-\u9fff]+/g, '-')
}

function geometricMean(left?: number, right?: number): number | undefined {
  if (left && right) return Math.sqrt(left * right)
  return left || right
}

function choosePoecurrencyPrice(item: UnknownRecord): number | undefined {
  const buyAverage = positive(item.buy_avg)
  const sellAverage = positive(item.sell_avg)
  const latestBuy = positive(item.latest_buy1)
  const latestSell = positive(item.latest_sell1)
  const average = geometricMean(buyAverage, sellAverage)
  const latest = geometricMean(latestBuy, latestSell)

  if (average && latest) {
    const spread = Math.max(average, latest) / Math.min(average, latest)
    if (spread <= 5) return geometricMean(average, latest)
  }
  return average || latest || buyAverage || sellAverage || latestBuy || latestSell
}

function findPoecurrencyItem(categories: unknown[], englishName: string): UnknownRecord | undefined {
  for (const rawCategory of categories) {
    const category = record(rawCategory)
    if (!category || !Array.isArray(category.items)) continue
    const match = category.items.map(record).find((item) => item && text(item.engname)?.toLocaleLowerCase() === englishName.toLocaleLowerCase())
    if (match) return match
  }
  return undefined
}

function convertPoecurrencyPrice(value: number | undefined, unit: string, divineInExalted?: number, chaosInExalted?: number): number | undefined {
  if (!value) return undefined
  if (unit === 'e') return value
  if (unit === 'd' && divineInExalted) return value * divineInExalted
  if (unit === 'c' && chaosInExalted) return value * chaosInExalted
  return undefined
}

export function normalizePoecurrencySummary(payload: unknown, fetchedAt = new Date().toISOString()): CurrencyMarketSnapshot {
  const categories = Array.isArray(payload) ? payload : []
  if (!categories.length) throw new Error('poecurrency.top returned no categories')

  const divineRaw = findPoecurrencyItem(categories, 'Divine Orb')
  const divineInExalted = divineRaw && text(divineRaw.currency_unit)?.toLocaleLowerCase() === 'e'
    ? choosePoecurrencyPrice(divineRaw)
    : undefined
  const chaosRaw = findPoecurrencyItem(categories, 'Chaos Orb')
  const chaosUnit = chaosRaw ? text(chaosRaw.currency_unit)?.toLocaleLowerCase() || 'e' : 'e'
  const chaosQuote = chaosRaw ? choosePoecurrencyPrice(chaosRaw) : undefined
  const chaosInExalted = chaosUnit === 'e' ? chaosQuote : chaosUnit === 'd' && divineInExalted && chaosQuote
    ? chaosQuote * divineInExalted
    : undefined

  const items: CurrencyMarketItem[] = []
  let latestSourceTime: string | undefined
  for (const rawCategory of categories) {
    const category = record(rawCategory)
    if (!category || !Array.isArray(category.items)) continue
    const categoryLabel = text(category.category_label) || '其他'
    const categoryId = stableId(categoryLabel) || 'other'
    for (const rawItem of category.items) {
      const item = record(rawItem)
      if (!item) continue
      const name = text(item.item_name)
      const englishName = text(item.engname)
      if (!name && !englishName) continue
      const quote = choosePoecurrencyPrice(item)
      const unit = text(item.currency_unit)?.toLocaleLowerCase() || 'e'
      const priceExalted = convertPoecurrencyPrice(quote, unit, divineInExalted, chaosInExalted)
      const error = boolean(item.error)
      const anomalyCount = finite(item.anomaly_count)
      const updatedAt = text(item.latest_datetime)
      if (updatedAt && (!latestSourceTime || updatedAt > latestSourceTime)) latestSourceTime = updatedAt
      const details: PoecurrencyDetails = {
        kind: 'poecurrency',
        latestBuy: positive(item.latest_buy1),
        latestSell: positive(item.latest_sell1),
        averageBuy: positive(item.buy_avg),
        averageSell: positive(item.sell_avg),
        average12hBuy: positive(item.buy_avg_12h),
        average12hSell: positive(item.sell_avg_12h),
        average24hBuy: positive(item.buy_avg_24h),
        average24hSell: positive(item.sell_avg_24h),
        previousBuy: positive(item.prev_buy1),
        previousBuyAt: text(item.prev_buy1_datetime),
        buyChangePercent: finite(item.buy_avg_ratio),
        sellChangePercent: finite(item.sell_avg_ratio),
        anomalyCount,
        errorInfo: text(item.error_info),
      }
      const missingConversion = !!quote && !priceExalted
      const quality = !priceExalted ? 'missing' : error || (anomalyCount || 0) > 0 || missingConversion ? 'anomalous' : 'good'
      const qualityReason = !priceExalted
        ? (quote ? `无法将 ${unit} 换算为崇高石` : '来源没有有效参考价')
        : error ? details.errorInfo || '数据源标记此价格异常'
          : (anomalyCount || 0) > 0 ? `来源记录 ${anomalyCount} 次异常` : undefined
      items.push({
        id: `poecurrency:${stableId(englishName || name || '')}`,
        name: name || englishName!,
        ...(englishName ? { englishName } : {}),
        ...(text(item.item_icon) ? { iconUrl: text(item.item_icon) } : {}),
        categoryId,
        categoryLabel,
        ...(priceExalted ? { priceExalted, priceDivine: divineInExalted ? priceExalted / divineInExalted : undefined } : {}),
        ...(quote ? { originalQuote: { value: quote, unit, label: `${quote} ${unit.toUpperCase()}` } } : {}),
        quality,
        ...(qualityReason ? { qualityReason } : {}),
        ...(updatedAt ? { updatedAt } : {}),
        sourceDetails: details,
      })
    }
  }
  if (!items.length) throw new Error('poecurrency.top returned no valid items')
  const fetchedMs = Date.parse(fetchedAt)
  return {
    schemaVersion: 1,
    realm: 'cn',
    source: 'poecurrency',
    sourceLabel: 'poecurrency.top',
    fetchedAt,
    ...(latestSourceTime ? { sourceUpdatedAt: latestSourceTime } : {}),
    expiresAt: new Date(fetchedMs + 10 * 60_000).toISOString(),
    ...(divineInExalted ? { divineInExalted } : {}),
    items,
  }
}

interface ScoutObservation {
  apiId: string
  name: string
  categoryId: string
  iconUrl?: string
  priceExalted: number
  pairLabel: string
  valueTraded?: number
  volumeTraded?: number
  stockValue?: number
  highestStock?: number
}

export function selectCurrentSoftcoreLeague(payload: unknown): UnknownRecord {
  if (!Array.isArray(payload)) throw new Error('poe2scout returned an invalid league list')
  const candidates = payload.map(record).filter((league): league is UnknownRecord => !!league && league.IsCurrent === true)
  const softcore = candidates.find((league) => {
    const value = text(league.Value) || ''
    const shortName = text(league.ShortName) || ''
    return !/^HC\s/i.test(value) && !/hc$/i.test(shortName)
  })
  if (!softcore || !text(softcore.ShortName) || !text(softcore.Value)) throw new Error('poe2scout current standard league was not found')
  return softcore
}

function scoutObservation(currency: UnknownRecord, data: UnknownRecord, pairLabel: string): ScoutObservation | undefined {
  const apiId = text(currency.ApiId)
  const name = text(currency.Text)
  const priceExalted = positive(data.RelativePrice)
  if (!apiId || !name || !priceExalted) return undefined
  return {
    apiId,
    name,
    categoryId: text(currency.CategoryApiId) || 'currency',
    ...(text(currency.IconUrl) ? { iconUrl: text(currency.IconUrl) } : {}),
    priceExalted,
    pairLabel,
    valueTraded: positive(data.ValueTraded),
    volumeTraded: positive(data.VolumeTraded),
    stockValue: finite(data.StockValue),
    highestStock: finite(data.HighestStock),
  }
}

export function normalizePoe2ScoutSnapshot(leaguesPayload: unknown, referencesPayload: unknown, pairsPayload: unknown, fetchedAt = new Date().toISOString()): CurrencyMarketSnapshot {
  const league = selectCurrentSoftcoreLeague(leaguesPayload)
  if (!Array.isArray(referencesPayload) || !Array.isArray(pairsPayload)) throw new Error('poe2scout returned invalid market data')
  const observations = new Map<string, ScoutObservation[]>()
  const add = (observation?: ScoutObservation) => {
    if (!observation) return
    const list = observations.get(observation.apiId) || []
    list.push(observation)
    observations.set(observation.apiId, list)
  }
  for (const rawPair of pairsPayload) {
    const pair = record(rawPair)
    const one = pair && record(pair.CurrencyOne)
    const two = pair && record(pair.CurrencyTwo)
    const oneData = pair && record(pair.CurrencyOneData)
    const twoData = pair && record(pair.CurrencyTwoData)
    if (!one || !two || !oneData || !twoData) continue
    const pairLabel = `${text(one.Text) || '?'} / ${text(two.Text) || '?'}`
    add(scoutObservation(one, oneData, pairLabel))
    add(scoutObservation(two, twoData, pairLabel))
  }

  const best = new Map<string, ScoutObservation>()
  for (const [apiId, values] of observations) {
    const selected = [...values].sort((a, b) => (b.valueTraded || 0) - (a.valueTraded || 0) || b.priceExalted - a.priceExalted)[0]
    if (selected) best.set(apiId, selected)
  }
  for (const rawReference of referencesPayload) {
    const reference = record(rawReference)
    if (!reference) continue
    const apiId = text(reference.ApiId)
    const name = text(reference.Text)
    const priceExalted = positive(reference.RelativePrice)
    if (!apiId || !name || !priceExalted) continue
    if (priceExalted === 1 || !best.has(apiId)) {
      best.set(apiId, {
        apiId, name, categoryId: 'currency', priceExalted,
        ...(text(reference.IconUrl) ? { iconUrl: text(reference.IconUrl) } : {}),
        pairLabel: 'ReferenceCurrencies',
      })
    }
  }
  if (!best.size) throw new Error('poe2scout returned no valid prices')
  const divineInExalted = positive(league.DivinePrice) || best.get('divine')?.priceExalted
  const items = [...best.values()].map((observation): CurrencyMarketItem => {
    const details: Poe2ScoutDetails = {
      kind: 'poe2scout',
      pairLabel: observation.pairLabel,
      valueTraded: observation.valueTraded,
      volumeTraded: observation.volumeTraded,
      stockValue: observation.stockValue,
      highestStock: observation.highestStock,
    }
    return {
      id: `poe2scout:${observation.apiId}`,
      name: observation.name,
      englishName: observation.name,
      ...(observation.iconUrl ? { iconUrl: observation.iconUrl } : {}),
      categoryId: observation.categoryId,
      categoryLabel: CATEGORY_LABELS[observation.categoryId] || observation.categoryId,
      priceExalted: observation.priceExalted,
      ...(divineInExalted ? { priceDivine: observation.priceExalted / divineInExalted } : {}),
      originalQuote: { value: observation.priceExalted, unit: 'e', label: `${observation.priceExalted} E` },
      quality: 'good',
      sourceDetails: details,
    }
  })
  const fetchedMs = Date.parse(fetchedAt)
  return {
    schemaVersion: 1,
    realm: 'global',
    source: 'poe2scout',
    sourceLabel: 'poe2scout.com',
    sourceLeague: text(league.Value),
    fetchedAt,
    expiresAt: new Date(fetchedMs + 10 * 60_000).toISOString(),
    ...(divineInExalted ? { divineInExalted } : {}),
    items,
  }
}
