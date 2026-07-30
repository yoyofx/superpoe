import { createHash } from 'node:crypto'
import type {
  LibraryItemSnapshot,
  LibraryModifier,
  LibraryModifierGroup,
  LibraryModifierSource,
  LibraryModifierTag,
  MarketDomListingRef,
  MarketFavoriteSource,
  MarketPriceSnapshot,
} from '../src/types/market.js'
import { marketSourceKey } from './equipmentLibraryRepository.js'

interface NormalizedMarketListing {
  item: LibraryItemSnapshot
  source: MarketFavoriteSource
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []
}

function cleanText(value: unknown): string {
  return typeof value === 'string' ? value.replace(/<<[^>]+>>/g, '').trim() : ''
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function sourceForGroup(group: string): LibraryModifierSource {
  if (['implicit', 'enchant', 'rune', 'fractured', 'crafted', 'desecrated', 'explicit'].includes(group)) {
    return group as LibraryModifierSource
  }
  return 'unknown'
}

function displayGroupFor(group: string): LibraryModifierGroup {
  if (group === 'implicit' || group === 'enchant' || group === 'rune') return group
  return 'explicit'
}

function sourceTagsFor(group: string): LibraryModifierTag[] {
  const source = sourceForGroup(group)
  return source === 'unknown' ? [] : [source]
}

function numericValues(text: string): number[] {
  return [...text.matchAll(/[-+]?\d+(?:\.\d+)?/g)]
    .map((match) => Number(match[0]))
    .filter(Number.isFinite)
}

function hashesByIndex(hashes: unknown): Map<number, string[]> {
  const result = new Map<number, string[]>()
  if (!Array.isArray(hashes)) return result
  for (const tuple of hashes) {
    if (!Array.isArray(tuple) || typeof tuple[0] !== 'string' || !Array.isArray(tuple[1])) continue
    for (const index of tuple[1]) {
      if (typeof index !== 'number' || !Number.isInteger(index)) continue
      const current = result.get(index) || []
      current.push(tuple[0])
      result.set(index, current)
    }
  }
  return result
}

function tierData(mods: unknown, index: number): LibraryModifier['tier'] | undefined {
  if (!Array.isArray(mods)) return undefined
  const mod = record(mods[index])
  const tier = cleanText(mod.tier)
  const name = cleanText(mod.name)
  const level = numberValue(mod.level)
  const rankMatch = tier.match(/(\d+)/)
  if (!tier && !name && level == null) return undefined
  return {
    ...(name ? { name } : {}),
    ...(rankMatch ? { rank: Number(rankMatch[1]) } : {}),
    ...(level != null ? { level } : {}),
  }
}

function tierRanges(mods: unknown, index: number): Array<{ min: number; max: number }> {
  if (!Array.isArray(mods)) return []
  const mod = record(mods[index])
  const magnitudes = Array.isArray(mod.magnitudes) ? mod.magnitudes : []
  return magnitudes.flatMap((magnitude) => {
    const value = record(magnitude)
    const min = numberValue(value.min)
    const max = numberValue(value.max)
    return min == null || max == null ? [] : [{ min, max }]
  })
}

function normalizeModifiers(item: Record<string, unknown>, realm: MarketDomListingRef['realm'], capturedAt: string): LibraryModifier[] {
  const extended = record(item.extended)
  const hashGroups = record(extended.hashes)
  const modGroups = record(extended.mods)
  const payloadHash = createHash('sha256').update(JSON.stringify(hashGroups)).digest('hex')
  const groupNames = ['enchant', 'rune', 'implicit', 'explicit', 'fractured', 'crafted', 'desecrated']
  const modifiers: LibraryModifier[] = []
  let displayOrder = 0

  for (const group of groupNames) {
    const lines = strings(item[`${group}Mods`])
    const hashes = hashesByIndex(hashGroups[group])
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index].trim()
      if (!line) continue
      const statIds = [...new Set(hashes.get(index) || [])]
      const queryStatId = statIds.length === 1 ? statIds[0] : undefined
      const [baseStatId, optionId] = queryStatId?.split('|') || []
      const source = sourceForGroup(group)
      const valueMode = optionId ? 'fixed-option' : numericValues(line).length ? 'numeric' : 'presence'
      const values = valueMode === 'numeric' ? numericValues(line) : []
      modifiers.push({
        id: `${group}-${index}`,
        displayOrder: displayOrder++,
        group: displayGroupFor(group),
        sourceTags: sourceTagsFor(group),
        original: {
          locale: realm === 'cn' ? 'zh-CN' : 'en',
          lines: [line],
          displayText: line,
        },
        valueMode,
        currentValues: values,
        tierRanges: tierRanges(modGroups[group], index),
        tradeResolutions: [{
          realm,
          queryStatId,
          baseStatId,
          optionId,
          candidateStatIds: statIds,
          source,
          valueMode,
          valueTransform: 'identity',
          resolvedBy: 'official-listing',
          catalogFetchedAt: capturedAt,
          catalogPayloadHash: payloadHash,
          status: statIds.length === 1 ? 'resolved' : statIds.length > 1 ? 'ambiguous' : 'unresolved',
        }],
        tier: tierData(modGroups[group], index),
      })
    }
  }
  return modifiers
}

function propertyNumber(item: Record<string, unknown>, label: RegExp): number | undefined {
  const properties = Array.isArray(item.properties) ? item.properties : []
  for (const rawProperty of properties) {
    const property = record(rawProperty)
    if (!label.test(cleanText(property.name))) continue
    const values = Array.isArray(property.values) ? property.values : []
    const first = Array.isArray(values[0]) ? values[0][0] : undefined
    if (typeof first !== 'string') continue
    const match = first.match(/[-+]?\d+(?:\.\d+)?/)
    if (match) return Number(match[0])
  }
  return undefined
}

function socketText(item: Record<string, unknown>): string | undefined {
  if (!Array.isArray(item.sockets) || !item.sockets.length) return undefined
  return item.sockets.map((socket) => {
    const value = record(socket)
    return cleanText(value.sColour || value.colour || value.attr || 'S') || 'S'
  }).join(' ')
}

function normalizePrice(listing: Record<string, unknown>): MarketPriceSnapshot | null {
  const price = record(listing.price)
  const amount = numberValue(price.amount)
  const currency = cleanText(price.currency)
  if (amount == null || !currency) return null
  return { amount, currency, display: `${amount} ${currency}` }
}

export function normalizeMarketListing(payload: unknown, ref: MarketDomListingRef): NormalizedMarketListing {
  const root = record(payload)
  const results = Array.isArray(root.result) ? root.result : []
  const result = results.map(record).find((candidate) => cleanText(candidate.id) === ref.listingId) || record(results[0])
  if (!Object.keys(result).length) throw new Error('Official trade listing was not returned')
  const officialId = cleanText(result.id)
  if (officialId && officialId !== ref.listingId) throw new Error('Official trade listing did not match the requested ID')

  const item = record(result.item)
  const listing = record(result.listing)
  const capturedAt = new Date().toISOString()
  const name = cleanText(item.name)
  const baseType = cleanText(item.baseType) || cleanText(item.typeLine)
  if (!name && !baseType) throw new Error('Official trade listing item is invalid')
  const sourceUrl = new URL(ref.sourceUrl)
  const pathParts = sourceUrl.pathname.split('/').filter(Boolean)
  const searchIndex = pathParts.indexOf('search')
  const leagueId = searchIndex >= 0 ? pathParts[searchIndex + 2] : undefined

  return {
    item: {
      rarity: cleanText(item.rarity) || 'UNKNOWN',
      name: name || baseType,
      baseType: baseType || name,
      itemLevel: numberValue(item.ilvl),
      quality: propertyNumber(item, /quality|品质|品質/i),
      sockets: socketText(item),
      corrupted: item.corrupted === true,
      identified: item.identified !== false,
      iconUrl: cleanText(item.icon) || undefined,
      modifiers: normalizeModifiers(item, ref.realm, capturedAt),
    },
    source: {
      kind: 'market-favorite',
      sourceKey: marketSourceKey(ref.realm, ref.listingId),
      capturedAt,
      updatedAt: capturedAt,
      realm: ref.realm,
      leagueId: leagueId ? decodeURIComponent(leagueId) : undefined,
      listingId: ref.listingId,
      queryId: ref.queryId,
      sourceUrl: ref.sourceUrl,
      state: 'available',
      price: normalizePrice(listing),
      indexedAt: cleanText(listing.indexed) || undefined,
    },
  }
}
