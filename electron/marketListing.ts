import { createHash } from 'node:crypto'
import type {
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
  item: {
    raw: string
    iconUrl?: string
    localized?: { 'zh-CN': { name: string; baseType: string } }
    preview: {
      rarity: string
      name: string
      baseType: string
      itemLevel?: number
      quality?: number
      sockets?: string
      corrupted: boolean
      identified: boolean
      modifiers: LibraryModifier[]
    }
  }
  source: MarketFavoriteSource
}

/** Text recovered from the official stat catalog for a listing hash. */
export interface MarketStatTextResolution {
  displayText?: string
  canonicalText?: string
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function cleanText(value: unknown): string {
  return typeof value === 'string' ? value.replace(/<<[^>]+>>/g, '').trim() : ''
}

function localizedText(value: unknown, realm: MarketDomListingRef['realm']): string {
  return cleanText(value).replace(/\[([^|\]]+)\|([^\]]+)\]/g, (_match, global: string, cn: string) => realm === 'cn' ? cn : global)
}

function englishText(value: unknown): string {
  return cleanText(value).replace(/\[([^|\]]+)\|([^\]]+)\]/g, '$1')
}

function verifiedEnglishText(value: unknown): string {
  const text = englishText(value)
  return /[\u3400-\u9fff\ufffd?]/.test(text) ? '' : text
}

function hasPlaceholderText(value: string): boolean {
  return /(?:\?{2,}|\uFFFD)/u.test(value)
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value)
  return undefined
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

function modifierDetails(raw: unknown, realm: MarketDomListingRef['realm'], translateCnStat?: (value: string) => string | undefined): {
  line: string
  englishLine: string
  directStatId?: string
  tier?: LibraryModifier['tier']
  tierRanges: Array<{ min: number; max: number }>
  affixKind?: LibraryModifier['affixKind']
} | null {
  if (typeof raw === 'string') {
    const line = localizedText(raw, realm)
    const english = englishText(raw)
    return { line, englishLine: realm === 'cn' ? (translateCnStat?.(line) || (/[\u3400-\u9fff]/.test(english) ? '' : english)) : english, tierRanges: [] }
  }
  const value = record(raw)
  const line = localizedText(value.description || value.text, realm)
  const directEnglishLine = englishText(value.description || value.text)
  const englishLine = realm === 'cn' ? (translateCnStat?.(line) || (/[\u3400-\u9fff]/.test(directEnglishLine) ? '' : directEnglishLine)) : directEnglishLine
  if (!line) return null
  const hash = cleanText(value.hash).replace(/^stat\.(?=(?:explicit|implicit|enchant|rune|fractured|crafted|desecrated)\.)/, '')
  const nestedMods = Array.isArray(value.mods) ? value.mods : []
  const firstMod = record(nestedMods[0])
  const tierText = cleanText(firstMod.tier)
  const name = localizedText(firstMod.name, realm)
  const level = numberValue(firstMod.level)
  const rankMatch = tierText.match(/(\d+)/)
  const tier = tierText || name || level != null ? {
    ...(name ? { name } : {}),
    ...(rankMatch ? { rank: Number(rankMatch[1]) } : {}),
    ...(level != null ? { level } : {}),
  } : undefined
  const ranges = nestedMods.flatMap((nested) => {
    const magnitudes = Array.isArray(record(nested).magnitudes) ? record(nested).magnitudes as unknown[] : []
    return magnitudes.flatMap((magnitude) => {
      const min = numberValue(record(magnitude).min)
      const max = numberValue(record(magnitude).max)
      return min == null || max == null ? [] : [{ min, max }]
    })
  })
  return {
    line,
    englishLine,
    ...(hash ? { directStatId: hash } : {}),
    ...(tier ? { tier } : {}),
    tierRanges: ranges,
    ...(tierText.startsWith('P') ? { affixKind: 'prefix' as const } : tierText.startsWith('S') ? { affixKind: 'suffix' as const } : {}),
  }
}

function normalizeModifiers(
  item: Record<string, unknown>,
  realm: MarketDomListingRef['realm'],
  capturedAt: string,
  translateCnStat?: (value: string) => string | undefined,
  resolveStatText?: (queryStatId: string) => MarketStatTextResolution | undefined,
): Array<LibraryModifier & { englishLine: string }> {
  const extended = record(item.extended)
  const hashGroups = record(extended.hashes)
  const modGroups = record(extended.mods)
  const payloadHash = createHash('sha256').update(JSON.stringify(hashGroups)).digest('hex')
  const groupNames = ['enchant', 'rune', 'implicit', 'explicit', 'fractured', 'crafted', 'desecrated']
  const modifiers: Array<LibraryModifier & { englishLine: string }> = []
  let displayOrder = 0

  for (const group of groupNames) {
    const rawModifiers = Array.isArray(item[`${group}Mods`]) ? item[`${group}Mods`] as unknown[] : []
    const hashes = hashesByIndex(hashGroups[group])
    for (let index = 0; index < rawModifiers.length; index += 1) {
      let details = modifierDetails(rawModifiers[index], realm, translateCnStat)
      if (!details?.line) continue
      const statIds = details.directStatId ? [details.directStatId] : [...new Set(hashes.get(index) || [])]
      // Some localized trade responses render parameterized descriptions as
      // question-mark placeholders. The hash remains authoritative; recover
      // the text from the official catalog instead of adding a per-affix rule.
      if (resolveStatText && (hasPlaceholderText(details.line) || !details.englishLine)) {
        const fallback = statIds.map((id) => resolveStatText(id)).find(Boolean)
        if (fallback) {
          const line = hasPlaceholderText(details.line) ? fallback.displayText || details.line : details.line
          const englishLine = details.englishLine || fallback.canonicalText || verifiedEnglishText(fallback.displayText || '')
          details = { ...details, line, englishLine }
        }
      }
      if (!details.englishLine) throw new Error(`Official trade modifier could not be mapped to PoB English: ${details.line}`)
      const line = details.line
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
        affixKind: details.affixKind,
        original: {
          locale: realm === 'cn' ? 'zh-CN' : 'en',
          lines: [line],
          displayText: line,
        },
        valueMode,
        currentValues: values,
        tierRanges: details.tierRanges.length ? details.tierRanges : tierRanges(modGroups[group], index),
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
        tier: details.tier || tierData(modGroups[group], index),
        englishLine: details.englishLine,
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

export function normalizeMarketListing(
  payload: unknown,
  ref: MarketDomListingRef,
  translateCnItem?: (value: string) => string | undefined,
  translateCnStat?: (value: string) => string | undefined,
  resolveStatText?: (queryStatId: string) => MarketStatTextResolution | undefined,
): NormalizedMarketListing {
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

  const rarity = cleanText(item.rarity) || 'UNKNOWN'
  const englishBaseType = ref.realm === 'cn' ? (translateCnItem?.(baseType) || verifiedEnglishText(item.baseType) || verifiedEnglishText(item.typeLine)) : baseType
  const englishName = ref.realm === 'cn' ? (translateCnItem?.(name) || verifiedEnglishText(item.name)) : name
  if (!englishBaseType) throw new Error('Official trade listing base type could not be mapped to PoB English')
  const modifiers = normalizeModifiers(item, ref.realm, capturedAt, translateCnStat, resolveStatText)
  const implicit = modifiers.filter((modifier) => ['rune', 'enchant', 'implicit'].includes(modifier.group))
  const explicit = modifiers.filter((modifier) => !implicit.includes(modifier))
  const rawLines = [`Rarity: ${rarity}`]
  if (englishName && englishName !== englishBaseType && ['RARE', 'UNIQUE'].includes(rarity.toUpperCase())) rawLines.push(englishName)
  rawLines.push(englishBaseType)
  const itemLevel = numberValue(item.ilvl)
  const quality = propertyNumber(item, /quality|品质|品質/i)
  const sockets = socketText(item)
  if (itemLevel != null) rawLines.push(`Item Level: ${itemLevel}`)
  if (quality != null) rawLines.push(`Quality: ${quality}`)
  if (sockets) rawLines.push(`Sockets: ${sockets}`)
  rawLines.push(`Implicits: ${implicit.length}`)
  for (const modifier of [...implicit, ...explicit]) {
    const tags = modifier.sourceTags.filter((tag) => ['rune', 'enchant', 'fractured', 'crafted', 'desecrated', 'mutated'].includes(tag))
    rawLines.push(`${tags.map((tag) => `{${tag}}`).join('')}${modifier.englishLine}`)
  }
  if (item.corrupted === true) rawLines.push('Corrupted')

  return {
    item: {
      raw: rawLines.join('\n'),
      iconUrl: cleanText(item.icon) || undefined,
      ...(ref.realm === 'cn' ? { localized: { 'zh-CN': { name: name || baseType, baseType: baseType || name } } } : {}),
      preview: {
        rarity,
        name: name || baseType,
        baseType: baseType || name,
        ...(itemLevel != null ? { itemLevel } : {}),
        ...(quality != null ? { quality } : {}),
        ...(sockets ? { sockets } : {}),
        corrupted: item.corrupted === true,
        identified: item.identified !== false,
        modifiers,
      },
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
      display: {
        locale: ref.realm === 'cn' ? 'zh-CN' : 'en',
        name: name || baseType,
        baseType: baseType || name,
        iconUrl: cleanText(item.icon) || undefined,
        modifiers: modifiers.map((modifier) => modifier.original.displayText),
      },
    },
  }
}
