import type { MarketRealm } from './market.js'

export type CurrencyMarketSource = 'poecurrency' | 'poe2scout'
export type CurrencyMarketQuality = 'good' | 'thin' | 'anomalous' | 'missing'
export type CurrencyQuoteUnit = 'exalted' | 'divine'
export type CurrencyMarketCacheStatus = 'fresh' | 'stale'

export interface PoecurrencyDetails {
  kind: 'poecurrency'
  latestBuy?: number
  latestSell?: number
  averageBuy?: number
  averageSell?: number
  average12hBuy?: number
  average12hSell?: number
  average24hBuy?: number
  average24hSell?: number
  previousBuy?: number
  previousBuyAt?: string
  buyChangePercent?: number
  sellChangePercent?: number
  anomalyCount?: number
  errorInfo?: string
}

export interface Poe2ScoutDetails {
  kind: 'poe2scout'
  pairLabel: string
  valueTraded?: number
  volumeTraded?: number
  stockValue?: number
  highestStock?: number
}

export interface CurrencyMarketItem {
  id: string
  name: string
  englishName?: string
  iconUrl?: string
  categoryId: string
  categoryLabel: string
  priceExalted?: number
  priceDivine?: number
  originalQuote?: { value: number; unit: string; label: string }
  quality: CurrencyMarketQuality
  qualityReason?: string
  updatedAt?: string
  sourceDetails: PoecurrencyDetails | Poe2ScoutDetails
}

export interface CurrencyMarketSnapshot {
  schemaVersion: 1
  realm: MarketRealm
  source: CurrencyMarketSource
  sourceLabel: string
  sourceLeague?: string
  fetchedAt: string
  sourceUpdatedAt?: string
  expiresAt: string
  divineInExalted?: number
  items: CurrencyMarketItem[]
}

export interface CurrencyMarketState {
  snapshot: CurrencyMarketSnapshot
  cacheStatus: CurrencyMarketCacheStatus
  error?: string
}
